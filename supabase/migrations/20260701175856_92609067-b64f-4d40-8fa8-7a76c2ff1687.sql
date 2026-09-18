
CREATE OR REPLACE FUNCTION public.trg_waybill_created_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship_id uuid;
  v_wh text;
BEGIN
  SELECT id INTO v_ship_id FROM public.shipments WHERE tracking_no = NEW.waybill_no;
  IF v_ship_id IS NULL THEN
    INSERT INTO public.shipments (tracking_no, status) VALUES (NEW.waybill_no, 'created') RETURNING id INTO v_ship_id;
  END IF;
  SELECT warehouse INTO v_wh FROM public.forwarding_orders WHERE id = NEW.forwarding_id;
  INSERT INTO public.tracking_events (shipment_id, status_zh, status_en, location_zh, location_en, event_time, source)
    VALUES (v_ship_id, '订单已生成', 'Order created', COALESCE(v_wh, '—'), COALESCE(v_wh, '—'), NEW.created_at, 'admin_manual');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waybill_created_tracking ON public.waybills;
CREATE TRIGGER waybill_created_tracking
  AFTER INSERT ON public.waybills
  FOR EACH ROW EXECUTE FUNCTION public.trg_waybill_created_tracking();
