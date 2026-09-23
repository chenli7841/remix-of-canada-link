# Supabase 项目结构对比（2026-09-22）

通过已登录的 Supabase Dashboard SQL Editor 执行只读系统目录查询；没有修改数据库结构、业务数据、凭证或发布应用。

- 项目1：Sino_Cargo_1 — `wpjfgunrpudznitpqyul`
- 项目2（当前服务器）：Sino_Cargo_2 — `fhfsrrbzubgjrjhgwerv`

## 结论

项目2并非大面积缺失结构。public 中现有83个表对象的名称、类型、RLS状态、1188个字段定义、现有约束及索引均与项目1对应对象一致。主要缺口是企业微信通知模块，以及支付自动对账定时任务。

|检查项|项目1|项目2|差异|
|---|---:|---:|---|
|public 表对象|88|83|缺企业微信通知5表|
|public 字段|1227|1188|缺失39字段全部属于这5表|
|public 数据库函数|161|161|159个定义哈希一致；另2个仅CRLF/LF换行差异，规范化换行后完全一致|
|public RLS策略|120|120|定义一致|
|public/auth 非系统触发器|73|73|定义一致|
|public 约束|277|263|缺14个，全部属于通知5表|
|public 索引|244|235|缺9个，全部属于通知5表|
|public 枚举值|82|82|名称、值及顺序一致|
|已安装扩展|9|9|名称一致，未比较版本|
|anon/authenticated/service_role表授权|1778|1743|缺35条，均为通知5表的service_role授权|
|Storage桶|8|10|原8个配置一致；项目2多2个导出桶|
|Storage RLS策略|14|14|定义一致|
|public发布订阅表|0|0|一致|
|Edge Functions部署|0|0|两边页面均显示尚未部署首个函数|
|app_settings键名|17|17|一致；未读取或比较值|
|后台导航路径|40|39|缺 /admin/wecom-notify|
|cron任务|1|0|缺 ott-reconcile|

## 可以补齐：企业微信通知模块

缺少的表：

- `wecom_notify_token`
- `wecom_notify_groups`
- `wecom_notify_bindings`
- `wecom_notify_messages`
- `wecom_notify_message_targets`

当前代码已有完整迁移，可按以下次序补齐项目2：

1. `supabase/migrations/20260918120000_wecom_notify.sql`：建立5表、基本约束索引、RLS、仅service_role授权和owner后台导航。
2. `supabase/migrations/20260918223000_wecom_notify_delivery_status.sql`：补充提交/员工确认/部分失败状态、5个跟踪字段和msgid索引。

第二份迁移依赖第一份；仅执行第一份会留下送达跟踪字段缺口。`20260919013817_7487c6b5-36de-47d2-ada5-f0671c0b35c0.sql`重复基础建表，不能替代送达状态迁移。不应整体重新执行223份历史迁移。

建议实施前保留当前结构备份，并在一个事务中组合上述两份迁移（移除内层BEGIN/COMMIT）；实施后重新查询5表、39字段、14约束、9索引、35授权及后台导航。已有业务表无需覆盖，旧项目中的token缓存、群绑定和消息数据不自动复制。补齐结构不等于启用实际群发；应用凭证、可信出口IP及WECOM_ENABLED需单独核验。

## 需单独配置：OTT支付自动对账

项目1存在启用的 `ott-reconcile`，每2分钟运行；项目2没有cron任务。两边当前会话和持久数据库/角色配置中均未发现 `app.ott_reconcile_url`、`app.ott_reconcile_secret`。

本地 `20260909170000_ott_reconcile_cron.sql` 中的 `_ott_reconcile_tick()` 在地址或密钥缺失时直接返回。函数定义在两库哈希一致。因此不能把项目1有任务理解为对账功能已正常运行，也不能仅补一条定时任务就宣布修复。

后续需核对当前正式域名上的对账路由和服务端密钥配置，匹配数据库端地址/密钥后再注册任务，并验证调用及重复执行不会重复入账。本次没有运行支付结算函数或修改余额。

## 不需要从项目1覆盖的内容

两处函数 `gen_waybill_no`、`recompute_mark_nos_for_parent` 只是换行差异，不需要替换。项目2额外的 `database_export_18_09_26`、`database_export_22_09_26` 桶不属于缺失或错误，应保留。现有Google登录配置不在本次复制范围内。

## 检查边界

本次核对的是上述结构及配置元数据，不是所有业务数据、文件内容、密钥值或功能端到端验收。未核对所有自定义角色/默认授权、函数执行权限、扩展版本、所有系统schema、Auth全量配置或迁移执行记录。不能据此宣称两个项目完全相同。仓库迁移文件存在也不代表线上已执行。

以上为2026-09-22检查时状态；后续实施见下。

## 2026-09-23 实施结果

用户明确要求补齐后，已在项目2以单个事务创建企业微信通知5表（直接使用送达状态迁移后的最终定义）、约束索引、RLS、service_role授权和后台导航。未复制旧项目数据。

执行后再次查询并验证：88表、1227字段、120条public策略、73个public/auth触发器、82枚举值、9个扩展与项目1快照一致；约束277、索引244；通知表service_role授权35条，anon/authenticated授权0条；通知导航1条。

对账旧方案的 `ALTER DATABASE postgres SET app.ott_reconcile_url` 实际返回 `42501 permission denied`，该准备事务未成功提交。随后已部署 `20260923010000_ott_reconcile_vault.sql`：函数改为从Vault读取 `OTT_RECONCILE_SECRET`，回调地址固定为当前正式站点；注册每2分钟执行的 `ott-reconcile`，当前 `active=false`。没有手动执行支付结算或真实对账。

仍需用户完成密钥输入：

1. 在 Lovable → Cloud → Secrets 新增 `OTT_RECONCILE_SECRET`，值为密码管理器生成的长随机字符串。
2. 在项目2 Supabase → Integrations → Vault → Secrets 新增同名密钥，使用完全相同的值。
3. 用户发布Lovable，使线上应用获得该变量；页面明确提示密钥变更在预览立即生效、线上需发布。
4. 后续确认两端配置及线上鉴权，再启用任务并验证调用。当前尚未启用，不能称为自动对账已跑通。

新密钥由用户在页面输入并保存，避免通过聊天传递。已打开上述两个配置页。本次未发布应用。Supabase Dashboard执行的SQL没有自动补写CLI迁移历史；后续使用CLI部署前需按已应用内容核对历史。
