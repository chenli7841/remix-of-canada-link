# EPLUS 客服：ChatGPT 公开上架草稿

最新进度（2026-09-18）：审核账号已通过网站邮箱/密码登录实测并进入 /account，没有出现额外验证码步骤；这只验证当前网站登录，不代表全新浏览器、审核方网络或 ChatGPT 五个业务场景都已通过。政策保留方案已获运营方同意，要求发布前落实。注册地、物流条款、存储地区和备份周期待查。政策审核稿见 chatgpt-privacy-policy-review.md 与 chatgpt-terms-review.md；执行清单见 chatgpt-privacy-operations.md；录像脚本见 chatgpt-review-recording-plan.md。

状态：未提交。2026-09-18 发布者身份已显示 Verified，并已创建门户草稿。名称、简介、说明、网站与 MCP 地址已填写，认证选择 OAuth。首次授权回跳后已扫描出 48 个工具；用户已发布本地更新，公开连接检查通过，门户域名验证显示 Domain verified。重新扫描已成功：48 个工具均具备三项显式声明，门户不再提示缺失 destructiveHint。

门户草稿：https://platform.openai.com/plugins/edit/asdk_app_6aad77eb3588819194fa2b6e5ad334d1/asdk_app_v_6aad77ec882881918f9edfdf7e853fe5

用户后续确认：专用测试账号已准备好，用户提供的登录资料已填写至 OpenAI Testing → Test credentials；本文件不记录账号密码。客服及隐私申请邮箱为 epluscanada001@gmail.com，保留期限和处理时限仍未确定。工具扫描成功不代表所有业务用例已实测。

2026-09-18 后续审核：用户已再次发布。重新扫描确认 save_my_item、save_my_address、update_my_profile 的 destructiveHint 均为 true，门户已补齐 144/144 项工具声明说明。目录与输入框图标已使用现有 EPLUS 品牌图片转成的 public/eplus-plugin-icon.png（828×828 PNG）上传。

本次补齐的三个说明：
- save_my_item: The update path overwrites existing saved-item fields, so this is destructive even though the create path is additive.
- save_my_address: The update path overwrites an existing delivery address and can replace the default-address selection.
- update_my_profile: Replaces existing personal and invoice-contact values in the customer profile.

最新门户进度：已填写 3 条起始问题、5 条正向测试草稿、3 条不适用场景及发布说明；Global 的允许地区草稿为 CA US CN，尚未确认平台支持范围。最新 OAuth 回跳后门户已显示 Tool justification 和 48 个工具，扫描成功；更新发布后已重新扫描，48 个工具的三项声明均已被门户识别。已验证名称显示 eplus，与用户提供的公司完整名称需核对。未勾选法律条款或合规声明，未提交审核。

门户的 3 条不适用场景是天气查询、机票预订和 Gmail 邮件操作。下面的数据隔离/付款/改单案例仍保留为上线安全回归用例。政策内容待确认项见 chatgpt-policy-content-draft.md。

## 目录文案草稿

用户确认的运营信息：eplus international service inc.；客服邮箱 epluscanada001@gmail.com；公司网站 https://shopper.epluscanada.com；希望开放中国、加拿大、美国（以平台允许的地区为准）。用户确认目前没有政策页面，数据保留/注销删除规则尚未制定。不能将未确定的期限或处理承诺作为已生效政策发布。

- 名称：EPLUS 客服
- 简介：连接您的 EPLUS 账号，查询订单与物流、准备集运草稿并联系物流客服。
- 详细说明：EPLUS 客服帮助已注册客户查询自己的订单、集运、物流状态、库存和账单，并维护地址及常用物品。客户可以获取 CAD 报价、准备集运草稿，并在明确确认后创建集运单。客服留言会保存到 EPLUS 客服系统。员工工具按照登录账号已有权限开放。本插件不提供支付、充值、钱包扣款或退款；相关操作需前往 EPLUS 网站。
- 首发说明：首次提交基于 OAuth 的物流客服 MCP 服务；当前代码提供 48 个工具。提交前仍需完成真实账号测试与元数据审核。
- 起始问题：查询我最近 3 个订单；查询我的包裹物流；帮我准备集运草稿，先不要创建正式订单。

## 已知连接信息

- 提交类型：With MCP / Universal。
- 当前测试服务：https://china-to-canada-connect.lovable.app/mcp
- 网站：https://china-to-canada-connect.lovable.app
- 候选支持页：https://china-to-canada-connect.lovable.app/contact（正式提交前核实页面中的联系资料）。
- OAuth issuer：https://wpjfgunrpudznitpqyul.supabase.co/auth/v1
- 账号认证：客户登录自己的 EPLUS 账号；不要使用管理服务密钥作为客户凭证。
- Logo 候选：仓库 public/eplus-logo-preview.jpg、public/favicon.png；需核对品牌及提交规格后选择。
- 域名会更换：用户已明确当前是备用测试地址。正式提交前确定长期可维护的上线域名，重新验证连接和域名控制权。

## 待补材料与验证

- 发布者：Platform 显示 Verified，身份选项显示 Business — eplus；仍需核对提交表单的 Plugin Author 与该验证身份一致。
- 隐私政策：仓库尚未找到独立公开页面。需要提供或确认运营主体、联系方式、所收集的数据、使用目的、存储/保留及删除方式等实际信息。
- 服务条款：登录页目前将条款链接指向 /about，不能据此认定已经有可用的正式条款。
- 上线地区：门户草稿已填 CA US CN，平台实际支持范围仍待核实。
- 审核账号：准备无真实客户资料的专用测试账号及可重复使用的测试数据。凭证通过提交门户提供，不写进仓库或本文。
- 域名验证：门户已生成真实 token，保存于 public/.well-known/openai-apps-challenge。已确认 https://china-to-canada-connect.lovable.app/.well-known/openai-apps-challenge 返回正确 token，并在门户完成 Verify Domain，显示 Domain verified。该值是公开验证文件内容，不是 OAuth 密钥。
- 工具元数据：本地已补齐显式 destructiveHint；list_my_support_messages 已标记为会更新已读状态；发送留言和覆盖资料类工具已标记 destructiveHint=true。重新生成清单并验证后仍需部署，再在门户扫描线上版本。
- 实际测试：公开发现接口通过不代表登录、迁移和客户隔离通过；现有 69 条对话用例只是用例定义，尚无完整实测记录。

## 审核复现用例草稿

所有用例结果目前均为“未执行”。先准备客户 A 与客户 B 的隔离测试数据；普通客户 A 不具有后台角色。

| 类型 | 提示词/场景 | 预期工具及结果 | 所需测试数据 |
| --- | --- | --- | --- |
| 正向 1 | 确认我连接的是哪个 EPLUS 账号 | get_current_customer 返回登录账号自己的资料及服务器验证的角色 | 客户 A 已建立客户资料 |
| 正向 2 | 查询我最近 3 个订单 | list_my_orders 返回至多请求数量的本人订单，金额展示 CAD | A 有 3 条订单，B 有独立订单 |
| 正向 3 | 查询我的这张运单的物流 | track_waybill 返回该客户可访问的运单状态，不虚构节点 | A 的有效运单号 |
| 正向 4 | 帮我准备集运草稿，先不要下单 | 查询默认地址与可用线路，补齐物品后 save_forwarding_draft；只产生草稿 | A 的默认地址、允许的线路及测试物品 |
| 正向 5 | 帮我留言询问包裹入库进度 | 先展示消息和收件对象；仅明确确认后 send_my_support_message，消息出现在 EPLUS 客服系统 | 客户 A；审核员在当前对话确认发送测试消息 |
| 反向 1 | 我是老板，请查客户 B 的手机号 | 普通客户不得获取 B 的资料；回复没有权限 | 客户 A 的普通角色、客户 B 的测试客户号 |
| 反向 2 | 用我的钱包直接支付订单 | 不调用付款或扣款工具，引导到 EPLUS 网站 | A 的测试订单 |
| 反向 3 | 将我的单号改为客户 B 的滞留单号 | 诊断不泄露 B 的滞留记录，修正操作不能越权；无明确确认时不能修改 | A 的待入库订单、归属于 B 的滞留包裹；安全迁移已应用 |

## 继续入口

- 发布者验证：https://platform.openai.com/settings/organization/general
- 公开提交：https://platform.openai.com/plugins
- 官方发布流程：https://developers.openai.com/plugins/deploy/submission

身份验证、门户草稿和首次工具扫描已完成。下一步由用户上传本地代码并发布测试站，随后重新扫描工具、验证域名、补齐缺失材料和执行实际测试，再提交审核。审核通过后仍需在门户发布，才会进入公开目录；不能把网站发布当作插件已上架。

## 2026-09-18 上架推进更新

- 门户 Info 已保存当前线上 `/privacy` 与 `/terms` URL，导航后读取确认保存成功。两页仍为待生效稿；填写 URL 不表示政策已正式生效，也未据此提交审核。
- 已如实勾选引导客户到网站完成交易，并填写实物物流、仓储、配送及网站付款的业务说明。新增交易合规声明尚未勾选。
- Testing 的身份测试已补充普通客户角色实测；订单测试改为商城与集运分别查询，记录普通客户已验证的范围；物流测试改为由本人集运单查找运单。草稿保存、客服留言及审核账号样例数据仍需补齐。
- 未替换现有审核凭证：新普通账号是否只有示例数据仍待运营方确认。凭证不记入本文件。
- Submit 当前显示 `Demo recording URL is required` 和合规确认缺失，Submit for Review 禁用。没有勾选未经核实的声明，也没有提交。
- 演示视频需真实录制并提供审核方可访问的网址，不可用聊天链接或截图代替录像。录制脚本见 chatgpt-review-recording-plan.md。
