
ALTER TABLE public.products ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
CREATE INDEX idx_products_is_featured ON public.products(is_featured) WHERE is_featured = true;
