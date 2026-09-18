CREATE POLICY "payment_proofs_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "payment_proofs_select_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'payment-proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_staff(auth.uid())));