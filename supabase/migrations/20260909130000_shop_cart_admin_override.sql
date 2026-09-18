-- 后台改价 + 按覆盖价下单 + 审计
--   - 后台可改「单品价 / 整车总收费 / 数量 / 线路 / 优惠码 / 备注」，改价必须写原因，逐条落 admin_action_logs
--   - override 只写在 shop_cart(_items) 的 override_* 列，绝不动 products / product_variants
--   - _shop_cart_reprice 照常重算「基础报价」写基础列；另算 effective_* 列（叠加 override）供展示与扣款
--   - place_shop_order 新增 cart_id 分支：从后端购物车下单，按 effective 价建单、扣款，
--     order_items 同时留底 list_price_cny + price_override_reason；下单后购物车置 ordered

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS list_price_cny numeric,
  ADD COLUMN IF NOT EXISTS price_override_reason text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS price_override_reason text,
  ADD COLUMN IF NOT EXISTS overridden_by uuid;

ALTER TABLE public.shop_carts
  ADD COLUMN IF NOT EXISTS effective_subtotal_cny numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_total_cny numeric NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- reprice v2：基础列同 PR2；新增 effective_subtotal_cny / effective_total_cny
--   effective_subtotal = Σ COALESCE(行override单价 * 数量, 行基础小计)
--   effective_total     = 整车override总价（若有）否则 effective_subtotal + 运/税/险 - 优惠
-- override_* 列只读不写。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._shop_cart_reprice(_cart_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart public.shop_carts;
  v_items jsonb := '[]'::jsonb;
  v_quote jsonb;
  v_ok boolean := false;
  it public.shop_cart_items;
  v_product products; v_variant product_variants; v_line jsonb;
  s_sub numeric := 0; s_frt numeric := 0; s_cus numeric := 0; s_ins numeric := 0; s_disc numeric := 0;
  v_coupon jsonb;
  v_needs_route boolean;
  v_eff_sub numeric := 0;
  v_eff_total numeric;
BEGIN
  SELECT * INTO v_cart FROM public.shop_carts WHERE id = _cart_id FOR UPDATE;
  IF v_cart IS NULL THEN RETURN; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'slug', ci.product_slug,
           'variant_id', ci.variant_id,
           'quantity', ci.quantity,
           'mode', ci.mode
         )), '[]'::jsonb)
    INTO v_items
  FROM public.shop_cart_items ci WHERE ci.cart_id = _cart_id;

  v_needs_route := (COALESCE(v_cart.route_code, '') = '');

  IF NOT v_needs_route AND jsonb_array_length(v_items) > 0 THEN
    v_quote := public.quote_shop_order(jsonb_build_object(
      'route_code', v_cart.route_code,
      'shipping_method', v_cart.shipping_method,
      'items', v_items,
      'coupon_code', v_cart.coupon_code
    ));
    v_ok := COALESCE((v_quote->>'ok')::boolean, false);
  END IF;

  IF v_ok THEN
    s_sub  := COALESCE((v_quote->>'subtotal_cny')::numeric, 0);
    s_frt  := COALESCE((v_quote->>'freight_cny')::numeric, 0);
    s_cus  := COALESCE((v_quote->>'customs_cny')::numeric, 0);
    s_ins  := COALESCE((v_quote->>'insurance_cny')::numeric, 0);
    s_disc := COALESCE((v_quote->>'discount_cny')::numeric, 0);

    FOR it IN SELECT * FROM public.shop_cart_items WHERE cart_id = _cart_id LOOP
      v_line := NULL;
      SELECT e.val INTO v_line
      FROM jsonb_array_elements(v_quote->'lines') AS e(val)
      WHERE e.val->>'slug' = it.product_slug
        AND COALESCE(e.val->>'variant_id', '') = COALESCE(it.variant_id::text, '')
      LIMIT 1;
      UPDATE public.shop_cart_items SET
        unit_price_cny     = CASE WHEN it.quantity > 0
                                  THEN round(COALESCE((v_line->>'subtotal_cny')::numeric, 0) / it.quantity, 4)
                                  ELSE 0 END,
        line_subtotal_cny  = COALESCE((v_line->>'subtotal_cny')::numeric, 0),
        line_freight_cny   = COALESCE((v_line->>'freight_cny')::numeric, 0),
        line_customs_cny   = COALESCE((v_line->>'customs_cny')::numeric, 0),
        line_insurance_cny = COALESCE((v_line->>'insurance_cny')::numeric, 0),
        chargeable_kg      = COALESCE((v_line->>'chargeable_kg')::numeric, 0),
        units              = COALESCE((v_line->>'units')::int, 0)
      WHERE id = it.id;
    END LOOP;
  ELSE
    FOR it IN SELECT * FROM public.shop_cart_items WHERE cart_id = _cart_id LOOP
      SELECT * INTO v_product FROM public.products WHERE slug = it.product_slug AND status = 'active';
      IF v_product IS NULL THEN
        UPDATE public.shop_cart_items SET
          unit_price_cny = 0, line_subtotal_cny = 0, line_freight_cny = 0,
          line_customs_cny = 0, line_insurance_cny = 0, chargeable_kg = 0, units = 0
        WHERE id = it.id;
        CONTINUE;
      END IF;
      v_variant := NULL;
      IF it.variant_id IS NOT NULL THEN
        SELECT * INTO v_variant FROM public.product_variants
          WHERE id = it.variant_id AND product_id = v_product.id AND is_active = true;
      END IF;
      v_line := public._compute_line_quote(
        v_product, NULL::shipping_routes, NULL::freight_rules, NULL::customs_rules,
        GREATEST(it.quantity, 1), it.mode, v_variant);
      UPDATE public.shop_cart_items SET
        unit_price_cny     = round(COALESCE(v_variant.price_cny, v_product.price_cny), 4),
        line_subtotal_cny  = COALESCE((v_line->>'subtotal_cny')::numeric, 0),
        line_freight_cny   = 0,
        line_customs_cny   = COALESCE((v_line->>'customs_cny')::numeric, 0),
        line_insurance_cny = 0,
        chargeable_kg      = COALESCE((v_line->>'chargeable_kg')::numeric, 0),
        units              = COALESCE((v_line->>'units')::int, 0)
      WHERE id = it.id;
      s_sub := s_sub + COALESCE((v_line->>'subtotal_cny')::numeric, 0);
      s_cus := s_cus + COALESCE((v_line->>'customs_cny')::numeric, 0);
    END LOOP;

    IF COALESCE(v_cart.coupon_code, '') <> '' THEN
      v_coupon := public.validate_coupon(v_cart.coupon_code, s_sub);
      IF COALESCE((v_coupon->>'ok')::boolean, false) THEN
        s_disc := COALESCE((v_coupon->>'discount_cny')::numeric, 0);
      END IF;
    END IF;
  END IF;

  -- effective：叠加行/整车 override（override_* 列本函数只读）
  SELECT COALESCE(SUM(COALESCE(ci.override_unit_price_cny * ci.quantity, ci.line_subtotal_cny)), 0)
    INTO v_eff_sub
  FROM public.shop_cart_items ci WHERE ci.cart_id = _cart_id;

  IF v_cart.override_total_cny IS NOT NULL THEN
    v_eff_total := v_cart.override_total_cny;
  ELSE
    v_eff_total := GREATEST(v_eff_sub + s_frt + s_cus + s_ins - s_disc, 0);
  END IF;

  UPDATE public.shop_carts SET
    subtotal_cny           = s_sub,
    freight_cny            = s_frt,
    customs_cny            = s_cus,
    insurance_cny          = s_ins,
    discount_cny           = s_disc,
    total_cny              = GREATEST(s_sub + s_frt + s_cus + s_ins - s_disc, 0),
    effective_subtotal_cny = v_eff_sub,
    effective_total_cny    = v_eff_total,
    quote_snapshot         = v_quote,
    quoted_at              = now(),
    needs_route            = v_needs_route,
    updated_at             = now()
  WHERE id = _cart_id;
END $$;

-- ---------------------------------------------------------------------------
-- 后台改购物车（员工）。单次一个 op，改价类必须带 reason，逐条落 admin_action_logs。
-- op: set_line_price | clear_line_price | set_line_qty | remove_line
--     | set_total_override | clear_total_override | set_meta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shop_cart_admin_adjust(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_op text := _payload->>'op';
  v_cart_id uuid := NULLIF(_payload->>'cart_id', '')::uuid;
  v_item_id uuid := NULLIF(_payload->>'item_id', '')::uuid;
  v_reason text := NULLIF(trim(COALESCE(_payload->>'reason', '')), '');
  v_op_name text;
  v_before jsonb;
  v_after jsonb;
  v_num numeric;
  v_cart public.shop_carts;
  v_item public.shop_cart_items;
BEGIN
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_cart_id IS NULL THEN RAISE EXCEPTION 'cart_id required'; END IF;
  SELECT * INTO v_cart FROM public.shop_carts WHERE id = v_cart_id;
  IF v_cart IS NULL THEN RAISE EXCEPTION 'cart not found'; END IF;
  IF v_cart.status <> 'active' THEN RAISE EXCEPTION 'cart not active (status=%)', v_cart.status; END IF;

  IF v_op IN ('set_line_price', 'clear_line_price', 'set_line_qty', 'remove_line',
              'set_total_override', 'clear_total_override')
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required for %', v_op;
  END IF;

  IF v_op IN ('set_line_price', 'clear_line_price', 'set_line_qty', 'remove_line') THEN
    SELECT * INTO v_item FROM public.shop_cart_items WHERE id = v_item_id AND cart_id = v_cart_id;
    IF v_item IS NULL THEN RAISE EXCEPTION 'cart item not found'; END IF;
    v_before := to_jsonb(v_item);
  END IF;

  IF v_op = 'set_line_price' THEN
    v_num := (_payload->>'override_unit_price_cny')::numeric;
    IF v_num IS NULL OR v_num < 0 THEN RAISE EXCEPTION 'invalid override_unit_price_cny'; END IF;
    UPDATE public.shop_cart_items SET
      override_unit_price_cny = v_num, override_reason = v_reason,
      overridden_by = v_uid, overridden_at = now()
    WHERE id = v_item_id RETURNING to_jsonb(shop_cart_items) INTO v_after;
    v_op_name := 'override_unit_price';

  ELSIF v_op = 'clear_line_price' THEN
    UPDATE public.shop_cart_items SET
      override_unit_price_cny = NULL, override_reason = NULL,
      overridden_by = NULL, overridden_at = NULL
    WHERE id = v_item_id RETURNING to_jsonb(shop_cart_items) INTO v_after;
    v_op_name := 'clear_unit_price_override';

  ELSIF v_op = 'set_line_qty' THEN
    v_num := GREATEST((_payload->>'quantity')::int, 1);
    UPDATE public.shop_cart_items SET quantity = v_num::int
    WHERE id = v_item_id RETURNING to_jsonb(shop_cart_items) INTO v_after;
    v_op_name := 'set_quantity';

  ELSIF v_op = 'remove_line' THEN
    DELETE FROM public.shop_cart_items WHERE id = v_item_id;
    v_after := 'null'::jsonb;
    v_op_name := 'remove_item';

  ELSIF v_op = 'set_total_override' THEN
    v_num := (_payload->>'override_total_cny')::numeric;
    IF v_num IS NULL OR v_num < 0 THEN RAISE EXCEPTION 'invalid override_total_cny'; END IF;
    v_before := to_jsonb(v_cart);
    UPDATE public.shop_carts SET
      override_total_cny = v_num, override_reason = v_reason,
      overridden_by = v_uid, overridden_at = now()
    WHERE id = v_cart_id RETURNING to_jsonb(shop_carts) INTO v_after;
    v_op_name := 'override_total';

  ELSIF v_op = 'clear_total_override' THEN
    v_before := to_jsonb(v_cart);
    UPDATE public.shop_carts SET
      override_total_cny = NULL, override_reason = NULL,
      overridden_by = NULL, overridden_at = NULL
    WHERE id = v_cart_id RETURNING to_jsonb(shop_carts) INTO v_after;
    v_op_name := 'clear_total_override';

  ELSIF v_op = 'set_meta' THEN
    v_before := to_jsonb(v_cart);
    UPDATE public.shop_carts SET
      route_code      = CASE WHEN _payload ? 'route_code' THEN NULLIF(_payload->>'route_code','') ELSE route_code END,
      shipping_method = CASE WHEN _payload ? 'shipping_method' THEN NULLIF(_payload->>'shipping_method','') ELSE shipping_method END,
      coupon_code     = CASE WHEN _payload ? 'coupon_code' THEN NULLIF(_payload->>'coupon_code','') ELSE coupon_code END,
      note            = CASE WHEN _payload ? 'note' THEN NULLIF(_payload->>'note','') ELSE note END
    WHERE id = v_cart_id RETURNING to_jsonb(shop_carts) INTO v_after;
    v_op_name := 'set_meta';

  ELSE
    RAISE EXCEPTION 'unknown op: %', v_op;
  END IF;

  INSERT INTO public.admin_action_logs (entity_type, entity_id, action, before, after, operator_id, operator_name, note)
  VALUES (
    CASE WHEN v_op LIKE '%line%' THEN 'shop_cart_item' ELSE 'shop_cart' END,
    COALESCE(v_item_id, v_cart_id)::text,
    v_op_name,
    v_before, v_after, v_uid,
    (SELECT full_name FROM public.profiles WHERE id = v_uid),
    v_reason
  );

  PERFORM public._shop_cart_reprice(v_cart_id);
  RETURN public._shop_cart_payload(v_cart_id);
END $$;

-- ---------------------------------------------------------------------------
-- place_shop_order —— 在 20260814210000 版本基础上增加 cart_id 分支。
-- 传 cart_id：从后端购物车下单，按 effective 价扣款，order_items 留底 list 价 + 原因。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  v_cust text;
  v_addr jsonb;
  v_default_mode text; v_ship_method text;
  v_items jsonb; it jsonb;
  v_product products; v_variant product_variants; v_qty int; v_mode text;
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  v_route_code text; v_line jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_group_key text; v_group jsonb;
  v_route_keys text[];
  v_order_id uuid; v_order_no text;
  v_order_ids uuid[] := ARRAY[]::uuid[];
  v_total_subtotal numeric := 0;
  v_total_freight  numeric := 0;
  v_total_customs  numeric := 0;
  v_total_ins      numeric := 0;
  v_disc numeric := 0; v_coupon jsonb; v_coupon_id uuid;
  v_grand_total numeric := 0;
  v_inv_id uuid; v_inv_no text;
  v_fx numeric := public.current_fx_cny_to_cad(); v_need_cad numeric; v_bal numeric;
  v_units int; v_i int;
  v_first_disc_applied boolean := false;
  v_g_sub numeric; v_g_freight numeric; v_g_customs numeric; v_g_ins numeric; v_g_total numeric;
  v_g_disc numeric;
  g_rule freight_rules; g_route shipping_routes;
  g_aw numeric; g_vw numeric; g_cw numeric; g_flat numeric; g_last_mile numeric;
  g_mode text;
  -- cart 分支
  v_cart_id uuid := NULLIF(_payload->>'cart_id', '')::uuid;
  v_cart public.shop_carts;
  v_from_cart boolean := false;
  v_ovr_unit numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
  v_ship_method := _payload->>'shipping_method';
  v_addr := _payload->'address_snapshot';

  IF v_cart_id IS NOT NULL THEN
    SELECT * INTO v_cart FROM public.shop_carts
      WHERE id = v_cart_id AND user_id = uid AND status = 'active';
    IF v_cart IS NULL THEN RAISE EXCEPTION '购物车不存在或已结束'; END IF;
    PERFORM public._shop_cart_reprice(v_cart_id);
    SELECT * INTO v_cart FROM public.shop_carts WHERE id = v_cart_id;
    v_from_cart := true;
    v_ship_method := COALESCE(v_cart.shipping_method, v_ship_method);
    IF COALESCE(v_cart.route_code, '') <> '' THEN
      _payload := jsonb_set(_payload, '{route_code}', to_jsonb(v_cart.route_code), true);
    END IF;
    IF COALESCE(v_cart.coupon_code, '') <> '' THEN
      _payload := jsonb_set(_payload, '{coupon_code}', to_jsonb(v_cart.coupon_code), true);
    END IF;
    SELECT jsonb_agg(jsonb_build_object(
             'slug', ci.product_slug,
             'variant_id', ci.variant_id,
             'quantity', ci.quantity,
             'mode', ci.mode,
             'override_unit_price_cny', ci.override_unit_price_cny,
             'override_reason', ci.override_reason
           ))
      INTO v_items
    FROM public.shop_cart_items ci WHERE ci.cart_id = v_cart_id;
    IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION '购物车是空的'; END IF;
  ELSE
    v_items := _payload->'items';
  END IF;

  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;
  IF v_cust IS NULL THEN v_cust := 'C' || lpad(floor(random()*1000000)::text,6,'0'); END IF;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug' AND status='active';
    IF v_product IS NULL THEN CONTINUE; END IF;

    v_variant := NULL;
    IF COALESCE(it->>'variant_id','') <> '' THEN
      SELECT * INTO v_variant FROM public.product_variants
        WHERE id = (it->>'variant_id')::uuid AND product_id = v_product.id AND is_active = true;
    END IF;

    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    IF v_mode='business' AND NOT v_product.allow_business THEN v_mode:='personal'; END IF;
    IF v_mode='personal' AND NOT v_product.allow_personal THEN v_mode:='business'; END IF;
    IF v_mode='business' AND v_qty < COALESCE(v_product.moq,1) THEN
      RAISE EXCEPTION '商品 % 未达起订量 %', v_product.name, v_product.moq;
    END IF;
    IF COALESCE(_payload->>'route_code','') <> '' THEN
      v_route_code := _payload->>'route_code';
    ELSE
      v_route_code := public._product_route_code(v_product, v_mode, v_ship_method);
    END IF;
    IF v_route_code IS NULL OR v_route_code='' THEN
      RAISE EXCEPTION '商品 % 没有配置 %/% 线路', v_product.name, v_mode, v_ship_method;
    END IF;
    SELECT * INTO v_route FROM public.shipping_routes WHERE code=v_route_code AND is_active=true;
    IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用: %', v_route_code; END IF;
    SELECT * INTO v_rule FROM public.freight_rules WHERE route_id=v_route.id AND is_active=true ORDER BY created_at DESC LIMIT 1;
    SELECT * INTO v_customs FROM public.customs_rules WHERE route_id=v_route.id LIMIT 1;
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode, v_variant)
              || jsonb_build_object(
                   'route_code', v_route.code, 'destination_code', v_route.destination_code,
                   'shipping_method', v_route.shipping_method, 'mode', v_mode,
                   'product_id', v_product.id, 'product_slug', v_product.slug,
                   'sku', COALESCE(v_variant.sku, v_product.sku), 'name', v_product.name,
                   'cover_url', v_product.cover_url,
                   'price_cny', COALESCE(v_variant.price_cny, v_product.price_cny),
                   'quantity', v_qty, 'personal_freight_mode', v_product.personal_freight_mode,
                   'variant_id', v_variant.id, 'attrs_snapshot', v_variant.attrs);

    -- 后台已改单品价：小计按 override 单价，同时留底 list 价 + 原因（关税/物理重不动）
    IF v_from_cart AND (it->>'override_unit_price_cny') IS NOT NULL THEN
      v_ovr_unit := (it->>'override_unit_price_cny')::numeric;
      IF v_ovr_unit >= 0 THEN
        v_line := jsonb_set(v_line, '{list_price_cny}', v_line->'price_cny', true);
        v_line := jsonb_set(v_line, '{price_cny}', to_jsonb(v_ovr_unit), true);
        v_line := jsonb_set(v_line, '{subtotal_cny}', to_jsonb(round(v_ovr_unit * v_qty, 2)), true);
        v_line := jsonb_set(v_line, '{price_override_reason}',
                            to_jsonb(COALESCE(NULLIF(it->>'override_reason',''), '人工调整')), true);
      END IF;
    END IF;

    v_total_subtotal := v_total_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_total_customs  := v_total_customs  + (v_line->>'customs_cny')::numeric;
    v_total_ins      := v_total_ins      + (v_line->>'insurance_cny')::numeric;
    v_group_key := v_route.code;
    v_group := COALESCE(v_groups->v_group_key, jsonb_build_object(
      'route_code', v_route.code, 'destination_code', v_route.destination_code,
      'shipping_method', v_route.shipping_method, 'lines', '[]'::jsonb));
    v_group := jsonb_set(v_group, '{lines}', (v_group->'lines') || v_line);
    v_groups := jsonb_set(v_groups, ARRAY[v_group_key], v_group, true);
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', v_total_subtotal);
    IF (v_coupon->>'ok')::boolean THEN
      v_disc := (v_coupon->>'discount_cny')::numeric;
      SELECT id INTO v_coupon_id FROM public.coupons WHERE code = _payload->>'coupon_code';
    END IF;
  END IF;

  SELECT array_agg(k) INTO v_route_keys FROM jsonb_object_keys(v_groups) k;
  FOREACH v_group_key IN ARRAY COALESCE(v_route_keys, ARRAY[]::text[]) LOOP
    v_group := v_groups->v_group_key;
    v_g_sub:=0; v_g_customs:=0; v_g_ins:=0; v_units:=0;
    SELECT * INTO g_route FROM public.shipping_routes WHERE code = v_group_key AND is_active = true;
    SELECT * INTO g_rule FROM public.freight_rules
      WHERE route_id = g_route.id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    g_aw := 0; g_vw := 0; g_flat := 0; g_last_mile := 0;
    FOR v_line IN SELECT jsonb_array_elements(v_group->'lines') LOOP
      v_g_sub     := v_g_sub     + (v_line->>'subtotal_cny')::numeric;
      v_g_customs := v_g_customs + (v_line->>'customs_cny')::numeric;
      v_g_ins     := v_g_ins     + (v_line->>'insurance_cny')::numeric;
      v_units     := v_units     + COALESCE((v_line->>'units')::int, 0);
      g_last_mile := g_last_mile + COALESCE((v_line->>'last_mile_cny')::numeric, 0);
      g_mode := v_line->>'mode';
      IF g_mode = 'personal' AND (v_line->>'personal_freight_mode') = 'per_unit' THEN
        g_flat := g_flat + (v_line->>'freight_cny')::numeric - COALESCE((v_line->>'last_mile_cny')::numeric, 0);
      ELSE
        g_aw := g_aw + COALESCE((v_line->>'actual_kg')::numeric, 0);
        g_vw := g_vw + COALESCE((v_line->>'volumetric_kg')::numeric, 0);
      END IF;
    END LOOP;
    g_cw := CASE COALESCE(g_rule.weight_mode,'max')
              WHEN 'actual' THEN g_aw WHEN 'volumetric' THEN g_vw ELSE GREATEST(g_aw, g_vw) END;
    v_g_freight := GREATEST(round(g_cw * COALESCE(g_rule.unit_price_cny,0), 2), COALESCE(g_rule.min_charge_cny,0))
      + COALESCE(g_rule.extra_fee_cny, 0) + g_flat + g_last_mile;

    v_g_disc := 0;
    IF NOT v_first_disc_applied AND v_disc > 0 THEN
      v_g_disc := v_disc; v_first_disc_applied := true;
    END IF;
    v_g_total := GREATEST(v_g_sub + v_g_freight + v_g_customs + v_g_ins - v_g_disc, 0);
    v_order_no := 'SO' || to_char(now(),'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text,3,'0');

    INSERT INTO public.orders(
      user_id, source, order_no, status, payment_status, paid_at,
      customer_code, subtotal_cny, shipping_cny, customs_cny, insurance_cny,
      total_cny, discount_cny, coupon_id, shipping_method, destination_code,
      route_code, box_count, address_snapshot, note, payment_method
    ) VALUES (
      uid, 'shop', v_order_no, 'procurement', 'paid', now(),
      v_cust, v_g_sub, v_g_freight, v_g_customs, v_g_ins,
      v_g_total, v_g_disc, v_coupon_id,
      COALESCE(v_ship_method, v_group->>'shipping_method','air'),
      v_group->>'destination_code',
      v_group->>'route_code', v_units, v_addr, _payload->>'note', 'wallet'
    ) RETURNING id INTO v_order_id;
    v_order_ids := v_order_ids || v_order_id;

    FOR v_line IN SELECT jsonb_array_elements(v_group->'lines') LOOP
      INSERT INTO public.order_items(
        order_id, product_id, product_slug, sku, name_zh, name_en, image_url,
        unit_price_cny, quantity, subtotal_cny, purchase_type, paid,
        variant_id, attrs_snapshot, list_price_cny, price_override_reason
      ) VALUES (
        v_order_id, NULLIF(v_line->>'product_id','')::uuid, v_line->>'product_slug',
        v_line->>'sku', v_line->>'name', NULL, v_line->>'cover_url',
        (v_line->>'price_cny')::numeric, (v_line->>'quantity')::int,
        (v_line->>'subtotal_cny')::numeric, v_line->>'mode', true,
        NULLIF(v_line->>'variant_id','')::uuid, v_line->'attrs_snapshot',
        NULLIF(v_line->>'list_price_cny','')::numeric, NULLIF(v_line->>'price_override_reason',''));
    END LOOP;

    IF v_units > 0 THEN
      FOR v_i IN 1..v_units LOOP
        INSERT INTO public.waybills(
          user_id, order_id, shipping_method, status, payment_status, box_no
        ) VALUES (
          uid, v_order_id,
          COALESCE(v_ship_method, v_group->>'shipping_method','air'),
          'procurement', 'paid', lpad(v_i::text, 3, '0'));
      END LOOP;
    END IF;

    v_total_freight := v_total_freight + v_g_freight;
  END LOOP;

  v_grand_total := GREATEST(v_total_subtotal + v_total_freight + v_total_customs + v_total_ins - v_disc, 0);

  -- 整车人工改价：以 override 总价为准，差额记在首个订单上并留底原因
  IF v_from_cart AND v_cart.override_total_cny IS NOT NULL THEN
    v_grand_total := v_cart.override_total_cny;
    IF array_length(v_order_ids, 1) >= 1 THEN
      UPDATE public.orders SET
        total_cny = v_cart.override_total_cny
                    - (SELECT COALESCE(SUM(o2.total_cny), 0) FROM public.orders o2
                       WHERE o2.id = ANY(v_order_ids) AND o2.id <> v_order_ids[1]),
        price_override_reason = COALESCE(v_cart.override_reason, '整车人工改价'),
        overridden_by = v_cart.overridden_by
      WHERE id = v_order_ids[1];
    END IF;
  END IF;

  v_need_cad := round(v_grand_total * v_fx, 2);
  SELECT COALESCE(balance_cad,0) INTO v_bal FROM public.wallets WHERE user_id = uid;
  IF COALESCE(v_bal,0) < v_need_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason','insufficient',
      'need_cad', v_need_cad, 'balance_cad', COALESCE(v_bal,0));
  END IF;

  INSERT INTO public.invoices(
    user_id, type, status, subtotal_cny, freight_cny, customs_cny, insurance_cny,
    total_cny, paid_cny, fx_rate, currency, paid_at, paid_cad, note
  ) VALUES (
    uid, 'shop', 'paid', v_total_subtotal, v_total_freight, v_total_customs, v_total_ins,
    v_grand_total, v_grand_total, v_fx, 'CNY', now(), v_need_cad,
    'Shop order: ' || array_to_string(v_order_ids::text[], ',')
  ) RETURNING id, invoice_no INTO v_inv_id, v_inv_no;

  FOREACH v_order_id IN ARRAY v_order_ids LOOP
    INSERT INTO public.invoice_items(
      invoice_id, order_id, description, freight_cny, customs_cny, insurance_cny, amount_cny
    ) SELECT v_inv_id, o.id, 'Order ' || o.order_no,
           o.shipping_cny, o.customs_cny, o.insurance_cny, o.total_cny
      FROM public.orders o WHERE o.id = v_order_id;
  END LOOP;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note
  ) VALUES (
    uid, 'spend', v_grand_total, v_need_cad, v_fx, 'completed', 'wallet',
    'Shop invoice ' || v_inv_no);

  IF v_from_cart THEN
    UPDATE public.shop_carts SET status = 'ordered', updated_at = now() WHERE id = v_cart_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'invoice_id', v_inv_id, 'invoice_no', v_inv_no,
    'order_ids', to_jsonb(v_order_ids),
    'orders_count', array_length(v_order_ids, 1),
    'total_cny', v_grand_total, 'paid_cad', v_need_cad);
END $function$;

REVOKE ALL ON FUNCTION public.shop_cart_admin_adjust(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_cart_admin_adjust(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_shop_order(jsonb) TO authenticated;
