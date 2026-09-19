# 客服政策基础设施核实记录

核实日期：2026-09-18。仅查看 Lovable 和 Supabase 控制台；未调用 AI、修改云设置、启用收费功能或恢复备份。

## 已核实

- Lovable 项目 Remix of Canada Link 的 Cloud → Overview 显示外接 Supabase `Sino_Cargo_1`，项目引用 `wpjfgunrpudznitpqyul`。
- Supabase 项目主页显示组织套餐 PRO、主数据库 Canada (Central)、区域 ca-central-1。该信息不能扩展为全部第三方处理均在加拿大。
- Database → Backups → Scheduled backups 显示每日备份说明及实际物理备份记录（含 2026-09-15 至 2026-09-18），并明确 Storage API 文件对象不包含在数据库备份中。
- Point in time 页显示需要启用 add-on；当前未启用 PITR。没有点击 Enable 或 Restore。
- Supabase 官方套餐说明：Pro 可访问最近 7 天的每日备份；API / Database 平台日志窗口 7 天。这些套餐规则不证明所有内部副本或 EPLUS 审计表都在 7 天后删除。

## 证据入口

- https://lovable.dev/projects/a7040f64-14a3-483e-aa91-dad51eb50070 （Cloud → Overview）
- https://supabase.com/dashboard/project/wpjfgunrpudznitpqyul
- https://supabase.com/dashboard/project/wpjfgunrpudznitpqyul/database/backups/scheduled
- https://supabase.com/dashboard/project/wpjfgunrpudznitpqyul/database/backups/pitr
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/pricing

## 尚不能据此确认

具体服务商副本的实际删除日期、项目专属日志转存及全链路驻留位置，不能由主库地区推断。运营方随后确认人工流程落实、业务审计保留 12 个月、关联文件随所属记录清理，以及 yanze 仅含内部演示资料且允许审核测试。

## 官方服务商说明补充

- Lovable 隐私政策（2026-09-15 版）：运行/安全日志按提供服务、安全及事件调查所需保留，未给全部日志统一天数；跨境处理涉及美国及其他国家。https://lovable.dev/privacy
- Lovable 公开数据处理协议：客户个人资料按服务所需处理，书面删除请求受安全、法律及备份例外影响。公开条款不等于核实项目签署了特定企业合同。https://lovable.dev/data-processing-agreement
- OpenAI 隐私政策：自身处理可能在美国或合作方、服务商所在其他地区进行，EPLUS 删除无法代替 OpenAI 独立处理。https://openai.com/policies/privacy-policy/
- 已将这些可核实的保留标准和跨境边界写入本地政策，不虚构所有服务商固定 7 天清除，也不声称该补充等于全部法律合规认证。

最新本地政策已结合官方说明和运营方确认转为正式版，待用户上传部署。尚未提交 OpenAI 上架审核。
