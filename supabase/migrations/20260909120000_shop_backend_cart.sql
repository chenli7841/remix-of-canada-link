-- 后端购物车（预下单）
--   - 登录用户的购物车存这两张表，未登录仍走前端 localStorage，登录时合并
--   - 所有金额由后端 _shop_cart_reprice 计算并写回快照字段，前端只展示、不再自算
--     （复用 quote_shop_order / _compute_line_quote，与报价、下单同一套公式）
--   - override_* 列本 PR 只建结构，由 PR3 的后台改价 RPC 写入；reprice 永不触碰它们
--
-- 表写入一律经 SECURITY DEFINER RPC（shop_cart_get / shop_cart_sync / shop_cart_reprice），
-- RLS 只放行「本人或员工」读，不给 authenticated 直接写。

CREATE TABLE IF NOT EXISTS public.shop_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ordered', 'abandoned')),
  route_code text,
  shipping_method text,
  address_id uuid,
  address_snapshot jsonb,
  coupon_code text,
  note text,
  -- 最近一次 reprice 的快照（CNY）
  subtotal_cny numeric NOT NULL DEFAULT 0,
  freight_cny numeric NOT NULL DEFAULT 0,
  customs_cny numeric NOT NULL DEFAULT 0,
  insurance_cny numeric NOT NULL DEFAULT 0,
  discount_cny numeric NOT NULL DEFAULT 0,
  total_cny numeric NOT NULL DEFAULT 0,
  quote_snapshot jsonb,
  quoted_at timestamptz,
  needs_route boolean NOT NULL DEFAULT true,
  -- 后台人工改「整车总收费」（PR3 写入）
  override_total_cny numeric,
  override_reason text,
  overridden_by uuid,
  overridden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 每个用户最多一张 active 购物车
CREATE UNIQUE INDEX IF NOT EXISTS shop_carts_one_active_per_user
  ON public.shop_carts (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS shop_carts_user_recent
  ON public.shop_carts (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.shop_cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.shop_carts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_slug text NOT NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  mode text NOT NULL DEFAULT 'personal' CHECK (mode IN ('personal', 'business')),
  -- 最近一次 reprice 的行快照（CNY）
  unit_price_cny numeric NOT NULL DEFAULT 0,
  line_subtotal_cny numeric NOT NULL DEFAULT 0,
  line_freight_cny numeric NOT NULL DEFAULT 0,
  line_customs_cny numeric NOT NULL DEFAULT 0,
  line_insurance_cny numeric NOT NULL DEFAULT 0,
  chargeable_kg numeric NOT NULL DEFAULT 0,
  units integer NOT NULL DEFAULT 0,
  -- 后台人工改「单品价」（PR3 写入）
  override_unit_price_cny numeric,
  override_reason text,
  overridden_by uuid,
  overridden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 同一购物车里「商品 + 规格」只有一行（variant 为空时按全 0 UUID 归一，避免 NULL 不去重）
CREATE UNIQUE INDEX IF NOT EXISTS shop_cart_items_unique_line
  ON public.shop_cart_items (cart_id, product_slug, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS shop_cart_items_cart ON public.shop_cart_items (cart_id);

DROP TRIGGER IF EXISTS set_shop_carts_updated_at ON public.shop_carts;
CREATE TRIGGER set_shop_carts_updated_at BEFORE UPDATE ON public.shop_carts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_shop_cart_items_updated_at ON public.shop_cart_items;
CREATE TRIGGER set_shop_cart_items_updated_at BEFORE UPDATE ON public.shop_cart_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.shop_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_cart_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.shop_carts, public.shop_cart_items TO authenticated;
GRANT ALL ON public.shop_carts, public.shop_cart_items TO service_role;

DROP POLICY IF EXISTS "read own or staff cart" ON public.shop_carts;
CREATE POLICY "read own or staff cart" ON public.shop_carts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "read own or staff cart items" ON public.shop_cart_items;
CREATE POLICY "read own or staff cart items" ON public.shop_cart_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shop_carts c
    WHERE c.id = shop_cart_items.cart_id
      AND (c.user_id = auth.uid() OR public.is_staff(auth.uid()))
  ));

-- ---------------------------------------------------------------------------
-- 计算：把一张购物车按当前 items + 线路/优惠码重新算一遍，写回快照列。
-- override_* 列永不在此写入或读取（PR3 在返回层叠加）。
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

  -- 有线路 → 直接复用 quote_shop_order（含运费池化 + 优惠码），与结账、下单同一函数
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

    -- 回填每一行（按 slug + variant 匹配 quote 的 lines）
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
    -- 无线路（或报价失败）：逐行算货值 + 关税，运费/保险记 0，等选线路后再全量 reprice
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

  UPDATE public.shop_carts SET
    subtotal_cny   = s_sub,
    freight_cny    = s_frt,
    customs_cny    = s_cus,
    insurance_cny  = s_ins,
    discount_cny   = s_disc,
    total_cny      = GREATEST(s_sub + s_frt + s_cus + s_ins - s_disc, 0),
    quote_snapshot = v_quote,
    quoted_at      = now(),
    needs_route    = v_needs_route,
    updated_at     = now()
  WHERE id = _cart_id;
END $$;

-- 组装返回给前端的结构：{ cart, items }（含 override_* 供前端标注「人工调整」）
CREATE OR REPLACE FUNCTION public._shop_cart_payload(_cart_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'cart', to_jsonb(c),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(ci) ORDER BY ci.created_at)
      FROM public.shop_cart_items ci WHERE ci.cart_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.shop_carts c WHERE c.id = _cart_id;
$$;

-- 找到（或新建）当前用户的 active 购物车
CREATE OR REPLACE FUNCTION public._shop_cart_ensure_active()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_id FROM public.shop_carts WHERE user_id = v_uid AND status = 'active' LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.shop_carts (user_id) VALUES (v_uid)
    ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.shop_carts WHERE user_id = v_uid AND status = 'active' LIMIT 1;
    END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.shop_cart_get()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public._shop_cart_ensure_active();
  RETURN public._shop_cart_payload(v_id);
END $$;

CREATE OR REPLACE FUNCTION public.shop_cart_reprice()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public._shop_cart_ensure_active();
  PERFORM public._shop_cart_reprice(v_id);
  RETURN public._shop_cart_payload(v_id);
END $$;

-- 全量同步：传 items 就整表替换（加购/改量/删除/清空/登录合并都走这个）；
-- route_code / shipping_method / coupon_code / note / address_* 传了才改。
CREATE OR REPLACE FUNCTION public.shop_cart_sync(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  it jsonb;
  v_slug text; v_variant uuid; v_qty int; v_mode text;
  v_product products;
BEGIN
  v_id := public._shop_cart_ensure_active();

  IF _payload ? 'route_code' THEN
    UPDATE public.shop_carts SET route_code = NULLIF(_payload->>'route_code', '') WHERE id = v_id;
  END IF;
  IF _payload ? 'shipping_method' THEN
    UPDATE public.shop_carts SET shipping_method = NULLIF(_payload->>'shipping_method', '') WHERE id = v_id;
  END IF;
  IF _payload ? 'coupon_code' THEN
    UPDATE public.shop_carts SET coupon_code = NULLIF(_payload->>'coupon_code', '') WHERE id = v_id;
  END IF;
  IF _payload ? 'note' THEN
    UPDATE public.shop_carts SET note = NULLIF(_payload->>'note', '') WHERE id = v_id;
  END IF;
  IF _payload ? 'address_id' THEN
    UPDATE public.shop_carts SET address_id = NULLIF(_payload->>'address_id', '')::uuid WHERE id = v_id;
  END IF;
  IF _payload ? 'address_snapshot' THEN
    UPDATE public.shop_carts SET address_snapshot = _payload->'address_snapshot' WHERE id = v_id;
  END IF;

  IF _payload ? 'items' THEN
    DELETE FROM public.shop_cart_items WHERE cart_id = v_id;
    FOR it IN SELECT jsonb_array_elements(_payload->'items') LOOP
      v_slug := it->>'slug';
      v_qty  := GREATEST(COALESCE((it->>'quantity')::int, 1), 1);
      v_mode := CASE WHEN it->>'mode' = 'business' THEN 'business' ELSE 'personal' END;
      v_variant := NULLIF(it->>'variant_id', '')::uuid;
      IF v_slug IS NULL OR v_slug = '' THEN CONTINUE; END IF;
      SELECT * INTO v_product FROM public.products WHERE slug = v_slug AND status = 'active';
      IF v_product IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.shop_cart_items (cart_id, product_id, product_slug, variant_id, quantity, mode)
      VALUES (v_id, v_product.id, v_slug, v_variant, v_qty, v_mode)
      ON CONFLICT (cart_id, product_slug, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET quantity = EXCLUDED.quantity, mode = EXCLUDED.mode, product_id = EXCLUDED.product_id;
    END LOOP;
  END IF;

  PERFORM public._shop_cart_reprice(v_id);
  RETURN public._shop_cart_payload(v_id);
END $$;

REVOKE ALL ON FUNCTION public._shop_cart_reprice(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._shop_cart_payload(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._shop_cart_ensure_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_cart_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_cart_reprice() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_cart_sync(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_cart_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_cart_reprice() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_cart_sync(jsonb) TO authenticated;
