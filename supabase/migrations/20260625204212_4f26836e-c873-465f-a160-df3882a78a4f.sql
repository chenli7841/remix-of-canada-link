
ALTER TABLE public.cartons ADD COLUMN IF NOT EXISTS self_freight_cny numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.pallets ADD COLUMN IF NOT EXISTS self_freight_cny numeric(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.gen_pallet_no_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  seq int; ds text; parts text;
BEGIN
  IF NEW.pallet_no IS NOT NULL AND NEW.pallet_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(sequence_no),0)+1 INTO seq FROM public.pallets
    WHERE to_char(created_at,'YYYYMMDD') = ds;
  NEW.sequence_no := seq;
  parts := 'PAL' || ds;
  IF NEW.route_code IS NOT NULL AND NEW.route_code <> '' THEN parts := parts || upper(NEW.route_code); END IF;
  IF NEW.customer_code IS NOT NULL AND NEW.customer_code <> '' THEN parts := parts || NEW.customer_code; END IF;
  IF NEW.pickup_warehouse IS NOT NULL AND NEW.pickup_warehouse <> '' THEN parts := parts || upper(NEW.pickup_warehouse); END IF;
  IF NEW.destination_code IS NOT NULL AND NEW.destination_code <> '' THEN parts := parts || upper(NEW.destination_code); END IF;
  parts := parts || lpad(seq::text, 3, '0');
  NEW.pallet_no := parts;
  RETURN NEW;
END $$;
