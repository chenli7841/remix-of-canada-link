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

EPLUS 业务审计表清理规则、Storage 文件生命周期、额外导出或日志转存、Lovable 网站部署日志及 OpenAI 等其他处理环节的实际地区/保留安排。人工申请与删除流程是否落实、审核账号是否仅含示例数据仍等待运营方回答。

本次更新只补充已核实事实，不把待生效政策转为正式生效，不进行公开上架提交。
