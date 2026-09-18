
-- =========================
-- ENUM TYPES
-- =========================
DO $$ BEGIN CREATE TYPE public.product_status AS ENUM ('draft','active','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.shop_order_status AS ENUM ('pending_pay','paid','shipped','completed','refunded','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.inv_reason AS ENUM ('in','out','adjust','sale','return'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.coupon_type AS ENUM ('fixed','percent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.promo_type AS ENUM ('discount','bundle','flash'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.cms_status AS ENUM ('draft','published','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================
-- product_categories
-- =========================
CREATE TABLE public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  name_en text,
  slug text UNIQUE NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  cover_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_public_read" ON public.product_categories FOR SELECT USING (is_active OR public.is_staff(auth.uid()));
CREATE POLICY "categories_staff_write" ON public.product_categories FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_cat_upd BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- products
-- =========================
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE NOT NULL,
  name text NOT NULL,
  subtitle text,
  slug text UNIQUE NOT NULL,
  category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  description text,
  brand text,
  status public.product_status NOT NULL DEFAULT 'draft',
  cover_url text,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_cny numeric(12,2) NOT NULL DEFAULT 0,
  compare_price_cny numeric(12,2),
  weight_kg numeric(8,3),
  length_cm numeric(8,2),
  width_cm numeric(8,2),
  height_cm numeric(8,2),
  tags text[] NOT NULL DEFAULT '{}',
  total_stock int NOT NULL DEFAULT 0,
  sold_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_read" ON public.products FOR SELECT USING (status = 'active' OR public.is_staff(auth.uid()));
CREATE POLICY "products_staff_write" ON public.products FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_products_status ON public.products(status);
CREATE INDEX idx_products_category ON public.products(category_id);
CREATE TRIGGER trg_prod_upd BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- product_variants
-- =========================
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text UNIQUE NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_cny numeric(12,2) NOT NULL DEFAULT 0,
  stock int NOT NULL DEFAULT 0,
  barcode text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_variants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variants_public_read" ON public.product_variants FOR SELECT USING (is_active OR public.is_staff(auth.uid()));
CREATE POLICY "variants_staff_write" ON public.product_variants FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_variants_product ON public.product_variants(product_id);
CREATE TRIGGER trg_var_upd BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- inventory_movements
-- =========================
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  qty_delta int NOT NULL,
  reason public.inv_reason NOT NULL,
  ref_type text,
  ref_id uuid,
  operator_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_staff_all" ON public.inventory_movements FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_inv_variant ON public.inventory_movements(variant_id);

-- Auto-update variant stock + product total_stock on movement
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid;
BEGIN
  UPDATE public.product_variants SET stock = stock + NEW.qty_delta WHERE id = NEW.variant_id RETURNING product_id INTO pid;
  IF pid IS NOT NULL THEN
    UPDATE public.products SET total_stock = (SELECT COALESCE(SUM(stock),0) FROM public.product_variants WHERE product_id = pid) WHERE id = pid;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_inv_apply AFTER INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();

-- =========================
-- coupons
-- =========================
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text,
  type public.coupon_type NOT NULL DEFAULT 'fixed',
  value numeric(12,2) NOT NULL DEFAULT 0,
  min_order_cny numeric(12,2) NOT NULL DEFAULT 0,
  usage_limit int,
  used_count int NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupons_auth_read" ON public.coupons FOR SELECT TO authenticated USING (is_active OR public.is_staff(auth.uid()));
CREATE POLICY "coupons_staff_write" ON public.coupons FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_coupons_upd BEFORE UPDATE ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  order_id uuid,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "redemptions_owner_read" ON public.coupon_redemptions FOR SELECT USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "redemptions_staff_write" ON public.coupon_redemptions FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- =========================
-- promotions
-- =========================
CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type public.promo_type NOT NULL DEFAULT 'discount',
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promotions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promo_public_read" ON public.promotions FOR SELECT USING (is_active OR public.is_staff(auth.uid()));
CREATE POLICY "promo_staff_write" ON public.promotions FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_promo_upd BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- cms_banners
-- =========================
CREATE TABLE public.cms_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_url text NOT NULL,
  link_url text,
  position text NOT NULL DEFAULT 'home_top',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cms_banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_banners TO authenticated;
GRANT ALL ON public.cms_banners TO service_role;
ALTER TABLE public.cms_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "banners_public_read" ON public.cms_banners FOR SELECT USING (is_active OR public.is_staff(auth.uid()));
CREATE POLICY "banners_staff_write" ON public.cms_banners FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_banner_upd BEFORE UPDATE ON public.cms_banners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- cms_articles
-- =========================
CREATE TABLE public.cms_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text UNIQUE NOT NULL,
  cover_url text,
  excerpt text,
  content_md text,
  author_id uuid,
  status public.cms_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cms_articles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_articles TO authenticated;
GRANT ALL ON public.cms_articles TO service_role;
ALTER TABLE public.cms_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "articles_public_read" ON public.cms_articles FOR SELECT USING (status = 'published' OR public.is_staff(auth.uid()));
CREATE POLICY "articles_staff_write" ON public.cms_articles FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_article_upd BEFORE UPDATE ON public.cms_articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- shop_orders
-- =========================
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text UNIQUE NOT NULL,
  user_id uuid NOT NULL,
  status public.shop_order_status NOT NULL DEFAULT 'pending_pay',
  subtotal_cny numeric(12,2) NOT NULL DEFAULT 0,
  shipping_cny numeric(12,2) NOT NULL DEFAULT 0,
  discount_cny numeric(12,2) NOT NULL DEFAULT 0,
  total_cny numeric(12,2) NOT NULL DEFAULT 0,
  fx_rate numeric(8,4) NOT NULL DEFAULT 0.19,
  address_snapshot jsonb,
  shipping_method text,
  destination_code text,
  route_code text,
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  waybill_id uuid,
  note text,
  paid_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.shop_orders TO authenticated;
GRANT ALL ON public.shop_orders TO service_role;
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so_owner_read" ON public.shop_orders FOR SELECT USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "so_owner_insert" ON public.shop_orders FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "so_staff_update" ON public.shop_orders FOR UPDATE USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_so_user ON public.shop_orders(user_id);
CREATE INDEX idx_so_status ON public.shop_orders(status);
CREATE TRIGGER trg_so_upd BEFORE UPDATE ON public.shop_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.gen_shop_order_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.order_no IS NULL OR NEW.order_no = '' THEN
    NEW.order_no := 'SO' || to_char(now(),'YYMMDD') || lpad((floor(random()*1000000))::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_so_no BEFORE INSERT ON public.shop_orders FOR EACH ROW EXECUTE FUNCTION public.gen_shop_order_no();

-- =========================
-- shop_order_items
-- =========================
CREATE TABLE public.shop_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  product_id uuid,
  variant_id uuid,
  sku text,
  name_snapshot text NOT NULL,
  attrs_snapshot jsonb,
  price_cny numeric(12,2) NOT NULL DEFAULT 0,
  qty int NOT NULL DEFAULT 1,
  subtotal_cny numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_order_items TO authenticated;
GRANT ALL ON public.shop_order_items TO service_role;
ALTER TABLE public.shop_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soi_owner_read" ON public.shop_order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.is_staff(auth.uid())))
);
CREATE POLICY "soi_staff_write" ON public.shop_order_items FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_soi_order ON public.shop_order_items(order_id);

-- =========================
-- shop_refunds
-- =========================
CREATE TABLE public.shop_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  amount_cny numeric(12,2) NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  operator_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.shop_refunds TO authenticated;
GRANT ALL ON public.shop_refunds TO service_role;
ALTER TABLE public.shop_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refund_owner_read" ON public.shop_refunds FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.shop_orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.is_staff(auth.uid())))
);
CREATE POLICY "refund_staff_write" ON public.shop_refunds FOR ALL USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- =========================
-- waybills.shop_order_id
-- =========================
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS shop_order_id uuid;
CREATE INDEX IF NOT EXISTS idx_waybills_shop_order ON public.waybills(shop_order_id);

-- =========================
-- Auto-decrement stock when shop_order becomes paid (sale movement)
-- =========================
CREATE OR REPLACE FUNCTION public.shop_order_apply_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status <> 'paid') THEN
    INSERT INTO public.inventory_movements (variant_id, qty_delta, reason, ref_type, ref_id, note)
    SELECT variant_id, -qty, 'sale', 'shop_order', NEW.id, 'Sale ' || NEW.order_no
      FROM public.shop_order_items WHERE order_id = NEW.id AND variant_id IS NOT NULL;
    UPDATE public.products p SET sold_count = sold_count + COALESCE((
      SELECT SUM(qty) FROM public.shop_order_items WHERE order_id = NEW.id AND product_id = p.id), 0)
    WHERE id IN (SELECT DISTINCT product_id FROM public.shop_order_items WHERE order_id = NEW.id AND product_id IS NOT NULL);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_so_stock AFTER INSERT OR UPDATE OF status ON public.shop_orders
FOR EACH ROW EXECUTE FUNCTION public.shop_order_apply_stock();
