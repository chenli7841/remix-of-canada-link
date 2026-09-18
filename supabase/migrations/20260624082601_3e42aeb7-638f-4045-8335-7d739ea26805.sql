
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_blacklisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blacklist_reason text;

CREATE OR REPLACE FUNCTION public.block_blacklisted_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_blocked boolean; v_reason text;
BEGIN
  SELECT is_blacklisted, blacklist_reason INTO v_blocked, v_reason
    FROM public.profiles WHERE id = NEW.user_id;
  IF COALESCE(v_blocked, false) THEN
    RAISE EXCEPTION '该账号已被列入黑名单，禁止下单。%',
      CASE WHEN v_reason IS NOT NULL AND v_reason <> '' THEN ' 原因: ' || v_reason ELSE '' END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_blacklist_orders ON public.orders;
CREATE TRIGGER trg_block_blacklist_orders
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.block_blacklisted_user();

DROP TRIGGER IF EXISTS trg_block_blacklist_forwardings ON public.forwarding_orders;
CREATE TRIGGER trg_block_blacklist_forwardings
  BEFORE INSERT ON public.forwarding_orders
  FOR EACH ROW EXECUTE FUNCTION public.block_blacklisted_user();
