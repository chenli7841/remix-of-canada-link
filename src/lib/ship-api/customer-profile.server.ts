// PUT /customers/{externalCustomerId}/profile —— 只更新这个合作方客户映射对应的
// profile 本身；订单收寄件资料独立保存在各自的 addresses 快照里，不会被这次更新
// 改写（system-change-guide-v3.md 第 6 节："订单地址不能引用可被这次更新改变的对象"，
// 这里的订单地址是建单时单独开的一条 addresses 记录，本来就不共享这条 profile 的
// 任何字段，天然满足这一点）。
import { ShipApiError } from "./auth.server";
import { computeCustomerEditToken } from "./concurrency.server";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function updateShipCustomerProfile(
  admin: any,
  partnerKey: string,
  externalCustomerId: string,
  ifMatch: string,
  body: any,
): Promise<{ status: number; data: any }> {
  if (!body || typeof body !== "object") throw new ShipApiError("INVALID_REQUEST", "请求体不是合法 JSON 对象");

  const { data: mapping, error: mapErr } = await admin
    .from("partner_customer_mappings")
    .select("local_user_id")
    .eq("partner_key", partnerKey)
    .eq("external_customer_id", externalCustomerId)
    .maybeSingle();
  if (mapErr) throw mapErr;
  if (!mapping) throw new ShipApiError("CUSTOMER_NOT_FOUND", "客户尚未通过首次下单建档");

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, customer_code, updated_at")
    .eq("id", mapping.local_user_id)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!profile) throw new ShipApiError("CUSTOMER_NOT_FOUND", "客户档案不存在");

  const currentToken = computeCustomerEditToken(profile);
  if (currentToken !== ifMatch) {
    // 契约允许 412 附带 currentEditToken，方便 Shipper 核对最新资料后再提交，
    // 不能盲目覆盖。
    throw new ShipApiError("VERSION_CONFLICT", "customerEditToken 已过期，请重新获取最新资料", undefined, {
      currentEditToken: currentToken,
    });
  }

  const errors: { path: string; message: string }[] = [];
  const name = str(body.name);
  const phone = str(body.phone);
  const email = str(body.email);
  if (!name) errors.push({ path: "name", message: "必填" });
  if (!phone) errors.push({ path: "phone", message: "必填" });
  if (errors.length) throw new ShipApiError("VALIDATION_FAILED", "请求缺少必填字段", errors);

  // contactAddress 目前只接收，不落地——本仓库现有 profiles.reg_address 等候选
  // 字段的语义（是否等价于"注册资料"）还没有确认过，先不写，避免写错语义。
  // 如果 Shipper 依赖这个字段被保存，需要先确认清楚再接上。

  const { error: updErr } = await admin
    .from("profiles")
    .update({ full_name: name, phone, email: email || null })
    .eq("id", profile.id);
  if (updErr) throw updErr;

  const { data: updated, error: reErr } = await admin
    .from("profiles")
    .select("id, customer_code, updated_at")
    .eq("id", profile.id)
    .maybeSingle();
  if (reErr || !updated) throw reErr ?? new Error("profile missing after update");

  return {
    status: 200,
    data: {
      externalCustomerId,
      customerNumber: updated.customer_code,
      customerEditToken: computeCustomerEditToken(updated),
    },
  };
}
