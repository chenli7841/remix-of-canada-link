REVOKE EXECUTE ON FUNCTION public.wechat_callback_claim(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wechat_callback_claim(TEXT) TO service_role;