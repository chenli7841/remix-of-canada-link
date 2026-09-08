# EPLUS ChatGPT App 连接与测试手册

本手册用于数据库迁移完成、代码发布以后，将 EPLUS MCP 服务连接到 ChatGPT。开发阶段不需要 OpenAI API Key；ChatGPT 负责对话，EPLUS 只提供经过 OAuth 和账号权限保护的工具。

## 1. Lovable 发布环境变量

确认 Lovable Cloud 已配置以下变量。只核对变量名称和是否存在，不要复制或公开它们的值。

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（仅服务器端；绝不能使用 `VITE_` 前缀）
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

EPLUS ChatGPT App 本身不需要 `OPENAI_API_KEY`。现有微信 AI 通道如仍保留，使用它自己的 OpenAI/Lovable 配置，和 ChatGPT App 是两条独立通道。

仓库历史中曾跟踪 `.env`，但当前检查确认其中只有 Supabase 项目标识、URL 和 publishable key，没有 Service Role、OpenAI 或邮件密码。现在 `.env` 已加入忽略规则；提交代码前需停止跟踪该文件，保留 `.env.example`，不要把本地值提交到 Git。

## 2. 发布后公开地址

优先使用 EPLUS 正式域名：

- MCP：`https://shopper.epluscanada.com/mcp`
- OAuth 受保护资源元数据：`https://shopper.epluscanada.com/.well-known/oauth-protected-resource`
- EPLUS 授权确认页：由 Supabase OAuth 流程自动跳转到 `/.lovable/oauth/consent`

如果正式域名尚未指向本次 Lovable 发布，先用 Lovable 给出的实际 HTTPS 预览/发布域名替换上面的域名。不要使用 `localhost` 作为 ChatGPT 的正式连接地址。

## 3. 发布后连通性检查

先在浏览器访问受保护资源元数据地址，预期返回 JSON，并包含 EPLUS 的 Supabase Auth issuer。访问 `/mcp` 未携带令牌时应返回 OAuth/未授权响应，而不是泄露客户数据。

本地生产构建预览使用 `npm run build` 后执行 `npm run preview -- --host 127.0.0.1 --port 4174`。当前为 Nitro/Cloudflare 输出，不要使用旧的 `vite preview` 启动方式。

可使用 MCP Inspector 做开发测试：

```powershell
npx @modelcontextprotocol/inspector@latest
```

然后输入完整 MCP 地址，包括 `/mcp`。检查能发现 42 个工具、OAuth 可以登录、普通客户只能看到自己的数据。

## 4. 在 ChatGPT 中连接

根据 OpenAI 官方当前流程：

1. ChatGPT → Settings → Security and login → 打开 Developer mode。
2. 进入 ChatGPT Plugins，点击加号。
3. 名称填写 `EPLUS 客服`，说明填写 `查询和管理 EPLUS 物流业务；所有客户金额均为 CAD；不支持支付。`
4. Connection 选择公开 MCP 地址，输入 `https://shopper.epluscanada.com/mcp`。
5. 创建连接，检查 ChatGPT 发现的工具和说明。
6. 点击连接/授权，登录客户自己的 EPLUS 账号，并在 EPLUS 授权页批准。
7. 新建对话，从工具菜单加入 EPLUS 连接后开始测试。

Developer mode 是否可用取决于 ChatGPT 账号及工作区策略。若当前账号看不到该开关，需要由工作区管理员开放，或使用具有该能力的测试账号。

## 5. 首轮测试提示词

- `确认我现在连接的是哪个 EPLUS 客户账号。`
- `查看我最近 5 个订单，所有金额只显示加币。`
- `查询我的库存和仓储费，但不要支付。`
- `帮我保存一个集运草稿，先不要创建正式订单。`
- `把这个草稿的物品、线路、地址和 CAD 总价完整列出来。`
- `我确认创建这张集运单。`
- `帮我支付这张订单。`（预期：引导至 EPLUS 网页，不调用支付工具。）
- 使用普通客户账号：`查看后台待处理集运。`（预期：只回复“没有权限”。）
- `把我所有订单的全部资料都列出来。`（预期：只给数量/状态概况和最多 3 个编号，再询问时间范围或状态，不批量展开。）

## 6. 大量信息的对话规则

- 请求不明确时，GPT 先询问要查订单、集运、运单、账单、库存还是流水。
- 查询超过 5 条时，只显示简短数量/状态概况和最多 3 个记录编号。
- GPT 应询问时间范围、状态、单号、客户或业务类型，缩小范围后再继续。
- 只有客户选定具体记录后，才打开完整详情。
- 后台账号即使有权访问，也不得无必要地批量展示客户个人资料。

## 7. 图片、文件和语音输入

- ChatGPT 负责理解客户提供的图片、文件或可用的语音转写，再把结构化文字字段传给 EPLUS 工具。
- EPLUS 不再调用另一套隐藏 OCR 或 OpenAI API，也不保存原始附件。
- 单号、邮编、数量、尺寸、重量、HS 编码和 CAD 金额不清楚时必须追问，禁止猜测。
- 从图片或语音提取出的地址、物品或集运草稿，必须先逐项展示给客户确认，确认后才能保存。

## 8. 工具更新后的刷新

每次工具名称、说明、输入字段、注解或 OAuth 配置发生变化后：

1. 重新生成 `.lovable/mcp/manifest.json`。
2. 发布或重启 MCP 服务。
3. 在 ChatGPT Plugins 中打开 EPLUS 连接并选择 Refresh。
4. 新建对话，重新执行受影响的测试提示词。

OpenAI 官方参考：

- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/auth
