
-- ============ 1. 订单/集运单 运费快照 ============
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.shipping_routes(id),
  ADD COLUMN IF NOT EXISTS freight_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS freight_recalc_at timestamptz,
  ADD COLUMN IF NOT EXISTS freight_recalc_by uuid;

CREATE INDEX IF NOT EXISTS idx_orders_route_id ON public.orders(route_id);
CREATE INDEX IF NOT EXISTS idx_orders_batch_no ON public.orders(batch_no);

ALTER TABLE public.forwarding_orders
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.shipping_routes(id),
  ADD COLUMN IF NOT EXISTS actual_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS length_cm numeric,
  ADD COLUMN IF NOT EXISTS width_cm numeric,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS declared_value_cad numeric,
  ADD COLUMN IF NOT EXISTS freight_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS intake_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_by uuid;

CREATE INDEX IF NOT EXISTS idx_fo_route_id ON public.forwarding_orders(route_id);
CREATE INDEX IF NOT EXISTS idx_fo_batch_no ON public.forwarding_orders(batch_no);

-- ============ 2. 操作日志表 ============
CREATE TABLE IF NOT EXISTS public.admin_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('order','forwarding','waybill','batch','tracking_event')),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  operator_id uuid,
  operator_name text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_action_logs TO authenticated;
GRANT ALL ON public.admin_action_logs TO service_role;
ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_logs" ON public.admin_action_logs FOR SELECT
  TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_logs_entity ON public.admin_action_logs(entity_type, entity_id, created_at DESC);

-- ============ 3. 物流轨迹预设 ============
CREATE TABLE IF NOT EXISTS public.tracking_event_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label_zh text NOT NULL,
  label_en text,
  default_location_zh text,
  default_location_en text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tracking_event_presets TO authenticated;
GRANT ALL ON public.tracking_event_presets TO service_role;
ALTER TABLE public.tracking_event_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_presets" ON public.tracking_event_presets FOR SELECT
  TO authenticated USING (public.is_staff(auth.uid()));
CREATE TRIGGER trg_presets_updated BEFORE UPDATE ON public.tracking_event_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.tracking_event_presets (code, label_zh, label_en, default_location_zh, default_location_en, sort_order) VALUES
  ('cn_received',    '中国仓已收件',     'Received at CN warehouse',      '广州仓', 'Guangzhou WH', 10),
  ('cn_packed',      '已打包',           'Packed',                        '广州仓', 'Guangzhou WH', 20),
  ('cn_departed',    '从中国仓发出',     'Departed CN warehouse',         '广州仓', 'Guangzhou WH', 30),
  ('in_transit',     '国际运输中',       'In international transit',      NULL,    NULL,            40),
  ('ca_arrived',     '加拿大仓到件',     'Arrived at CA warehouse',       '多伦多仓', 'Toronto WH', 50),
  ('ca_customs',     '清关中',           'Customs clearance',             '多伦多仓', 'Toronto WH', 55),
  ('ready_pickup',   '可取货 / 待派送',  'Ready for pickup / delivery',   '多伦多仓', 'Toronto WH', 60),
  ('delivered',      '已签收',           'Delivered',                     NULL,    NULL,            70)
ON CONFLICT (code) DO NOTHING;

-- ============ 4. 批次表 ============
DO $$ BEGIN
  CREATE TYPE public.batch_status AS ENUM ('draft','locked','shipped','arrived','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.batch_method AS ENUM ('air','sea','express');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no text UNIQUE,
  planned_ship_date date NOT NULL,
  shipping_method public.batch_method NOT NULL,
  cargo_type text,
  destination_code text,
  sequence_no int,
  status public.batch_status NOT NULL DEFAULT 'draft',
  total_weight_kg numeric DEFAULT 0,
  total_volume_cm3 numeric DEFAULT 0,
  total_cny numeric DEFAULT 0,
  waybill_count int DEFAULT 0,
  notes text,
  created_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO authenticated;
GRANT ALL ON public.batches TO service_role;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_batches" ON public.batches FOR SELECT
  TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff_write_batches" ON public.batches FOR ALL
  TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER trg_batches_updated BEFORE UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 批次号生成函数
CREATE OR REPLACE FUNCTION public.gen_batch_no_fn()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  method_code text;
  cargo_short text;
  dest_short text;
  seq int;
  date_str text;
BEGIN
  IF NEW.batch_no IS NOT NULL AND NEW.batch_no <> '' THEN RETURN NEW; END IF;
  date_str := to_char(NEW.planned_ship_date, 'YYYYMMDD');
  method_code := CASE NEW.shipping_method
    WHEN 'air' THEN 'AIR' WHEN 'sea' THEN 'SEA' WHEN 'express' THEN 'EXP' END;
  cargo_short := upper(coalesce(left(regexp_replace(NEW.cargo_type, '[^a-zA-Z0-9]', '', 'g'), 4), 'GEN'));
  IF cargo_short = '' THEN cargo_short := 'GEN'; END IF;
  dest_short := upper(coalesce(NEW.destination_code, 'XXX'));

  SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO seq
  FROM public.batches
  WHERE planned_ship_date = NEW.planned_ship_date
    AND shipping_method = NEW.shipping_method
    AND COALESCE(cargo_type,'') = COALESCE(NEW.cargo_type,'')
    AND COALESCE(destination_code,'') = COALESCE(NEW.destination_code,'');

  NEW.sequence_no := seq;
  NEW.batch_no := 'BAT' || date_str || method_code || cargo_short || dest_short || lpad(seq::text, 3, '0');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_gen_batch_no BEFORE INSERT ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.gen_batch_no_fn();

-- ============ 5. 运单字段 ============
ALTER TABLE public.waybills
  ADD COLUMN IF NOT EXISTS assigned_batch_id uuid REFERENCES public.batches(id),
  ADD COLUMN IF NOT EXISTS weight_snapshot jsonb;

CREATE INDEX IF NOT EXISTS idx_waybills_batch ON public.waybills(assigned_batch_id);
CREATE INDEX IF NOT EXISTS idx_waybills_status ON public.waybills(status);
