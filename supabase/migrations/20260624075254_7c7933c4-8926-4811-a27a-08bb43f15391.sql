
CREATE POLICY "system_assets_admin_all" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'system-assets' AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')))
WITH CHECK (bucket_id = 'system-assets' AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager')));

CREATE POLICY "system_assets_authenticated_read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'system-assets');
