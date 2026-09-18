
CREATE TABLE public.offline_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  method text NOT NULL,
  reference text,
  amount_cad numeric(12,2) NOT NULL CHECK (amount_cad > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  attachment_url text,
  note text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_payments TO authenticated;
GRANT ALL ON public.offline_payments TO service_role;
ALTER TABLE public.offline_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage offline payments" ON public.offline_payments
  FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "users read own offline payments" ON public.offline_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id AND i.user_id = auth.uid()));
CREATE INDEX ON public.offline_payments(invoice_id);

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS paid_cad numeric(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_invoice_offline_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv record; v_total_cad numeric; v_sum_cad numeric;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_inv.id IS NULL THEN RETURN NULL; END IF;
  v_total_cad := round(v_inv.total_cny * COALESCE(v_inv.fx_rate, 0.19), 2);
  SELECT COALESCE(SUM(amount_cad),0) INTO v_sum_cad FROM public.offline_payments WHERE invoice_id = v_inv.id;
  UPDATE public.invoices
    SET paid_cad = v_sum_cad,
        status = CASE WHEN v_sum_cad >= v_total_cad AND status <> 'void' THEN 'paid'::invoice_status ELSE status END,
        paid_at = CASE WHEN v_sum_cad >= v_total_cad AND paid_at IS NULL THEN now() ELSE paid_at END
  WHERE id = v_inv.id;
  IF v_sum_cad >= v_total_cad THEN
    UPDATE public.waybills SET payment_status = 'paid'
      WHERE id IN (SELECT waybill_id FROM public.invoice_items WHERE invoice_id = v_inv.id AND waybill_id IS NOT NULL);
    UPDATE public.orders SET payment_status = 'paid'
      WHERE id IN (SELECT order_id FROM public.invoice_items WHERE invoice_id = v_inv.id AND order_id IS NOT NULL);
    UPDATE public.forwarding_orders SET payment_status = 'paid'
      WHERE id IN (SELECT forwarding_id FROM public.invoice_items WHERE invoice_id = v_inv.id AND forwarding_id IS NOT NULL);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_offline_payments_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.offline_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_offline_paid();

CREATE OR REPLACE FUNCTION public.mark_invoices_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.invoices SET status = 'overdue'
   WHERE status = 'unpaid' AND due_date IS NOT NULL AND due_date < current_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

INSERT INTO public.app_settings(key, value) VALUES
  ('invoice_auto_rules', '{"enabled": false, "trigger_status": "packed", "due_days": 7, "overdue_days": 14}'::jsonb),
  ('company_info', '{"name":"SC Express","address":"","phone":"","email":"","wechat":""}'::jsonb),
  ('print_template', '{"logo_url":"","header":"","footer":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
