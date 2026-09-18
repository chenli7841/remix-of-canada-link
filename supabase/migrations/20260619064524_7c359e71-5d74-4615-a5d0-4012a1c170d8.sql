
-- Stage E: cartons matching fields + payment aggregation helper

ALTER TABLE public.cartons
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.shipping_routes(id),
  ADD COLUMN IF NOT EXISTS route_code text,
  ADD COLUMN IF NOT EXISTS customer_user_id uuid,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS pickup_warehouse text,
  ADD COLUMN IF NOT EXISTS destination_code text;

CREATE INDEX IF NOT EXISTS idx_cartons_route ON public.cartons(route_id);
CREATE INDEX IF NOT EXISTS idx_cartons_customer ON public.cartons(customer_user_id);

-- Rewrite carton number trigger: BOX + YYYYMMDD + [route] + [customer] + [pickup] + [dest] + seq
CREATE OR REPLACE FUNCTION public.gen_carton_no_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  seq int; ds text; parts text;
BEGIN
  IF NEW.carton_no IS NOT NULL AND NEW.carton_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(sequence_no),0)+1 INTO seq FROM public.cartons
    WHERE to_char(created_at,'YYYYMMDD') = ds;
  NEW.sequence_no := seq;
  parts := 'BOX' || ds;
  IF NEW.route_code IS NOT NULL AND NEW.route_code <> '' THEN parts := parts || upper(NEW.route_code); END IF;
  IF NEW.customer_code IS NOT NULL AND NEW.customer_code <> '' THEN parts := parts || NEW.customer_code; END IF;
  IF NEW.pickup_warehouse IS NOT NULL AND NEW.pickup_warehouse <> '' THEN parts := parts || upper(NEW.pickup_warehouse); END IF;
  IF NEW.destination_code IS NOT NULL AND NEW.destination_code <> '' THEN parts := parts || upper(NEW.destination_code); END IF;
  parts := parts || lpad(seq::text, 3, '0');
  NEW.carton_no := parts;
  RETURN NEW;
END $$;

-- Helper: aggregate payment status of a carton from its child waybills
CREATE OR REPLACE FUNCTION public.carton_payment_status(_carton_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT bool_and(payment_status = 'paid') AS all_paid,
           bool_or(payment_status = 'paid')  AS any_paid,
           count(*) AS n
    FROM public.waybills WHERE carton_id = _carton_id
  )
  SELECT CASE
    WHEN n = 0 THEN 'empty'
    WHEN all_paid THEN 'paid'
    WHEN any_paid THEN 'partial'
    ELSE 'unpaid'
  END FROM s
$$;

CREATE OR REPLACE FUNCTION public.pallet_payment_status(_pallet_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT bool_and(payment_status = 'paid') AS all_paid,
           bool_or(payment_status = 'paid')  AS any_paid,
           count(*) AS n
    FROM public.waybills WHERE pallet_id = _pallet_id
       OR carton_id IN (SELECT id FROM public.cartons WHERE pallet_id = _pallet_id)
  )
  SELECT CASE WHEN n = 0 THEN 'empty' WHEN all_paid THEN 'paid' WHEN any_paid THEN 'partial' ELSE 'unpaid' END FROM s
$$;

CREATE OR REPLACE FUNCTION public.batch_payment_status(_batch_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT bool_and(payment_status = 'paid') AS all_paid,
           bool_or(payment_status = 'paid')  AS any_paid,
           count(*) AS n
    FROM public.waybills WHERE assigned_batch_id = _batch_id
  )
  SELECT CASE WHEN n = 0 THEN 'empty' WHEN all_paid THEN 'paid' WHEN any_paid THEN 'partial' ELSE 'unpaid' END FROM s
$$;
