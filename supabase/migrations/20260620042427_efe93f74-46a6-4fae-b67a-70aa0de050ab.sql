GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
GRANT SELECT ON public.product_categories TO anon, authenticated;
GRANT ALL ON public.product_categories TO service_role;
GRANT SELECT ON public.product_variants TO anon, authenticated;
GRANT ALL ON public.product_variants TO service_role;

-- public read for variants of active products
DROP POLICY IF EXISTS "variants_public_read" ON public.product_variants;
CREATE POLICY "variants_public_read" ON public.product_variants FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_variants.product_id AND (p.status = 'active' OR public.is_staff(auth.uid()))));