# ChatGPT 域名与数据库迁移更新（2026-09-22）

## 最新结果：2026-09-23 已重新提交审核

- 用户发布新验证文件后，OpenAI 门户显示 Domain verified。
- 使用普通测试账号完成新的 OAuth 授权后，重新运行 Scan Tools；提交页校验通过，Submit for Review 可用。
- 已重新提交 EPLUS 客服 1.0.0。门户明确显示 `Plugin review submitted.` 和 `EPLUS 客服 submitted for review`。
- 本次提交使用 https://shopper.epluscanada.com/mcp 和新 Supabase 项目 fhfsrrbzubgjrjhgwerv；客服、隐私、条款链接均已更新。
- 当前为已提交待审核，并非已批准或公开上架。本次没有重新执行全部业务测试；此前记录的迁移与运营核对事项仍应按实际情况落实。
- 下方草稿与待提交描述为本次操作的历史过程，以本节最新结果为准。

## 2026-09-23 门户更新进度

- 用户明确授权取消旧审核、更新地址后重新提交。1.0.0 已从 Review 退回 Draft。
- 门户已保存新 MCP 地址、客服/隐私/条款网址；DCR 注册、authorize、token、issuer、resource 以及 OIDC 地址已切换新项目。
- 新域名的 OAuth 授权页可以打开，但当前网站会话是管理员邮箱，未批准该账号授权。后续需使用普通专用测试账号并由用户完成授权。
- 新域名要求的新公开验证 token 已写入 public/.well-known/openai-apps-challenge；需要用户上传发布后再验证域名。
- 工具重新扫描及再次提交尚未完成，当前不在审核队列中。

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
