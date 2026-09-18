-- Cartons/pallets lock onto a single delivery address the moment their first
-- customer item is added — copied from that item's own actual shipping address
-- (orders.address_snapshot, or the forwarding_orders.address_id row), not the
-- customer's account default. Once set, later items must match it or the
-- assign is rejected (see assignToCarton/assignToPallet in cartons.functions.ts).
ALTER TABLE public.cartons ADD COLUMN address_snapshot jsonb;
ALTER TABLE public.pallets ADD COLUMN address_snapshot jsonb;
