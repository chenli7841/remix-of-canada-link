CREATE OR REPLACE FUNCTION public.place_forwarding(_payload jsonb, _target_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  fn_src text;
BEGIN
  RETURN NULL;
END;
$function$;