create table if not exists public.wechat_gpt_session (
  open_kfid text not null,
  external_userid text not null,
  welcome_sent boolean not null default false,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  primary key (open_kfid, external_userid)
);

grant all on public.wechat_gpt_session to service_role;
alter table public.wechat_gpt_session enable row level security;

create or replace function public.wechat_gpt_claim_welcome(_open_kfid text, _external_userid text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _first boolean;
begin
  insert into public.wechat_gpt_session (open_kfid, external_userid, welcome_sent, last_seen_at, expires_at)
  values (_open_kfid, _external_userid, true, now(), now() + interval '7 days')
  on conflict (open_kfid, external_userid) do update
    set last_seen_at = now(),
        expires_at = now() + interval '7 days'
  returning (xmax = 0) into _first;

  if _first then
    return true;
  end if;

  update public.wechat_gpt_session
     set welcome_sent = true
   where open_kfid = _open_kfid
     and external_userid = _external_userid
     and welcome_sent = false;

  return found;
end;
$$;

revoke all on function public.wechat_gpt_claim_welcome(text, text) from public;
grant execute on function public.wechat_gpt_claim_welcome(text, text) to service_role;

create or replace function public.wechat_gpt_cleanup()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.wechat_gpt_session where expires_at < now();
  delete from public.wechat_kf_msg_dedup where created_at < now() - interval '3 days';
$$;

revoke all on function public.wechat_gpt_cleanup() from public;
grant execute on function public.wechat_gpt_cleanup() to service_role;