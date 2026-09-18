CREATE TABLE public.user_import_staging (
  code text,
  phone text,
  email text,
  uname text
);
GRANT ALL ON public.user_import_staging TO service_role;
GRANT SELECT, INSERT ON public.user_import_staging TO authenticated;
ALTER TABLE public.user_import_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging_staff_all" ON public.user_import_staging FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));