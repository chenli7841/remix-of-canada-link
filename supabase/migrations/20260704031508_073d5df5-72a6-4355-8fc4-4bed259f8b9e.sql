ALTER TABLE public.cartons ADD COLUMN IF NOT EXISTS self_freight_cad numeric NOT NULL DEFAULT 0;
ALTER TABLE public.pallets ADD COLUMN IF NOT EXISTS self_freight_cad numeric NOT NULL DEFAULT 0;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS surcharge_cad numeric NOT NULL DEFAULT 0;