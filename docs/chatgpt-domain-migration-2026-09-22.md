# ChatGPT 域名与数据库迁移更新（2026-09-22）

## 当前目标

- 网站：https://shopper.epluscanada.com
- MCP：https://shopper.epluscanada.com/mcp
- Supabase：https://fhfsrrbzubgjrjhgwerv.supabase.co
- OAuth issuer：https://fhfsrrbzubgjrjhgwerv.supabase.co/auth/v1
- 隐私政策：https://shopper.epluscanada.com/privacy
- 条款：https://shopper.epluscanada.com/terms
- 客服：https://shopper.epluscanada.com/contact

本记录覆盖旧连接手册中的当前域名和数据库地址；历史测试记录不代表新环境已完成相同测试。

## 已完成的本地更改与核对

- MCP 账号注册/登录链接默认域名改为 shopper.epluscanada.com。
- `.env.example` 的 MCP_PUBLIC_SITE_URL 和公开连接探测脚本默认域名同步更新。
- 前端 Supabase URL、supabase/config.toml 和 MCP manifest 已使用新项目，本次未重复修改。
- `npm run mcp:validate` 通过，包括配置一致性、迁移文件静态校验和 4 项 OAuth 测试。静态校验不代表线上数据库已执行迁移。
- 新网站公开探测通过：OAuth 资源元数据指向新项目、未登录 MCP 返回 401 及正确授权发现地址、新 Supabase OAuth 发现接口正常。

## 发布与控制台待办

1. 用户上传并发布本次本地更改。发布环境 MCP_PUBLIC_SITE_URL 必须为 https://shopper.epluscanada.com；若仍配置旧值，会覆盖新的代码默认值。
2. 核对服务器 SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY、SUPABASE_SERVICE_ROLE_KEY 均属于新项目；私密密钥仅放服务器 Secrets，不写到聊天或前端。
3. 核对 Supabase Auth 的 Site URL、登录回跳允许列表、OAuth 授权确认页（https://shopper.epluscanada.com/.lovable/oauth/consent）和 OpenAI OAuth 客户端/回调配置。按控制台实际授权方式配置，不盲目沿用旧项目客户端凭据。
4. OpenAI 提交资料同步上述 MCP 和政策地址，按门户要求重新验证新域名、扫描工具、完成 OAuth 并核对测试凭据。当前审核版本能否编辑、是否需撤回重提，须根据门户当前状态处理；本次没有撤回或重新提交。
5. ChatGPT 测试连接更新地址（不可编辑时重建），用普通客户账号重新授权；核对 yanze 在新项目中的登录、演示数据和角色，再测试查询、草稿、客服留言和客户数据隔离。
6. 核实新项目的地区、套餐、备份和日志保留设置。现行隐私政策仍写加拿大中部、Pro 每日备份及 7 天窗口，不能据旧项目的核验结果认定新项目相同；待核实后按实际情况修订。
7. 新连接与审核资料切换完成前保留旧服务可用，避免审核人员使用旧提交地址时无法测试。

本次未修改线上设置、数据库、OpenAI 提交状态，也未测试登录或业务数据。
