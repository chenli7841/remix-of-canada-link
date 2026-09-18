-- Product detail page: the "trust points" bullet list (正品保障 / 合箱集运 / 全程追踪)
-- was hardcoded copy shared by every product. Making it per-product editable —
-- seed the existing copy as the default so already-live products keep showing
-- the same three lines until a staff member edits them.
ALTER TABLE public.products ADD COLUMN trust_points jsonb NOT NULL DEFAULT
  '["国内官方渠道直采，保证正品","支持合箱集运，节省 40% 运费","全程运单追踪，节点透明"]'::jsonb;
