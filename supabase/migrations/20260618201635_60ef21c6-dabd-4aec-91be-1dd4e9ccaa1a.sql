
ALTER FUNCTION public.gen_waybill_no(text,text,text,text) SECURITY INVOKER;
ALTER FUNCTION public.gen_fo_tracking_no() SECURITY INVOKER;
ALTER FUNCTION public.gen_order_tracking_no() SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.gen_fo_tracking_no() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gen_order_tracking_no() FROM PUBLIC, anon, authenticated;
