-- Per-route customer-facing cargo guidance. Empty means the route has not been documented yet.
ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS allowed_items_text text,
  ADD COLUMN IF NOT EXISTS prohibited_items_text text;

COMMENT ON COLUMN public.shipping_routes.allowed_items_text IS
  'Customer-facing examples/categories accepted by this specific route; not a universal customs guarantee.';
COMMENT ON COLUMN public.shipping_routes.prohibited_items_text IS
  'Customer-facing prohibited/restricted cargo guidance for this specific route.';
