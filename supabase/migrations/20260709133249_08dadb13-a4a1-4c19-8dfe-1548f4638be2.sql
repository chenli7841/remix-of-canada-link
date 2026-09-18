-- Public tracking (/track) currently only matches an exact shipments.tracking_no, which is
-- really just the waybill number. Customers also want to search by their shop order number
-- or forwarding (consolidation) order number. track_by_any_no() resolves any of the three to
-- the underlying waybill(s) and returns a merged, chronologically-sorted event timeline —
-- same pattern already used for per-batch tracking in the account page.

CREATE OR REPLACE FUNCTION public.track_by_any_no(_input text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n text := upper(trim(COALESCE(_input, '')));
  k text;
  wb_ids uuid[];
  header record;
  evts jsonb;
BEGIN
  IF n = '' THEN RETURN NULL; END IF;
  k := public.normalize_no(n);

  -- 1) direct waybill number match
  SELECT array_agg(id) INTO wb_ids FROM public.waybills
   WHERE waybill_no = n OR n = ANY(aliases) OR public.normalize_no(waybill_no) = k;

  -- 2) shop order number -> every waybill boxed under that order
  IF wb_ids IS NULL THEN
    SELECT array_agg(w.id) INTO wb_ids
      FROM public.waybills w JOIN public.orders o ON o.id = w.order_id
     WHERE o.order_no = n OR n = ANY(o.aliases) OR public.normalize_no(o.order_no) = k;
  END IF;

  -- 3) forwarding (consolidation) order number -> every waybill boxed under that request
  IF wb_ids IS NULL THEN
    SELECT array_agg(w.id) INTO wb_ids
      FROM public.waybills w JOIN public.forwarding_orders f ON f.id = w.forwarding_id
     WHERE f.request_no = n OR n = ANY(f.aliases) OR public.normalize_no(f.request_no) = k;
  END IF;

  IF wb_ids IS NULL OR array_length(wb_ids, 1) IS NULL THEN RETURN NULL; END IF;

  -- Representative header: the earliest-created matching shipment (first box shipped).
  SELECT s.shipping_method, s.carrier, s.status, s.current_location, s.eta, s.created_at
    INTO header
    FROM public.shipments s
   WHERE s.tracking_no IN (SELECT waybill_no FROM public.waybills WHERE id = ANY(wb_ids))
   ORDER BY s.created_at ASC
   LIMIT 1;

  IF header IS NULL THEN RETURN NULL; END IF;

  -- Merge every matching shipment's events into one chronological timeline, tagging each
  -- with the box it came from so multi-box orders stay legible (mirrors batch tracking).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'status_zh', te.status_zh, 'status_en', te.status_en,
    'location_zh', te.location_zh, 'location_en', te.location_en,
    'event_time', te.event_time, 'source', te.source,
    'source_ref', COALESCE(te.source_ref, sh.tracking_no)
  ) ORDER BY te.event_time ASC), '[]'::jsonb)
    INTO evts
    FROM public.tracking_events te
    JOIN public.shipments sh ON sh.id = te.shipment_id
   WHERE sh.tracking_no IN (SELECT waybill_no FROM public.waybills WHERE id = ANY(wb_ids));

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
END; $$;

GRANT EXECUTE ON FUNCTION public.track_by_any_no(text) TO anon, authenticated;
