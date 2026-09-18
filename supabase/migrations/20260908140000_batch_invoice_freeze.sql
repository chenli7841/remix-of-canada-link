-- 批次账单冻结：
--   - 每个「客户 × 批次」最多一张"未结"账单（并发防重）
--   - 账单在【确认 / 批量确认】时原地重生成覆盖；已付账单不可改
--   - 批次内改运费需先"取消确认"（应用层校验，见 orders.functions.ts）
--
-- 唯一部分索引：同一 user_id + batch_no 下，type='batch' 且状态未结的账单只能有一张。
-- 已付（paid）/作废（void）不受限，允许"一张已付 + 一张新未付"（部分付款场景）。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_batch_invoice_open
  ON public.invoices (user_id, batch_no)
  WHERE type = 'batch' AND status IN ('unpaid', 'overdue');
