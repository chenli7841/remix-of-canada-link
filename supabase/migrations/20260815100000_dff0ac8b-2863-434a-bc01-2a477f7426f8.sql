-- Short-lived, single-use state for "sign in with WeChat" (no prior session,
-- unlike wechat_bind_states which ties a state to an already-logged-in
-- user_id). Previously /api/public/wechat/login minted a `login:<random>`
-- string with nothing stored server-side, so the callback only checked the
-- prefix — the random suffix itself was never verified against anything,
-- giving no real protection against authorization-code-injection replay.
-- Written/read only by server code (service role) — RLS enabled, no
-- policies, unreachable via anon/authenticated. Same shape/intent as
-- wechat_bind_states.
CREATE TABLE IF NOT EXISTS public.wechat_login_states (
  state text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wechat_login_states ENABLE ROW LEVEL SECURITY;
