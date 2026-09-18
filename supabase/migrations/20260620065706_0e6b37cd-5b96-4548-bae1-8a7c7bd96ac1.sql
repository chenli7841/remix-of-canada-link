
-- A1: per-product freight formula overrides
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS personal_freight_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS business_freight_override jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A2: customers may read active freight/customs rules to render checkout quotes client-side fallback
DROP POLICY IF EXISTS "freight_rules_auth_read_active" ON public.freight_rules;
CREATE POLICY "freight_rules_auth_read_active" ON public.freight_rules
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "customs_rules_auth_read_enabled" ON public.customs_rules;
CREATE POLICY "customs_rules_auth_read_enabled" ON public.customs_rules
  FOR SELECT TO authenticated USING (enabled = true);

-- Helper: compute one cart line's freight breakdown using product override + route rule fallback
CREATE OR REPLACE FUNCTION public._compute_line_quote(
  _product products,
  _route shipping_routes,
  _rule  freight_rules,
  _customs customs_rules,
  _qty int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  ov jsonb;
  weight_mode text; divisor numeric; unit_price numeric;
  min_charge numeric; extra_fee numeric; ins_pct numeric;
  L numeric; W numeric; H numeric; kg numeric; units numeric;
  aw numeric; vw numeric; cw numeric;
  subtotal numeric; line_freight numeric; line_ins numeric; line_customs numeric;
BEGIN
  -- pick override jsonb
  IF _product.purchase_type = 'business' THEN
    ov := COALESCE(_product.business_freight_override, '{}'::jsonb);
  ELSE
    ov := COALESCE(_product.personal_freight_override, '{}'::jsonb);
  END IF;

  weight_mode := COALESCE(NULLIF(ov->>'weight_mode',''), _rule.weight_mode, 'max');
  divisor     := COALESCE(NULLIF(ov->>'volumetric_divisor','')::numeric, _rule.volumetric_divisor, 6000);
  unit_price  := COALESCE(NULLIF(ov->>'unit_price_cny','')::numeric, _rule.unit_price_cny, 0);
  min_charge  := COALESCE(NULLIF(ov->>'min_charge_cny','')::numeric, _rule.min_charge_cny, 0);
  extra_fee   := COALESCE(NULLIF(ov->>'extra_fee_cny','')::numeric, _rule.extra_fee_cny, 0);
  ins_pct     := COALESCE(NULLIF(ov->>'insurance_rate_pct','')::numeric, _rule.insurance_rate_pct, 0);

  IF _product.purchase_type = 'business' THEN
    units := ceil(_qty::numeric / GREATEST(COALESCE(_product.pack_qty,1),1));
    L := COALESCE(_product.pack_length_cm, _product.length_cm, 0);
    W := COALESCE(_product.pack_width_cm,  _product.width_cm,  0);
    H := COALESCE(_product.pack_height_cm, _product.height_cm, 0);
    kg := COALESCE(_product.pack_weight_kg, _product.weight_kg, 0);
  ELSE
    units := _qty;
    L := COALESCE(_product.length_cm, 0);
    W := COALESCE(_product.width_cm,  0);
    H := COALESCE(_product.height_cm, 0);
    kg := COALESCE(_product.weight_kg, 0);
  END IF;

  aw := kg * units;
  vw := CASE WHEN divisor > 0 THEN (L * W * H * units) / divisor ELSE 0 END;
  cw := CASE weight_mode
          WHEN 'actual' THEN aw
          WHEN 'volumetric' THEN vw
          ELSE GREATEST(aw, vw)
        END;

  subtotal := _product.price_cny * _qty;
  line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
  line_ins := round(subtotal * ins_pct / 100.0, 2);

  IF _product.customs_rate > 0 THEN
    line_customs := round(subtotal * _product.customs_rate, 2);
  ELSIF _customs.enabled THEN
    line_customs := round(subtotal * _customs.rate_pct / 100.0, 2);
  ELSE
    line_customs := 0;
  END IF;

  RETURN jsonb_build_object(
    'slug', _product.slug,
    'units', units,
    'chargeable_kg', round(cw, 3),
    'actual_kg', round(aw,3),
    'volumetric_kg', round(vw,3),
    'subtotal_cny', subtotal,
    'freight_cny', line_freight,
    'insurance_cny', line_ins,
    'customs_cny', line_customs,
    'extra_cny', extra_fee
  );
END $$;

-- Quote RPC for the checkout page
CREATE OR REPLACE FUNCTION public.quote_shop_order(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  it jsonb; v_product products; v_qty int;
  v_lines jsonb := '[]'::jsonb; v_line jsonb;
  s_sub numeric := 0; s_freight numeric := 0; s_ins numeric := 0; s_customs numeric := 0;
BEGIN
  SELECT * INTO v_route FROM public.shipping_routes
    WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'route_unavailable');
  END IF;
  SELECT * INTO v_rule FROM public.freight_rules
    WHERE route_id = v_route.id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_customs FROM public.customs_rules
    WHERE route_id = v_route.id LIMIT 1;

  FOR it IN SELECT jsonb_array_elements(_payload->'items') LOOP
    SELECT * INTO v_product FROM public.products
      WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN CONTINUE; END IF;
    IF array_length(v_product.available_route_codes,1) > 0
       AND NOT (v_route.code = ANY(v_product.available_route_codes)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'route_not_for_product', 'slug', v_product.slug);
    END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty);
    v_lines := v_lines || v_line;
    s_sub     := s_sub     + (v_line->>'subtotal_cny')::numeric;
    s_freight := s_freight + (v_line->>'freight_cny')::numeric;
    s_ins     := s_ins     + (v_line->>'insurance_cny')::numeric;
    s_customs := s_customs + (v_line->>'customs_cny')::numeric;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'route_code', v_route.code,
    'subtotal_cny', s_sub,
    'freight_cny', s_freight,
    'insurance_cny', s_ins,
    'customs_cny', s_customs,
    'shipping_total_cny', s_freight + s_ins + s_customs,
    'total_cny', s_sub + s_freight + s_ins + s_customs,
    'lines', v_lines,
    'has_freight_rule', v_rule.id IS NOT NULL
  );
END $$;

-- Replace place_shop_order to use the new pricing model
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  v_method text; v_dest text; v_batch text;
  v_subtotal numeric := 0; v_shipping numeric := 0; v_total numeric := 0;
  v_addr jsonb; v_order_id uuid; v_order_no text;
  it jsonb; v_product products; v_qty int; v_line jsonb;
  v_oi_id uuid; v_n int; v_first_wb uuid; v_wb_id uuid;
  v_items jsonb; i int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_route FROM public.shipping_routes
    WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用: %', _payload->>'route_code'; END IF;
  SELECT * INTO v_rule FROM public.freight_rules
    WHERE route_id = v_route.id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_customs FROM public.customs_rules WHERE route_id = v_route.id LIMIT 1;

  v_method := v_route.shipping_method;
  v_dest := v_route.destination_code;
  v_addr := _payload->'address_snapshot';
  v_items := _payload->'items';
  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;

  -- Validate + sum
  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN RAISE EXCEPTION '商品不存在: %', it->>'slug'; END IF;
    IF array_length(v_product.available_route_codes,1) > 0
       AND NOT (v_route.code = ANY(v_product.available_route_codes)) THEN
      RAISE EXCEPTION '商品 % 不支持线路 %', v_product.name, v_route.code;
    END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty);
    v_subtotal := v_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_shipping := v_shipping
                  + (v_line->>'freight_cny')::numeric
                  + (v_line->>'insurance_cny')::numeric
                  + (v_line->>'customs_cny')::numeric;
  END LOOP;
  v_total := v_subtotal + v_shipping;

  SELECT batch_no INTO v_batch FROM public.batches
    WHERE shipping_method = v_method
      AND COALESCE(destination_code,'') = COALESCE(v_dest,'')
      AND status IN ('draft','locked')
    ORDER BY planned_ship_date NULLS LAST LIMIT 1;

  INSERT INTO public.orders(
    user_id, source, status, subtotal_cny, shipping_cny, total_cny,
    shipping_method, route_code, destination_code, route_id, customer_code, batch_no,
    address_snapshot, payment_status
  ) VALUES (
    uid, 'shop', 'pending', v_subtotal, v_shipping, v_total,
    v_method, v_route.code, v_dest, v_route.id, v_cust, v_batch,
    v_addr, 'unpaid'
  ) RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug';
    v_qty := GREATEST((it->>'quantity')::int, 1);
    INSERT INTO public.order_items(
      order_id, product_id, product_slug, name_zh, name_en, image_url,
      unit_price_cny, quantity, subtotal_cny, purchase_type
    ) VALUES (
      v_order_id, v_product.id, v_product.slug, v_product.name, v_product.name,
      v_product.cover_url, v_product.price_cny, v_qty,
      v_product.price_cny * v_qty, v_product.purchase_type::text
    ) RETURNING id INTO v_oi_id;

    v_n := GREATEST(1, ceil(v_qty::numeric / GREATEST(COALESCE(v_product.pack_qty,1),1))::int);
    v_first_wb := NULL;
    FOR i IN 1..v_n LOOP
      INSERT INTO public.waybills(
        user_id, order_id, customer_code, route_code, destination_code,
        shipping_method, batch_no, status, payment_status,
        length_cm, width_cm, height_cm, weight_kg
      ) VALUES (
        uid, v_order_id, v_cust, v_route.code, v_dest,
        v_method, v_batch, 'pending', 'unpaid',
        v_product.pack_length_cm, v_product.pack_width_cm,
        v_product.pack_height_cm, v_product.pack_weight_kg
      ) RETURNING id INTO v_wb_id;
      IF i = 1 THEN v_first_wb := v_wb_id; END IF;
    END LOOP;
    UPDATE public.order_items SET waybill_id = v_first_wb WHERE id = v_oi_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_no', v_order_no);
END $$;
