// 查询/组装一张 ship 订单的对外响应——GET 和 PUT 的响应共用这套逻辑，保证两个
// 接口看到的是同一份口径。见 docs/ship-api/shipper-api-v3.md 第 6、6.1、7 节。
import { ShipApiError } from "./auth.server";
import { computeCustomerEditToken, computeOrderEditToken } from "./concurrency.server";

export type PartnerOrderRow = {
  id: string;
  partner_key: string;
  domestic_number: string;
  forwarding_id: string;
  local_user_id: string;
  route_code: string;
  box_count_known: boolean;
};

// 按 (partner_key, domestic_number) 精确查——唯一入口，不接受本地号/箱号/其他
// 客户号回退（system-change-guide-v3.md 第 6 节明确禁止）。
export async function resolvePartnerOrder(
  admin: any,
  partnerKey: string,
  domesticNumber: string,
): Promise<PartnerOrderRow> {
  const { data, error } = await admin
    .from("partner_orders")
    .select("id, partner_key, domestic_number, forwarding_id, local_user_id, route_code, box_count_known")
    .eq("partner_key", partnerKey)
    .eq("domestic_number", domesticNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ShipApiError("ORDER_NOT_FOUND", "运单不存在");
  return data as PartnerOrderRow;
}

export type OrderLockState = { editable: boolean; deletable: boolean; lockReason: string | null };

// 判定依据跟用户确认过：箱数已知线路复用现有 waybill 入库状态（任一箱已经离开
// 'pending' 状态即视为已入库，锁定）；箱数未知（海运）线路在真正开始收货前
// （forwarding_orders.intake_at 为空）都可编辑/删除，一开始收货立即锁定，不做
// 部分锁定——这类订单本来就没有"总箱数"这个分母可供衡量"部分"。
export async function computeOrderLockState(admin: any, order: PartnerOrderRow): Promise<OrderLockState> {
  if (order.box_count_known) {
    const { data: wbs, error } = await admin.from("waybills").select("status").eq("forwarding_id", order.forwarding_id);
    if (error) throw error;
    const anyReceived = ((wbs ?? []) as any[]).some((w) => w.status !== "pending");
    return anyReceived
      ? { editable: false, deletable: false, lockReason: "已有箱子完成入库，仅可在原后台继续处理" }
      : { editable: true, deletable: true, lockReason: null };
  }
  const { data: fo, error } = await admin.from("forwarding_orders").select("intake_at").eq("id", order.forwarding_id).maybeSingle();
  if (error) throw error;
  return fo?.intake_at
    ? { editable: false, deletable: false, lockReason: "仓库已开始收货，仅可在原后台继续处理" }
    : { editable: true, deletable: true, lockReason: null };
}

// 稳定对外状态映射：只用契约里声明的这几个值，不向 Shipper 暴露内部枚举含义。
function mapStatus(foStatus: string, lock: OrderLockState, boxKnown: boolean, hasWaybills: boolean): { status: string; statusText: string } {
  if (!lock.editable) {
    // 已入库/已收货：箱数已知线路走常规后续状态；箱数未知线路只知道"已开始收货"，
    // 更细的状态（配货/清关/派送...）由原后台流程决定，这里保守只报 IN_WAREHOUSE。
    if (boxKnown) {
      if (foStatus === "shipped") return { status: "DISPATCHED", statusText: "已发出" };
      if (foStatus === "arrived") return { status: "IN_TRANSIT", statusText: "运输中" };
      if (foStatus === "closed") return { status: "COMPLETED", statusText: "已完成" };
      return { status: "IN_WAREHOUSE", statusText: "已入库" };
    }
    return { status: "IN_WAREHOUSE", statusText: "已入库" };
  }
  if (boxKnown && hasWaybills) return { status: "PENDING_INBOUND", statusText: "待入库" };
  if (!boxKnown) return { status: "PENDING_INBOUND", statusText: "待入库" };
  return { status: "UNKNOWN", statusText: "状态未知" };
}

function contentsOf(summary: any): string {
  return (
    (Array.isArray(summary) ? summary : []).map((it: any) => `${it?.name ?? ""} × ${it?.quantity ?? 1}`).join(", ") || "-"
  );
}

export async function assembleOrderResponse(
  admin: any,
  order: PartnerOrderRow,
  opts: { includeFees: boolean },
): Promise<any> {
  const { data: fo, error: foErr } = await admin
    .from("forwarding_orders")
    .select(
      "id, request_no, domestic_tracking_no, route_code, status, note, updated_at, customer_code, address_id, user_id",
    )
    .eq("id", order.forwarding_id)
    .maybeSingle();
  if (foErr) throw foErr;
  if (!fo) throw new ShipApiError("ORDER_NOT_FOUND", "运单不存在");

  const { data: addr } = fo.address_id
    ? await admin
        .from("addresses")
        .select("recipient, phone, country, province, city, postal_code, line1, line2, destination_code")
        .eq("id", fo.address_id)
        .maybeSingle()
    : { data: null };

  const { data: waybills, error: wbErr } = await admin
    .from("waybills")
    .select("id, waybill_no, mark_no, box_no, status, items_summary, client_package_id, updated_at, weight_kg, length_cm, width_cm, height_cm, freight_cad, duty_cad, insurance_cad, clearance_cad, surcharge_cad")
    .eq("forwarding_id", order.forwarding_id)
    .order("box_no", { ascending: true });
  if (wbErr) throw wbErr;
  const wbRows = (waybills ?? []) as any[];

  const lock = await computeOrderLockState(admin, order);
  const { status, statusText } = mapStatus(fo.status, lock, order.box_count_known, wbRows.length > 0);

  const { data: mapping } = await admin
    .from("partner_customer_mappings")
    .select("external_customer_id")
    .eq("partner_key", order.partner_key)
    .eq("local_user_id", order.local_user_id)
    .maybeSingle();

  const { data: profile } = await admin.from("profiles").select("id, updated_at").eq("id", order.local_user_id).maybeSingle();

  const editToken = computeOrderEditToken({ updated_at: fo.updated_at }, wbRows);
  const customerEditToken = profile ? computeCustomerEditToken(profile) : "";

  const recipient = addr
    ? {
        name: addr.recipient,
        phone: addr.phone,
        countryCode: addr.country,
        province: addr.province || null,
        city: addr.city || null,
        district: null,
        addressLine1: addr.line1,
        addressLine2: addr.line2 || null,
        postalCode: addr.postal_code || null,
      }
    : null;

  const address = recipient
    ? [recipient.addressLine2, recipient.addressLine1, recipient.city, recipient.province, recipient.postalCode, recipient.countryCode]
        .filter(Boolean)
        .join(", ")
    : "";

  let packages: any[];
  let labelData: any[];
  if (order.box_count_known) {
    packages = wbRows.map((w, i) => ({
      clientPackageId: w.client_package_id ?? null,
      waybillNumber: w.waybill_no,
      sequence: i + 1,
      status: w.status,
      measurement:
        w.weight_kg != null && w.length_cm != null && w.width_cm != null && w.height_cm != null
          ? { lengthCm: w.length_cm, widthCm: w.width_cm, heightCm: w.height_cm, actualWeightKg: w.weight_kg }
          : null,
    }));
    labelData = wbRows.map((w, i) => ({
      waybillNumber: w.waybill_no,
      domesticNumber: fo.domestic_tracking_no,
      customerNumber: fo.customer_code,
      recipientName: recipient?.name ?? null,
      phone: recipient?.phone ?? null,
      address,
      destination: addr?.destination_code ?? null,
      contents: contentsOf(w.items_summary),
      sequence: i + 1,
      totalPackages: wbRows.length,
    }));
  } else {
    packages = [];
    labelData = [
      {
        waybillNumber: null,
        domesticNumber: fo.domestic_tracking_no,
        customerNumber: fo.customer_code,
        recipientName: recipient?.name ?? null,
        phone: recipient?.phone ?? null,
        address,
        destination: addr?.destination_code ?? null,
        contents: "-",
        sequence: 1,
        totalPackages: 1,
      },
    ];
  }

  const result: any = {
    domesticNumber: fo.domestic_tracking_no,
    externalCustomerId: mapping?.external_customer_id ?? null,
    customerNumber: fo.customer_code,
    customerEditToken,
    routeCode: fo.route_code,
    // sender/routeData 目前没有对应的现有字段可读，如实返回空——不编造。
    recipient,
    sender: null,
    routeData: {},
    remark: fo.note ?? null,
    status,
    statusText,
    editable: lock.editable,
    deletable: lock.deletable,
    lockReason: lock.lockReason,
    editToken,
    packageCount: order.box_count_known ? packages.length : null,
    packages,
    labelData,
    tracking: [],
    exceptions: [],
  };

  if (opts.includeFees) {
    result.fees = buildFeesSnapshot(wbRows);
  }

  return result;
}

// 费用只读快照——保守口径：任何一箱都还没有实际计费数据时，直接给"尚未计费"
// （items=[]、total=null、complete=false），不把默认值 0 误当作"已确认收费 CA$0"。
// 只要有任何一项有非零值，就如实按项返回，但 complete 仍然保持 false——现在没有
// 可靠信号能证明"这一单所有箱子都已经计费完成"，宁可少报也不能编造完整性。
function buildFeesSnapshot(waybills: any[]) {
  const sums = { freight: 0, duty: 0, insurance: 0, clearance: 0, surcharge: 0 };
  let anyNonZero = false;
  for (const w of waybills) {
    sums.freight += Number(w.freight_cad ?? 0);
    sums.duty += Number(w.duty_cad ?? 0);
    sums.insurance += Number(w.insurance_cad ?? 0);
    sums.clearance += Number(w.clearance_cad ?? 0);
    sums.surcharge += Number(w.surcharge_cad ?? 0);
  }
  anyNonZero = Object.values(sums).some((v) => v !== 0);
  if (!anyNonZero) {
    return { currency: "CAD", items: [], total: null, complete: false };
  }
  const items = [
    { code: "TRANSPORT", name: "运输费", amount: sums.freight.toFixed(2) },
    { code: "DUTY", name: "关税", amount: sums.duty.toFixed(2) },
    { code: "INSURANCE", name: "保险费", amount: sums.insurance.toFixed(2) },
    { code: "CLEARANCE", name: "清关费", amount: sums.clearance.toFixed(2) },
    { code: "SURCHARGE", name: "附加费", amount: sums.surcharge.toFixed(2) },
  ].filter((it) => Number(it.amount) !== 0);
  return { currency: "CAD", items, total: null, complete: false };
}
