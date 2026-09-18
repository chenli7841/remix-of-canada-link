# SinoCargo Lovable 系统修改意见与 Claude 开发指导

版本 v3.0
代码根目录 C:/Users/zeyan/Desktop/代码/SinoCargo-Lovable
核查日期 2026-09-11

本文件取代基于错误 .NET 项目生成的所有系统修改意见。它仅是开发指导，本轮没有修改业务代码、数据库或后台页面。配套对外文档为 shipper-api-v3.md。

**v3 修订**：与用户逐条核实后更新四处——①一箱多品按线路是否要求箱数分两种情况处理；②客户归属本轮只做最小映射，不含 sales_user_id/结算字段；③客户分级改为有意复用现有线路可见性机制，且 ship 客户首单时自动设置分级（原 v2 的"不自动分配/不要联动"改为明确的例外）；④删除/编辑锁定信号确认为 forwarding_orders.intake_at。

## 1 改造目标

在现有 TypeScript、TanStack Start、Supabase 项目上增加 ship API，使其客户能够独立建档、在现有系统录集运单、待入库修改删除，并只按国内单号主动查询包裹及整单费用。

主要增加服务端接口和必要数据库函数，复用原后台入库、称重、量尺、费用及运单页面。不另建后台，不新增重复 ship 单号字段，不因接口响应长成树形就另建一套订单表。

另在现有客户分级增加 ship客户、owner 两个选项。**v3 修订**：owner 完全独立、无任何联动；ship客户 例外——首单建档成功时服务端自动设置（幂等），并作为线路可见性的判断依据之一（见 4 节），这是本轮明确要用到的既有机制，不是需要避免的联动。

## 2 已核实的代码和数据结构

以下为本地静态核查，不能替代已部署数据库检查。types.ts 可能落后于迁移，开发时以迁移完整链路和测试库实际结构相互验证。

| 业务 | 现有结构或入口 | 修改方向 |
|---|---|---|
| HTTP API | src/routes/api/public/ai-create-forwarding-order.ts | 参考 TanStack server.handlers 组织方式，新建 ship 路由，不复用微信身份 |
| 录单事务 | place_forwarding RPC | 复用或最小扩展，保留原调用方兼容性 |
| 集运订单 | forwarding_orders | 继续存现有表 |
| 国内单号 | forwarding_orders.domestic_tracking_no | ship SIP 单号直接写入，无新字段 |
| 集运号 | forwarding_orders.request_no | 返回作显示标识，不作为查询条件 |
| 逐箱运单 | waybills.forwarding_id、waybill_no、mark_no、box_no | 复用实际逐箱结构与发号 |
| 物品 | forwarding_items；waybills.items_summary | 保存订单物品和逐箱内件 |
| 客户资料 | profiles.id、customer_code、full_name、email、phone | 使用既有客户体系，独立客户映射另核查 |
| 联系地址 | profiles.reg_address、reg_city、reg_country、reg_postal_code、reg_province | 候选复用字段，先确认与注册资料的语义一致 |
| 收件地址 | addresses.user_id、recipient、phone、country、province、city、postal_code、line1、line2 | 按订单隔离使用，避免复用可变默认地址影响历史 |
| 线路 | shipping_routes.code、item_fields、item_field_required、起点仓和目的地设置 | 返回录单规则，复用现有验证 |
| 费用 | src/lib/orders.functions.ts、src/lib/duty.server.ts | 按真实业务口径只读输出，不另建费用来源 |
| 入库 | src/lib/orders.functions.ts、src/lib/receivings.functions.ts | 复用现有行为；新增必要事务检查而非改页面 |
| 客户分级 | src/lib/vip-levels.ts、public.vip_level、profiles.vip_level | 单独增加两个选项，防止已有联动被误触发 |

错误项目中的 DomesticNumber、OrderService.cs、Customer.IntegrationId、User.BelongsToId 等不是本仓库字段或入口，不可用于实施。也不再沿用“秒级发号可能冲突”的旧项目结论；当前号码生成器需独立核查。

## 3 客户识别和销售归属的真实缺口

现有 profiles 有客户号和资料字段，但本次查看的类型及关键词搜索未发现已建好的通用销售归属和 ship 外部客户 ID 映射。不能宣称其已经存在，也不能将 vip_level、company_code、user_id 直接当销售归属。

用户要求是：同一 ship 客户稳定复用独立本地档案；原有同人账户不合并；运单保留客户所有者，同时未来由 ship 销售账户结算。这需要可靠身份关系，单纯新建 HTTP 路由不能自动产生这种关系。

建议先查全量迁移、profiles 建档触发器及 auth.users 关系。如果确无可复用结构，最小补充一张合作方客户映射，建议字段：

- partner_key：例如 ship，来自凭证，不能由请求任意指定。
- external_customer_id：ship 客户唯一 ID。
- local_user_id：对应现有 profiles.id。
- 唯一约束 partner_key + external_customer_id，必要时约束本地独立档案映射唯一性。

**v3 修订**：sales_user_id 本轮不加。用户已确认：这一轮只建立"ship 客户 ↔ 本地 profile"的归属映射，结算/扣款账户怎么定，等后续单独做扣款端口、批量扣款端口和前端销售明细时再一起设计对应字段，不在这次 API 对接范围内。

仅映射关系，不复制姓名、邮箱、订单或费用。若系统需要通用销售归属，可将对应关系放在既有合适表或单独小表；以实际核查为准，不要求后台页面先显示才能完成 API 功能。

不把所有订单 user_id 都设成 ship，否则会丢失独立客户。也不能从最新客户分级推导结算账户。归属关系应稳定，后续若允许迁移需另定历史单结算归属，不在 v2 自动实现。

Supabase Auth 与 Profile 建档必须特别核实：相同真实邮箱可能已属于原账户，不能调用按邮箱匹配然后复用原用户。也不能凭空生成一个不存在的 Auth UUID 插入受外键限制的 profiles。选择现有支持的非登录客户机制；若必须通过 Auth Admin 建身份，应设计不向客户发邀请、不获取后台角色、不覆盖真实联系邮箱的流程。

Auth Admin 与数据库事务不能假装属于一个原子事务。应保证建档可恢复、映射幂等，失败不遗留可用半单；补偿只能处理此次创建且未被引用的身份，不碰既有用户。

## 4 线路授权与新增分级严格分开

现有 src/lib/wechat-ai-routes.server.ts 明确包含微信专属限制：YW 仓库、wechat_ai_enabled、VIP 和客户号可见性，并返回 price_text。ship 不能直接复用完整微信线路列表方法，否则会错误限制仓库、继承微信开关或泄露价格。

可提取一般线路字段验证。本地只核验 ship 获授权线路及提交资料。

**v3 修订，推翻 v2 本条**：用户已确认这是有意设计，不是要规避的副作用——ship 客户的线路可见性就是要通过"把该客户分级设为 ship客户，再在线路管理页面的『可见客户等级』勾选 ship客户"这条现成机制实现，不需要另外建一套 ship 专属线路授权配置。已核实 `src/lib/wechat-ai-routes.server.ts` 里的 `isRouteVisibleToCustomer(route, customerCode, vip)` 是一个跟微信解耦的纯函数（只看 customerCode/vip 两个参数，不读微信专属字段），可以直接复用；`admin/routes.tsx` 里"可见客户等级/黑名单客户等级"勾选框已经是通用 UI，不需要改。也就是说 VIP_LEVELS 数组会被线路配置界面枚举这件事本身不是风险，是这次要用到的能力；唯一要注意的是新增 ship客户、owner 两个值之后，把所有引用 vip_level 的地方过一遍，确认除了路由可见性之外没有别的地方（比如定价、权限分支）意外因为新枚举值而改变行为——本地抽查未发现 vip_level 直接驱动定价/权限的分支代码，但这不是穷尽式结论，正式实现前仍需逐处确认。

数据库 public.vip_level 现为 normal、silver、gold、diamond。增加两个独立值 ship、owner（中文显示 ship客户、owner——用户已确认用 owner 而不是 v2 建议的 general_manager）及类型、标签、颜色映射即可；不得给这两个值附加与线路可见性无关的其他特殊业务分支。**v3 修订**：不需要拆分 VIP_LEVELS 数组，这是有意复用而不是需要规避的耦合（见上）。**v3 新增**：ship 客户首单建档成功时（customerCreated=true 这一次，不是每次下单），服务端在同一事务/紧接着的一步里把该本地 profile 的 vip_level 设为 ship；这是对"不自动分配分级"原则的一个刻意、唯一的例外，仅在这一个触发条件下生效，不适用于 owner 或其他任何分级。必须保证幂等：同一 Idempotency-Key 重放建单请求不能重复触发或报错，用"若当前不是 ship 客户分级才设置"这种条件更新即可，不需要额外的幂等记录。

## 5 集运录单和多箱复用

核查的迁移 supabase/migrations/20260904150000_fix_parent_status_trigger_bulk_insert.sql 中，place_forwarding 接收 payload 和 _target_user_id，创建 forwarding_orders、forwarding_items，再按每行物品 extras.box_count 循环生成 waybills，调用 recompute_mark_nos_for_parent 和 recompute_parent_status。

新增 ship 入口在服务端鉴权后解析外部客户映射，再传入正确 local_user_id。不能允许调用方自由指定 _target_user_id、customer_code、销售账户。使用 service_role 的服务器路径必须自己严格做归属校验，RLS 不会替 service_role 自动隔离。

外部 packages 是实际包裹数组，允许一箱多种商品。现有 RPC 按每行物品生成箱子的方式不等于一箱多物品：不能把一个两种商品的箱子拆成两箱。应在原函数兼容分支或独立封装 RPC 中准确映射 packages，复用同样的 waybills 表和发号触发器。测试既有网页和微信录单不受影响。

**v3 新增，已核实**：place_forwarding 的建箱循环（20260904150000_fix_parent_status_trigger_bulk_insert.sql 第 210-234 行）是"每个物品行 × 该行 extras.box_count"各自建箱，且 v_total_boxes=0（没有任何物品声明 box_count）时整段建箱逻辑（含 recompute_mark_nos_for_parent/recompute_parent_status）完全跳过，只建 forwarding_orders 与 forwarding_items——这正是海运（箱数未知）线路目前的实际行为，不需要改。与用户核实：箱数已知线路走独立封装的新建箱逻辑（按 Shipper 提交的 packages[] 直接生成 waybills，一箱的 items_summary 存该箱全部物品，不复用 place_forwarding 现有"一物品一箱"的循环）；箱数未知线路直接复用 place_forwarding 现有的"零箱"分支，不新增代码。items_summary 本身已经是数组结构，computeWaybillDeclaredCad()（orders.functions.ts 第 194 行）已经是对整个数组求和，不是只取第一项，不需要改数据结构。

place_forwarding 当前返回 id、request_no、waybills 数量，并不返回所有号码。封装需在成功后查本次 forwarding_id 的 waybills，将 waybill_no、mark_no、box_no 等真实值作为打印数据返回。

当前 RPC 对声明单价含固定汇率换算逻辑。不能不经核查直接沿用到新 API，更不能把运输费用混成商品单价。确定各线路申报币种与现有汇率来源，接口以真实规则验证，声明价值和运费分别处理。

创建后是否仍为 pending 需结合 recompute_parent_status 和触发器核查。不能以“SQL INSERT 初始 pending”推断最终所有状态。待入库要求不能通过单一表面状态错误判断。

## 6 修改删除及精确查询

API 建议路径统一 /api/partners/v1。具体 HTTP、字段、错误结构见配套文档，可通过薄 DTO 将 camelCase 映射到现有 snake_case，不增加重复字段。

查询以已鉴权 ship 范围关联到的 forwarding_orders.domestic_tracking_no 精确匹配。不能使用现有后台 ilike 多字段搜索，也不能用 request_no、tracking_no、waybill_no、aliases 回退。现有微信入口会去空格并大写，新 ship 接口不能无说明继承该号码转换。数据库字符串规则必须与文档精确匹配约定一致。

同一国内单号的新建去重应在 ship 范围内完成，不对所有历史客户的国内单号强加全局唯一。若发现历史同归属多主单重复，返回可诊断冲突，不能随意 first/maybeSingle 后选一单。

客户更新仅更新该映射对应 profile，订单地址不能引用可被这次更新改变的对象。若复用 addresses，创建订单专用地址记录或现有可靠快照机制，不直接覆盖用户全局默认地址。

待入库修改及删除须在数据库事务中锁定主单与有关 waybills，并核验实际入库记录、intake_at、子单状态和扫描关系。存在真实入库事实时禁止覆盖；状态人工回退不能自动解锁。先复用既有入库事实来源，不预设新字段。

Supabase 多次 REST update 不构成一个事务，不能先在 TypeScript 查询状态、稍后分步写表就称为原子操作。必要时增加最小 RPC，白名单写入物品、地址和箱数据，并调用现有父状态、唛头维护逻辑。

稳定 clientPackageId 可在现有合适 JSON 中保存明确元数据，或增加最小字段/映射；先检查现有用途，不能覆盖 items_summary 的物品数组格式。删除包裹后返回移除号码，剩余号码稳定；箱序号/唛头变化应按现有规则重新生成并返回重印数据。

对外稿采用 editToken，优先使用既有 updated_at 与关联数据形成可靠聚合令牌，不能只用主单 updated_at 假定每个子单变化都会同步。令牌检查与写入必须同事务。参考 chatgpt_owner_update_forwarding_basic_info 的并发思想，但不要让合作方获得 owner 管理角色或复用其宽权限。

删除执行现有外键/扫描约束兼容的业务操作；成功查询可 404，不强制新增墓碑字段。已有包裹被关联入库/计费时不得级联误删。接口改号功能不包括修改国内单号，国内单号错填按待入库删除后使用新号码重建。

**v3 修订，已与用户确认**：editable/deletable 统一只看 forwarding_orders.intake_at 是否为空：intake_at 为空（仓库尚未开始收货）才允许整单编辑/删除，一旦仓库开始收货（intake_at 有值）立即锁定，不区分部分/全部收货——不需要新字段，也不需要比 intake_at 更细的判断。

**v3 新增，已核实**：海运（箱数未知）订单不建 waybills，因此无法出"每箱一张面单"；已确认 label-templates/standard.ts 第 16 行本来就有 `d.waybills?.length ? d.waybills : [{waybill_no:"—"}]` 这个兜底——没有真实箱号时用占位符出一张整单参考面单，国内单号正常显示。ship API 的 labelData 直接复用这个已有能力即可，不需要新逻辑。

## 7 费用只读适配

本项目已有 waybills.freight_cad、duty_cad、insurance_cad、clearance_cad、surcharge_cad，集运表则有 fee_cny、customs_cny、insurance_cny、freight_snapshot。不同后缀及历史算法并存，不能直接累加所有金额。

src/lib/orders.functions.ts 存在计算并写库的费用方法，也有整单聚合及托盘、整柜等口径。查询不得调用会持久化、重算或扣款的方法。应提取纯读取结果适配或现有可靠账单快照读取。

先制作费用映射表：每项 API code 对应真实字段或账单来源、币种、是否已经包含在总额、是否按整单分摊、什么时候能证明有确定值。涉及派送费、关税、保险、附加费都要核实，不能只凭英文字段名猜测。缺乏可靠值时返回 null，不编造费用。

内部逐箱计算保持原样，对外整单只汇总一次。使用 decimal/数据库 numeric 口径避免浮点误差。fees.complete 只能来自可证明的完整性，不能因金额字段默认 0 就返回已计费。

普通凭证完全省略 fees；管理凭证仅返回我方向 ship 的结算费用，不含供应商成本、内部备注或原始账单敏感信息。客户销售价不属于本地录单请求。本版不扣款、不以余额拦截首次录单。

## 8 API 安全与最小必要持久化

建议服务端独立 Token 绑定 ship 账户和 scopes，不修改既有微信接口、MCP OAuth 或网页登录。使用 TanStack server handler 与 server-only Supabase client；service_role 密钥不进入客户端 bundle。

鉴权上下文决定客户和订单范围，请求不得任意指定本地用户。API 来源字段不是权限证据。路线权限和费用权限分别校验。错误不输出 SQL、堆栈或其他客户存在信息。

幂等必须覆盖并发和超时。可利用已有持久化机制或最小请求记录表；不要求完整合作方平台。原 key 同方法路径正文重放，原 key 不同正文拒绝，成功记录与建单事务关联。建议 7 天保存期须与实现一致。

如果客户映射/幂等确无存储位置，适量新增技术表是实现已确认需求的必要支持，不能为了“只加接口”使用进程内 Map 假装多实例可靠；也不应预设十几张业务表。

## 9 Claude 实施顺序和文件清单

1. 读取 AGENTS.md，检查 git status，保留未跟踪 .claude/ 等用户内容。不改写 Lovable 已发布历史，不 force push、rebase/amend/squash 已推送提交。
2. 核查所有 place_forwarding 定义及其触发器，生成实际客户、线路、订单、箱号、地址、状态、费用映射清单。
3. 落定最小客户映射和凭证配置，处理独立 Auth/Profile 身份，不邀请或合并原客户。
4. 增加 src/routes/api 下 ship API server handlers 和 src/lib 下 server-only 编排及 DTO 校验。路由必须通过项目现有生成机制注册，不手改生成文件硬凑。
5. 将创建、覆盖修改、删除及并发条件放进可靠事务边界；仅必要时新增 supabase/migrations 中的小范围迁移或 RPC。
6. 实现只读精确查询、费用过滤、线路字段适配和打印数据。
7. 增加 ship客户、owner 两个分级选项，更新必要生成类型/映射；owner 无业务联动，ship客户 按 4 节的自动设置 + 线路可见性方案接入。
8. 测试并同步对外文档，使用实际实现替换待确认项。

重点文件：src/routes/api/public/ai-create-forwarding-order.ts、ai-forwarding-options.ts、src/lib/wechat-ai-routes.server.ts、src/lib/orders.functions.ts、src/lib/receivings.functions.ts、src/lib/duty.server.ts、src/lib/vip-levels.ts、src/lib/admin.functions.ts、src/integrations/supabase/client.server.ts、types.ts、supabase/migrations。

只读参考原后台 src/routes/admin 和 src/routes/_authenticated 下集运/仓库流程，不以实现 API 为由改页面。根据真实缺口对公共服务做小范围兼容调整。

## 10 验收要求

| 场景 | 必须结果 |
|---|---|
| 原本已有同邮箱客户 | ship 独立建档，原账户和登录不变 |
| 同客户并发首次下单 | 只产生一条有效 ship 客户映射 |
| 同国内单号重试 | 不重复订单、箱号；同号不同内容明确冲突 |
| 一箱多物品及多箱 | 实际箱数准确，返回真实 waybill_no 和内件，不按商品行错误拆箱 |
| API 创建后原后台处理 | 能在原后台查看、入库、测量、计费，无页面改版 |
| 修改和入库竞争 | 只有合法事务成功，不覆盖已入库数据 |
| 客户资料更新 | 不改变历史运单收件资料 |
| 精确查询 | 仅 domestic_tracking_no；不能用本地号、箱号或其他客户号码访问 |
| 费用查询 | GET 无写副作用；整单金额不重复；普通凭证无 fees |
| 新分级 | **v3 修订**：owner 分级仅选项增加，无默认设置、权限、销售或线路联动；ship客户 分级仅在"ship 客户首单建档成功"这一个条件下由服务端自动设置（幂等，重放不重复触发），不适用于其他任何场景；线路可见性联动是本轮明确要用到的既有机制，不是需要避免的副作用——验收时应确认"除首单自动设置 + 线路可见性联动之外，没有别的隐藏联动"，而不是要求完全没有联动 |
| 兼容性 | 原网页、微信 AI 和 MCP 既有流程仍可用 |

使用 package.json 中现有构建与校验脚本，先查看 lockfile 确认包管理器，不升级依赖。针对新增逻辑增加有意义测试，数据库事务需数据库集成验证，不只用 Mock。涉及共享 MCP 逻辑时运行相关校验，否则不要为不相关能力扩大范围。

不连接生产试单，不执行生产迁移，不自动部署。若需要测试库或真实费用规则才能完成某项，清楚记录未验证项，不能宣称已通过。

## 11 交付内容

交付代码、最小迁移及回滚/兼容说明、环境变量占位模板、字段和费用映射、真实 API 示例、构建与测试结果、剩余事项。任何新增字段/表需逐项说明为什么现有结构无法复用。

配套 API 是评审稿，不代表服务器已实现。将实现与契约的差异在联调前统一，尤其客户身份创建、多箱混装、状态聚合、号码规则、费用完整性及分级与现有线路筛选的隔离。

## 12 可直接交给 Claude 的指令

请在 C:/Users/zeyan/Desktop/代码/SinoCargo-Lovable 实现 ship API。先读 AGENTS.md、本文件和同目录 shipper-api-v3.md。ship SIP 单号直接存 forwarding_orders.domestic_tracking_no，复用 place_forwarding、forwarding_orders、forwarding_items、waybills、profiles、addresses 和现有后台仓库费用逻辑。不得采用此前错误 .NET 项目的文件或字段，不改版页面，不建立第二套业务表，不做扣款或推送。客户分级只增加 ship客户 和 owner 两个选项，其中 ship客户 在首单建档成功时由服务端自动设置（幂等）、并驱动线路可见性，owner 无任何联动。重点核实客户销售映射缺口、Auth 同邮箱独立身份、箱数已知/未知两种线路的建单方式、数据库原子更新、整单费用去重及 service_role 归属隔离。按文档执行最小实现并验证，不改写 Lovable 已推送历史，不改无关文件，不连接生产试单或自动部署。
