-- Batch customs documents, parsed HBL metadata, and staff-only private storage.
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS hbl_file_path text,
  ADD COLUMN IF NOT EXISTS hbl_file_name text,
  ADD COLUMN IF NOT EXISTS hbl_extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS customs_shipper jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS customs_consignee jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actual_ship_date date,
  ADD COLUMN IF NOT EXISTS container_no text,
  ADD COLUMN IF NOT EXISTS hbl_total_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS hbl_total_volume_m3 numeric,
  ADD COLUMN IF NOT EXISTS hbl_goods_description text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('batch-documents', 'batch-documents', false, 26214400, ARRAY['application/pdf','image/png','image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "batch_documents_staff_select" ON storage.objects;
CREATE POLICY "batch_documents_staff_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'batch-documents' AND public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "batch_documents_manager_insert" ON storage.objects;
CREATE POLICY "batch_documents_manager_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'batch-documents'
  AND (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'))
);

DROP POLICY IF EXISTS "batch_documents_manager_update" ON storage.objects;
CREATE POLICY "batch_documents_manager_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'batch-documents'
  AND (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'))
);

DROP POLICY IF EXISTS "batch_documents_manager_delete" ON storage.objects;
CREATE POLICY "batch_documents_manager_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'batch-documents'
  AND (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'))
);
