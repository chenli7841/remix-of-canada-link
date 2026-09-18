
-- 1. Add can_origin / can_destination to warehouses
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS can_origin boolean NOT NULL DEFAULT false;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS can_destination boolean NOT NULL DEFAULT false;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS can_inventory boolean NOT NULL DEFAULT true;

UPDATE public.warehouses SET
  can_origin = (type IN ('origin','transit')) OR can_origin,
  can_destination = (type IN ('destination','transit')) OR can_destination;

-- Drop the restrictive type check; keep column for legacy compat but allow anything
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS warehouses_type_check;
ALTER TABLE public.warehouses ALTER COLUMN type DROP NOT NULL;

-- 2. Create variant_stocks (per-warehouse stock)
CREATE TABLE IF NOT EXISTS public.variant_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  stock integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_variant_stocks_variant ON public.variant_stocks(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_stocks_warehouse ON public.variant_stocks(warehouse_id);

GRANT SELECT ON public.variant_stocks TO authenticated;
GRANT ALL ON public.variant_stocks TO service_role;
ALTER TABLE public.variant_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variant_stocks_staff_all" ON public.variant_stocks
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "variant_stocks_read_active" ON public.variant_stocks FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
                  WHERE v.id = variant_stocks.variant_id AND p.status = 'active'));

DROP TRIGGER IF EXISTS trg_variant_stocks_updated ON public.variant_stocks;
CREATE TRIGGER trg_variant_stocks_updated BEFORE UPDATE ON public.variant_stocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Add warehouse_id to inventory_movements
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_inv_warehouse ON public.inventory_movements(warehouse_id);

-- 4. Backfill: choose default warehouse (first can_origin, fallback any)
DO $$
DECLARE v_def uuid;
BEGIN
  SELECT id INTO v_def FROM public.warehouses
    WHERE can_inventory = true ORDER BY (CASE WHEN can_origin THEN 0 ELSE 1 END), sort_order, code LIMIT 1;
  IF v_def IS NULL THEN RETURN; END IF;

  -- Backfill variant_stocks from existing product_variants.stock
  INSERT INTO public.variant_stocks (variant_id, warehouse_id, stock)
    SELECT v.id, v_def, v.stock FROM public.product_variants v
    ON CONFLICT (variant_id, warehouse_id) DO NOTHING;

  -- Backfill warehouse_id on existing movements
  UPDATE public.inventory_movements SET warehouse_id = v_def WHERE warehouse_id IS NULL;
END $$;

ALTER TABLE public.inventory_movements ALTER COLUMN warehouse_id SET NOT NULL;

-- 5. Replace apply_inventory_movement trigger to update per-warehouse stock
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid;
BEGIN
  INSERT INTO public.variant_stocks (variant_id, warehouse_id, stock)
    VALUES (NEW.variant_id, NEW.warehouse_id, NEW.qty_delta)
    ON CONFLICT (variant_id, warehouse_id)
    DO UPDATE SET stock = variant_stocks.stock + EXCLUDED.stock, updated_at = now();

  UPDATE public.product_variants
    SET stock = COALESCE((SELECT SUM(stock) FROM public.variant_stocks WHERE variant_id = NEW.variant_id), 0)
    WHERE id = NEW.variant_id
    RETURNING product_id INTO pid;

  IF pid IS NOT NULL THEN
    UPDATE public.products SET total_stock =
      (SELECT COALESCE(SUM(stock),0) FROM public.product_variants WHERE product_id = pid)
      WHERE id = pid;
  END IF;
  RETURN NEW;
END $$;
