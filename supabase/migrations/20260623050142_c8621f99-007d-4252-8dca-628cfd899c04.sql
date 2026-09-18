
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_route_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.shipping_routes(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.forwarding_orders DROP CONSTRAINT IF EXISTS forwarding_orders_route_id_fkey;
ALTER TABLE public.forwarding_orders ADD CONSTRAINT forwarding_orders_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.shipping_routes(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.cartons DROP CONSTRAINT IF EXISTS cartons_route_id_fkey;
ALTER TABLE public.cartons ADD CONSTRAINT cartons_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES public.shipping_routes(id) ON DELETE SET NULL ON UPDATE CASCADE;
