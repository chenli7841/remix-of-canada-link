
-- 1) Default fx_rate setting (CNY per 1 CAD)
INSERT INTO public.app_settings(key, value)
VALUES ('fx_rate', jsonb_build_object('cny_per_cad', 5.26))
ON CONFLICT (key) DO NOTHING;

-- Ensure anon can read fx_rate (SELECT policy is already 'true', but grant just in case)
GRANT SELECT ON public.app_settings TO anon;

-- 2) Auto-recompute declared_value_cad on forwarding_items changes
CREATE OR REPLACE FUNCTION public.recalc_fo_declared_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fid uuid;
  v_sum numeric;
BEGIN
  v_fid := COALESCE(NEW.forwarding_id, OLD.forwarding_id);
  IF v_fid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(quantity * COALESCE(unit_price_cad, 0)), 0)
    INTO v_sum
    FROM public.forwarding_items
   WHERE forwarding_id = v_fid;
  UPDATE public.forwarding_orders
     SET declared_value_cad = ROUND(v_sum, 2)
   WHERE id = v_fid;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_fi_recalc_declared_ai ON public.forwarding_items;
DROP TRIGGER IF EXISTS trg_fi_recalc_declared_au ON public.forwarding_items;
DROP TRIGGER IF EXISTS trg_fi_recalc_declared_ad ON public.forwarding_items;
CREATE TRIGGER trg_fi_recalc_declared_ai
  AFTER INSERT ON public.forwarding_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_fo_declared_value();
CREATE TRIGGER trg_fi_recalc_declared_au
  AFTER UPDATE OF quantity, unit_price_cad ON public.forwarding_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_fo_declared_value();
CREATE TRIGGER trg_fi_recalc_declared_ad
  AFTER DELETE ON public.forwarding_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_fo_declared_value();

-- 3) Backfill for existing orders
UPDATE public.forwarding_orders fo
   SET declared_value_cad = ROUND(sub.s, 2)
  FROM (
    SELECT forwarding_id, COALESCE(SUM(quantity * COALESCE(unit_price_cad,0)), 0) AS s
      FROM public.forwarding_items GROUP BY forwarding_id
  ) sub
 WHERE fo.id = sub.forwarding_id
   AND (fo.declared_value_cad IS NULL OR fo.declared_value_cad <> ROUND(sub.s, 2));
