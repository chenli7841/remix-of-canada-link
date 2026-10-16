const TORONTO_TIME_ZONE = "America/Toronto";

function nextTorontoSendDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(byType.year);
  const month = Number(byType.month);
  const day = Number(byType.day);
  const hour = Number(byType.hour);
  const scheduled = new Date(Date.UTC(year, month - 1, day + (hour >= 8 ? 1 : 0)));
  return scheduled.toISOString().slice(0, 10);
}

type IntakeWaybill = {
  id: string;
  waybill_no?: string | null;
  order_id?: string | null;
  forwarding_id?: string | null;
};

type DailySections = {
  intake?: { pieces: number };
};

function chineseDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function renderDailyContent(
  customerCode: string,
  serviceDate: string,
  sections: DailySections,
): string {
  const lines = [
    "【EPLUS每日物流通知】",
    `客户号：${customerCode}`,
    `日期：${chineseDate(serviceDate)}`,
  ];
  if (sections.intake && sections.intake.pieces > 0) {
    lines.push("", "【每日入库】", `今日入库：${sections.intake.pieces}件`);
  }
  return lines.join("\n");
}

async function refreshDailyIntakeDraft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  serviceDate: string,
  customerCode: string,
) {
  const { data: events, error: eventError } = await admin
    .from("wecom_daily_notification_events")
    .select("id")
    .eq("service_date", serviceDate)
    .eq("customer_code", customerCode)
    .eq("category", "intake");
  if (eventError) throw new Error(`汇总每日入库微信通知失败: ${eventError.message}`);

  const { data: existing, error: draftError } = await admin
    .from("wecom_daily_notification_drafts")
    .select("id,sections,status")
    .eq("service_date", serviceDate)
    .eq("customer_code", customerCode)
    .maybeSingle();
  if (draftError) throw new Error(`读取每日微信预发送信息失败: ${draftError.message}`);
  if (existing && existing.status !== "draft") {
    throw new Error("当天微信通知已经提交，不能再写入新的入库信息");
  }

  const sections: DailySections = {
    ...(existing?.sections ?? {}),
    intake: { pieces: events?.length ?? 0 },
  };
  const renderedContent = renderDailyContent(customerCode, serviceDate, sections);
  const { error: upsertError } = await admin.from("wecom_daily_notification_drafts").upsert(
    {
      service_date: serviceDate,
      customer_code: customerCode,
      sections,
      rendered_content: renderedContent,
      status: "draft",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "service_date,customer_code" },
  );
  if (upsertError) throw new Error(`保存每日微信预发送信息失败: ${upsertError.message}`);
  return { pieces: events?.length ?? 0, renderedContent };
}

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

  // Before 08:00 Toronto time the draft belongs to today's run; after the
  // cutoff, new intake rolls into tomorrow's 08:00 run.
  const serviceDate = nextTorontoSendDate();
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
  const draft = await refreshDailyIntakeDraft(admin, serviceDate, resolvedCode);
  return { recorded: rows.length, serviceDate, customerCode: resolvedCode, ...draft };
}
