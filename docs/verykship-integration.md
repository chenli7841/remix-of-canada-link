# VerykShip / eplus 接口层

本模块只提供服务端能力、共享数据结构和测试。**没有加入页面、导航、按钮或自动运行任务**。未来的调用入口、数据显示位置、客户购买权限和费用展示方式由产品设计另行确定。

## 当前能力

- 获取订单、集运单、运单、箱号、托盘或批次的发货上下文。
- 查询实时服务与价格；统一使用 kg/cm 输入，调用 account 接口读取实际账号单位后转换。
- 条件选择：币种、承运商白名单、服务白名单、最高报价、最晚预计送达日期；按最低价或最早预计送达排序。未知日期不参与时效条件匹配；没有匹配结果不会降级为任意服务。
- 保存不可变报价快照（10 分钟有效）；正式购买前重新校验货物结构、单位、价格、币种和预计时效。
- 创建平台运单、持久化各件跟踪号、读取共享记录、获取官方 PDF 面单（用于后续预览、下载和打印）。
- 查询订单状态、按平台订单号核对结果不明的创建请求、取消面单并核对平台最终状态。
- 承运商签名字段映射（UPS、Canada Post、FedEx、Purolator）；整托重量/尺寸、描述、FedEx/Day & Ross 尾板和 Day & Ross 预约时间字段。

自动选择仅产生推荐，不会自动购买。购买接口必须显式传 `confirmed: true`，且服务端开启购买开关。打印本身由未来调用方使用 PDF 内容实现；本模块不操作打印机。

## 上线配置

先在目标 Supabase 项目应用 `supabase/migrations/20260928150000_express_shipping.sql`。本次开发未对远程数据库执行迁移。

服务端环境变量（不要加 VITE_ 前缀、不要提交密钥、不要把密钥放在客户端）：

| 变量                           | 说明                                           |
| ------------------------------ | ---------------------------------------------- |
| `VERYKSHIP_ENV`                | `sandbox`（默认）或 `production`               |
| `VERYKSHIP_SANDBOX_APP_ID`     | 测试站单独注册的应用 ID                        |
| `VERYKSHIP_SANDBOX_APP_SECRET` | 测试应用密钥                                   |
| `VERYKSHIP_APP_ID`             | 正式 eplus 应用 ID                             |
| `VERYKSHIP_APP_SECRET`         | 正式 eplus 应用密钥                            |
| `VERYKSHIP_PURCHASE_ENABLED`   | 只有精确设置为 `true` 才允许创建订单；默认关闭 |

生产和测试环境隔离凭据及记录。测试站为 `https://3hlrnj-shipper.veryk.dev`；生产站为 `https://www.verykship.com`。首次正式下单前需要平台开通生产权限。本次没有读取、配置或重置 eplus 密钥，也没有真实询价、下单或扣费。

## 调用契约

入口为 `src/lib/express.functions.ts`，采用项目现有 TanStack Start authenticated server functions；内部服务为 `express-service.server.ts`。这不是公开 HTTP / 第三方 REST API，也没有添加匿名代理。未来 React 页面可通过 `useServerFn` 调用，服务端业务可复用内部服务但必须传递经过验证的用户上下文。

| 函数                  | 输入                                  | 输出/效果                                                                         |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `getExpressWorkspace` | `{kind, id}`                          | 权限校验后的货物上下文、可选交运单位、默认规则、配置状态及最近 100 条相关发货记录 |
| `quoteExpress`        | `{draft, rule}`                       | `{id, rates, recommendation, expiresAt}`；报价保存到服务器；不会下单              |
| `buyExpress`          | `{quoteId, rateKey, confirmed: true}` | 返回本地发货记录 `{id}`；用共享记录读取最终状态，不应把响应成功当成平台下单成功   |
| `refreshExpress`      | `{id, providerId?}`                   | 刷新平台状态；人工关联时校验完整参考号与服务 ID；providerId 只允许员工提供        |
| `labelExpress`        | `{id}`                                | `{mime_type, file_name, base64}`；仅返回经 PDF 文件头检查的官方面单               |
| `voidExpress`         | `{id, reason, confirmed: true}`       | 提交取消原因并刷新状态；仅平台明确取消后才释放重复发货保护，不代表退款已到账      |
| `saveExpressSettings` | `{origin, rule}`                      | 员工保存默认发件地址和规则，不含密钥                                              |
| `getExpressOverview`  | 无                                    | 员工获取当前环境最近 100 条记录及默认配置                                         |

`kind` 为 `order / forwarding / waybill / carton / pallet / batch`，`id` 为对应表 UUID。已有运单的订单必须选择实际运单；批次只作为聚合读取入口。整箱/整托直接选 carton/pallet，下属件分别派送则逐件调用。

`draft` 类型和校验定义在 `src/lib/express.ts`：

- `source`: 交运单位，不能直接对 batch 下单。
- `leg`: `last_mile / first_mile / transfer`，同一运输段防重复；不要通过切换运输段绕过保护。
- `from / to`: 姓名、电话、国家两位代码、省、市、邮编、地址、地址类型等。
- `packageType`: `parcel / pallet`，与交运单位匹配。
- `packages`: `{weightKg, lengthCm, widthCm, heightCm}[]`，全部必须为正数；不会自动用体积重或子件汇总重量替代实测包装数据。
- `description`, `signature`, `liftgate`, `pickupDate`, `pickupStart`, `pickupEnd`。
- `printSize`: `thermal / letter / default`，映射已支持承运商格式，其他服务使用平台默认。

报价 `price` 是平台 `services.charge`，`tax` 是单独返回的税额，不二次叠加，亦不擅自保证所有服务含税。未来界面应保留平台报价口径，并提示承运商复核可能调整最终费用。`actual_price` 保存订单详情的 `price.charges` 明细，保留币种。

## 数据与安全

新增五张 RLS 表：`express_settings / express_quotes / express_shipments / express_unit_locks / express_labels`。匿名和 authenticated 数据库角色不能直接读写，只由校验身份的服务端访问。标签含收件地址等个人资料，不能公开缓存或公开分享。

普通客户可对自己货物查询报价、读取和打印自己的记录；员工可购买及管理。跨多个客户的整箱/整托记录不会授权给单个客户读取。这里复用现有 `is_staff` 角色判定；未来如需更细的购买限额、客户钱包扣款或特定角色权限，需要单独确定，当前不会改动商城/批次计费。

不覆盖 `domestic_tracking_no` 等原字段，也不推进原订单/批次状态。跟踪号、平台状态及费用均在独立记录中保存，通过 `links` 关联订单、运单、箱号、托盘和批次，避免误覆盖其他运输段的信息。

购买预留通过 SQL RPC 原子执行，按账号、运输段和覆盖货物加锁；箱托盘与内部运单交叉调用不能重复买。购买前检查货物快照；创建后如果发生装箱调整，现有面单仍代表创建时的货物，不会自动随调整重新签发，操作方必须先处理原面单。

创建请求永不自动重试：超时或返回异常会保留 `unknown`，锁继续存在。平台成功但本地保存失败时也必须核对，不能重新调用 create。参考号 `EP-<本地UUID无连字符>` 可用于平台查单；找到订单后用 `refreshExpress({id, providerId})` 关联。若平台确认根本没有创建订单，当前不提供自助释放接口，应由维护人员核对平台记录后做受审计的数据修复，不要直接再次扣费。取消请求成功后还会读取平台状态，未确认取消不会释放锁。

## 当前边界

- 支持同一国家境内运输；跨境申报商品、关税条款、Elink / Manifest 提交流程尚未接入，跨境请求会明确拒绝。
- 没有自动批量扣费、后台自动派单、物流轨迹轮询、Webhook 或自动预约任务。
- 只提供 PDF 面单，不重绘官方条码，不生成打印机专用 ZPL；发票单独打印的 UI 尚未确定。
- 超过 1000 个关联货物时拒绝聚合处理，避免数据库截断造成漏锁；应按箱托盘分批调用。
- 真实账号服务可用性、平台响应差异、打印效果和 SQL 在目标库运行需要测试环境联调。没有凭据时不能声称已连接成功。

## 验证

`npm run test:express`：纯规则、单位转换、官方签名、请求脱敏、权限、并发预留、报价变化与超时处理测试。测试通过模拟服务与数据库预留验证应用逻辑，不调用生产 API；真实 PostgreSQL RPC 并发行为需在测试库迁移后验证。

联调顺序：测试库迁移 → 配置测试凭据 → 查询 account/报价验证单位与费用口径 → 明确确认的测试下单 → 获取 PDF → 多入口读取同一记录 → 重复/超时场景 → 取消并核对。完成后再开启正式购买开关。

官方依据：[认证](https://www.verykship.com/document/start/authorize)、[账号单位](https://www.verykship.com/document/general/Account)、[询价](https://www.verykship.com/document/shipment/quote)、[创建订单](https://www.verykship.com/document/shipment/create)、[获取面单](https://www.verykship.com/document/shipment/label)、[取消](https://www.verykship.com/document/shipment/void)。
