
CREATE TABLE public.customer_hs_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku text,
  description text NOT NULL,
  unit_price_cad numeric,
  items_per_carton numeric,
  ctns numeric,
  hs_code text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_hs_items_user ON public.customer_hs_items(user_id);
CREATE INDEX idx_customer_hs_items_hs ON public.customer_hs_items(hs_code);
CREATE INDEX idx_customer_hs_items_sku ON public.customer_hs_items(user_id, sku);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_hs_items TO authenticated;
GRANT ALL ON public.customer_hs_items TO service_role;

ALTER TABLE public.customer_hs_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_hs_items read" ON public.customer_hs_items
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "customer_hs_items write" ON public.customer_hs_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE TRIGGER trg_customer_hs_items_updated_at
  BEFORE UPDATE ON public.customer_hs_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
