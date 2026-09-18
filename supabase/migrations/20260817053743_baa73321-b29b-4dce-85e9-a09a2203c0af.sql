ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS min_charge_order_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_charge_batch_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clearance_fee_order_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clearance_fee_batch_cad numeric NOT NULL DEFAULT 0;

UPDATE public.freight_rules
SET min_charge_order_cad = CASE WHEN COALESCE(min_charge_level,'waybill') = 'batch' THEN 0 ELSE COALESCE(min_charge_cad,0) END,
    min_charge_batch_cad = CASE WHEN COALESCE(min_charge_level,'waybill') = 'batch' THEN COALESCE(min_charge_cad,0) ELSE 0 END,
    clearance_fee_order_cad = CASE WHEN COALESCE(clearance_fee_level,'waybill') = 'batch' THEN 0 ELSE COALESCE(clearance_fee_cad,0) END,
    clearance_fee_batch_cad = CASE WHEN COALESCE(clearance_fee_level,'waybill') = 'batch' THEN COALESCE(clearance_fee_cad,0) ELSE 0 END;