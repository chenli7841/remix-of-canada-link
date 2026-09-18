ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'procurement' AFTER 'paid';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'received' AFTER 'procurement';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'packed' AFTER 'received';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'in_transit' AFTER 'packed';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'ready_pickup' AFTER 'in_transit';