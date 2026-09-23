-- Authorized one-time correction on Sino_Cargo_2; not an automatic migration.
-- Only currently uninsured forwarding orders' unpaid waybills are included.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $cleanup$
DECLARE
  r record;
  changed integer;
BEGIN
  FOR r IN
    SELECT w.id, to_jsonb(w) AS original
    FROM public.waybills w
    JOIN public.forwarding_orders f ON f.id = w.forwarding_id
    WHERE f.insured IS NOT TRUE
      AND w.payment_status = 'unpaid'
      AND w.insurance_cad <> 0
    ORDER BY w.id
    FOR UPDATE OF w, f
  LOOP
    INSERT INTO public.admin_action_logs
      (action, entity_type, entity_id, "before", "after", note)
    VALUES
      ('uninsured_unpaid_insurance_cleanup_20260923', 'waybill', r.id,
       r.original, jsonb_build_object('insurance_cad', 0),
       'User-authorized correction: uninsured forwarding order and unpaid waybill. Only insurance_cad cleared; original waybill retained in before.');
    UPDATE public.waybills SET insurance_cad = 0
    WHERE id = r.id AND payment_status = 'unpaid';
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
      RAISE EXCEPTION 'Expected one updated waybill, got %', changed;
    END IF;
  END LOOP;
END $cleanup$;
COMMIT;

SELECT count(*) AS corrected_waybills,
       sum(("before"->>'insurance_cad')::numeric) AS removed_insurance_cad
FROM public.admin_action_logs
WHERE action = 'uninsured_unpaid_insurance_cleanup_20260923';
