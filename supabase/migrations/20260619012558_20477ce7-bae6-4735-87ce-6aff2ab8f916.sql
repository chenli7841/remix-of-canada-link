CREATE OR REPLACE FUNCTION public.waybill_status_rank(_s waybill_status)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE _s
    WHEN 'pending'      THEN 1
    WHEN 'received'     THEN 2
    WHEN 'packed'       THEN 3
    WHEN 'shipped'      THEN 4
    WHEN 'in_transit'   THEN 5
    WHEN 'ready_pickup' THEN 6
    WHEN 'delivered'    THEN 7
    WHEN 'cancelled'    THEN 0
  END
$function$;