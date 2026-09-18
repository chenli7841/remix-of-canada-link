
CREATE POLICY att_select_staff ON public.order_attachments
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY att_storage_select_staff ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'order-attachments' AND public.is_staff(auth.uid()));
