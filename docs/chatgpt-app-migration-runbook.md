# EPLUS ChatGPT App 手动迁移手册

这份手册用于稍后在 Lovable/Supabase 中统一执行 ChatGPT App 数据库迁移。当前开发阶段不要提前执行。

## 执行前

1. 确认 Lovable 项目已同步到准备发布的代码版本。
2. 在 Supabase SQL Editor 中确认当前项目是 EPLUS 正式项目，而不是其他项目。
3. 备份数据库或确认平台已有可恢复备份。
4. 不要把 `.env`、Service Role Key、OpenAI Key 或数据库密码粘贴到聊天或提交到 GitHub。
5. 四个迁移必须按文件名顺序执行；任意一步报错都立即停止，不继续后面的文件。
6. 在本地先运行 `npm run mcp:check`，必须同时通过工具清单、迁移静态检查和生产构建。

## 固定执行顺序

1. `20260828090000_chatgpt_app_forwarding.sql`
   - 创建客户自己的 ChatGPT 集运草稿表、RLS、版本触发器。
   - 创建 CAD 报价、按已审阅版本确认草稿生成集运单、取消草稿 RPC。
2. `20260828100000_chatgpt_owner_read_tools.sql`
   - 创建员工只读看板、客户搜索、待处理集运和集运详情 RPC。
   - 依赖第一步的 `ai_forwarding_drafts` 表。
3. `20260828110000_chatgpt_owner_actions.sql`
   - 创建员工修改集运基础信息 RPC。
   - 要求最新记录时间、明确确认、修改原因，并写入现有审计表。
4. `20260828120000_chatgpt_waybill_status.sql`
   - 创建员工查看运单及 Owner/Manager 修改运单状态 RPC。
   - 状态修改要求最新记录时间、明确确认、原因和审计记录。

## 迁移后只读验证

在 SQL Editor 中执行以下查询；它们只检查对象，不修改业务数据。

```sql
select to_regclass('public.ai_forwarding_drafts') as draft_table;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'quote_forwarding_cad',
    'confirm_ai_forwarding_draft',
    'cancel_ai_forwarding_draft',
    'chatgpt_owner_access',
    'chatgpt_owner_dashboard',
    'chatgpt_owner_search_customers',
    'chatgpt_owner_pending_forwardings',
    'chatgpt_owner_get_forwarding',
    'chatgpt_admin_search_orders',
    'chatgpt_admin_get_order',
    'chatgpt_admin_get_customer',
    'chatgpt_admin_search_invoices',
    'chatgpt_admin_get_invoice',
    'chatgpt_admin_search_forwardings',
    'chatgpt_owner_update_forwarding_basic_info',
    'chatgpt_admin_get_waybill',
    'chatgpt_admin_search_waybills',
    'chatgpt_admin_search_batches',
    'chatgpt_admin_get_batch',
    'chatgpt_admin_search_audit_logs',
    'chatgpt_admin_get_audit_log',
    'chatgpt_manager_set_waybill_status'
  )
order by routine_name;

select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'ai_forwarding_drafts'
order by policyname;
```

预期结果：草稿表存在、22 个业务 RPC 和 2 个线路安全辅助函数全部存在、草稿表有读取/新增/更新三条客户 RLS 策略。

## 发布后测试顺序

1. 普通客户连接 EPLUS，确认只能看到自己的资料。
2. 查询订单、集运、物流、库存、钱包流水和账单，金额只显示 CAD。
3. 保存集运草稿，确认在最终确认前不会产生正式集运单。
4. 明确确认后创建一张测试集运单，并核对 EPLUS 网页中的结果。
5. 普通客户尝试后台操作，预期只回复“没有权限”。
6. Owner/Manager 使用各自账号测试后台工具，确认权限与网页后台一致。
7. 测试删除、取消和状态修改，确认必须先展示记录并再次获得明确确认。
8. 询问 GPT 支付、充值、扣款或退款，预期只引导到 EPLUS 网页，不调用任何支付工具。

## 停止条件

出现以下任一情况时停止发布：迁移报错、客户可读取他人数据、普通客户可调用后台工具、金额出现人民币或“元”、未确认即创建/删除/修改、出现任何支付工具。
