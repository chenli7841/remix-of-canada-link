-- Supabase rejects ALTER DATABASE ... SET app.ott_reconcile_* on this project.
-- Store the shared secret as OTT_RECONCILE_SECRET in Vault and in the app.
-- New jobs stay paused until the user saves the secret and publishes the app.
BEGIN;
CREATE OR REPLACE FUNCTION public._ott_reconcile_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url text := 'https://shopper.epluscanada.com/api/public/hooks/reconcile-ott';
  v_secret text;
BEGIN
  SELECT NULLIF(decrypted_secret, '') INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'OTT_RECONCILE_SECRET';
  IF v_secret IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE type = 'recharge' AND status = 'pending'
      AND channel IN ('wechat', 'alipay', 'card')
      AND created_at > now() - interval '24 hours'
      AND created_at < now() - interval '45 seconds'
  ) THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reconcile-secret', v_secret),
    body := '{}'::jsonb
  );
END $$;
REVOKE ALL ON FUNCTION public._ott_reconcile_tick() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE j bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ott-reconcile') THEN
    SELECT cron.schedule('ott-reconcile', '*/2 * * * *', 'SELECT public._ott_reconcile_tick();') INTO j;
    PERFORM cron.alter_job(j, active := false);
  END IF;
END $$;
COMMIT;
