DROP VIEW IF EXISTS public.warehouses_public;

-- Restore active-warehouse read for signed-in customers, but at column level:
-- internal fields (contact, note) are no longer readable by ordinary clients.
CREATE POLICY "warehouses_auth_read_active" ON public.warehouses
  FOR SELECT TO authenticated USING (is_active = true);

REVOKE SELECT ON public.warehouses FROM authenticated, anon;
GRANT SELECT (
  id, code, name_zh, name_en, country, type, address, phone,
  business_hours, is_active, sort_order, can_origin, can_destination, can_inventory,
  storage_fee_cad_per_cbm_day, inout_fee_cad_per_cbm, storage_free_days,
  created_at, updated_at
) ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;