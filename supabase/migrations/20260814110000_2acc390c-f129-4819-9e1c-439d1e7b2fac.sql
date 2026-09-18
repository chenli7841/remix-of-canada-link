-- Product detail page redesign: a few public-facing fields that the
-- Alibaba-style template needs and didn't have a home yet.
-- (manufacturer stays admin-only/hidden per existing business rule —
-- origin_location is a separate, deliberately-public field.)
ALTER TABLE public.products ADD COLUMN origin_location text;
ALTER TABLE public.products ADD COLUMN packaging_note text;
ALTER TABLE public.products ADD COLUMN lead_time_note text;
ALTER TABLE public.products ADD COLUMN origin_port_note text;
ALTER TABLE public.products ADD COLUMN faq_items jsonb NOT NULL DEFAULT '[]'::jsonb;
