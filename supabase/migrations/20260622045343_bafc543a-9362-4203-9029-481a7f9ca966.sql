
-- 1) Enum value additions (safe; not referenced as live values in this migration)
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'storage';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'arrived';
ALTER TYPE public.waybill_status ADD VALUE IF NOT EXISTS 'procurement';
ALTER TYPE public.waybill_status ADD VALUE IF NOT EXISTS 'storage';
ALTER TYPE public.waybill_status ADD VALUE IF NOT EXISTS 'arrived';

-- 2) shipping_method check constraints: add 'storage'
ALTER TABLE public.shipping_routes DROP CONSTRAINT IF EXISTS shipping_routes_shipping_method_check;
ALTER TABLE public.shipping_routes ADD CONSTRAINT shipping_routes_shipping_method_check
  CHECK (shipping_method = ANY (ARRAY['air','sea','express','truck','storage']));

ALTER TABLE public.forwarding_orders DROP CONSTRAINT IF EXISTS forwarding_orders_shipping_method_check;
ALTER TABLE public.forwarding_orders ADD CONSTRAINT forwarding_orders_shipping_method_check
  CHECK (shipping_method = ANY (ARRAY['air','sea','express','truck','storage']));
