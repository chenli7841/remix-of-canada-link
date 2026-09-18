-- 1) Lock down internal-only SECURITY DEFINER maintenance/callback functions
REVOKE EXECUTE ON FUNCTION public.wechat_expire_stale_drafts() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wechat_gpt_cleanup() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wechat_gpt_claim_welcome(text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.wechat_expire_stale_drafts() TO service_role;
GRANT EXECUTE ON FUNCTION public.wechat_gpt_cleanup() TO service_role;
GRANT EXECUTE ON FUNCTION public.wechat_gpt_claim_welcome(text, text) TO service_role;

-- 2) Warehouses: customers no longer read internal contact/note columns
DROP POLICY IF EXISTS "warehouses_auth_read_active" ON public.warehouses;

CREATE OR REPLACE VIEW public.warehouses_public AS
  SELECT id, code, name_zh, name_en, country, type, address, phone,
         business_hours, is_active, sort_order, can_origin, can_destination, can_inventory,
         storage_fee_cad_per_cbm_day, inout_fee_cad_per_cbm, storage_free_days
  FROM public.warehouses
  WHERE is_active = true;

GRANT SELECT ON public.warehouses_public TO authenticated, anon, service_role;