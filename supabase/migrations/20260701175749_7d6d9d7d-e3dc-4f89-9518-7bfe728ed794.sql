
GRANT SELECT ON public.tracking_events TO authenticated;
GRANT ALL ON public.tracking_events TO service_role;

DROP POLICY IF EXISTS tracking_events_select_own ON public.tracking_events;
CREATE POLICY tracking_events_select_own ON public.tracking_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shipments s
      LEFT JOIN public.orders o ON o.id = s.order_id
      LEFT JOIN public.waybills w ON w.waybill_no = s.tracking_no
      LEFT JOIN public.forwarding_orders fo ON fo.id = w.forwarding_id
      WHERE s.id = tracking_events.shipment_id
        AND (o.user_id = auth.uid() OR w.user_id = auth.uid() OR fo.user_id = auth.uid())
    )
  );
