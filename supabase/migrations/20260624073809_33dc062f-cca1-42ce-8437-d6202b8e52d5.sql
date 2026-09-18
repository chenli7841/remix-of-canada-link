-- Add bidirectional flag and sales tax to shipping_routes
ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS is_bidirectional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_tax_rate_pct numeric NOT NULL DEFAULT 0;

-- Add pallet-based pricing to freight_rules
ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'weight',
  ADD COLUMN IF NOT EXISTS pallet_unit_price_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pallet_max_length_cm numeric,
  ADD COLUMN IF NOT EXISTS pallet_max_width_cm numeric,
  ADD COLUMN IF NOT EXISTS pallet_max_height_cm numeric,
  ADD COLUMN IF NOT EXISTS pallet_max_weight_kg numeric,
  ADD COLUMN IF NOT EXISTS pallet_overflow_factor numeric NOT NULL DEFAULT 2;