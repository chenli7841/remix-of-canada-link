REVOKE EXECUTE ON FUNCTION public.check_email_available(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_phone_available(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_username_available(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.quote_shop_order(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.track_by_any_no(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_email_available(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_phone_available(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quote_shop_order(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.track_by_any_no(text) TO anon, authenticated, service_role;