-- Make waybill items_summary work for shop-order waybills (where order_items.waybill_id is NULL)
CREATE OR REPLACE FUNCTION public.recompute_waybill_items_summary(_waybill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_forwarding_id uuid;
BEGIN
  SELECT order_id, forwarding_id INTO v_order_id, v_forwarding_id
  FROM public.waybills WHERE id = _waybill_id;

  IF v_order_id IS NOT NULL THEN
    -- Prefer items bound to this waybill; fall back to all items of the order
    UPDATE public.waybills w
       SET items_summary = COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'name', COALESCE(oi.name_zh, oi.name_en, oi.sku, '—'),
           'quantity', oi.quantity
         ))
         FROM public.order_items oi
         WHERE oi.order_id = v_order_id
           AND (
             EXISTS (SELECT 1 FROM public.order_items x WHERE x.waybill_id = _waybill_id)
               AND oi.waybill_id = _waybill_id
             OR NOT EXISTS (SELECT 1 FROM public.order_items x WHERE x.waybill_id = _waybill_id)
           )
       ), '[]'::jsonb)
     WHERE w.id = _waybill_id;
  ELSIF v_forwarding_id IS NOT NULL THEN
    -- For forwarding waybills, if not already populated by place_forwarding, summarise all forwarding_items
    UPDATE public.waybills w
       SET items_summary = COALESCE((
         SELECT jsonb_agg(jsonb_build_object('name', fi.name, 'quantity', fi.quantity))
         FROM public.forwarding_items fi
         WHERE fi.forwarding_id = v_forwarding_id
       ), '[]'::jsonb)
     WHERE w.id = _waybill_id
       AND (w.items_summary IS NULL OR w.items_summary = '[]'::jsonb);
  END IF;
END $function$;

-- Ensure order-level changes also refresh related waybills
CREATE OR REPLACE FUNCTION public.trg_order_items_sync_waybill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT id FROM public.waybills WHERE order_id = OLD.order_id LOOP
      PERFORM public.recompute_waybill_items_summary(r.id);
    END LOOP;
    RETURN OLD;
  ELSE
    FOR r IN SELECT id FROM public.waybills WHERE order_id = NEW.order_id LOOP
      PERFORM public.recompute_waybill_items_summary(r.id);
    END LOOP;
    RETURN NEW;
  END IF;
END $function$;

-- Same for forwarding_items
CREATE OR REPLACE FUNCTION public.trg_forwarding_items_sync_waybill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; fid uuid;
BEGIN
  fid := COALESCE(NEW.forwarding_id, OLD.forwarding_id);
  FOR r IN SELECT id FROM public.waybills WHERE forwarding_id = fid LOOP
    PERFORM public.recompute_waybill_items_summary(r.id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $function$;

DROP TRIGGER IF EXISTS forwarding_items_sync_waybill ON public.forwarding_items;
CREATE TRIGGER forwarding_items_sync_waybill
AFTER INSERT OR UPDATE OR DELETE ON public.forwarding_items
FOR EACH ROW EXECUTE FUNCTION public.trg_forwarding_items_sync_waybill();

-- Backfill existing waybills
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.waybills LOOP
    PERFORM public.recompute_waybill_items_summary(r.id);
  END LOOP;
END $$;