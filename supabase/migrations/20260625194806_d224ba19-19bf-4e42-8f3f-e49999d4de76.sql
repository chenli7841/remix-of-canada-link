
ALTER TABLE public.pallets
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.shipping_routes(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_code text,
  ADD COLUMN IF NOT EXISTS customer_user_id uuid,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS pickup_warehouse text,
  ADD COLUMN IF NOT EXISTS destination_code text,
  ADD COLUMN IF NOT EXISTS self_length_cm numeric,
  ADD COLUMN IF NOT EXISTS self_width_cm numeric,
  ADD COLUMN IF NOT EXISTS self_height_cm numeric,
  ADD COLUMN IF NOT EXISTS self_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS self_volume_m3 numeric;

CREATE INDEX IF NOT EXISTS idx_pallets_customer ON public.pallets(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_pallets_route ON public.pallets(route_id);

ALTER TABLE public.cartons
  ADD COLUMN IF NOT EXISTS self_length_cm numeric,
  ADD COLUMN IF NOT EXISTS self_width_cm numeric,
  ADD COLUMN IF NOT EXISTS self_height_cm numeric,
  ADD COLUMN IF NOT EXISTS self_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS self_volume_m3 numeric;
