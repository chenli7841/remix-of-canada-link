CREATE OR REPLACE FUNCTION public.gen_fo_request_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cust text; route text;
BEGIN
  IF NEW.request_no IS NOT NULL AND NEW.request_no <> '' THEN RETURN NEW; END IF;
  cust  := lpad(regexp_replace(COALESCE(NEW.customer_code,''), '\D','','g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;
  route := upper(COALESCE(NULLIF(NEW.route_code,''), 'XX'));
  IF length(route) < 2 THEN route := lpad(route, 2, 'X'); END IF;
  IF length(route) > 2 THEN route := left(route, 2); END IF;
  NEW.request_no := 'FW' || cust || route || to_char(now(),'MMDD')
                    || lpad((floor(random()*1000))::text, 3, '0');
  RETURN NEW;
END $$;