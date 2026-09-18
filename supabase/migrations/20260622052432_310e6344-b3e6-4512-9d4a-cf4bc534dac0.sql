-- A) Helper rank (kept for compatibility)
CREATE OR REPLACE FUNCTION public.waybill_status_rank(_s waybill_status)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'cancelled'    THEN 0
    WHEN 'procurement'  THEN 1
    WHEN 'pending'      THEN 2
    WHEN 'received'     THEN 3
    WHEN 'storage'      THEN 3
    WHEN 'packed'       THEN 4
    WHEN 'shipped'      THEN 5
    WHEN 'arrived'      THEN 6
    WHEN 'in_transit'   THEN 7
    WHEN 'ready_pickup' THEN 8
    WHEN 'delivered'    THEN 9
  END
$$;

-- B) Recompute parent order/forwarding status from the FIRST waybill (by created_at)
CREATE OR REPLACE FUNCTION public.recompute_parent_from_waybills()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  oid uuid; fid uuid;
  first_wb record;
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
      SELECT id, status INTO first_wb
        FROM public.waybills
        WHERE order_id = oid AND status <> 'cancelled'
        ORDER BY created_at ASC, id ASC
        LIMIT 1;
      IF first_wb IS NOT NULL THEN
        UPDATE public.orders SET status =
          CASE first_wb.status
            WHEN 'procurement'  THEN 'procurement'::order_status
            WHEN 'pending'      THEN 'pending'::order_status
            WHEN 'received'     THEN 'received'::order_status
            WHEN 'storage'      THEN 'storage'::order_status
            WHEN 'packed'       THEN 'packed'::order_status
            WHEN 'shipped'      THEN 'shipped'::order_status
            WHEN 'arrived'      THEN 'arrived'::order_status
            WHEN 'in_transit'   THEN 'in_transit'::order_status
            WHEN 'ready_pickup' THEN 'ready_pickup'::order_status
            WHEN 'delivered'    THEN 'delivered'::order_status
          END
        WHERE id = oid;
      END IF;
    END IF;
  END IF;

  IF fid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE forwarding_id = fid;
    IF all_cancelled THEN
      UPDATE public.forwarding_orders SET status = 'cancelled' WHERE id = fid;
    ELSE
      SELECT id, status INTO first_wb
        FROM public.waybills
        WHERE forwarding_id = fid AND status <> 'cancelled'
        ORDER BY created_at ASC, id ASC
        LIMIT 1;
      IF first_wb IS NOT NULL THEN
        UPDATE public.forwarding_orders SET status = first_wb.status::text
          WHERE id = fid;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recompute_parent_from_waybills ON public.waybills;
CREATE TRIGGER trg_recompute_parent_from_waybills
AFTER INSERT OR UPDATE OR DELETE ON public.waybills
FOR EACH ROW EXECUTE FUNCTION public.recompute_parent_from_waybills();

-- C) Auto-mark waybill as 'packed' when assigned to carton/pallet/batch
CREATE OR REPLACE FUNCTION public.waybill_auto_packed()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF (NEW.carton_id IS NOT NULL OR NEW.pallet_id IS NOT NULL OR NEW.assigned_batch_id IS NOT NULL)
     AND NEW.status IN ('pending','procurement','received','storage')
  THEN
    NEW.status := 'packed'::waybill_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_waybill_auto_packed ON public.waybills;
CREATE TRIGGER trg_waybill_auto_packed
BEFORE INSERT OR UPDATE OF carton_id, pallet_id, assigned_batch_id
ON public.waybills FOR EACH ROW EXECUTE FUNCTION public.waybill_auto_packed();

-- D) Staff flips procurement → pending
CREATE OR REPLACE FUNCTION public.admin_ship_shop_order(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); v_n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.waybills SET status = 'pending'::waybill_status
   WHERE order_id = _order_id AND status = 'procurement';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.orders SET status = 'pending'::order_status
   WHERE id = _order_id AND status = 'procurement';

  RETURN jsonb_build_object('ok', true, 'waybills_updated', v_n);
END $$;
REVOKE ALL ON FUNCTION public.admin_ship_shop_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ship_shop_order(uuid) TO authenticated, service_role;