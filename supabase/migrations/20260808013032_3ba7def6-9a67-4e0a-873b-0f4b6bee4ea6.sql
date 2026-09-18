CREATE OR REPLACE FUNCTION public.sync_my_item_to_hs_lib()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.customer_hs_items
  WHERE user_id = NEW.user_id
    AND (
      (NEW.sku IS NOT NULL AND sku IS NOT NULL AND lower(sku) = lower(NEW.sku))
      OR ((NEW.sku IS NULL OR sku IS NULL) AND lower(description) = lower(NEW.name))
    )
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.customer_hs_items (user_id, sku, description, unit_price_cad, items_per_carton, hs_code)
    VALUES (NEW.user_id, NEW.sku, NEW.name, NULLIF(NEW.declared_value_cad, 0), NEW.inner_qty, NULLIF(NEW.hs_code, ''));
  ELSE
    UPDATE public.customer_hs_items
    SET description = NEW.name,
        sku = COALESCE(NEW.sku, sku),
        unit_price_cad = COALESCE(NULLIF(NEW.declared_value_cad, 0), unit_price_cad),
        items_per_carton = COALESCE(NEW.inner_qty, items_per_carton),
        hs_code = COALESCE(NULLIF(NEW.hs_code, ''), hs_code),
        updated_at = now()
    WHERE id = v_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_my_items_sync_hs_lib ON public.my_items;
CREATE TRIGGER trg_my_items_sync_hs_lib
AFTER INSERT OR UPDATE ON public.my_items
FOR EACH ROW EXECUTE FUNCTION public.sync_my_item_to_hs_lib();