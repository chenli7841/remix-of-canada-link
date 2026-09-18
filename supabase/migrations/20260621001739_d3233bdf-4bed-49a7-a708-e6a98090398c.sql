
-- ============================================================
-- Shop redesign: purchase modes, CAD fields, freight formula
-- ============================================================

-- 1) Storage policies for shop-media bucket
DROP POLICY IF EXISTS "shop_media_public_read" ON storage.objects;
CREATE POLICY "shop_media_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'shop-media');

DROP POLICY IF EXISTS "shop_media_staff_write" ON storage.objects;
CREATE POLICY "shop_media_staff_write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'shop-media' AND public.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'shop-media' AND public.is_staff(auth.uid()));

-- 2) Products: new columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS allow_personal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_business boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compare_price_cad numeric(12,2),
  ADD COLUMN IF NOT EXISTS last_mile_fee_cad numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_freight_mode text NOT NULL DEFAULT 'follow_route',
  ADD COLUMN IF NOT EXISTS personal_per_unit_freight_cny numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_chargeable_weight_kg numeric(8,3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_personal_freight_mode_chk') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_personal_freight_mode_chk
      CHECK (personal_freight_mode IN ('follow_route','per_unit'));
  END IF;
END $$;

-- 3) Backfill allow_personal/allow_business from existing purchase_type
UPDATE public.products
   SET allow_personal = (purchase_type = 'personal'),
       allow_business = (purchase_type = 'business');

-- 4) FX setting (CAD <-> CNY) used by RPC if last_mile_fee_cad needs conversion
INSERT INTO public.app_settings(key, value)
VALUES ('fx_cad_to_cny', jsonb_build_object('rate', 5.26))
ON CONFLICT (key) DO NOTHING;

-- 5) Rewrite _compute_line_quote with new formula
CREATE OR REPLACE FUNCTION public._compute_line_quote(
  _product products,
  _route shipping_routes,
  _rule freight_rules,
  _customs customs_rules,
  _qty integer,
  _mode text DEFAULT 'personal'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $function$
DECLARE
  ov jsonb;
  weight_mode text; divisor numeric; unit_price numeric;
  min_charge numeric; extra_fee numeric; ins_pct numeric;
  L numeric; W numeric; H numeric; kg numeric; units numeric;
  aw numeric; vw numeric; cw numeric;
  subtotal numeric; line_freight numeric; line_ins numeric; line_customs numeric;
  fx_cad_cny numeric;
  last_mile_cny numeric;
  is_business boolean;
BEGIN
  is_business := (_mode = 'business');

  IF is_business THEN
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

  subtotal := _product.price_cny * _qty;

  IF is_business THEN
    -- Business: pack-based, follow route
    units := ceil(_qty::numeric / GREATEST(COALESCE(_product.pack_qty,1),1));
    L := COALESCE(_product.pack_length_cm, _product.length_cm, 0);
    W := COALESCE(_product.pack_width_cm,  _product.width_cm,  0);
    H := COALESCE(_product.pack_height_cm, _product.height_cm, 0);
    kg := COALESCE(_product.pack_weight_kg, _product.weight_kg, 0);
    aw := kg * units;
    vw := CASE WHEN divisor > 0 THEN (L * W * H * units) / divisor ELSE 0 END;
    cw := CASE weight_mode WHEN 'actual' THEN aw WHEN 'volumetric' THEN vw ELSE GREATEST(aw, vw) END;
    line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;

    -- last mile fee (CAD -> CNY)
    SELECT COALESCE((value->>'rate')::numeric, 5.26) INTO fx_cad_cny
      FROM public.app_settings WHERE key = 'fx_cad_to_cny';
    last_mile_cny := round(COALESCE(_product.last_mile_fee_cad,0) * COALESCE(fx_cad_cny,5.26), 2);
    line_freight := line_freight + last_mile_cny;

    -- customs: business only
    IF _product.customs_rate > 0 THEN
      line_customs := round(subtotal * _product.customs_rate, 2);
    ELSIF _customs.enabled THEN
      line_customs := round(subtotal * _customs.rate_pct / 100.0, 2);
    ELSE
      line_customs := 0;
    END IF;
  ELSE
    -- Personal: per_unit OR follow_route
    units := _qty;
    L := COALESCE(_product.length_cm, 0);
    W := COALESCE(_product.width_cm, 0);
    H := COALESCE(_product.height_cm, 0);
    kg := COALESCE(_product.personal_chargeable_weight_kg, _product.weight_kg, 0);

    IF _product.personal_freight_mode = 'per_unit' THEN
      cw := 0;
      aw := COALESCE(_product.weight_kg,0) * units;
      vw := 0;
      line_freight := round(_qty * COALESCE(_product.personal_per_unit_freight_cny, 0), 2);
    ELSE
      -- follow_route: qty * preset_chargeable_weight * route_unit_price
      cw := kg * units;
      aw := COALESCE(_product.weight_kg,0) * units;
      vw := CASE WHEN divisor > 0 THEN (L * W * H * units) / divisor ELSE 0 END;
      line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
    END IF;
    last_mile_cny := 0;
    line_customs := 0; -- personal: no customs
  END IF;

  line_ins := round(subtotal * ins_pct / 100.0, 2);

  RETURN jsonb_build_object(
    'slug', _product.slug,
    'mode', _mode,
    'units', units,
    'chargeable_kg', round(cw, 3),
    'actual_kg', round(aw,3),
    'volumetric_kg', round(vw,3),
    'subtotal_cny', subtotal,
    'freight_cny', line_freight,
    'last_mile_cny', last_mile_cny,
    'insurance_cny', line_ins,
    'customs_cny', line_customs,
    'extra_cny', extra_fee
  );
END $function$;

-- 6) quote_shop_order: accept payload.mode + per-item.mode
CREATE OR REPLACE FUNCTION public.quote_shop_order(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  it jsonb; v_product products; v_qty int; v_mode text; v_default_mode text;
  v_lines jsonb := '[]'::jsonb; v_line jsonb;
  s_sub numeric := 0; s_freight numeric := 0; s_ins numeric := 0; s_customs numeric := 0;
  v_coupon jsonb; v_disc numeric := 0;
BEGIN
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
  SELECT * INTO v_route FROM public.shipping_routes
    WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'route_unavailable');
  END IF;
  SELECT * INTO v_rule FROM public.freight_rules
    WHERE route_id = v_route.id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_customs FROM public.customs_rules WHERE route_id = v_route.id LIMIT 1;

  FOR it IN SELECT jsonb_array_elements(_payload->'items') LOOP
    SELECT * INTO v_product FROM public.products
      WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN CONTINUE; END IF;
    IF array_length(v_product.available_route_codes,1) > 0
       AND NOT (v_route.code = ANY(v_product.available_route_codes)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'route_not_for_product', 'slug', v_product.slug);
    END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    -- enforce permissions
    IF v_mode = 'business' AND NOT v_product.allow_business THEN v_mode := 'personal'; END IF;
    IF v_mode = 'personal' AND NOT v_product.allow_personal THEN v_mode := 'business'; END IF;
    -- MOQ enforcement for business
    IF v_mode = 'business' AND v_qty < COALESCE(v_product.moq,1) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'below_moq',
        'slug', v_product.slug, 'moq', v_product.moq);
    END IF;
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode);
    v_lines := v_lines || v_line;
    s_sub     := s_sub     + (v_line->>'subtotal_cny')::numeric;
    s_freight := s_freight + (v_line->>'freight_cny')::numeric;
    s_ins     := s_ins     + (v_line->>'insurance_cny')::numeric;
    s_customs := s_customs + (v_line->>'customs_cny')::numeric;
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', s_sub);
    IF (v_coupon->>'ok')::boolean THEN
      v_disc := (v_coupon->>'discount_cny')::numeric;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'route_code', v_route.code,
    'subtotal_cny', s_sub,
    'freight_cny', s_freight,
    'insurance_cny', s_ins,
    'customs_cny', s_customs,
    'discount_cny', v_disc,
    'coupon', v_coupon,
    'shipping_total_cny', s_freight + s_ins + s_customs,
    'total_cny', GREATEST(s_sub + s_freight + s_ins + s_customs - v_disc, 0),
    'lines', v_lines,
    'has_freight_rule', v_rule.id IS NOT NULL
  );
END $function$;

-- 7) place_shop_order: same mode handling
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  v_method text; v_dest text; v_batch text;
  v_subtotal numeric := 0; v_shipping numeric := 0;
  v_ins numeric := 0; v_cus numeric := 0; v_total numeric := 0; v_disc numeric := 0;
  v_addr jsonb; v_order_id uuid; v_order_no text;
  it jsonb; v_product products; v_qty int; v_line jsonb;
  v_oi_id uuid; v_n int; v_first_wb uuid; v_wb_id uuid;
  v_items jsonb; i int;
  v_coupon jsonb; v_coupon_id uuid;
  v_mode text; v_default_mode text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
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

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN RAISE EXCEPTION '商品不存在: %', it->>'slug'; END IF;
    IF array_length(v_product.available_route_codes,1) > 0
       AND NOT (v_route.code = ANY(v_product.available_route_codes)) THEN
      RAISE EXCEPTION '商品 % 不支持线路 %', v_product.name, v_route.code;
    END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    IF v_mode = 'business' AND NOT v_product.allow_business THEN v_mode := 'personal'; END IF;
    IF v_mode = 'personal' AND NOT v_product.allow_personal THEN v_mode := 'business'; END IF;
    IF v_mode = 'business' AND v_qty < COALESCE(v_product.moq,1) THEN
      RAISE EXCEPTION '商品 % 商业采购最少 % 件', v_product.name, v_product.moq;
    END IF;
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode);
    v_subtotal := v_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_shipping := v_shipping + (v_line->>'freight_cny')::numeric;
    v_ins      := v_ins      + (v_line->>'insurance_cny')::numeric;
    v_cus      := v_cus      + (v_line->>'customs_cny')::numeric;
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', v_subtotal);
    IF NOT (v_coupon->>'ok')::boolean THEN
      RAISE EXCEPTION '优惠券无效: %', v_coupon->>'reason';
    END IF;
    v_disc := (v_coupon->>'discount_cny')::numeric;
    v_coupon_id := (v_coupon->>'coupon_id')::uuid;
  END IF;

  v_total := GREATEST(v_subtotal + v_shipping + v_ins + v_cus - v_disc, 0);

  SELECT batch_no INTO v_batch FROM public.batches
    WHERE shipping_method = v_method
      AND COALESCE(destination_code,'') = COALESCE(v_dest,'')
      AND status IN ('draft','locked')
    ORDER BY planned_ship_date NULLS LAST LIMIT 1;

  INSERT INTO public.orders(
    user_id, source, status, subtotal_cny, shipping_cny, insurance_cny, customs_cny,
    total_cny, discount_cny, coupon_id,
    shipping_method, route_code, destination_code, route_id, customer_code, batch_no,
    address_snapshot, payment_status
  ) VALUES (
    uid, 'shop', 'pending', v_subtotal, v_shipping, v_ins, v_cus,
    v_total, v_disc, v_coupon_id,
    v_method, v_route.code, v_dest, v_route.id, v_cust, v_batch,
    v_addr, 'unpaid'
  ) RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug';
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    IF v_mode = 'business' AND NOT v_product.allow_business THEN v_mode := 'personal'; END IF;
    IF v_mode = 'personal' AND NOT v_product.allow_personal THEN v_mode := 'business'; END IF;
    INSERT INTO public.order_items(
      order_id, product_id, product_slug, name_zh, name_en, image_url,
      unit_price_cny, quantity, subtotal_cny, purchase_type
    ) VALUES (
      v_order_id, v_product.id, v_product.slug, v_product.name, v_product.name,
      v_product.cover_url, v_product.price_cny, v_qty,
      v_product.price_cny * v_qty, v_mode
    ) RETURNING id INTO v_oi_id;

    IF v_mode = 'business' THEN
      v_n := GREATEST(1, ceil(v_qty::numeric / GREATEST(COALESCE(v_product.pack_qty,1),1))::int);
    ELSE
      v_n := 1;
    END IF;
    v_first_wb := NULL;
    FOR i IN 1..v_n LOOP
      INSERT INTO public.waybills(
        user_id, order_id, customer_code, route_code, destination_code,
        shipping_method, batch_no, status, payment_status,
        length_cm, width_cm, height_cm, weight_kg
      ) VALUES (
        uid, v_order_id, v_cust, v_route.code, v_dest,
        v_method, v_batch, 'pending', 'unpaid',
        CASE WHEN v_mode='business' THEN v_product.pack_length_cm ELSE v_product.length_cm END,
        CASE WHEN v_mode='business' THEN v_product.pack_width_cm  ELSE v_product.width_cm  END,
        CASE WHEN v_mode='business' THEN v_product.pack_height_cm ELSE v_product.height_cm END,
        CASE WHEN v_mode='business' THEN v_product.pack_weight_kg ELSE v_product.weight_kg END
      ) RETURNING id INTO v_wb_id;
      IF i = 1 THEN v_first_wb := v_wb_id; END IF;
    END LOOP;
    UPDATE public.order_items SET waybill_id = v_first_wb WHERE id = v_oi_id;
  END LOOP;

  IF v_coupon_id IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions(coupon_id, user_id, order_id)
      VALUES (v_coupon_id, uid, v_order_id);
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_coupon_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_no', v_order_no);
END $function$;
