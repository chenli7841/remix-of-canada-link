
-- =============== warehouses ===============
CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_zh text NOT NULL,
  name_en text,
  country text NOT NULL CHECK (country IN ('CN','CA','US','OTHER')),
  type text NOT NULL CHECK (type IN ('origin','destination','transit')),
  address text,
  contact text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view warehouses" ON public.warehouses
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_warehouses_updated BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============== shipping_routes ===============
CREATE TABLE public.shipping_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_zh text NOT NULL,
  name_en text,
  origin_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  destination_warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  shipping_method text NOT NULL CHECK (shipping_method IN ('air','sea','express','truck')),
  destination_code text,
  transit_days_min integer,
  transit_days_max integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shipping_routes TO authenticated;
GRANT ALL ON public.shipping_routes TO service_role;
ALTER TABLE public.shipping_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view routes" ON public.shipping_routes
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_routes_updated BEFORE UPDATE ON public.shipping_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_routes_active ON public.shipping_routes(is_active, sort_order);

-- =============== freight_rules ===============
CREATE TABLE public.freight_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.shipping_routes(id) ON DELETE CASCADE,
  weight_mode text NOT NULL DEFAULT 'max' CHECK (weight_mode IN ('actual','volumetric','max')),
  volumetric_divisor numeric(10,2) NOT NULL DEFAULT 6000 CHECK (volumetric_divisor > 0),
  unit_price_cny numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price_cny >= 0),
  min_charge_cny numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_charge_cny >= 0),
  extra_fee_cny numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_fee_cny >= 0),
  effective_from timestamptz,
  effective_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.freight_rules TO authenticated;
GRANT ALL ON public.freight_rules TO service_role;
ALTER TABLE public.freight_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view freight rules" ON public.freight_rules
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_freight_updated BEFORE UPDATE ON public.freight_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_freight_route ON public.freight_rules(route_id, is_active);

-- =============== customs_rules ===============
CREATE TABLE public.customs_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.shipping_routes(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  rate_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (rate_pct >= 0 AND rate_pct <= 100),
  threshold_cad numeric(12,2) NOT NULL DEFAULT 0 CHECK (threshold_cad >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id)
);
GRANT SELECT ON public.customs_rules TO authenticated;
GRANT ALL ON public.customs_rules TO service_role;
ALTER TABLE public.customs_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view customs rules" ON public.customs_rules
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_customs_updated BEFORE UPDATE ON public.customs_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============== Seed: 默认仓库 ===============
INSERT INTO public.warehouses (code, name_zh, name_en, country, type, sort_order) VALUES
  ('CN-GZ', '广州仓', 'Guangzhou Warehouse', 'CN', 'origin', 10),
  ('CN-SZ', '深圳仓', 'Shenzhen Warehouse', 'CN', 'origin', 20),
  ('CA-YVR', '温哥华仓', 'Vancouver Warehouse', 'CA', 'destination', 100),
  ('CA-YYZ', '多伦多仓', 'Toronto Warehouse', 'CA', 'destination', 110)
ON CONFLICT (code) DO NOTHING;
