-- Preserve the installed settlement implementation (wallet locks, amounts and
-- idempotency), replacing only its direct-batch membership predicate.
DO $migration$
DECLARE
  definition text;
  old_predicate text := 'WHERE w.assigned_batch_id = v_batch_id';
  new_predicate text := $predicate$WHERE (
      (w.assigned_batch_id = v_batch_id AND w.carton_id IS NULL AND w.pallet_id IS NULL)
      OR (w.carton_id IS NULL AND EXISTS (
        SELECT 1 FROM public.pallets bp WHERE bp.id = w.pallet_id AND bp.batch_id = v_batch_id
      ))
      OR EXISTS (
        SELECT 1 FROM public.cartons bc
        WHERE bc.id = w.carton_id AND (
          bc.batch_id = v_batch_id OR EXISTS (
            SELECT 1 FROM public.pallets bp WHERE bp.id = bc.pallet_id AND bp.batch_id = v_batch_id
          )
        )
      )
    )$predicate$;
BEGIN
  definition := pg_get_functiondef('public.settle_batch_customer_txn(jsonb)'::regprocedure);
  IF position(new_predicate IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_predicate IN definition) = 0
     OR (length(definition) - length(replace(definition, old_predicate, ''))) / length(old_predicate) <> 1 THEN
    RAISE EXCEPTION 'Settlement function changed; inspect membership predicate before migration';
  END IF;
  EXECUTE replace(definition, old_predicate, new_predicate);
END;
$migration$;
