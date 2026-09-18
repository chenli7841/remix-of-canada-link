-- 客户端「我的批次」(listMyBatches) 现在每次打开都对整个批次重跑
-- computeBatchFeeSummary（算全部客户、再筛当前客户），大批次要 5–7 秒。
--
-- 方案：为「批次 × 客户号」保存费用快照。
--   - 快照在【锁定批次】时写入（draft→locked，正式冻结点）；
--   - 之后任何改钱的操作（附加费 / 派送费 / 折扣 / 确认价格 / 改重量尺寸 /
--     运单进出批次）会把 batches.fees_dirty_at 打上时间戳；
--   - listMyBatches 读时：snapshot_at >= fees_dirty_at（或 fees_dirty_at 为空）
--     → 直接读 subtotal_cad；否则现算一次并回写。
--   - 已发出 / 已到货 / 已关闭 这些纯物流状态变更【不刷新快照】。
--
-- balance_cad（钱包余额）和 is_paid（付款状态）不进快照：前者是实时钱包余额，
-- 后者付款时才变，都由 listMyBatches 另行实时读取。

-- 1. 批次级「费用已变动」标记：非空即表示快照可能已过期
ALTER TABLE public.batches
  ADD COLUMN IF NOT EXISTS fees_dirty_at timestamptz;

-- 2. batch_settlements 增加费用快照列（主键仍是 UNIQUE(batch_id, customer_code)，
--    subtotal_cad 存该客户在本批【跨线路合计】，与客户端口径一致）
ALTER TABLE public.batch_settlements
  ADD COLUMN IF NOT EXISTS subtotal_cad numeric,
  ADD COLUMN IF NOT EXISTS waybill_count integer,
  ADD COLUMN IF NOT EXISTS carton_count integer,
  ADD COLUMN IF NOT EXISTS pallet_count integer,
  ADD COLUMN IF NOT EXISTS route_codes text,
  ADD COLUMN IF NOT EXISTS fee_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS calc_version integer NOT NULL DEFAULT 1,
  -- 付款状态快照：该客户在本批的运单是否已全部付清。
  -- 客户在「我的批次」自助钱包付款、或员工在批次详情「扣款」时写入。
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 客户端按 (batch_id, customer_code) 命中已有索引（UNIQUE 约束自带），无需新增。
