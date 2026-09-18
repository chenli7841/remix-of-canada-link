
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS customer_code text UNIQUE;

CREATE OR REPLACE FUNCTION public.gen_customer_code() RETURNS text
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c text; tries int := 0;
BEGIN
  LOOP
    c := lpad((floor(random()*100000))::int::text, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE customer_code = c);
    tries := tries + 1;
    IF tries > 50 THEN RAISE EXCEPTION 'cannot allocate customer_code'; END IF;
  END LOOP;
  RETURN c;
END $$;

UPDATE public.profiles SET customer_code = public.gen_customer_code()
WHERE customer_code IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, phone, customer_code)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url', NEW.phone, public.gen_customer_code())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.wallets (user_id, balance_cny) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $function$;
