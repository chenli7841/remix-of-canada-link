DO $migration$
DECLARE
  fn_sql text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO fn_sql
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'place_forwarding'
     AND pg_get_function_arguments(p.oid) = '_payload jsonb, _target_user_id uuid DEFAULT NULL::uuid';

  IF fn_sql IS NULL THEN
    RAISE EXCEPTION 'place_forwarding(jsonb, uuid) function not found';
  END IF;

  fn_sql := replace(
    fn_sql,
    'ELSE v_extras->>v_field',
    'WHEN ''box_count'' THEN COALESCE(NULLIF(v_extras->>''box_count'', ''''), NULLIF(v_extras->>''inv_box_count'', ''''))
          ELSE v_extras->>v_field'
  );

  IF position('inv_box_count' IN fn_sql) = 0 THEN
    RAISE EXCEPTION 'place_forwarding validation patch could not be applied';
  END IF;

  EXECUTE fn_sql;
END
$migration$;