-- Phase 1 · 物品明细 + 关税落库
--
-- 现状：关税逐品名明细（品名 / HS / mfn+gst+反倾销 / 申报价 / 关税）在
-- computeWaybillDutyBreakdown / computeBatchFeeSummary 里每次调用都从
-- forwarding_items + hs_codes 库现算，任何一处都没有持久化。
--
-- 本迁移：
--   1. 新表 waybill_items —— 运单级拆分 + 关税快照（客户端 / 账单直读）
--   2. forwarding_items 加列 —— 材质等从 extras 提升为列 + 关税快照
--   3. order_items 加列 —— 关税快照（电商侧税率来自 products，下单时快照进来）
-- 全部关税/税率/HS 字段可为空。填充逻辑在 persistWaybillItems (TS)。

-- ============================================================
-- 1. waybill_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.waybill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waybill_id uuid NOT NULL REFERENCES public.waybills(id) ON DELETE CASCADE,
  forwarding_item_id uuid REFERENCES public.forwarding_items(id) ON DELETE SET NULL,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  hs_code text,
  hs_matched text,          -- manual | name | alias | fuzzy | none
  hs_confirmed boolean NOT NULL DEFAULT false,
  quantity numeric NOT NULL DEFAULT 0,   -- 拆到本运单的数量（可含分数）
  unit_price_cad numeric,
  declared_value_cad numeric,
  mfn_rate numeric,
  gst_rate numeric,
  anti_dumping_rate numeric,
  tax_rate numeric,
  duty_cad numeric,
  duty_applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waybill_items_waybill ON public.waybill_items(waybill_id);
CREATE INDEX IF NOT EXISTS idx_waybill_items_fwd_item ON public.waybill_items(forwarding_item_id);
CREATE INDEX IF NOT EXISTS idx_waybill_items_order_item ON public.waybill_items(order_item_id);

GRANT SELECT ON public.waybill_items TO authenticated;
GRANT ALL ON public.waybill_items TO service_role;
ALTER TABLE public.waybill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "waybill_items readable by staff or owning customer"
ON public.waybill_items FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.waybills w
    WHERE w.id = waybill_items.waybill_id AND w.user_id = auth.uid()
  )
);

CREATE POLICY "waybill_items manage by staff"
ON public.waybill_items FOR ALL TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_waybill_items_updated BEFORE UPDATE ON public.waybill_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. forwarding_items 加列
-- ============================================================
ALTER TABLE public.forwarding_items
  ADD COLUMN IF NOT EXISTS material text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS box_count integer,
  ADD COLUMN IF NOT EXISTS inner_qty integer,
  ADD COLUMN IF NOT EXISTS hs_matched text,
  ADD COLUMN IF NOT EXISTS hs_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfn_rate numeric,
  ADD COLUMN IF NOT EXISTS gst_rate numeric,
  ADD COLUMN IF NOT EXISTS anti_dumping_rate numeric,
  ADD COLUMN IF NOT EXISTS declared_value_cad numeric,
  ADD COLUMN IF NOT EXISTS duty_cad numeric;

-- 一次性把已有 extras 里的展示字段搬到列（不覆盖已有非空值）
UPDATE public.forwarding_items SET
  material   = COALESCE(material,   NULLIF(extras->>'material', '')),
  origin     = COALESCE(origin,     NULLIF(extras->>'origin', '')),
  brand      = COALESCE(brand,      NULLIF(extras->>'brand', '')),
  box_count  = COALESCE(box_count,  NULLIF(extras->>'box_count', '')::int),
  inner_qty  = COALESCE(inner_qty,  NULLIF(extras->>'inner_qty', '')::int),
  hs_code    = COALESCE(hs_code,    NULLIF(extras->>'hscode', ''))
WHERE extras IS NOT NULL AND extras <> '{}'::jsonb;

-- ============================================================
-- 3. order_items 加列（电商关税快照）
-- ============================================================
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS hs_code text,
  ADD COLUMN IF NOT EXISTS hs_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfn_rate numeric,
  ADD COLUMN IF NOT EXISTS gst_rate numeric,
  ADD COLUMN IF NOT EXISTS anti_dumping_rate numeric,
  ADD COLUMN IF NOT EXISTS declared_value_cad numeric,
  ADD COLUMN IF NOT EXISTS duty_cad numeric;
