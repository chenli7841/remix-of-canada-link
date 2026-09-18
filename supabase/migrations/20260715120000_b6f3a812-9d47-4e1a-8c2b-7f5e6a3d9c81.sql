-- Batch settlement: support offline payment methods (EMT / cash) that generate
-- an invoice + a wallet_transactions audit row without touching wallet balance.

-- 1) invoices: record which method actually settled the invoice.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'wallet';

-- 2) apply_wallet_tx: skip the balance update for offline settlement channels.
-- Everything else (row still inserted, status still 'completed') is unchanged,
-- so these rows show up normally in the customer's transaction history.
CREATE OR REPLACE FUNCTION public.apply_wallet_tx()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed')
     AND COALESCE(NEW.channel, '') NOT IN ('emt', 'cash') THEN
    INSERT INTO public.wallets (user_id, balance_cny, balance_cad) VALUES (NEW.user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET
      balance_cad = balance_cad + CASE WHEN NEW.type IN ('recharge','refund','adjust') THEN NEW.amount_cad ELSE -NEW.amount_cad END,
      updated_at = now()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;
