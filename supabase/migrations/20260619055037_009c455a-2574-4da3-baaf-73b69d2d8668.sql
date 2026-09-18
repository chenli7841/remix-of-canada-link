
-- 1. CARGO TYPES
CREATE TABLE public.cargo_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_zh text NOT NULL,
  name_en text,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cargo_types TO anon, authenticated;
GRANT ALL ON public.cargo_types TO authenticated;
GRANT ALL ON public.cargo_types TO service_role;
ALTER TABLE public.cargo_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cargo_types read all" ON public.cargo_types FOR SELECT USING (true);
CREATE POLICY "cargo_types manage by manager" ON public.cargo_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_cargo_types_updated BEFORE UPDATE ON public.cargo_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. DESTINATIONS
CREATE TABLE public.destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_zh text NOT NULL,
  name_en text,
  country text,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.destinations TO anon, authenticated;
GRANT ALL ON public.destinations TO authenticated;
GRANT ALL ON public.destinations TO service_role;
ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "destinations read all" ON public.destinations FOR SELECT USING (true);
CREATE POLICY "destinations manage by manager" ON public.destinations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_destinations_updated BEFORE UPDATE ON public.destinations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. PALLETS (define first so cartons can reference)
CREATE TABLE public.pallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pallet_no text UNIQUE,
  sequence_no int,
  status text NOT NULL DEFAULT 'open',
  weight_kg numeric,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  batch_id uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pallets TO authenticated;
GRANT ALL ON public.pallets TO service_role;
ALTER TABLE public.pallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pallets staff read" ON public.pallets FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "pallets warehouse write" ON public.pallets FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_pallets_updated BEFORE UPDATE ON public.pallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.gen_pallet_no_fn() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE seq int; ds text;
BEGIN
  IF NEW.pallet_no IS NOT NULL AND NEW.pallet_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(sequence_no),0)+1 INTO seq FROM public.pallets
    WHERE to_char(created_at,'YYYYMMDD') = ds;
  NEW.sequence_no := seq;
  NEW.pallet_no := 'PAL' || ds || lpad(seq::text, 3, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pallets_gen_no BEFORE INSERT ON public.pallets
  FOR EACH ROW EXECUTE FUNCTION public.gen_pallet_no_fn();

-- 4. CARTONS
CREATE TABLE public.cartons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carton_no text UNIQUE,
  sequence_no int,
  status text NOT NULL DEFAULT 'open',
  weight_kg numeric,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  pallet_id uuid REFERENCES public.pallets(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cartons TO authenticated;
GRANT ALL ON public.cartons TO service_role;
ALTER TABLE public.cartons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cartons staff read" ON public.cartons FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "cartons warehouse write" ON public.cartons FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_cartons_updated BEFORE UPDATE ON public.cartons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.gen_carton_no_fn() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE seq int; ds text;
BEGIN
  IF NEW.carton_no IS NOT NULL AND NEW.carton_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(sequence_no),0)+1 INTO seq FROM public.cartons
    WHERE to_char(created_at,'YYYYMMDD') = ds;
  NEW.sequence_no := seq;
  NEW.carton_no := 'BOX' || ds || lpad(seq::text, 3, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cartons_gen_no BEFORE INSERT ON public.cartons
  FOR EACH ROW EXECUTE FUNCTION public.gen_carton_no_fn();

-- 5. BATCHES additions
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS eta_date date,
  ADD COLUMN IF NOT EXISTS vessel_no text;

-- 6. WAYBILLS additions
ALTER TABLE public.waybills
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS carton_id uuid REFERENCES public.cartons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES public.pallets(id) ON DELETE SET NULL;

-- 7. ORDERS additions
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS domestic_tracking_no text,
  ADD COLUMN IF NOT EXISTS carton_id uuid REFERENCES public.cartons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES public.pallets(id) ON DELETE SET NULL;

-- 8. FORWARDING_ORDERS additions
ALTER TABLE public.forwarding_orders
  ADD COLUMN IF NOT EXISTS carton_id uuid REFERENCES public.cartons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pallet_id uuid REFERENCES public.pallets(id) ON DELETE SET NULL;

-- 9. Trigger to sync waybill.payment_status from parent order/forwarding
CREATE OR REPLACE FUNCTION public.sync_waybill_payment_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    UPDATE public.waybills SET payment_status = NEW.payment_status WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_sync_waybill_pay ON public.orders;
CREATE TRIGGER trg_orders_sync_waybill_pay AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION public.sync_waybill_payment_status();

CREATE OR REPLACE FUNCTION public.sync_waybill_payment_status_fo() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.waybills SET payment_status = NEW.payment_status WHERE forwarding_id = NEW.id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fo_sync_waybill_pay ON public.forwarding_orders;
CREATE TRIGGER trg_fo_sync_waybill_pay AFTER UPDATE OF payment_status ON public.forwarding_orders
  FOR EACH ROW WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  EXECUTE FUNCTION public.sync_waybill_payment_status_fo();

-- 10. Seed some defaults so the dropdowns aren't empty
INSERT INTO public.cargo_types (code, name_zh, name_en, sort_order) VALUES
  ('GEN', '普货', 'General', 10),
  ('ELEC', '电子产品', 'Electronics', 20),
  ('FOOD', '食品', 'Food', 30),
  ('LIQ', '液体', 'Liquid', 40),
  ('DOC', '文件', 'Documents', 50)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.destinations (code, name_zh, name_en, country, sort_order) VALUES
  ('YYZ', '多伦多', 'Toronto', 'CA', 10),
  ('YVR', '温哥华', 'Vancouver', 'CA', 20),
  ('YUL', '蒙特利尔', 'Montreal', 'CA', 30),
  ('YYC', '卡尔加里', 'Calgary', 'CA', 40)
ON CONFLICT (code) DO NOTHING;
