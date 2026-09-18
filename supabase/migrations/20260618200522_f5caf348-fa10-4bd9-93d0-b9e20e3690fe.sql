
-- Add waybill identifiers to orders & forwarding_orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS destination_code text,
  ADD COLUMN IF NOT EXISTS route_code text,
  ADD COLUMN IF NOT EXISTS company_code text,
  ADD COLUMN IF NOT EXISTS intl_tracking_no text,
  ADD COLUMN IF NOT EXISTS box_no text,
  ADD COLUMN IF NOT EXISTS pallet_no text;

ALTER TABLE public.forwarding_orders
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS destination_code text,
  ADD COLUMN IF NOT EXISTS route_code text,
  ADD COLUMN IF NOT EXISTS company_code text,
  ADD COLUMN IF NOT EXISTS intl_tracking_no text,
  ADD COLUMN IF NOT EXISTS box_no text,
  ADD COLUMN IF NOT EXISTS pallet_no text,
  ADD COLUMN IF NOT EXISTS insurance_cny numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customs_cny numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS box_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS items_desc text,
  ADD COLUMN IF NOT EXISTS eta_label text;

-- Order attachments table (files / photos uploaded by user; viewable only by owner via signed URL)
CREATE TABLE IF NOT EXISTS public.order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_kind text NOT NULL CHECK (owner_kind IN ('order','forwarding')),
  owner_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  content_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_attachments TO authenticated;
GRANT ALL ON public.order_attachments TO service_role;

ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "att_select_own" ON public.order_attachments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "att_insert_own" ON public.order_attachments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "att_delete_own" ON public.order_attachments FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_att_owner ON public.order_attachments(owner_kind, owner_id);

-- Storage RLS policies for order-attachments bucket (path = {user_id}/{owner_id}/filename)
CREATE POLICY "att_storage_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'order-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "att_storage_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'order-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "att_storage_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'order-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Unpaid by batch summary RPC for the dashboard wallet card
CREATE OR REPLACE FUNCTION public.unpaid_batches_summary()
RETURNS TABLE(batch_no text, total_cny numeric, shipping_method text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH all_rows AS (
    SELECT batch_no, total_cny, shipping_method FROM public.orders
      WHERE user_id = auth.uid() AND payment_status = 'unpaid' AND batch_no IS NOT NULL
    UNION ALL
    SELECT batch_no, COALESCE(fee_cny,0) AS total_cny, shipping_method FROM public.forwarding_orders
      WHERE user_id = auth.uid() AND payment_status = 'unpaid' AND batch_no IS NOT NULL
  )
  SELECT batch_no, SUM(total_cny)::numeric AS total_cny, MAX(shipping_method) AS shipping_method
  FROM all_rows GROUP BY batch_no ORDER BY batch_no;
$$;
