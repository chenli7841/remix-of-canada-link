# ship API 文档

正确代码根目录：C:/Users/zeyan/Desktop/代码/SinoCargo-Lovable

本目录 v3 文档取代 v2（v2 保留在仓库中作为历史记录，实施以 v3 为准）。

- shipper-api-v3.md：对外 API 对接评审稿。
- system-change-guide-v3.md：内部系统修改意见及 Claude 实施指导。
- word/Shipper_API对接文档_v3.docx、word/系统修改意见与Claude指导_v3.docx：对应的 Word 版本（v2 Word 保留作历史存档）。以 .md 为准；Word 版内容与 .md 一致，但未来若只改 .md 忘了同步 Word，请以 .md 为准。

v3 相对 v2 的主要变化：
1. 一箱多品按线路是否要求箱数分两种处理（箱数已知线路按 packages[] 建箱；箱数未知/海运线路只提交订单级别 items[]，不建箱，收货后再查真实箱号——详见 shipper-api-v3.md 第 5.1/6.1 节）。
2. 客户归属本轮只做最小映射（partner_key/external_customer_id/local_user_id），不含 sales_user_id/结算字段，留给后续扣款功能。
3. 客户分级改为有意复用现有线路可见性机制：ship客户 分级在首单建档成功时由服务端自动设置（幂等），并驱动 shipping_routes 的"可见客户等级"勾选；owner 分级保持纯选项、无联动。
4. 待入库编辑/删除锁定信号确认为 forwarding_orders.intake_at 是否为空，不新增字段。

本轮仅编写/修订文档，不代表 API 已实现或已上线。
