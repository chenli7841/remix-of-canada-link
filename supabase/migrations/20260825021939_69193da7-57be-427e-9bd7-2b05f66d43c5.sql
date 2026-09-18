create extension if not exists http with schema extensions;

create schema if not exists ai_proxy;
revoke all on schema ai_proxy from public, anon, authenticated;

create table if not exists ai_proxy.config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on ai_proxy.config from public, anon, authenticated, service_role;
alter table ai_proxy.config enable row level security;

create table if not exists ai_proxy.rate_window (
  window_start timestamptz primary key,
  hits integer not null default 0
);
revoke all on ai_proxy.rate_window from public, anon, authenticated, service_role;
alter table ai_proxy.rate_window enable row level security;

create or replace function public.openai_responses_proxy(_token text, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ai_proxy, extensions, pg_temp
as $$
declare
  v_token text;
  v_key text;
  v_model text;
  v_max int;
  v_body jsonb;
  v_res extensions.http_response;
  v_started timestamptz := clock_timestamp();
  v_hits int;
  v_win timestamptz := date_trunc('minute', now());
begin
  select value into v_token from ai_proxy.config where key = 'OPENAI_PROXY_TOKEN';
  if v_token is null then
    return jsonb_build_object('status', 500, 'body', jsonb_build_object('error', jsonb_build_object('code','proxy_not_configured')));
  end if;
  if _token is null or length(_token) <> length(v_token) or _token <> v_token then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', jsonb_build_object('code','unauthorized')));
  end if;

  insert into ai_proxy.rate_window(window_start, hits) values (v_win, 1)
    on conflict (window_start) do update set hits = ai_proxy.rate_window.hits + 1
    returning hits into v_hits;
  delete from ai_proxy.rate_window where window_start < v_win - interval '10 minutes';
  if v_hits > 120 then
    return jsonb_build_object('status', 429, 'body', jsonb_build_object('error', jsonb_build_object('code','rate_limited')));
  end if;

  if _payload is null or jsonb_typeof(_payload) <> 'object' then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', jsonb_build_object('code','invalid_json')));
  end if;
  if octet_length(_payload::text) > 102400 then
    return jsonb_build_object('status', 413, 'body', jsonb_build_object('error', jsonb_build_object('code','payload_too_large')));
  end if;

  v_model := _payload->>'model';
  if v_model is distinct from 'gpt-5.6-luna' then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', jsonb_build_object('code','model_not_allowed')));
  end if;

  select value into v_key from ai_proxy.config where key = 'OPENAI_API_KEY';
  if v_key is null then
    return jsonb_build_object('status', 500, 'body', jsonb_build_object('error', jsonb_build_object('code','openai_not_configured')));
  end if;

  v_max := coalesce(nullif(_payload->>'max_output_tokens','')::int, 300);
  if v_max > 300 then v_max := 300; end if;
  if v_max < 1 then v_max := 300; end if;

  v_body := jsonb_build_object(
    'model', 'gpt-5.6-luna',
    'store', false,
    'reasoning', jsonb_build_object('effort','none'),
    'text', jsonb_build_object('verbosity','low'),
    'max_output_tokens', v_max
  );
  if _payload ? 'input' then v_body := v_body || jsonb_build_object('input', _payload->'input'); end if;
  if _payload ? 'instructions' then v_body := v_body || jsonb_build_object('instructions', _payload->'instructions'); end if;
  if _payload ? 'tools' then v_body := v_body || jsonb_build_object('tools', _payload->'tools'); end if;
  if _payload ? 'tool_choice' then v_body := v_body || jsonb_build_object('tool_choice', _payload->'tool_choice'); end if;
  if _payload ? 'parallel_tool_calls' then v_body := v_body || jsonb_build_object('parallel_tool_calls', _payload->'parallel_tool_calls'); end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '12000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '5000');

  begin
    select * into v_res from extensions.http((
      'POST',
      'https://api.openai.com/v1/responses',
      array[extensions.http_header('Authorization', 'Bearer ' || v_key)],
      'application/json',
      v_body::text
    )::extensions.http_request);
  exception when others then
    return jsonb_build_object(
      'status', 504,
      'ms', (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
      'body', jsonb_build_object('error', jsonb_build_object('code','network_error'))
    );
  end;

  return jsonb_build_object(
    'status', v_res.status,
    'ms', (extract(epoch from clock_timestamp() - v_started) * 1000)::int,
    'body', case when v_res.content is null or v_res.content = '' then null else v_res.content::jsonb end
  );
end;
$$;

revoke all on function public.openai_responses_proxy(text, jsonb) from public, anon, authenticated;
grant execute on function public.openai_responses_proxy(text, jsonb) to service_role;