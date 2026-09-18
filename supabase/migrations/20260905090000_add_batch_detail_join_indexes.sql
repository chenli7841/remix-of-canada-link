-- 批次详情页（computeBatchFeeSummary）在大批次上（数百运单/数十客户/数十附加费）
-- 打开要卡很久，根因之一是它实际用到的关联列缺索引，随着 waybills/cartons/pallets/
-- surcharges 全站数据量增长，这些 .eq()/.in() 过滤退化成全表扫描：
--   - cartons.batch_id / pallets.batch_id      （批次下的箱号/托盘）
--   - waybills.carton_id / waybills.pallet_id  （箱号/托盘内的运单）
--   - cartons.pallet_id                        （托盘内的箱号）
--   - surcharges.batch_id                      （批次附加费；forwarding_id 早有索引，batch_id 没有）
-- waybills.assigned_batch_id 已经有 idx_waybills_batch，不受影响。
-- 纯增量索引，不改变任何查询结果，可安全上线。

CREATE INDEX IF NOT EXISTS idx_cartons_batch ON public.cartons(batch_id);
CREATE INDEX IF NOT EXISTS idx_pallets_batch ON public.pallets(batch_id);
CREATE INDEX IF NOT EXISTS idx_waybills_carton_id ON public.waybills(carton_id);
CREATE INDEX IF NOT EXISTS idx_waybills_pallet_id ON public.waybills(pallet_id);
CREATE INDEX IF NOT EXISTS idx_cartons_pallet_id ON public.cartons(pallet_id);
CREATE INDEX IF NOT EXISTS surcharges_batch_idx ON public.surcharges(batch_id);
