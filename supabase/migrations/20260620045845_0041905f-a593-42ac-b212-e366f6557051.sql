
-- ============ 1. orders 扩字段 ============
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_cny NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_note TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_source ON public.orders(source);

-- ============ 2. order_items 扩字段 ============
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS attrs_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS subtotal_cny NUMERIC(12,2) NOT NULL DEFAULT 0;
-- 把现有 quantity/product_slug/name_zh/unit_price_cny 作为兼容字段保留

-- ============ 3. 迁移 shop_orders -> orders ============
INSERT INTO public.orders (
  id, user_id, order_no, status, subtotal_cny, shipping_cny, total_cny,
  display_currency, fx_rate, shipping_method, address_snapshot, note,
  destination_code, route_code, source, coupon_id, discount_cny,
  paid_at, shipped_at, completed_at, payment_status,
  customer_code, created_at, updated_at
)
SELECT
  so.id, so.user_id, so.order_no,
  CASE so.status::text
    WHEN 'pending_pay' THEN 'pending'::order_status
    WHEN 'paid' THEN 'paid'::order_status
    WHEN 'shipped' THEN 'shipped'::order_status
    WHEN 'completed' THEN 'delivered'::order_status
    WHEN 'refunded' THEN 'cancelled'::order_status
    WHEN 'cancelled' THEN 'cancelled'::order_status
    ELSE 'pending'::order_status
  END,
  so.subtotal_cny, so.shipping_cny, so.total_cny,
  'CNY', so.fx_rate, COALESCE(so.shipping_method,'air'),
  so.address_snapshot, so.note,
  so.destination_code, so.route_code, 'shop', so.coupon_id, so.discount_cny,
  so.paid_at, so.shipped_at, so.completed_at,
  CASE WHEN so.paid_at IS NOT NULL OR so.status::text IN ('paid','shipped','completed') THEN 'paid' ELSE 'unpaid' END,
  (SELECT customer_code FROM public.profiles WHERE id = so.user_id),
  so.created_at, so.updated_at
FROM public.shop_orders so
ON CONFLICT (id) DO NOTHING;

-- 迁移 items
INSERT INTO public.order_items (
  id, order_id, product_id, variant_id, sku, product_slug,
  name_zh, name_en, image_url, unit_price_cny, quantity,
  attrs_snapshot, subtotal_cny, purchase_type, created_at
)
SELECT
  soi.id, soi.order_id, soi.product_id, soi.variant_id, soi.sku,
  COALESCE((SELECT slug FROM public.products WHERE id = soi.product_id), 'unknown'),
  soi.name_snapshot, soi.name_snapshot,
  (SELECT cover_url FROM public.products WHERE id = soi.product_id),
  soi.price_cny, soi.qty,
  soi.attrs_snapshot, soi.subtotal_cny, 'personal', soi.created_at
FROM public.shop_order_items soi
ON CONFLICT (id) DO NOTHING;

-- ============ 4. waybills 解耦 shop_order_id ============
-- waybills.shop_order_id 还没用到，直接 drop
ALTER TABLE public.waybills DROP COLUMN IF EXISTS shop_order_id;

-- ============ 5. shop_refunds 改挂 orders（已经是同一 id） ============
ALTER TABLE public.shop_refunds DROP CONSTRAINT IF EXISTS shop_refunds_order_id_fkey;
ALTER TABLE public.shop_refunds
  ADD CONSTRAINT shop_refunds_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- 重建 shop_refunds RLS（旧 policy 引用了 shop_orders）
DROP POLICY IF EXISTS refund_owner_read ON public.shop_refunds;
DROP POLICY IF EXISTS refund_staff_write ON public.shop_refunds;
CREATE POLICY refund_owner_read ON public.shop_refunds FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = shop_refunds.order_id AND (o.user_id = auth.uid() OR public.is_staff(auth.uid()))));
CREATE POLICY refund_staff_write ON public.shop_refunds FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- ============ 6. 删除 shop_orders/items + 旧触发器 ============
DROP TRIGGER IF EXISTS trg_shop_order_apply_stock ON public.shop_orders;
DROP TRIGGER IF EXISTS trg_gen_shop_order_no ON public.shop_orders;
DROP TABLE IF EXISTS public.shop_order_items CASCADE;
DROP TABLE IF EXISTS public.shop_orders CASCADE;
DROP TYPE IF EXISTS public.shop_order_status;

-- ============ 7. 新触发器：orders source='shop' + paid -> 扣库存 ============
CREATE OR REPLACE FUNCTION public.order_shop_apply_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source = 'shop' AND NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status <> 'paid') THEN
    INSERT INTO public.inventory_movements (variant_id, qty_delta, reason, ref_type, ref_id, note)
    SELECT variant_id, -quantity, 'sale', 'order', NEW.id, 'Sale ' || NEW.order_no
      FROM public.order_items WHERE order_id = NEW.id AND variant_id IS NOT NULL;
    UPDATE public.products p SET sold_count = sold_count + COALESCE(
      (SELECT SUM(quantity) FROM public.order_items WHERE order_id = NEW.id AND product_id = p.id), 0)
    WHERE id IN (SELECT DISTINCT product_id FROM public.order_items WHERE order_id = NEW.id AND product_id IS NOT NULL);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_shop_apply_stock ON public.orders;
CREATE TRIGGER trg_order_shop_apply_stock AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.order_shop_apply_stock();

DROP FUNCTION IF EXISTS public.shop_order_apply_stock() CASCADE;
DROP FUNCTION IF EXISTS public.gen_shop_order_no() CASCADE;

-- ============ 8. products 扩字段 ============
DO $$ BEGIN
  CREATE TYPE public.product_purchase_type AS ENUM ('personal','business');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS hs_code TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS detail_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS purchase_type public.product_purchase_type NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS moq INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS customs_rate NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_cny NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pack_qty INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pack_weight_kg NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS pack_length_cm NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS pack_width_cm NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS pack_height_cm NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS pack_volume_m3 NUMERIC(10,5);
