
REVOKE EXECUTE ON FUNCTION public.apply_wallet_tx() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_forwarding_shipment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_order_shipment() FROM PUBLIC, anon, authenticated;
