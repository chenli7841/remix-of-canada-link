CREATE OR REPLACE FUNCTION public.gen_short_no(_prefix text, _customer_code text, _route_code text, _at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE cust text; route text; pfx text;
BEGIN
  pfx := upper(COALESCE(NULLIF(_prefix,''),'XX'));
  IF length(pfx) <> 2 THEN pfx := rpad(left(pfx,2),2,'X'); END IF;
  cust := lpad(regexp_replace(COALESCE(_customer_code,''), '\D','','g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;
  route := upper(COALESCE(NULLIF(_route_code,''), 'XX'));
  IF length(route) < 2 THEN route := lpad(route, 2, 'X'); END IF;
  IF length(route) > 2 THEN route := left(route, 2); END IF;
  RETURN pfx || route || cust || to_char(COALESCE(_at, now()),'MMDD')
         || lpad((floor(random()*1000))::text, 3, '0');
END $function$;

CREATE OR REPLACE FUNCTION public.gen_carton_no_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE seq int; ds text;
BEGIN
  IF NEW.carton_no IS NOT NULL AND NEW.carton_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(), 'MMDD');
  SELECT COALESCE(MAX(sequence_no),0)+1 INTO seq FROM public.cartons
    WHERE to_char(created_at,'MMDD') = ds;
  NEW.sequence_no := seq;
  NEW.carton_no := 'B'
    || upper(COALESCE(NULLIF(NEW.route_code,''),''))
    || COALESCE(NULLIF(NEW.customer_code,''),'')
    || ds
    || lpad(seq::text, 3, '0');
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.gen_pallet_no_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE seq int; ds text;
BEGIN
  IF NEW.pallet_no IS NOT NULL AND NEW.pallet_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(), 'MMDD');
  SELECT COALESCE(MAX(sequence_no),0)+1 INTO seq FROM public.pallets
    WHERE to_char(created_at,'MMDD') = ds;
  NEW.sequence_no := seq;
  NEW.pallet_no := 'P'
    || upper(COALESCE(NULLIF(NEW.route_code,''),''))
    || COALESCE(NULLIF(NEW.customer_code,''),'')
    || ds
    || lpad(seq::text, 3, '0');
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.gen_batch_no_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE seq int; ds text; method_code text; dest_short text;
BEGIN
  IF NEW.batch_no IS NOT NULL AND NEW.batch_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(COALESCE(NEW.planned_ship_date, now()::date), 'MMDD');
  method_code := CASE NEW.shipping_method
    WHEN 'air' THEN 'AIR' WHEN 'sea' THEN 'SEA' WHEN 'express' THEN 'EXP' ELSE 'GEN' END;
  dest_short := upper(COALESCE(NULLIF(NEW.destination_code,''), 'XXX'));
  SELECT COALESCE(MAX(sequence_no), 0) + 1 INTO seq
  FROM public.batches
  WHERE planned_ship_date = NEW.planned_ship_date
    AND shipping_method = NEW.shipping_method
    AND COALESCE(destination_code,'') = COALESCE(NEW.destination_code,'');
  NEW.sequence_no := seq;
  NEW.batch_no := 'M' || method_code || dest_short || ds || lpad(seq::text, 3, '0');
  RETURN NEW;
END $function$;