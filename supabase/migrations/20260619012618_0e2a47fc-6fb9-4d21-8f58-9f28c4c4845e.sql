CREATE OR REPLACE FUNCTION public.recompute_parent_from_waybills()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  oid uuid; fid uuid;
  latest public.waybill_status;
  all_cancelled boolean;
BEGIN
  oid := COALESCE(NEW.order_id, OLD.order_id);
  fid := COALESCE(NEW.forwarding_id, OLD.forwarding_id);

  IF oid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE order_id = oid;
    IF all_cancelled THEN
      UPDATE public.orders SET status = 'cancelled' WHERE id = oid;
    ELSE
      SELECT status INTO latest FROM public.waybills
        WHERE order_id = oid AND status <> 'cancelled'
        ORDER BY public.waybill_status_rank(status) DESC NULLS LAST, updated_at DESC
        LIMIT 1;
      IF latest IS NOT NULL THEN
        UPDATE public.orders SET status =
          CASE latest
            WHEN 'pending'      THEN 'paid'::order_status
            WHEN 'received'     THEN 'processing'::order_status
            WHEN 'packed'       THEN 'processing'::order_status
            WHEN 'shipped'      THEN 'shipped'::order_status
            WHEN 'in_transit'   THEN 'shipped'::order_status
            WHEN 'ready_pickup' THEN 'shipped'::order_status
            WHEN 'delivered'    THEN 'delivered'::order_status
          END
        WHERE id = oid AND status <> 'pending';
      END IF;
    END IF;
  END IF;

  IF fid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE forwarding_id = fid;
    IF all_cancelled THEN
      UPDATE public.forwarding_orders SET status = 'cancelled' WHERE id = fid;
    ELSE
      SELECT status INTO latest FROM public.waybills
        WHERE forwarding_id = fid AND status <> 'cancelled'
        ORDER BY public.waybill_status_rank(status) DESC NULLS LAST, updated_at DESC
        LIMIT 1;
      IF latest IS NOT NULL THEN
        UPDATE public.forwarding_orders SET status = latest::text
          WHERE id = fid;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END $function$;