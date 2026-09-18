-- 1) Fix mutable search_path on project functions
ALTER FUNCTION public._product_route_code(products, text, text) SET search_path = public;
ALTER FUNCTION public.normalize_no(text) SET search_path = public;
ALTER FUNCTION public.normalize_phone(text) SET search_path = public;
ALTER FUNCTION public.waybill_status_rank(waybill_status) SET search_path = public;

-- 2) Trigger + internal-only SECURITY DEFINER functions: not callable from the API at all
REVOKE EXECUTE ON FUNCTION public.apply_inventory_movement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_blacklisted_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_email_updated() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.order_shop_apply_stock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_fo_declared_value() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_order_payment_from_items() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_mark_nos_for_parent(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_waybill_items_summary(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_container_status_from_batch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_invoice_offline_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_my_item_to_hs_lib() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_forwarding_items_sync_waybill() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_order_items_sync_waybill() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recompute_mark_nos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_waybill_created_tracking() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_invoices_overdue() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_change_route(text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_by_any_no(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_hs_code_rates(text, text, text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_points_for_spend(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pay_batch(text) FROM PUBLIC, anon, authenticated;

-- 3) Signed-in-only functions: drop anonymous execute
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lookup_shipment(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.place_shop_order(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_order_items(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.place_forwarding(jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_invoice(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_storage_fees(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.preview_storage_fees(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unpaid_batches_summary() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_fx_cny_to_cad() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_ship_shop_order(uuid) FROM PUBLIC, anon;

-- keep signed-in access where the app needs it
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_shipment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_shop_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_items(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_forwarding(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_storage_fees(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_storage_fees(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpaid_batches_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_fx_cny_to_cad() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ship_shop_order(uuid) TO authenticated;

-- 4) Explicit access rules for tables that had none
-- admin_nav_items: staff read-only, owners manage
REVOKE ALL ON public.admin_nav_items FROM anon;
GRANT SELECT ON public.admin_nav_items TO authenticated;
GRANT ALL ON public.admin_nav_items TO service_role;
CREATE POLICY "Staff can view nav config" ON public.admin_nav_items
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Owners manage nav config" ON public.admin_nav_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));

-- ai_forwarding_requests: owner-scoped read only
REVOKE ALL ON public.ai_forwarding_requests FROM anon, authenticated;
GRANT SELECT ON public.ai_forwarding_requests TO authenticated;
GRANT ALL ON public.ai_forwarding_requests TO service_role;
CREATE POLICY "Users view own AI forwarding requests" ON public.ai_forwarding_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- wechat_ai_bind_codes: never readable through the API
REVOKE ALL ON public.wechat_ai_bind_codes FROM anon, authenticated;
GRANT ALL ON public.wechat_ai_bind_codes TO service_role;

-- wechat_bind_states: never readable through the API
REVOKE ALL ON public.wechat_bind_states FROM anon, authenticated;
GRANT ALL ON public.wechat_bind_states TO service_role;

-- wechat_identity_bindings: owner-scoped read only
REVOKE ALL ON public.wechat_identity_bindings FROM anon, authenticated;
GRANT SELECT ON public.wechat_identity_bindings TO authenticated;
GRANT ALL ON public.wechat_identity_bindings TO service_role;
CREATE POLICY "Users view own WeChat bindings" ON public.wechat_identity_bindings
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_staff(auth.uid()));