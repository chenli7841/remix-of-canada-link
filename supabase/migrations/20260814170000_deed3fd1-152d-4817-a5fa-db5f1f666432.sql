-- Staff-only manufacturer contact details (phone / address / website / contact
-- person), grouped alongside the existing `manufacturer` name field. This is
-- never selected by the public shop endpoints (see shop-public.functions.ts) —
-- unlike `manufacturer`, which those queries already fetch (just don't render),
-- this one is kept out of that select list entirely so it can't leak to anon
-- API calls.
ALTER TABLE public.products ADD COLUMN manufacturer_contact jsonb NOT NULL DEFAULT '{}'::jsonb;
