
-- shipments
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  tracking_no text NOT NULL UNIQUE,
  shipping_method text NOT NULL DEFAULT 'air',
  carrier text,
  status text NOT NULL DEFAULT 'created',
  current_location text,
  eta date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY shipments_select_own ON public.shipments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = shipments.order_id AND o.user_id = auth.uid()));

CREATE TRIGGER shipments_set_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- tracking_events
CREATE TABLE public.tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  status_zh text NOT NULL,
  status_en text NOT NULL,
  location_zh text,
  location_en text,
  event_time timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tracking_events TO authenticated;
GRANT ALL ON public.tracking_events TO service_role;

ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tracking_events_select_own ON public.tracking_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = tracking_events.shipment_id AND o.user_id = auth.uid()
  ));

CREATE INDEX tracking_events_shipment_time_idx ON public.tracking_events (shipment_id, event_time DESC);

-- Public lookup function: anyone can query a single shipment by tracking number
-- without exposing other orders / PII.
CREATE OR REPLACE FUNCTION public.lookup_shipment(_tracking_no text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  evts jsonb;
BEGIN
  SELECT id, tracking_no, shipping_method, carrier, status, current_location, eta, created_at
    INTO s
  FROM public.shipments
  WHERE upper(tracking_no) = upper(trim(_tracking_no))
  LIMIT 1;

  IF s.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'status_zh', status_zh,
    'status_en', status_en,
    'location_zh', location_zh,
    'location_en', location_en,
    'event_time', event_time
  ) ORDER BY event_time DESC), '[]'::jsonb)
    INTO evts
  FROM public.tracking_events
  WHERE shipment_id = s.id;

  RETURN jsonb_build_object(
    'tracking_no', s.tracking_no,
    'shipping_method', s.shipping_method,
    'carrier', s.carrier,
    'status', s.status,
    'current_location', s.current_location,
    'eta', s.eta,
    'created_at', s.created_at,
    'events', evts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_shipment(text) TO anon, authenticated;

-- Auto-create shipment when an order's tracking_no is set
CREATE OR REPLACE FUNCTION public.sync_order_shipment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tracking_no IS NOT NULL AND NEW.tracking_no <> '' THEN
    INSERT INTO public.shipments (order_id, tracking_no, shipping_method, status)
    VALUES (NEW.id, NEW.tracking_no, NEW.shipping_method, 'created')
    ON CONFLICT (tracking_no) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_sync_shipment
  AFTER INSERT OR UPDATE OF tracking_no ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_shipment();
