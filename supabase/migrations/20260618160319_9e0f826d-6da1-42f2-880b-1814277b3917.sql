
ALTER TABLE public.tracking_events
  ADD COLUMN source text NOT NULL DEFAULT 'admin_manual'
    CHECK (source IN ('third_party', 'admin_action', 'admin_manual')),
  ADD COLUMN source_ref text;

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
    'event_time', event_time,
    'source', source,
    'source_ref', source_ref
  ) ORDER BY event_time ASC), '[]'::jsonb)
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
