CREATE OR REPLACE FUNCTION public.track_by_any_no(_input text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  n text := upper(trim(COALESCE(_input, '')));
  k text;
  wb_ids uuid[];
  header record;
  evts jsonb;
BEGIN
  IF n = '' THEN RETURN NULL; END IF;
  k := public.normalize_no(n);

  SELECT array_agg(id) INTO wb_ids FROM public.waybills
   WHERE waybill_no = n OR n = ANY(aliases) OR public.normalize_no(waybill_no) = k
      OR upper(COALESCE(intl_tracking_no,'')) = n OR public.normalize_no(COALESCE(intl_tracking_no,'')) = k
      OR upper(COALESCE(mark_no,'')) = n;

  IF wb_ids IS NULL THEN
    SELECT array_agg(w.id) INTO wb_ids
      FROM public.waybills w JOIN public.orders o ON o.id = w.order_id
     WHERE o.order_no = n OR n = ANY(o.aliases) OR public.normalize_no(o.order_no) = k
        OR upper(COALESCE(o.domestic_tracking_no,'')) = n OR public.normalize_no(COALESCE(o.domestic_tracking_no,'')) = k
        OR upper(COALESCE(o.intl_tracking_no,'')) = n OR public.normalize_no(COALESCE(o.intl_tracking_no,'')) = k
        OR upper(COALESCE(o.tracking_no,'')) = n;
  END IF;

  IF wb_ids IS NULL THEN
    SELECT array_agg(w.id) INTO wb_ids
      FROM public.waybills w JOIN public.forwarding_orders f ON f.id = w.forwarding_id
     WHERE f.request_no = n OR n = ANY(f.aliases) OR public.normalize_no(f.request_no) = k
        OR upper(COALESCE(f.domestic_tracking_no,'')) = n OR public.normalize_no(COALESCE(f.domestic_tracking_no,'')) = k
        OR upper(COALESCE(f.intl_tracking_no,'')) = n OR public.normalize_no(COALESCE(f.intl_tracking_no,'')) = k
        OR upper(COALESCE(f.tracking_no,'')) = n;
  END IF;

  IF wb_ids IS NULL OR array_length(wb_ids, 1) IS NULL THEN RETURN NULL; END IF;

  SELECT s.shipping_method, s.carrier, s.status, s.current_location, s.eta, s.created_at
    INTO header
    FROM public.shipments s
   WHERE s.tracking_no IN (SELECT waybill_no FROM public.waybills WHERE id = ANY(wb_ids))
   ORDER BY s.created_at ASC
   LIMIT 1;

  IF header IS NULL THEN RETURN NULL; END IF;

  WITH raw AS (
    SELECT te.status_zh, te.status_en, te.location_zh, te.location_en,
           te.event_time, te.source, COALESCE(te.source_ref, sh.tracking_no) AS source_ref
      FROM public.tracking_events te
      JOIN public.shipments sh ON sh.id = te.shipment_id
     WHERE sh.tracking_no IN (SELECT waybill_no FROM public.waybills WHERE id = ANY(wb_ids))
  ), grouped AS (
    SELECT status_zh, status_en, location_zh, location_en, source,
           min(event_time) AS event_time,
           count(*) AS box_count,
           min(source_ref) AS one_ref
      FROM raw
     GROUP BY status_zh, status_en, location_zh, location_en, source,
              date_trunc('minute', event_time)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'status_zh', status_zh, 'status_en', status_en,
    'location_zh', location_zh, 'location_en', location_en,
    'event_time', event_time, 'source', source,
    'source_ref', CASE WHEN box_count > 1 THEN box_count::text || ' 件' ELSE one_ref END
  ) ORDER BY event_time ASC), '[]'::jsonb) INTO evts FROM grouped;

  RETURN jsonb_build_object(
    'tracking_no', trim(_input),
    'shipping_method', header.shipping_method,
    'carrier', header.carrier,
    'status', header.status,
    'current_location', header.current_location,
    'eta', header.eta,
    'created_at', header.created_at,
    'events', evts
  );
END;
$fn$;