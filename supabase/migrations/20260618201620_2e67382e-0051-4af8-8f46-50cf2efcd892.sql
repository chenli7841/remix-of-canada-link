
-- Seed waybill generator settings
INSERT INTO public.app_settings (key, value) VALUES
  ('waybill_company_code', '{"code":"SC"}'::jsonb),
  ('waybill_route_codes', '{"air":"A","sea":"S"}'::jsonb),
  ('waybill_destinations', '{"YYZ":"Toronto","YVR":"Vancouver","YUL":"Montreal"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Generator: CompanyCode + CustomerCode + RouteCode + YYMMDD + DestinationCode + RandN
CREATE OR REPLACE FUNCTION public.gen_waybill_no(
  _customer_code text,
  _route_code text DEFAULT NULL,
  _destination_code text DEFAULT NULL,
  _shipping_method text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company text;
  route_map jsonb;
  route text;
  dest text;
  rnd text;
BEGIN
  SELECT (value->>'code') INTO company FROM public.app_settings WHERE key = 'waybill_company_code';
  company := COALESCE(NULLIF(company,''), 'SC');

  IF _route_code IS NOT NULL AND _route_code <> '' THEN
    route := _route_code;
  ELSE
    SELECT value INTO route_map FROM public.app_settings WHERE key = 'waybill_route_codes';
    route := COALESCE(route_map->>COALESCE(_shipping_method,'air'), 'A');
  END IF;

  dest := COALESCE(NULLIF(_destination_code,''), 'XXX');
  rnd  := lpad((floor(random()*100000))::text, 5, '0');

  RETURN company
       || COALESCE(NULLIF(_customer_code,''), '0000')
       || route
       || to_char(now(),'YYMMDD')
       || dest
       || rnd;
END; $$;

GRANT EXECUTE ON FUNCTION public.gen_waybill_no(text,text,text,text) TO authenticated, anon, service_role;

-- Auto-fill tracking_no for forwarding_orders when missing
CREATE OR REPLACE FUNCTION public.gen_fo_tracking_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tracking_no IS NULL OR NEW.tracking_no = '' THEN
    NEW.tracking_no := public.gen_waybill_no(
      NEW.customer_code,
      NEW.route_code,
      NEW.destination_code,
      NEW.shipping_method::text
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_gen_fo_tracking_no ON public.forwarding_orders;
CREATE TRIGGER trg_gen_fo_tracking_no
  BEFORE INSERT ON public.forwarding_orders
  FOR EACH ROW EXECUTE FUNCTION public.gen_fo_tracking_no();

-- Auto-fill tracking_no for orders when missing
CREATE OR REPLACE FUNCTION public.gen_order_tracking_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tracking_no IS NULL OR NEW.tracking_no = '' THEN
    NEW.tracking_no := public.gen_waybill_no(
      NEW.customer_code,
      NEW.route_code,
      NEW.destination_code,
      NEW.shipping_method::text
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_gen_order_tracking_no ON public.orders;
CREATE TRIGGER trg_gen_order_tracking_no
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.gen_order_tracking_no();
