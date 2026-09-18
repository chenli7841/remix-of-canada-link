-- English counterparts for the four free-text product-page fields that only
-- had a Chinese column. (faq_items / trust_points / detail_blocks are jsonb
-- already, so their _en text lives inside the JSON itself — no column needed.)
ALTER TABLE public.products ADD COLUMN origin_location_en text;
ALTER TABLE public.products ADD COLUMN packaging_note_en text;
ALTER TABLE public.products ADD COLUMN lead_time_note_en text;
ALTER TABLE public.products ADD COLUMN origin_port_note_en text;
