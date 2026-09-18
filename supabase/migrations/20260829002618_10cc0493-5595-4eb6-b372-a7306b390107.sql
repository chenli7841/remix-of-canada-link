GRANT SELECT ON public.shipping_routes TO anon;
CREATE POLICY "routes_anon_read_shop" ON public.shipping_routes FOR SELECT TO anon
USING (is_active = true AND usage_scope IN ('shop','both'));