
-- 1) Update route_codes setting: 2-letter per (method, destination)
UPDATE public.app_settings
SET value = '{"air":{"YYZ":"AT","YVR":"AV","YUL":"AM"},"sea":{"YYZ":"ST","YVR":"SV","YUL":"SM"}}'::jsonb
WHERE key = 'waybill_route_codes';

-- 2) Rewrite gen_waybill_no: 5-digit customer, 2-letter route from nested map by (method, destination)
CREATE OR REPLACE FUNCTION public.gen_waybill_no(
  _customer_code text,
  _route_code text DEFAULT NULL,
  _destination_code text DEFAULT NULL,
  _shipping_method text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE
  company text;
  route_map jsonb;
  route text;
  dest text;
  cust text;
  rnd text;
BEGIN
  SELECT (value->>'code') INTO company FROM public.app_settings WHERE key = 'waybill_company_code';
  company := COALESCE(NULLIF(company,''), 'SC');

  IF _route_code IS NOT NULL AND _route_code <> '' THEN
    route := _route_code;
  ELSE
    SELECT value INTO route_map FROM public.app_settings WHERE key = 'waybill_route_codes';
    route := COALESCE(
      route_map->COALESCE(_shipping_method,'air')->>COALESCE(_destination_code,''),
      'XX'
    );
  END IF;

  dest := COALESCE(NULLIF(_destination_code,''), 'XXX');
  -- Normalize customer code to 5 digits
  cust := lpad(regexp_replace(COALESCE(_customer_code,''), '\D', '', 'g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;

  rnd := lpad((floor(random()*100000))::text, 5, '0');

  RETURN company || cust || route || to_char(now(),'YYMMDD') || dest || rnd;
END; $$;

-- 3) Add domestic_tracking_no to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS domestic_tracking_no text;

-- 4) Waybill status enum
DO $$ BEGIN
  CREATE TYPE public.waybill_status AS ENUM
    ('pending','received','packed','shipped','in_transit','delivered','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Waybills table
CREATE TABLE IF NOT EXISTS public.waybills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  forwarding_id uuid REFERENCES public.forwarding_orders(id) ON DELETE CASCADE,
  waybill_no text NOT NULL UNIQUE,
  intl_tracking_no text,
  domestic_tracking_no text,
  box_no text,
  pallet_no text,
  length_cm numeric(8,2),
  width_cm numeric(8,2),
  height_cm numeric(8,2),
  weight_kg numeric(8,2),
  status public.waybill_status NOT NULL DEFAULT 'pending',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waybills_one_parent CHECK (
    (order_id IS NOT NULL AND forwarding_id IS NULL) OR
    (order_id IS NULL AND forwarding_id IS NOT NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.waybills TO authenticated;
GRANT ALL ON public.waybills TO service_role;

ALTER TABLE public.waybills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own waybills" ON public.waybills;
CREATE POLICY "Users manage their own waybills"
  ON public.waybills FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_waybills_order_id ON public.waybills(order_id);
CREATE INDEX IF NOT EXISTS idx_waybills_forwarding_id ON public.waybills(forwarding_id);
CREATE INDEX IF NOT EXISTS idx_waybills_user_id ON public.waybills(user_id);

DROP TRIGGER IF EXISTS trg_waybills_updated_at ON public.waybills;
CREATE TRIGGER trg_waybills_updated_at
  BEFORE UPDATE ON public.waybills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) Auto-generate waybill_no on insert if missing (needs parent context)
CREATE OR REPLACE FUNCTION public.gen_waybill_row_no()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  cust text; route text; dest text; method text;
BEGIN
  IF NEW.waybill_no IS NOT NULL AND NEW.waybill_no <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.order_id IS NOT NULL THEN
    SELECT customer_code, route_code, destination_code, shipping_method::text
      INTO cust, route, dest, method
      FROM public.orders WHERE id = NEW.order_id;
  ELSE
    SELECT customer_code, route_code, destination_code, shipping_method::text
      INTO cust, route, dest, method
      FROM public.forwarding_orders WHERE id = NEW.forwarding_id;
  END IF;
  NEW.waybill_no := public.gen_waybill_no(cust, route, dest, method);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.gen_waybill_row_no() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_waybills_gen_no ON public.waybills;
CREATE TRIGGER trg_waybills_gen_no
  BEFORE INSERT ON public.waybills
  FOR EACH ROW EXECUTE FUNCTION public.gen_waybill_row_no();

-- 7) Derive order/forwarding status from child waybill statuses
-- Ordering: pending < received < packed < shipped < in_transit < delivered ; cancelled treated as lowest priority (only used if ALL waybills are cancelled)
CREATE OR REPLACE FUNCTION public.waybill_status_rank(_s public.waybill_status)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'pending'    THEN 1
    WHEN 'received'   THEN 2
    WHEN 'packed'     THEN 3
    WHEN 'shipped'    THEN 4
    WHEN 'in_transit' THEN 5
    WHEN 'delivered'  THEN 6
    WHEN 'cancelled'  THEN 0
  END
$$;

CREATE OR REPLACE FUNCTION public.recompute_parent_from_waybills()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  oid uuid; fid uuid;
  latest public.waybill_status;
  all_cancelled boolean;
BEGIN
  oid := COALESCE(NEW.order_id, OLD.order_id);
  fid := COALESCE(NEW.forwarding_id, OLD.forwarding_id);

  IF oid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE order_id = oid;
    IF all_cancelled THEN
      UPDATE public.orders SET status = 'cancelled' WHERE id = oid;
    ELSE
      SELECT status INTO latest FROM public.waybills
        WHERE order_id = oid AND status <> 'cancelled'
        ORDER BY public.waybill_status_rank(status) DESC NULLS LAST, updated_at DESC
        LIMIT 1;
      IF latest IS NOT NULL THEN
        UPDATE public.orders SET status =
          CASE latest
            WHEN 'pending'    THEN 'paid'::order_status
            WHEN 'received'   THEN 'processing'::order_status
            WHEN 'packed'     THEN 'processing'::order_status
            WHEN 'shipped'    THEN 'shipped'::order_status
            WHEN 'in_transit' THEN 'shipped'::order_status
            WHEN 'delivered'  THEN 'delivered'::order_status
          END
        WHERE id = oid AND status <> 'pending';
      END IF;
    END IF;
  END IF;

  IF fid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE forwarding_id = fid;
    IF all_cancelled THEN
      UPDATE public.forwarding_orders SET status = 'cancelled' WHERE id = fid;
    ELSE
      SELECT status INTO latest FROM public.waybills
        WHERE forwarding_id = fid AND status <> 'cancelled'
        ORDER BY public.waybill_status_rank(status) DESC NULLS LAST, updated_at DESC
        LIMIT 1;
      IF latest IS NOT NULL THEN
        UPDATE public.forwarding_orders SET status = latest::text::forwarding_status
          WHERE id = fid;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.recompute_parent_from_waybills() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_waybills_recompute_parent ON public.waybills;
CREATE TRIGGER trg_waybills_recompute_parent
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.waybills
  FOR EACH ROW EXECUTE FUNCTION public.recompute_parent_from_waybills();
