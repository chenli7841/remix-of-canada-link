-- ===== Invoices =====
CREATE TYPE invoice_status AS ENUM ('unpaid','paid','overdue','void');
CREATE TYPE invoice_type AS ENUM ('waybill','batch','monthly','manual');

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type invoice_type NOT NULL DEFAULT 'waybill',
  status invoice_status NOT NULL DEFAULT 'unpaid',
  subtotal_cny numeric(12,2) NOT NULL DEFAULT 0,
  freight_cny numeric(12,2) NOT NULL DEFAULT 0,
  customs_cny numeric(12,2) NOT NULL DEFAULT 0,
  insurance_cny numeric(12,2) NOT NULL DEFAULT 0,
  other_cny numeric(12,2) NOT NULL DEFAULT 0,
  total_cny numeric(12,2) NOT NULL DEFAULT 0,
  paid_cny numeric(12,2) NOT NULL DEFAULT 0,
  fx_rate numeric(10,4) NOT NULL DEFAULT 0.19,
  currency text NOT NULL DEFAULT 'CNY',
  due_date date,
  paid_at timestamptz,
  batch_no text,
  period_start date,
  period_end date,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_user ON public.invoices(user_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_select_own_or_staff" ON public.invoices FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "invoices_manage_staff" ON public.invoices FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  waybill_id uuid REFERENCES public.waybills(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  forwarding_id uuid REFERENCES public.forwarding_orders(id) ON DELETE SET NULL,
  description text NOT NULL,
  freight_cny numeric(12,2) NOT NULL DEFAULT 0,
  customs_cny numeric(12,2) NOT NULL DEFAULT 0,
  insurance_cny numeric(12,2) NOT NULL DEFAULT 0,
  other_cny numeric(12,2) NOT NULL DEFAULT 0,
  amount_cny numeric(12,2) NOT NULL DEFAULT 0,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_items_invoice ON public.invoice_items(invoice_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_via_parent" ON public.invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND (i.user_id = auth.uid() OR public.is_staff(auth.uid()))));
CREATE POLICY "invoice_items_manage_staff" ON public.invoice_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Auto-number trigger
CREATE OR REPLACE FUNCTION public.gen_invoice_no_fn() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE seq int; ds text;
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN RETURN NEW; END IF;
  ds := to_char(now(),'YYYYMMDD');
  SELECT COUNT(*)+1 INTO seq FROM public.invoices WHERE to_char(created_at,'YYYYMMDD')=ds;
  NEW.invoice_no := 'INV' || ds || lpad(seq::text, 4, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoices_gen_no BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.gen_invoice_no_fn();

-- Pay invoice via wallet
CREATE OR REPLACE FUNCTION public.pay_invoice(_invoice_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  inv record; bal numeric; need_cad numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF inv.user_id <> auth.uid() AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF inv.status = 'paid' THEN RETURN jsonb_build_object('ok', false, 'reason','already_paid'); END IF;

  need_cad := round(inv.total_cny * COALESCE(inv.fx_rate, 0.19), 2);
  SELECT COALESCE(balance_cad,0) INTO bal FROM public.wallets WHERE user_id = inv.user_id;
  IF COALESCE(bal,0) < need_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason','insufficient','need_cad', need_cad, 'balance_cad', COALESCE(bal,0));
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note)
  VALUES (inv.user_id, 'spend', inv.total_cny, need_cad, COALESCE(inv.fx_rate,0.19), 'completed', 'wallet', 'Invoice payment: ' || inv.invoice_no);

  UPDATE public.invoices SET status='paid', paid_cny = total_cny, paid_at = now() WHERE id = _invoice_id;

  -- Sync downstream waybills/orders payment_status
  UPDATE public.waybills SET payment_status = 'paid'
    WHERE id IN (SELECT waybill_id FROM public.invoice_items WHERE invoice_id = _invoice_id AND waybill_id IS NOT NULL);
  UPDATE public.orders SET payment_status = 'paid'
    WHERE id IN (SELECT order_id FROM public.invoice_items WHERE invoice_id = _invoice_id AND order_id IS NOT NULL);
  UPDATE public.forwarding_orders SET payment_status = 'paid'
    WHERE id IN (SELECT forwarding_id FROM public.invoice_items WHERE invoice_id = _invoice_id AND forwarding_id IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'paid_cad', need_cad, 'paid_cny', inv.total_cny);
END $$;