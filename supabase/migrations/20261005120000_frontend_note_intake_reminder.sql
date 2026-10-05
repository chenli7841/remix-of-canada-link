begin;

-- Persist the frontend's reminder request in the same transaction as creation.
-- Do not enable reminders for generated insurance/API notes or existing orders.
do $patch$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.place_forwarding(jsonb,uuid)'::regprocedure);
  if position('frontend_note_intake_reminder' in definition) > 0 then return; end if;
  updated := replace(definition,
    'status, payment_status, note, items_desc, insured',
    'status, payment_status, note, items_desc, insured, intake_reminder');
  if updated = definition then raise exception 'place_forwarding insert columns changed; review required'; end if;
  definition := updated;
  updated := regexp_replace(definition,
    'v_insured([[:space:]]*\)[[:space:]]*RETURNING id, request_no)',
    E'v_insured, /* frontend_note_intake_reminder */\n    coalesce(_payload->''intake_reminder'' = ''true''::jsonb, false) AND nullif(btrim(v_note), '''') IS NOT NULL\\1');
  if updated = definition then raise exception 'place_forwarding insert values changed; review required'; end if;
  execute updated;
end $patch$;

commit;
