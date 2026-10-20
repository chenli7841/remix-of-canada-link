export type BackendError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
} | null | undefined;

// Only translate known server conditions. Never echo database messages, row
// contents, constraint names, or user-controlled text to a customer.
export function explainMcpError(error: BackendError) {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").trim();
  const known: Record<string, [string, string, string]> = {
    "draft not found": ["DRAFT_NOT_FOUND", "找不到当前账号可访问的草稿。", "请核对草稿编号和当前连接账号。"],
    "active draft not found": ["ACTIVE_DRAFT_NOT_FOUND", "找不到当前账号可操作的有效草稿。", "请先查询草稿状态，确认是否已提交、取消或过期。"],
    "draft is not active": ["DRAFT_INACTIVE", "草稿已过期或不再处于可提交状态。", "请查询草稿状态；已提交的请查看原订单，不要重复下单。"],
    "draft changed; review again": ["DRAFT_CHANGED", "草稿已被修改，本次确认的版本不是最新版本。", "请重新读取并展示完整草稿，取得用户确认后再提交。"],
    "order changed; review again": ["ORDER_CHANGED", "订单资料已更新，不能按旧版本修改。", "请重新读取订单并确认修改内容。"],
    "draft currency must be CAD": ["CURRENCY_MISMATCH", "草稿申报币种不是加元 CAD。", "请核对加元金额并更新草稿，重新确认后再提交；不要直接更换币种标签。"],
    "route unavailable": ["ROUTE_UNAVAILABLE", "所选线路目前不可用。", "请重新查询可用线路并选择。"],
    "route unavailable for customer": ["ROUTE_UNAVAILABLE", "当前账号不能使用所选线路。", "请从当前账号返回的可用线路中重新选择。"],
    "线路不可用": ["ROUTE_UNAVAILABLE", "所选线路目前不可用。", "请重新查询可用线路并选择。"],
    "请选择仓库": ["WAREHOUSE_REQUIRED", "缺少仓库资料。", "集运草稿请使用义乌仓库 YW，并重新核对草稿。"],
    "no active pricing rule": ["PRICING_UNAVAILABLE", "该线路尚未配置可用的计价规则，无法报价。", "请联系客服核实运费，不要把缺失报价当作免费。"],
    "explicit confirmation required": ["CONFIRMATION_REQUIRED", "尚未取得本次操作所需的明确确认。", "请先展示完整内容，再请用户确认。"],
    "reason is required": ["REASON_REQUIRED", "缺少修改原因，或原因长度不符合要求。", "请提供 2 至 500 字的修改原因。"],
    "patch required": ["CHANGES_REQUIRED", "没有提供需要修改的内容。", "请明确要修改的字段和新值。"],
    "invalid direction": ["INVALID_DIRECTION", "运输方向不符合要求。", "请使用 forward 或 reverse 指定方向。"],
    "invalid message": ["INVALID_MESSAGE", "客服留言为空或超过长度限制。", "请填写 1 至 4000 字的留言，展示完整内容并确认后发送。"],
    "valid tracking number required": ["INVALID_TRACKING_NUMBER", "快递单号长度不符合要求。", "请核对原始单号，长度须为 5 至 100 个字符。"],
    "valid different tracking number required": ["INVALID_REPLACEMENT_TRACKING", "更正后的单号与原单号相同，或长度不符合要求。", "请核对真实的新旧单号；新单号须为 5 至 100 个字符。"],
    "tracking number already belongs to another active order": ["TRACKING_ALREADY_USED", "该快递单号已被其他有效订单使用。", "请核对已有订单或联系客服，不要修改真实单号绕过重复检查。"],
    "tracking number changed; diagnose again": ["TRACKING_CHANGED", "订单上的快递单号已经发生变化。", "请重新诊断并核对最新单号，确认后再更正。"],
    "order is no longer pending intake": ["INTAKE_STATE_CHANGED", "订单已不处于允许更正单号的待入库状态。", "请查看最新订单状态，需要修改时联系客服。"],
    "active detained number not found for this account; contact support": ["DETAINED_TRACKING_NOT_FOUND", "当前账号下未找到该单号对应的有效待认领包裹。", "请核对单号并联系客服处理认领。"],
    "new tracking number is not an active detained number": ["DETAINED_TRACKING_NOT_FOUND", "新单号不属于有效待认领包裹。", "请核对单号并联系客服。"],
    "unsupported order type": ["UNSUPPORTED_ORDER_TYPE", "该操作不支持当前订单类型。", "请核对所选订单类型，或联系客服处理。"],
  };
  const result = (reason: string, description: string, nextStep: string) => ({
    reason, description, next_step: nextStep,
  });
  if (code === "23505" && message === "国内单号已被其他订单使用，请核对后重试") {
    return result("TRACKING_ALREADY_USED", "该国内快递单号已被其他订单使用，不能重复录入。", "请核对已有订单或联系客服；不要修改真实单号绕过重复检查。");
  }
  if (Object.hasOwn(known, message)) return result(...known[message]);
  if (["not authenticated", "authentication required", "unauthenticated", "JWT expired"].includes(message) || ["PGRST301", "PGRST302", "PGRST303"].includes(code)) {
    return result("AUTH_REQUIRED", "登录授权无效或已过期。", "请重新连接 EPLUS 账号后再查询操作状态。");
  }
  if (/^(forwarding order|order|customer|invoice|batch|audit log) not found$/.test(message)) {
    return result("RECORD_NOT_FOUND", "找不到当前账号可访问的目标记录。", "请核对编号和当前账号；不要推断其他客户的记录是否存在。");
  }
  const missing = /^物品「[\s\S]*」缺少必填项: ([a-z_]+)$/.exec(message);
  const fields: Record<string, string> = {
    name: "品名", quantity: "数量", unit_price: "申报单价", box_count: "箱数",
    inner_qty: "每箱数量", hscode: "HS 编码", origin: "产地", material: "材质", brand: "品牌",
  };
  if (missing && Object.hasOwn(fields, missing[1])) {
    return result("ITEM_FIELD_REQUIRED", `线路要求的物品资料不完整：缺少${fields[missing[1]]}。`, "请补齐每件物品的该项资料，更新草稿并重新确认。");
  }
  if (code === "23505") return result("DUPLICATE_RECORD", "记录与已有数据冲突，不能重复保存。", "请先核对已有记录；具体冲突可由客服通过诊断编号查询。");
  if (code === "23503") return result("RELATED_RECORD_CONFLICT", "关联资料不存在、已变更，或仍被其他记录引用。", "请刷新地址、物品或订单资料；删除失败时需先处理引用关系。");
  if (code === "23502") return result("REQUIRED_VALUE_MISSING", "保存所需的必填资料为空。", "请核对完整资料；如已填写，请将诊断编号提供给客服。");
  if (code === "23514") return result("BUSINESS_RULE_VIOLATION", "资料不符合系统的状态或数值规则。", "请核对数量、金额和记录状态，并通过诊断编号确认具体限制。");
  if (["22P02", "22003", "22007", "22008", "22023"].includes(code)) return result("INVALID_VALUE", "编号、日期或数值的格式或范围不符合要求。", "请使用系统返回的记录编号，并核对日期、数量与金额格式。");
  if (code === "PGRST116") return result("RECORD_LOOKUP_MISMATCH", "查询未能定位到唯一一条可访问记录。", "请核对记录编号和当前账号；该结果可能为空或不唯一。");
  if (["PGRST202", "PGRST204", "42883", "42P01", "42703"].includes(code)) return result("SERVICE_CONFIGURATION", "服务接口与数据库配置不一致。", "需要管理员检查部署和数据库迁移；重复提交相同内容不能解决。");
  if (["57014", "PGRST003"].includes(code)) return result("REQUEST_TIMEOUT", "请求超时或被服务取消，未取得操作结果。", "请先查询记录状态，再决定是否重试，避免重复提交。");
  if (["40001", "40P01", "55P03"].includes(code)) return result("CONCURRENT_CHANGE", "记录正在被其他操作处理，本次发生并发冲突。", "请刷新最新记录；修改内容变化时需重新确认。");
  if (code.startsWith("08") || ["PGRST000", "PGRST001", "PGRST002", "53300", "57P01"].includes(code) || /^(TypeError: )?fetch failed$/i.test(message)) {
    return result("SERVICE_UNAVAILABLE", "暂时无法连接数据服务，未取得操作结果。", "请稍后先查询记录状态；不要连续重复执行写入操作。");
  }
  return result("UNEXPECTED_FAILURE", "服务处理失败，目前无法确定具体原因。", "请提供诊断编号给客服排查；写入操作请先核对记录状态，不要盲目重试。");
}

export function queryFailedResult(error: BackendError, operation: string) {
  const reference = crypto.randomUUID();
  const explanation = explainMcpError(error);
  console.error("MCP backend failure", {
    reference, operation, code: error?.code, message: error?.message,
    details: error?.details, hint: error?.hint,
  });
  return {
    content: [{ type: "text" as const, text: `${explanation.description}\n处理建议：${explanation.next_step}\n诊断编号：${reference}` }],
    structuredContent: { ...explanation, operation, reference },
    isError: true,
  };
}
