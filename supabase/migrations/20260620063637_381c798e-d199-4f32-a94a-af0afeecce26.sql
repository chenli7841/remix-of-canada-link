
CREATE OR REPLACE FUNCTION public.sync_waybill_payment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only fully-paid / fully-unpaid order states fan out to all waybills.
  -- Partial payment is handled per-item by recompute_order_payment_from_items.
  IF NEW.order_id IS NOT NULL AND NEW.payment_status IN ('paid', 'unpaid') THEN
    UPDATE public.waybills SET payment_status = NEW.payment_status WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
