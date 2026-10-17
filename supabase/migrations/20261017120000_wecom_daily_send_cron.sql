-- Submit due daily WeCom drafts every five minutes. The application endpoint
-- itself enforces the America/Toronto 10:00 cutoff.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public._wecom_daily_send_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if not exists (
    select 1 from public.wecom_daily_notification_drafts
    where status = 'draft' and service_date = (now() at time zone 'America/Toronto')::date
  ) then
    return;
  end if;
  select nullif(decrypted_secret, '') into v_secret
  from vault.decrypted_secrets
  where name = 'LOVABLE_CRON_SECRET'
  limit 1;
  if v_secret is null then
    raise warning 'LOVABLE_CRON_SECRET is missing from Supabase Vault';
    return;
  end if;
  perform net.http_post(
    url := 'https://shopper.epluscanada.com/api/public/hooks/wecom-daily-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb
  );
end
$$;

revoke all on function public._wecom_daily_send_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('wecom-daily-send');
exception when others then
  null;
end
$$;

select cron.schedule(
  'wecom-daily-send',
  '*/5 * * * *',
  'select public._wecom_daily_send_tick();'
);

commit;
