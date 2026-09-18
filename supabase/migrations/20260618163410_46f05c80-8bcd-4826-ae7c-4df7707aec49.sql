
REVOKE EXECUTE ON FUNCTION public.apply_wallet_tx() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_forwarding_shipment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_order_shipment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gen_order_no() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gen_fo_request_no() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
