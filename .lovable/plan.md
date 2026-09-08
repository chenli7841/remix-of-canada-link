# 统一关税计算 · HS 明细口径

## 目标

1. 运单落库 `waybills.duty_cad`、批次客户号账单、运单详情"物品明细"三处，**用同一份算法**，同一票复核可对上。
2. `customs_rules.rate_pct` 不再参与金额计算；`customs_rules.enabled` 仅作为"该线路是否征税"的开关（配合 `threshold_cad` 免税额）。
3. 关税税率完全来自 `hs_codes.mfn_rate + gst_rate + anti_dumping_rate`，靠 **品名 → HS** 匹配。
4. 匹配不到 HS 的品名，前端红色提示，并提供两条修复通道：
   - **绑定已有 HS**：把该品名追加为该 HS 的 alias。
   - **新增 HS**：跳到 HS 库并预填品名。
5. 集运单可对单条 `forwarding_items` 手动指定 `hs_code`，覆盖名称匹配。

## 数据流（新版·唯一口径）

```text
forwarding_items(name, quantity, unit_price_cad, extras.items_per_carton, hs_code?)
        │
        ▼
 每条运单 items_breakdown:
   qty_per_wb   = extras.items_per_carton || quantity / box_count
   declared_cad = unit_price_cad × qty_per_wb
   hs           = forwarding_items.hs_code  → 精确
                  ‖ hs_codes.name_zh / name_en / aliases（精确 → 包含）
   rate         = mfn_rate + gst_rate + anti_dumping_rate       // 未匹配 → 0 + 标红
   duty_cad     = declared_cad × rate                            // enabled=false 或
                                                                  declared_total < threshold → 0
        │
        ▼
 waybills.duty_cad = Σ items_breakdown.duty_cad         （落库快照）
 批次客户号关税     = Σ 该客户号在该批次所有运单的 items_breakdown.duty_cad
 关税明细表        = 同上，按 (name, hs_code) 合并（数量、申报价、关税累加）
```

## 拆解

### A. 数据库

新增：
- `forwarding_items.hs_code text null` — 手动 HS 绑定。
- 索引 `hs_codes(name_zh)`、`hs_codes` GIN on `aliases`（若未建）用于加速匹配。

保留但降级：
- `customs_rules.rate_pct` 保留列（不删，历史数据），后端计算里忽略。UI 上标注"（已弃用，改用 HS 库税率）"。

### B. 后端：抽取共用函数

新增 `src/lib/duty.server.ts`：
```ts
export type DutyRow = {
  forwarding_item_id: string; name: string;
  hs_code: string | null; hs_matched: 'manual'|'alias'|'name'|'fuzzy'|'none';
  quantity_per_waybill: number; quantity_display: string;
  unit_price_cad: number; declared_value_cad: number;
  mfn_rate: number; gst_rate: number; anti_dumping_rate: number; tax_rate: number;
  duty_cad: number;
};
export async function computeWaybillDutyBreakdown(admin, wb): Promise<{
  items: DutyRow[];
  declared_cad: number;
  duty_cad: number;
  customs_applies: boolean;
  unmatched_names: string[];
}>;
```
读取路径：
1. `forwarding_orders(box_count, route_id)` → `customs_rules(enabled, threshold_cad)`。
2. `forwarding_items` 全表 → 按 `wb.items_summary` 里出现的 name 过滤（无 summary 则全量按 box 均摊）。
3. HS 匹配优先级：`fi.hs_code`（manual）→ `hs_codes.hs_code = fi.hs_code` → `name_zh/name_en 精确` → `aliases 包含` → `name_zh/name_en ilike`。
4. `duty_cad = 0` 当 `!customs.enabled || Σdeclared < threshold_cad`。

### C. 替换现有调用点

| 位置 | 现在 | 改为 |
|---|---|---|
| `scan.functions.ts` `computeWaybillFeesCad` | `declared × customs.rate_pct/100` | `computeWaybillDutyBreakdown(admin, wb).duty_cad` |
| `orders.functions.ts` `computeAndPersistWaybillFees` | 同上 | 同上 |
| `orders.functions.ts` `computeFreight`（订单快照） | 同上 | 保留（订单快照不动，与集运脱钩） |
| `orders.functions.ts` `computeBatchFeeSummary` items 循环 | fx=0.19 硬编码 + `unit_price_cny×qty` 当 CAD | 直接用 `computeWaybillDutyBreakdown` 结果聚合，删除硬编码 fx |

`computeBatchFeeSummary` 聚合逻辑：
- 遍历该批次每条运单 → `computeWaybillDutyBreakdown` → 按 `(customer_code, route_code)` bucket 累加。
- 明细表按 `(name, hs_code)` 合并：`quantity += / declared_value_cad += / duty_cad +=`，`unit_price_cad` 取首条。
- `bucket.customs = Σ duty_cad`（覆盖旧的 `wbDuty` 兜底）。
- `unmatched_names` 附带在 bucket 上，前端展示。

### D. 服务端函数（新增）

`src/lib/hs-codes.functions.ts` 追加：
- `bindNameToHs({ hs_id, name })` — 把 name push 进 `hs_codes.aliases`（去重）。
- `setForwardingItemHs({ item_id, hs_code | null })` — 更新 `forwarding_items.hs_code`。

### E. 前端

**1. `/admin/waybills/:id` · 物品明细表**
- HS 列：已匹配显示 `hs_code + 匹配来源徽章`（手动/别名/名称/模糊）；未匹配显示红色"未匹配 HS"+ 两个按钮：
  - **绑定**：弹窗，搜索 HS → 选中后调 `bindNameToHs` + 可选 `setForwardingItemHs`。
  - **新增**：新窗口打开 `/admin/hs-codes?prefill=<name>`。
- 每条明细右侧加"改绑" chip 允许换 HS（写 `forwarding_items.hs_code`）。
- 费用卡"关税"：显示 `waybills.duty_cad`；若与 `computed.duty_cad` 不一致，标琥珀色并给"重算本单"按钮（调用现有 `computeAndPersistWaybillFees`）。

**2. `/admin/batches/:id` · CustomerDrawer 关税块**
- 顶部提示条：`⚠ 未匹配 HS：xxx、yyy` + 跳转 HS 库按钮。
- 明细表按新 bucket items 渲染，列：品名 · HS · 数量 · 单价 CAD · 申报价 CAD · 税率拆分 · 关税 CAD。
- 底部合计与运单落库总和不一致时提示"运单快照过期，去 /admin/system 重算"。

**3. `/admin/system` · "重算运单费用"按钮**（已有）
- 保持不变；重算会自动写入按 HS 计算的 `duty_cad`。

**4. `/admin/hs-codes`**
- 支持 URL `?prefill=<name>` 预填品名 + 自动写入 `aliases`。

## 兼容与迁移

- `customs_rules.rate_pct` 不删；后端不再引用金额。已有 `waybills.duty_cad` 快照保留，用户在 system 页点"重算"后按新口径刷新。
- 电商 `orders` 路径（`computeFreight` / `computeOrderCustomsSnapshot`）暂不动，避免影响商城结算；只统一集运侧。若后续要电商也走 HS，再单独一轮。
- 无历史数据迁移。

## 技术要点

- HS 匹配用 in-memory Map 一次拉全表 `hs_codes`（几百行内），避免 N 次 ilike。
- `computeWaybillDutyBreakdown` 需可被 `.functions.ts` 客户端可达文件 `await import()` 使用，放 `duty.server.ts` 并只在 handler 里 import。
- `forwarding_items.hs_code` 新增后 types 会自动重生成。

## 交付顺序

1. migration：`forwarding_items.hs_code` + HS 索引。
2. `duty.server.ts` 抽取。
3. `computeWaybillFeesCad` / `computeAndPersistWaybillFees` 切换到新算法。
4. `computeBatchFeeSummary` 关税段重写。
5. `hs-codes.functions.ts` 新增 `bindNameToHs` / `setForwardingItemHs`。
6. 运单详情 UI + 客户抽屉 UI + HS 库 prefill。
7. 用户在 `/admin/system` 一键"重算运单费用"。

不变更：运费、保险、清关费、附加费算法。
