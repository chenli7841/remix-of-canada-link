
-- Sequential customer codes starting from 00000
CREATE SEQUENCE IF NOT EXISTS public.customer_code_seq START WITH 0 MINVALUE 0 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.gen_customer_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE c text; v bigint; tries int := 0;
BEGIN
  LOOP
    v := nextval('public.customer_code_seq');
    c := lpad(v::text, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE customer_code = c);
    tries := tries + 1;
    IF tries > 100000 THEN RAISE EXCEPTION 'cannot allocate customer_code'; END IF;
  END LOOP;
  RETURN c;
END $function$;

-- Renumber existing profiles in creation order, starting at 00000
DO $$
DECLARE r record; i bigint := 0;
BEGIN
  -- temporarily clear to avoid unique conflict
  UPDATE public.profiles SET customer_code = 'TMP_' || id::text;
  FOR r IN SELECT id FROM public.profiles ORDER BY created_at ASC LOOP
    UPDATE public.profiles SET customer_code = lpad(i::text, 5, '0') WHERE id = r.id;
    i := i + 1;
  END LOOP;
  -- align sequence so next nextval returns i
  PERFORM setval('public.customer_code_seq', i, false);
END $$;
