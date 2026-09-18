# Shipper 运单 API 对接文档

版本：v2.0 对接评审稿｜日期：2026-09-11｜接收方：Shipper（ship-cheap.com）开发团队

本文取代此前版本，依据 SinoCargo-Lovable 项目重新核对。接口尚未上线，本文用于开发和联调准备。正式域名、凭证、真实线路规则和上线限制由服务方提供。以下协议是本版建议契约，示例数据非真实订单；标注为待确认的事项应在正式联调前冻结。

## 1. 对接范围

Shipper 在自己的系统完成登录、客户资料、地址簿、客户线路分配和销售价格管理，通过 API 在服务方系统建立运单。

首次下单建立服务方客户档案，归属 ship 销售账户。同一人在服务方已有其他账户时仍独立建档；后续通过 ship 客户唯一 ID 复用。客户资料更新由 Shipper 显式请求，普通下单不覆盖已有档案。

ship 生成的 SIP 运单号作为服务方现有国内单号。运单只能按这个号码精确查询；不提供本地运单号查询、箱号查询、模糊查询、运单列表或批量查询。

录单时无需尺寸、重量或运输费用。入库后由服务方录入并计费，Shipper 主动查询，不接收主动通知。费用属于整单，只向管理端提供；客户销售价由 Shipper 自行设置。本版不触发自动扣款，余额及退款规则不在本版范围。

## 2. 基础协议

根地址：HTTPS，正式地址待提供。统一前缀：/api/partners/v1。

- JSON UTF-8，字段 camelCase。
- 时间为 ISO 8601 UTC；未知时间为 null。
- 尺寸 cm，重量 kg；币种三字母代码。
- 金额为十进制字符串，例如 "12.50"；未知金额为 null，确认免费为 "0.00"。
- 标识均按字符串处理，保留前导零。国内单号区分大小写，精确匹配，不自动去空格或改变字符。
- 路径参数进行 URL 编码；号码支持的字符和最大长度联调前按双方现有号码规则确认。
- 服务方返回的本地号码不得由 Shipper 拼接或解析。

请求头：

~~~http
Authorization: Bearer <服务端API凭证>
Content-Type: application/json
X-Request-Id: <可选，请求追踪标识>
Idempotency-Key: <写操作必填，每个逻辑操作一个UUID>
If-Match: "<修改/删除时必填的editToken>"
~~~

凭证绑定 ship 销售账户及访问范围。Shipper 不传销售账户、公司、负责人或客户分级来决定权限。业务凭证可配置 routes:read、orders:read、orders:write、customers:write；管理端凭证另外配置 orders:fees:read。凭证仅放在 Shipper 服务端，费用由其系统限制为管理员可见。

成功统一返回 requestId、data、error；错误时 data=null。以下示例主要展示 data，请求示例则为完整请求体。

~~~json
{
  "requestId": "req-example",
  "data": null,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "收件地址不完整",
    "fields": [{"path":"recipient.postalCode","message":"该线路要求邮编"}],
    "retryable": false
  }
}
~~~

## 3. 接口清单

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /routes | 获取 ship 可用线路，不含价格 |
| GET | /routes/{routeCode}/order-schema | 获取线路录单要求 |
| POST | /orders | 录单并返回号码和打印数据 |
| GET | /orders/by-domestic-number/{domesticNumber} | 按国内单号获取整单信息 |
| PUT | /orders/by-domestic-number/{domesticNumber} | 待入库覆盖修改，可增删包裹 |
| DELETE | /orders/by-domestic-number/{domesticNumber} | 待入库整单删除 |
| PUT | /customers/{externalCustomerId}/profile | 显式更新已建立的客户资料 |

只有运单查询使用国内单号；客户资料更新使用客户 ID，线路规则查询使用线路标识，不属于其他运单查询入口。

## 4. 线路接口

GET /routes 返回 routes 数组，每项含 routeCode、name、enabled、destinations（目的地国家/地区代码数组）、schemaVersion。已撤销授权的线路不返回。

GET /routes/{routeCode}/order-schema 返回以下 data：

~~~json
{
  "routeCode":"ROUTE-DEMO",
  "schemaVersion":"demo-1",
  "fields":[
    {"path":"recipient.postalCode","label":"邮编","type":"string","required":true,"maxLength":20},
    {"path":"packages[].items[].quantity","label":"数量","type":"integer","required":true,"min":1},
    {"path":"routeData.insuranceRequested","label":"是否投保","type":"boolean","required":false}
  ]
}
~~~

fields 描述基础字段的线路附加要求以及 routeData 扩展字段。type 可为 string、integer、decimal、boolean、object、array；可选约束为 min、max、maxLength、enum。条件必填用 requiredWhen：{path, equals} 表示单个字段相等条件，不传可执行表达式。

线路不要求首次录单提供仓库测量数据或服务方运输费用。线路要求的商品申报价值与运输费用不同，按具体字段提交。线路价目表不随接口返回，管理员获取价目表的方式另约定。

线路返回对应起点仓库标识 originWarehouseCode、运输方式 shippingMethod、货物类型 cargoTypes 和目的地。若一条线路允许多个起点仓库，返回 originWarehouses 数组，并要求录单显式选择 warehouseCode；唯一仓库时由服务方根据线路确定。录单可包含 cargoType，支持值以线路返回为准。Shipper 自己管理客户可见线路，不同步客户线路分配。服务方只核验该线路是否可用、是否开放给 ship，以及资料是否符合要求。

## 5. 创建运单

POST /orders。请求：

~~~json
{
  "domesticNumber":"SIP202609110001",
  "externalCustomerId":"SHIP-C00023",
  "customerProfile":{
    "name":"王小明",
    "phone":"+8613800000000",
    "email":"customer@example.com",
    "contactAddress":{
      "countryCode":"CN","province":"广东省","city":"深圳市",
      "district":"南山区","addressLine1":"示例联系地址1号",
      "addressLine2":null,"postalCode":"518000"
    }
  },
  "routeCode":"ROUTE-DEMO",
  "schemaVersion":"demo-1",
  "destination":"DEST-DEMO",
  "recipient":{
    "name":"王小明","phone":"+14165550123","countryCode":"CA",
    "province":"ON","city":"Toronto","district":null,
    "addressLine1":"123 Example Street","addressLine2":"Unit 2",
    "postalCode":"M5V 1A1","email":"customer@example.com"
  },
  "sender":null,
  "packageCount":2,
  "packages":[
    {"clientPackageId":"BOX-1","items":[{"name":"衣服","quantity":5}]},
    {"clientPackageId":"BOX-2","items":[{"name":"书籍","quantity":3}]}
  ],
  "routeData":{},
  "remark":null
}
~~~

字段约定：

| 字段 | 要求 |
|---|---|
| domesticNumber | 必填，SIP 运单号；创建后不通过修改接口变更 |
| externalCustomerId | 必填，稳定 ship 客户 ID；不通过运单修改接口换客户 |
| customerProfile | 首次建档必填，已有客户可省略；即使传入也不覆盖已有档案 |
| name / phone / email | 首次客户资料必填 |
| contactAddress | 客户联系资料，可空；不自动作为寄件或收件地址 |
| routeCode / schemaVersion | 必填，采用线路接口返回值 |
| destination | 必填，使用线路返回的目的地代码；不假定它一定等于国家代码。recipient.countryCode 为地址国家代码，服务方校验二者相容 |
| warehouseCode / cargoType | 按线路要求填写；唯一可选值可由服务方推导，不猜测仓库 |
| recipient | 必填，本次实际收件地址 |
| sender | 是否必填由线路规则决定 |
| packageCount | 必填，正整数，等于 packages 长度 |
| packages[].clientPackageId | 必填，同单内稳定、唯一的 ship 箱标识 |
| packages[].items | 非空数组，name 和正整数 quantity 必填；其他商品字段按线路要求 |
| routeData | 线路扩展资料，无则空对象 |
| remark | 可选业务备注，不是服务方内部备注 |

收寄件 Address 中 name、phone、countryCode、addressLine1 必填；province、city、district、postalCode 按线路要求；addressLine2、email 可空。首次客户 contactAddress 不含隐式收寄件含义。Shipper 地址簿可有多个地址及默认值，下单只传选中的完整地址。

本版建议默认字符上限：姓名 100、电话 32、邮箱 254、地址行 200、行政区 100、邮编 20、物品名称 200、备注 1000。最终限制随真实线路 schema 及上线参数提供。未声明的扩展字段、状态、测量值及费用不能作为创建字段上传。

成功 HTTP 201；同单有效重试 HTTP 200。data 示例：

~~~json
{
  "domesticNumber":"SIP202609110001",
  "externalCustomerId":"SHIP-C00023",
  "customerNumber":"EXAMPLE-C23",
  "customerCreated":true,
  "customerEditToken":"opaque-customer-token",
  "status":"PENDING_INBOUND",
  "editable":true,
  "deletable":true,
  "editToken":"opaque-order-token",
  "packageCount":2,
  "packages":[
    {"clientPackageId":"BOX-1","waybillNumber":"EXAMPLE-10001","sequence":1},
    {"clientPackageId":"BOX-2","waybillNumber":"EXAMPLE-10002","sequence":2}
  ],
  "labelData":[
    {
      "waybillNumber":"EXAMPLE-10001","domesticNumber":"SIP202609110001",
      "customerNumber":"EXAMPLE-C23","recipientName":"王小明","phone":"+14165550123",
      "address":"Unit 2, 123 Example Street, Toronto, ON, M5V 1A1, CA",
      "destination":"DEST-DEMO","contents":"衣服 × 5","sequence":1,"totalPackages":2
    },
    {
      "waybillNumber":"EXAMPLE-10002","domesticNumber":"SIP202609110001",
      "customerNumber":"EXAMPLE-C23","recipientName":"王小明","phone":"+14165550123",
      "address":"Unit 2, 123 Example Street, Toronto, ON, M5V 1A1, CA",
      "destination":"DEST-DEMO","contents":"书籍 × 3","sequence":2,"totalPackages":2
    }
  ],
  "replayed":false
}
~~~

号码是服务方现有业务号码。响应还可附带 requestNo（服务方集运号）和 packages[].markNo（现有唛头）；它们仅供显示或打印，不能用来查询。示例不规定号码格式。多箱成功响应须返回各箱实际生成的号码；单箱发号按服务方现有规则，若该阶段不生成号码则 waybillNumber=null，并在联调时确认识别方法。所有包裹作为一次录单处理，失败不返回部分成功。

## 6. 唯一运单查询入口

GET /orders/by-domestic-number/{domesticNumber}

精确查询此 ship 国内单号，一次返回所有关联包裹。不存在和属于其他销售范围均返回 404 ORDER_NOT_FOUND，不回退到其他号码。

data 包含：

| 字段 | 含义 |
|---|---|
| domesticNumber、externalCustomerId、customerNumber | 国内单号、ship 客户 ID、服务方客户号 |
| customerEditToken | 当前客户资料的更新令牌 |
| routeCode、schemaVersion、destination | 线路及当前运单规则标识、目的地 |
| recipient、sender、routeData、remark | 当前运单业务资料 |
| status、statusText | 稳定对外状态及说明 |
| editable、deletable、lockReason、editToken | 当前操作资格、不可操作原因及令牌 |
| packageCount、packages | 关联包裹；每项包含箱标识、号码、序号、物品、status、measurement |
| labelData | 当前有效打印数据，与创建响应同结构 |
| tracking | 公开承运商及物流资料；无则 [] |
| exceptions | 公开异常；无则 [] |
| fees | 仅管理费用权限返回；普通凭证完全省略此字段 |

包裹 measurement 在未测量时为 null；有数据时包含 lengthCm、widthCm、heightCm、actualWeightKg，并可返回 volumetricWeightKg、chargeableWeightKg、measuredAt。尚不掌握的字段为 null，不用 0 替代未知。服务方不提供无法可靠计算的数据。

tracking 每项包含 carrierCode、trackingNumber、events；事件包含 code、description、occurredAt、location。exceptions 每项包含 code、message、waybillNumber（整单异常可空）、occurredAt。未具备可靠来源的可选时间字段为 null。

建议状态：PENDING_INBOUND、PARTIALLY_INBOUND、IN_WAREHOUSE、PENDING_DISPATCH、DISPATCHED、IN_TRANSIT、CUSTOMS_CLEARANCE、READY_FOR_PICKUP、OUT_FOR_DELIVERY、DELIVERED、RETURN_PENDING、RETURNED、COMPLETED、EXCEPTION、UNKNOWN。具体线路不必经历全部状态，UNKNOWN 不等于待入库。以 editable/deletable 及服务端提交时校验判断操作资格。

服务方的全部可公开运单业务信息通过上述结构及线路声明的扩展资料提供；内部成本、内部备注、技术记录不对外返回。

### 整单费用

有 orders:fees:read 权限时，fees 示例：

~~~json
{
  "currency":"CAD",
  "items":[
    {"code":"TRANSPORT","name":"运输费","amount":"100.00"},
    {"code":"SURCHARGE","name":"附加费","amount":"10.00"},
    {"code":"DELIVERY","name":"派送费","amount":"20.00"},
    {"code":"DUTY","name":"关税","amount":null},
    {"code":"INSURANCE","name":"保险费","amount":"5.00"}
  ],
  "total":null,
  "complete":false
}
~~~

items 是当前整单费用完整快照，项目可增加 REMOTE、STORAGE、WAREHOUSE、CLEARANCE、OVERSIZE、OTHER 等。不适用项目省略；待定金额 null；确认免费为 "0.00"。存在未定费用时 complete=false、total=null；只有当前全部适用费用确定且不重复计入时返回 total。

complete 只表示当前费用计算完整，不表示已扣款或以后不会调整。无法证明费用已完整时保持 false，不猜测。尚未计费时 items=[]、total=null、complete=false，币种未知可为 null。每次查询覆盖原缓存，不能将多次结果累加；费用只在整单出现，不在各箱重复返回。

## 7. 待入库修改

PUT /orders/by-domestic-number/{domesticNumber}，If-Match 使用最近查询的 editToken，Idempotency-Key 必填。

完整请求字段为 routeCode、schemaVersion、warehouseCode、cargoType、destination、recipient、sender、packageCount、packages、routeData、remark，格式同创建对应字段。不传国内单号、客户 ID 或 customerProfile。

- 必填字段遗漏报错；可选字段省略或 null 视为清空；数组完整替换。
- 保留相同 clientPackageId 的包裹并修改其资料；新增标识代表增箱；从数组移除代表删除对应包裹/号码。剩余包裹号码原则上保留，实际替换以响应为准。
- 不允许有效订单为零箱，删除最后一箱使用整单 DELETE。
- 所有包裹待入库时才可覆盖操作；部分入库后本版建议整单锁定，联调前与服务方当前规则确认。不能仅依赖集运单显示状态判断，服务方同时核验各箱入库事实。
- 不允许覆盖仓库状态、测量结果、费用、销售归属或承运商信息。
- 更新客户资料不隐式修改运单，修改运单也不更新客户资料。
- 修改成功后返回最新号码、labelData、editToken、removedWaybillNumbers 和 reprintRequired。号码删除不代表可以将号码复用给另一件包裹。
- 地址、物品、线路或箱数发生变化时重新打印受影响标签并替换旧标签。

操作作为整体提交；状态变化或令牌过期时拒绝，不部分覆盖。editToken 为不透明字符串，Shipper 不解析或递增。

## 8. 待入库整单删除

DELETE /orders/by-domestic-number/{domesticNumber}，If-Match、Idempotency-Key 必填，无请求体。服务方校验归属和入库状态后执行业务删除，不涉及退款或扣款。

成功 data：

~~~json
{
  "domesticNumber":"SIP202609110001",
  "deleted":true,
  "removedWaybillNumbers":["EXAMPLE-10001","EXAMPLE-10002"]
}
~~~

本版不承诺删除后可查询到墓碑订单：成功删除后 GET 返回 404。Shipper 保存成功响应，停用全部旧标签。相同幂等 key 重试删除返回已成功的删除结果；超出幂等保存期后可能返回 404。

Shipper 不应复用已经提交过的国内单号；服务方是否长期保留号码占用，联调前按既有删除机制确定，不作为当前数据库实现承诺。

## 9. 显式客户资料更新

PUT /customers/{externalCustomerId}/profile，请求体为完整 customerProfile（直接包含 name、phone、email、contactAddress，不额外包一层）。使用 customerEditToken 作为 If-Match，Idempotency-Key 必填。

客户必须已经通过首次下单建档；不存在返回 404。成功 data 包含 externalCustomerId、customerNumber、customerEditToken。此更新不改历史运单、箱号、收件资料或结算归属。

令牌从创建结果、该客户任一运单查询或上次资料更新响应取得。资料冲突 412 可返回 currentEditToken，Shipper 核对其自身最新资料后再提交，不能盲目覆盖。此令牌不是数据库字段要求。

## 10. 打印要求

面单由 Shipper 排版，每箱必须包含收件地址、客户号、电话、ship SIP 运单号、内件及数量、目的地、本地运单号（如果有）。建议同时包含收件人姓名、箱序号/总箱数。

号码使用接口原值。若打印条码，编码兼容性和样张须经服务方现有仓库扫描验证。不要在标签显示服务方结算费用、凭证或客户联系地址。修改后使用返回的最新打印数据，不保留被删除包裹的标签。

## 11. 幂等、并发及错误处理

写请求使用 Idempotency-Key。同一 key、方法、路径、正文和前置令牌的重试返回原结果；相同 key 内容不同返回 409。新逻辑操作使用新 key。建议保存成功写响应至少 7 天，最终期限上线前提供。业务去重同时基于 ship 范围和国内单号，不允许一次请求的多个包裹被误判为多次重复提交。

创建同国内单号且原始内容相同，返回已有号码；内容不同则 409，必须使用修改接口。创建超时可先按国内单号查询，或用原 key 原内容重试。查询暂未找到不能证明前次请求未提交完成。

If-Match 防止覆盖旧资料，最终入库状态由服务端在提交时再次核验；令牌可在后台变化后失效。幂等重放可能是旧成功响应，打印或继续编辑前应查询当前结果。

| HTTP | code | 处理 |
|---|---|---|
| 400 | INVALID_REQUEST | 修正 JSON、号码格式或编码 |
| 401 | UNAUTHORIZED | 检查凭证 |
| 403 | SCOPE_FORBIDDEN / ROUTE_FORBIDDEN | 核对权限或线路 |
| 404 | ORDER_NOT_FOUND / CUSTOMER_NOT_FOUND / ROUTE_NOT_FOUND | 核对准确标识 |
| 409 | DOMESTIC_NUMBER_CONFLICT / IDEMPOTENCY_CONFLICT | 核对原单/原请求 |
| 409 | ORDER_LOCKED / ROUTE_DISABLED / ROUTE_SCHEMA_CHANGED | 查询最新状态或刷新规则 |
| 412 | VERSION_CONFLICT | 查询新令牌并核对最新资料 |
| 413 | PAYLOAD_TOO_LARGE | 缩减请求 |
| 422 | VALIDATION_FAILED / UNKNOWN_FIELD / PACKAGE_COUNT_MISMATCH | 按 fields 修正 |
| 428 | PRECONDITION_REQUIRED | 补充必要请求头 |
| 429 | RATE_LIMITED | 按 Retry-After 延迟 |
| 500/503 | INTERNAL_ERROR / TEMPORARILY_UNAVAILABLE | 原 key、原内容有界退避重试 |

业务错误不自动重试。网络及临时服务错误采用带随机抖动的退避，超过次数转人工处理。服务方不返回数据库异常堆栈。

## 12. 联调前确认清单

- 测试/生产根地址、凭证权限、撤销及轮换方式。
- SIP 运单号及客户/箱标识格式；请求体、箱数、物品数与频率上限。
- 真实线路标识、录单规则、schemaVersion 变化处理和目的地范围。
- 多箱实际发号、单箱是否发号、删除箱号及原仓库扫描行为。
- 部分入库修改限制、历史删除及号码复用规则。
- 费用项目口径、币种及如何判断完整；费用不代表扣款。
- editToken 和幂等保存期限。
- 首单、重试、修改、删除、入库、查询、费用权限完整联调及打印样张。

本文描述接口行为，不规定服务方数据库或后台页面结构。正式发布前双方确认本清单，接口未实现的能力不得宣称已上线。

## 13. 本版补充说明

本版沿用服务方现有集运订单及逐箱号码。每箱可以包含多种商品；Shipper 按实际箱子提交 packages，不得按物品行数量推断箱数。服务方应保证返回的箱数与实际箱数一致，多箱建单失败不得返回部分可用号码。

商品申报单价由线路规则要求时传入，不等于运输费用。申报币种与最终运输结算币种分别处理，服务方不得无提示套用示例汇率。fees.currency 是响应金额真实币种，不能依据内部字段后缀或示例推断。

普通订单查询不触发重新计费、扣款、确认费用或其他写操作，仅读取当前可公开数据。内部逐箱费用可以存在，API 仍按整单去重汇总一次。

收件地址以本次订单数据为准。客户联系地址更新不改变任何历史订单地址。单独寄件地址是否为某线路必填，以该线路正式规则为准；未支持的字段不能声称已保存。

管理者线路价目表交付方式另定，本版只提供不含价格的线路资料及管理端可见的运单实际费用。

此稿尚需通过真实多箱样单、现有仓库扫码及金额对账后发布。所有路径、认证及并发令牌是新增接口的提议契约，不代表旧接口已具备这些能力。
