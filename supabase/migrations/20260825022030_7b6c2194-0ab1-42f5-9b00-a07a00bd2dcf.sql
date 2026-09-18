create or replace function public.ai_proxy_set_secret(_key text, _value text)
returns boolean
language plpgsql
security definer
set search_path = ai_proxy, pg_temp
as $$
begin
  if _key not in ('OPENAI_API_KEY', 'OPENAI_PROXY_TOKEN') then
    raise exception 'unsupported key';
  end if;
  if _value is null or length(_value) < 16 then
    raise exception 'value too short';
  end if;
  insert into ai_proxy.config(key, value) values (_key, _value)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end;
$$;

revoke all on function public.ai_proxy_set_secret(text, text) from public, anon, authenticated;
grant execute on function public.ai_proxy_set_secret(text, text) to service_role;