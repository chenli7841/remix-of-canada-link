-- Routes were shared indiscriminately between the shop checkout flow and the
-- freight-forwarding request flow. Add a usage_scope so admins can restrict a route to one
-- flow or the other. Default 'both' preserves current behavior for all existing routes until
-- an admin explicitly narrows one.
ALTER TABLE public.shipping_routes
  ADD COLUMN usage_scope text NOT NULL DEFAULT 'both'
  CHECK (usage_scope IN ('shop', 'forwarding', 'both'));
