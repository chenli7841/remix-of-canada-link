-- Products had no English name/subtitle/description columns, so the storefront
-- fell back to showing the Chinese text even when lang=en. Add optional English
-- counterparts; the storefront falls back to the Chinese value when unset.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS subtitle_en text,
  ADD COLUMN IF NOT EXISTS description_en text;
