
-- 1) Add CAD-native fields to wallets and wallet_transactions
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS balance_cad numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS amount_cad numeric(12,2),
  ADD COLUMN IF NOT EXISTS fx_rate_cny_to_cad numeric(10,6);

-- 2) Backfill existing CAD figures from historical CNY values using current default rate (0.192)
UPDATE public.wallets SET balance_cad = ROUND(balance_cny * 0.192, 2) WHERE balance_cad = 0 AND balance_cny > 0;
UPDATE public.wallet_transactions
  SET amount_cad = ROUND(amount_cny * 0.192, 2), fx_rate_cny_to_cad = 0.192
  WHERE amount_cad IS NULL;

ALTER TABLE public.wallet_transactions
  ALTER COLUMN amount_cny DROP NOT NULL,
  ALTER COLUMN amount_cad SET NOT NULL;

-- 3) Replace trigger fn to settle in CAD
CREATE OR REPLACE FUNCTION public.apply_wallet_tx()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
    INSERT INTO public.wallets (user_id, balance_cny, balance_cad) VALUES (NEW.user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET
      balance_cad = balance_cad + CASE WHEN NEW.type IN ('recharge','refund','adjust') THEN NEW.amount_cad ELSE -NEW.amount_cad END,
      updated_at = now()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;

-- 4) Settings table for FX rate (admin-managed; readable by all authenticated)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings readable by everyone" ON public.app_settings;
CREATE POLICY "app_settings readable by everyone"
  ON public.app_settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Seed FX rate default (CNY -> CAD); mode: 'manual' or 'live'
INSERT INTO public.app_settings (key, value) VALUES
  ('fx_cny_to_cad', '{"rate": 0.192, "mode": "manual", "updated_at": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
