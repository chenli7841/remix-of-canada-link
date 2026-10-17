-- The original table-level UNIQUE(category, source_type, source_id) constraint
-- prevents a source from producing a new notification on a later send date.
-- PostgreSQL may auto-truncate its generated name, so locate it by definition
-- instead of relying on a particular constraint name.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select constraint_row.conname
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.wecom_daily_notification_events'::regclass
      and constraint_row.contype = 'u'
      and regexp_replace(
        pg_get_constraintdef(constraint_row.oid),
        '[[:space:]\"]',
        '',
        'g'
      ) = 'UNIQUE(category,source_type,source_id)'
  loop
    execute format(
      'alter table public.wecom_daily_notification_events drop constraint %I',
      legacy_constraint.conname
    );
  end loop;
end
$$;

create unique index if not exists wecom_daily_notification_events_event_key_key
  on public.wecom_daily_notification_events (event_key);
