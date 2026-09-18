
-- forwarding_orders
CREATE TABLE public.forwarding_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_no TEXT UNIQUE,
  warehouse TEXT NOT NULL CHECK (warehouse IN ('guangzhou','yiwu')),
  shipping_method TEXT NOT NULL CHECK (shipping_method IN ('air','sea')),
  domestic_tracking_nos TEXT[] NOT NULL DEFAULT '{}',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tracking_no TEXT,
  fee_cny NUMERIC(10,2),
  weight_kg NUMERIC(10,2),
  address_id UUID REFERENCES public.addresses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.forwarding_orders TO authenticated;
GRANT ALL ON public.forwarding_orders TO service_role;
ALTER TABLE public.forwarding_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fo_select_own" ON public.forwarding_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fo_insert_own" ON public.forwarding_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fo_update_own" ON public.forwarding_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "fo_delete_own" ON public.forwarding_orders FOR DELETE TO authenticated USING (auth.uid() = user_id AND status = 'pending');

CREATE TRIGGER trg_fo_updated BEFORE UPDATE ON public.forwarding_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.gen_fo_request_no()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.request_no IS NULL OR NEW.request_no = '' THEN
    NEW.request_no := 'FW' || to_char(now(),'YYYYMMDD') || lpad((floor(random()*1000000))::text, 6, '0');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_fo_no BEFORE INSERT ON public.forwarding_orders FOR EACH ROW EXECUTE FUNCTION public.gen_fo_request_no();

-- shipments can also be linked from forwarding orders via tracking_no (already keyed on tracking_no)
-- sync trigger for forwarding_orders.tracking_no -> shipments
CREATE OR REPLACE FUNCTION public.sync_forwarding_shipment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tracking_no IS NOT NULL AND NEW.tracking_no <> '' THEN
    INSERT INTO public.shipments (tracking_no, shipping_method, status)
    VALUES (NEW.tracking_no, NEW.shipping_method, 'created')
    ON CONFLICT (tracking_no) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_fo_shipment AFTER INSERT OR UPDATE OF tracking_no ON public.forwarding_orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_forwarding_shipment();

-- wallets
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cny NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "w_select_own" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_wallet_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- wallet_transactions
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('recharge','spend','refund','adjust')),
  amount_cny NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  channel TEXT,
  ref_no TEXT,
  note TEXT,
  related_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wt_select_own" ON public.wallet_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wt_insert_own" ON public.wallet_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status = 'pending' AND type = 'recharge');

-- auto-apply completed transactions to wallet balance
CREATE OR REPLACE FUNCTION public.apply_wallet_tx()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status <> 'completed') THEN
    INSERT INTO public.wallets (user_id, balance_cny) VALUES (NEW.user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET
      balance_cny = balance_cny + CASE WHEN NEW.type IN ('recharge','refund','adjust') THEN NEW.amount_cny ELSE -NEW.amount_cny END,
      updated_at = now()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_apply_wallet_tx AFTER INSERT OR UPDATE OF status ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_wallet_tx();

-- ensure new users get a wallet via existing handle_new_user trigger extension
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, phone)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url', NEW.phone)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.wallets (user_id, balance_cny) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

-- backfill wallets for existing users
INSERT INTO public.wallets (user_id, balance_cny)
SELECT id, 0 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
