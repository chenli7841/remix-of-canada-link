const TORONTO_TIME_ZONE = "America/Toronto";

function torontoDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

type IntakeWaybill = {
  id: string;
  waybill_no?: string | null;
  order_id?: string | null;
  forwarding_id?: string | null;
};

/**
 * Adds one daily-notification event per physically received waybill.
 * The database unique key makes retries safe: a waybill can only contribute one
 * piece to the daily intake total, even if the operator repeats the scan.
 */
export async function recordWecomDailyIntake(
  // Supabase's generated fluent query type is intentionally erased here because
  // this helper is shared by several service-role server functions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  waybills: IntakeWaybill[],
  customerCode?: string | null,
) {
  if (!waybills.length) return { recorded: 0 };

  let resolvedCode = String(customerCode ?? "").trim();
  if (!resolvedCode) {
    const first = waybills[0];
    if (first.order_id) {
      const { data, error } = await admin
        .from("orders")
        .select("customer_code")
        .eq("id", first.order_id)
        .maybeSingle();
      if (error) throw new Error(`读取入库客户号失败: ${error.message}`);
      resolvedCode = String(data?.customer_code ?? "").trim();
    } else if (first.forwarding_id) {
      const { data, error } = await admin
        .from("forwarding_orders")
        .select("customer_code")
        .eq("id", first.forwarding_id)
        .maybeSingle();
      if (error) throw new Error(`读取入库客户号失败: ${error.message}`);
      resolvedCode = String(data?.customer_code ?? "").trim();
    }
  }
  if (!resolvedCode) throw new Error("入库成功，但无法生成微信通知：订单缺少客户号");

  const serviceDate = torontoDate();
  const rows = waybills.map((waybill) => ({
    service_date: serviceDate,
    customer_code: resolvedCode,
    category: "intake",
    source_type: "waybill",
    source_id: waybill.id,
    payload: {
      pieces: 1,
      waybill_no: waybill.waybill_no ?? null,
    },
  }));
  const { error } = await admin.from("wecom_daily_notification_events").upsert(rows, {
    onConflict: "category,source_type,source_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`生成每日入库微信通知失败: ${error.message}`);
  return { recorded: rows.length, serviceDate, customerCode: resolvedCode };
}
