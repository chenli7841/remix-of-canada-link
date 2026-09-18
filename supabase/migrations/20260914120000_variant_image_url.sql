-- 每个 SKU（product_variants）自己的图片，前台选中该规格时优先显示；没设置就
-- 回退到商品封面图，不会出现空白。跟 products.cover_url 是同一种存法（单张 URL，
-- 不是数组），不用建新表。
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS image_url text;
