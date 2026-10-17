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
  const scheduled = new Date(Date.UTC(year, month - 1, day + (hour >= 10 ? 1 : 0)));
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
  measurements?: Array<{
    trackingNo: string;
    totalActualWeightKg: number;
    totalVolumetricWeightKg: number;
    totalChargeableWeightKg: number;
    totalFeeCad: number;
  }>;
  batchPrices?: Array<{
    batchId: string;
    batchName: string;
    totalFeeCad: number;
  }>;
  customerPayment?: {
    dueCad: number;
    balanceCad: number;
  };
  deliveryReady?: Array<{
    receivingId: string;
    batchName: string;
    batchNo: string;
    unitCount: number;
    address: string;
  }>;
  dispatched?: Array<{
    batchId: string;
    batchName: string;
    batchNo: string;
    unitCount: number;
    dispatchedAt: string;
  }>;
};

type StoredDailyEvent = {
  category: string;
  payload: {
    trackingNo?: string;
    actualWeightKg?: number;
    volumetricWeightKg?: number;
    chargeableWeightKg?: number;
    freightCad?: number;
    batchId?: string;
    batchName?: string;
    totalFeeCad?: number;
    dueCad?: number;
    balanceCad?: number;
    receivingId?: string;
    batchNo?: string;
    unitCount?: number;
    address?: string;
    dispatchedAt?: string;
  };
  occurred_at: string;
};

const displayWeight = (value: number) => Number(value.toFixed(3));

function chineseDate(serviceDate: string): string {
  const [year, month, day] = serviceDate.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function torontoDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
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
  if (sections.measurements?.length) {
    lines.push("", "【量尺称重】");
    sections.measurements.forEach((item, index) => {
      if (index > 0) lines.push("");
      lines.push(
        item.trackingNo,
        `总体积重：${displayWeight(item.totalVolumetricWeightKg)}kg`,
        `总实重：${displayWeight(item.totalActualWeightKg)}kg`,
        `总收费重量：${displayWeight(item.totalChargeableWeightKg)}kg`,
        `总费用：CAD ${item.totalFeeCad.toFixed(2)}`,
      );
    });
  }
  if (sections.batchPrices?.length) {
    lines.push("", "【批次价格已确认】");
    sections.batchPrices.forEach((item) => {
      lines.push(`${item.batchName} | CAD ${item.totalFeeCad.toFixed(2)}`);
    });
    lines.push("价格已经确认，请前往“我的批次”查看账单并完成付款。");
  }
  if (sections.customerPayment) {
    lines.push(
      "",
      "【客户代付款】",
      `需要付款：CAD ${sections.customerPayment.dueCad.toFixed(2)}`,
      `账户余额：CAD ${sections.customerPayment.balanceCad.toFixed(2)}`,
      `余额不足：CAD ${(sections.customerPayment.dueCad - sections.customerPayment.balanceCad).toFixed(2)}`,
    );
  }
  if (sections.deliveryReady?.length) {
    lines.push("", "【准备派送】");
    sections.deliveryReady.forEach((item, index) => {
      if (index > 0) lines.push("");
      lines.push(
        `批次名称：${item.batchName}`,
        `批次号：${item.batchNo}`,
        `派送单元：${item.unitCount}个`,
        `派送地址：${item.address || "未设置"}`,
      );
    });
    lines.push("预计在一周内派送到家。", "如有问题，请联系客服。");
  }
  if (sections.dispatched?.length) {
    lines.push("", "【已派送】");
    sections.dispatched.forEach((item, index) => {
      if (index > 0) lines.push("");
      lines.push(
        `批次名称：${item.batchName}`,
        `批次号：${item.batchNo}`,
        `派送时间：${torontoDateTime(item.dispatchedAt)}`,
        `派送单元：${item.unitCount}个`,
      );
    });
  }
  return lines.join("\n");
}

async function refreshDailyDraft(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  serviceDate: string,
  customerCode: string,
) {
  const { data: events, error: eventError } = await admin
    .from("wecom_daily_notification_events")
    .select("category,payload,occurred_at")
    .eq("service_date", serviceDate)
    .eq("customer_code", customerCode)
    .order("occurred_at", { ascending: true });
  if (eventError) throw new Error(`汇总每日微信通知失败: ${eventError.message}`);

  const { data: existing, error: draftError } = await admin
    .from("wecom_daily_notification_drafts")
    .select("id,sections,status")
    .eq("service_date", serviceDate)
    .eq("customer_code", customerCode)
    .maybeSingle();
  if (draftError) throw new Error(`读取每日微信预发送信息失败: ${draftError.message}`);
  if (existing && existing.status !== "draft") {
    throw new Error("当天微信通知已经提交，不能再修改这份预发送信息");
  }

  const storedEvents = (events ?? []) as StoredDailyEvent[];
  const intakeEvents = storedEvents.filter((event) => event.category === "intake");
  const measurementEvents = storedEvents.filter((event) => event.category === "measurement");
  const batchPriceEvents = storedEvents.filter((event) => event.category === "batch_price");
  const customerPaymentEvents = storedEvents.filter(
    (event) => event.category === "customer_payment",
  );
  const deliveryReadyEvents = storedEvents.filter((event) => event.category === "delivery_ready");
  const dispatchedEvents = storedEvents.filter((event) => event.category === "dispatched");
  const sections: DailySections = { ...(existing?.sections ?? {}) };
  if (intakeEvents.length) sections.intake = { pieces: intakeEvents.length };
  else delete sections.intake;
  if (measurementEvents.length) {
    const totalsByTracking = new Map<string, NonNullable<DailySections["measurements"]>[number]>();
    for (const event of measurementEvents) {
      const trackingNo = String(event.payload.trackingNo ?? "").trim();
      if (!trackingNo) continue;
      const current = totalsByTracking.get(trackingNo) ?? {
        trackingNo,
        totalActualWeightKg: 0,
        totalVolumetricWeightKg: 0,
        totalChargeableWeightKg: 0,
        totalFeeCad: 0,
      };
      current.totalActualWeightKg += Number(event.payload.actualWeightKg ?? 0);
      current.totalVolumetricWeightKg += Number(event.payload.volumetricWeightKg ?? 0);
      current.totalChargeableWeightKg += Number(event.payload.chargeableWeightKg ?? 0);
      current.totalFeeCad += Number(event.payload.freightCad ?? 0);
      totalsByTracking.set(trackingNo, current);
    }
    sections.measurements = [...totalsByTracking.values()];
  } else {
    delete sections.measurements;
  }
  if (batchPriceEvents.length) {
    sections.batchPrices = batchPriceEvents.map((event) => ({
      batchId: String(event.payload.batchId ?? event.payload.batchName ?? ""),
      batchName: String(event.payload.batchName ?? "未命名批次"),
      totalFeeCad: Number(event.payload.totalFeeCad ?? 0),
    }));
  } else {
    delete sections.batchPrices;
  }
  const latestCustomerPayment = customerPaymentEvents.at(-1);
  if (latestCustomerPayment) {
    sections.customerPayment = {
      dueCad: Number(latestCustomerPayment.payload.dueCad ?? 0),
      balanceCad: Number(latestCustomerPayment.payload.balanceCad ?? 0),
    };
  } else {
    delete sections.customerPayment;
  }
  if (deliveryReadyEvents.length) {
    sections.deliveryReady = deliveryReadyEvents.map((event) => ({
      receivingId: String(event.payload.receivingId ?? ""),
      batchName: String(event.payload.batchName ?? "未命名批次"),
      batchNo: String(event.payload.batchNo ?? "—"),
      unitCount: Number(event.payload.unitCount ?? 0),
      address: String(event.payload.address ?? "未设置"),
    }));
  } else {
    delete sections.deliveryReady;
  }
  if (dispatchedEvents.length) {
    sections.dispatched = dispatchedEvents.map((event) => ({
      batchId: String(event.payload.batchId ?? ""),
      batchName: String(event.payload.batchName ?? "未命名批次"),
      batchNo: String(event.payload.batchNo ?? "—"),
      unitCount: Number(event.payload.unitCount ?? 0),
      dispatchedAt: String(event.payload.dispatchedAt ?? event.occurred_at),
    }));
  } else {
    delete sections.dispatched;
  }
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

  // Before 10:00 Toronto time the draft belongs to today's run; after the
  // cutoff, new intake rolls into tomorrow's 10:00 run.
  const serviceDate = nextTorontoSendDate();
  const rows = waybills.map((waybill) => ({
    service_date: serviceDate,
    customer_code: resolvedCode,
    category: "intake",
    source_type: "waybill",
    source_id: waybill.id,
    event_key: `intake:waybill:${waybill.id}`,
    payload: {
      pieces: 1,
      waybill_no: waybill.waybill_no ?? null,
    },
  }));
  const { error } = await admin.from("wecom_daily_notification_events").upsert(rows, {
    onConflict: "event_key",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`生成每日入库微信通知失败: ${error.message}`);
  const draft = await refreshDailyDraft(admin, serviceDate, resolvedCode);
  return { recorded: rows.length, serviceDate, customerCode: resolvedCode, ...draft };
}

export async function recordWecomDailyMeasurements(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  waybillIds: string[],
) {
  if (!waybillIds.length) return { recorded: 0 };
  const serviceDate = nextTorontoSendDate();
  const { data: waybills, error } = await admin
    .from("waybills")
    .select(
      "id,waybill_no,order_id,forwarding_id,length_cm,width_cm,height_cm,weight_kg,freight_cad,weight_snapshot",
    )
    .in("id", [...new Set(waybillIds)]);
  if (error) throw new Error(`读取量尺称重数据失败: ${error.message}`);

  const parentCache = new Map<string, { customerCode: string; trackingNo: string }>();
  const rows = [];
  const incompleteEventKeys: string[] = [];
  const affectedCustomerCodes = new Set<string>();
  for (const waybill of waybills ?? []) {
    const parentTable = waybill.order_id ? "orders" : "forwarding_orders";
    const parentId = waybill.order_id ?? waybill.forwarding_id;
    if (!parentId) throw new Error(`运单 ${waybill.waybill_no} 缺少所属订单`);
    const cacheKey = `${parentTable}:${parentId}`;
    let parent = parentCache.get(cacheKey);
    if (!parent) {
      const { data, error: parentError } = await admin
        .from(parentTable)
        .select("customer_code,domestic_tracking_no")
        .eq("id", parentId)
        .maybeSingle();
      if (parentError) throw new Error(`读取量尺称重客户失败: ${parentError.message}`);
      parent = {
        customerCode: String(data?.customer_code ?? "").trim(),
        trackingNo: String(data?.domestic_tracking_no ?? waybill.waybill_no ?? "").trim(),
      };
      parentCache.set(cacheKey, parent);
    }
    if (!parent.customerCode) throw new Error(`运单 ${waybill.waybill_no} 所属订单缺少客户号`);
    affectedCustomerCodes.add(parent.customerCode);
    const snapshot = waybill.weight_snapshot ?? {};
    const eventKey = `measurement:waybill:${waybill.id}:${serviceDate}`;
    const lengthCm = Number(waybill.length_cm ?? 0);
    const widthCm = Number(waybill.width_cm ?? 0);
    const heightCm = Number(waybill.height_cm ?? 0);
    const actualWeightKg = Number(waybill.weight_kg ?? 0);
    if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0 || actualWeightKg <= 0) {
      incompleteEventKeys.push(eventKey);
      continue;
    }
    rows.push({
      service_date: serviceDate,
      customer_code: parent.customerCode,
      category: "measurement",
      source_type: "waybill",
      // Include the send date so this remains compatible with the legacy
      // UNIQUE(category, source_type, source_id) constraint on older databases.
      source_id: `${waybill.id}:${parent.customerCode}:${serviceDate}`,
      event_key: eventKey,
      payload: {
        waybillId: waybill.id,
        trackingNo: parent.trackingNo || waybill.waybill_no,
        actualWeightKg,
        volumetricWeightKg: Number(snapshot.volumetric_weight ?? 0),
        chargeableWeightKg: Number(snapshot.chargeable_weight ?? 0),
        freightCad: Number(waybill.freight_cad ?? snapshot.freight_cad ?? 0),
      },
      occurred_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error: upsertError } = await admin
      .from("wecom_daily_notification_events")
      .upsert(rows, { onConflict: "event_key" });
    if (upsertError) throw new Error(`生成量尺称重微信通知失败: ${upsertError.message}`);
  }
  if (incompleteEventKeys.length) {
    const { error: deleteError } = await admin
      .from("wecom_daily_notification_events")
      .delete()
      .in("event_key", incompleteEventKeys);
    if (deleteError) throw new Error(`更新量尺称重微信通知失败: ${deleteError.message}`);
  }

  const customerCodes = [...affectedCustomerCodes];
  for (const customerCode of customerCodes)
    await refreshDailyDraft(admin, serviceDate, customerCode);
  return { recorded: rows.length, serviceDate, customerCodes };
}

export async function recordWecomDailyBatchPrice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  batchId: string,
  customerCode: string,
) {
  const serviceDate = nextTorontoSendDate();
  const [{ data: batch, error: batchError }, { data: settlement, error: settlementError }] =
    await Promise.all([
      admin.from("batches").select("batch_no,display_name").eq("id", batchId).maybeSingle(),
      admin
        .from("batch_settlements")
        .select("subtotal_cad,is_paid,confirmed")
        .eq("batch_id", batchId)
        .eq("customer_code", customerCode)
        .maybeSingle(),
    ]);
  if (batchError) throw new Error(`读取批次名称失败: ${batchError.message}`);
  if (settlementError) throw new Error(`读取批次确认金额失败: ${settlementError.message}`);
  if (!settlement?.confirmed) throw new Error("价格尚未确认，不能生成微信预发送信息");
  if (settlement.is_paid) return { recorded: 0, skipped: "paid" as const };

  const eventKey = `batch_price:${batchId}:${customerCode}:${serviceDate}`;
  const { error } = await admin.from("wecom_daily_notification_events").upsert(
    {
      service_date: serviceDate,
      customer_code: customerCode,
      category: "batch_price",
      source_type: "batch",
      source_id: `${batchId}:${customerCode}:${serviceDate}`,
      event_key: eventKey,
      payload: {
        batchId,
        batchName: String(batch?.display_name ?? batch?.batch_no ?? batchId),
        totalFeeCad: Number(settlement.subtotal_cad ?? 0),
      },
      occurred_at: new Date().toISOString(),
    },
    { onConflict: "event_key" },
  );
  if (error) throw new Error(`生成批次价格微信通知失败: ${error.message}`);
  await refreshDailyDraft(admin, serviceDate, customerCode);
  return { recorded: 1, serviceDate, customerCode };
}

export async function removeWecomDailyBatchPrice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  batchId: string,
  customerCode: string,
) {
  const serviceDate = nextTorontoSendDate();
  const eventKey = `batch_price:${batchId}:${customerCode}:${serviceDate}`;
  const { error } = await admin
    .from("wecom_daily_notification_events")
    .delete()
    .eq("event_key", eventKey);
  if (error) throw new Error(`取消批次价格微信通知失败: ${error.message}`);
  await refreshDailyDraft(admin, serviceDate, customerCode);
  return { removed: 1, serviceDate, customerCode };
}

export async function recordWecomDailyCustomerPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  customerCode: string,
  dueCad: number,
  balanceCad: number,
) {
  if (!(dueCad > 0)) throw new Error("该客户没有待付款账单");
  if (balanceCad >= dueCad) throw new Error("客户余额充足，不需要发送余额不足通知");
  const serviceDate = nextTorontoSendDate();
  const eventKey = `customer_payment:${customerCode}:${serviceDate}`;
  const { error } = await admin.from("wecom_daily_notification_events").upsert(
    {
      service_date: serviceDate,
      customer_code: customerCode,
      category: "customer_payment",
      source_type: "customer",
      source_id: `${customerCode}:${serviceDate}`,
      event_key: eventKey,
      payload: { dueCad, balanceCad },
      occurred_at: new Date().toISOString(),
    },
    { onConflict: "event_key" },
  );
  if (error) throw new Error(`生成客户代付款微信通知失败: ${error.message}`);
  await refreshDailyDraft(admin, serviceDate, customerCode);
  return { recorded: 1, serviceDate, customerCode };
}

export async function removeWecomDailyCustomerPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  customerCode: string,
) {
  const serviceDate = nextTorontoSendDate();
  const { error } = await admin
    .from("wecom_daily_notification_events")
    .delete()
    .eq("event_key", `customer_payment:${customerCode}:${serviceDate}`);
  if (error) throw new Error(`清理客户代付款微信通知失败: ${error.message}`);
  await refreshDailyDraft(admin, serviceDate, customerCode);
}

export async function recordWecomDailyDeliveryReady(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  input: {
    receivingId: string;
    batchId: string;
    customerCode: string;
    unitCount: number;
    address: string;
  },
) {
  if (!(input.unitCount > 0)) return { recorded: 0 };
  const { data: batch, error: batchError } = await admin
    .from("batches")
    .select("batch_no,display_name")
    .eq("id", input.batchId)
    .maybeSingle();
  if (batchError || !batch)
    throw new Error(`读取派送批次失败: ${batchError?.message ?? "批次不存在"}`);
  const serviceDate = nextTorontoSendDate();
  const eventKey = `delivery_ready:${input.receivingId}:${input.customerCode}:${serviceDate}`;
  const { error } = await admin.from("wecom_daily_notification_events").upsert(
    {
      service_date: serviceDate,
      customer_code: input.customerCode,
      category: "delivery_ready",
      source_type: "receiving",
      source_id: `${input.receivingId}:${input.customerCode}:${serviceDate}`,
      event_key: eventKey,
      payload: {
        receivingId: input.receivingId,
        batchName: String(batch.display_name ?? batch.batch_no ?? "未命名批次"),
        batchNo: String(batch.batch_no ?? "—"),
        unitCount: input.unitCount,
        address: input.address || "未设置",
      },
      occurred_at: new Date().toISOString(),
    },
    { onConflict: "event_key" },
  );
  if (error) throw new Error(`生成准备派送微信通知失败: ${error.message}`);
  await refreshDailyDraft(admin, serviceDate, input.customerCode);
  return { recorded: 1, serviceDate, customerCode: input.customerCode };
}

export async function recordWecomDailyDispatched(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  batchId: string,
  customerCode: string,
) {
  const [{ data: units, error: unitError }, { data: batch, error: batchError }] = await Promise.all(
    [
      admin
        .from("delivery_queue")
        .select("id,dispatched_at")
        .eq("source_batch_id", batchId)
        .eq("customer_code", customerCode)
        .eq("status", "dispatched"),
      admin.from("batches").select("batch_no,display_name").eq("id", batchId).maybeSingle(),
    ],
  );
  if (unitError) throw new Error(`读取已派送单元失败: ${unitError.message}`);
  if (batchError || !batch)
    throw new Error(`读取派送批次失败: ${batchError?.message ?? "批次不存在"}`);
  if (!units?.length) throw new Error("没有找到已派送单元");
  const dispatchedAt =
    (units as Array<{ dispatched_at?: string | null }>)
      .map((unit) => unit.dispatched_at)
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? new Date().toISOString();
  const serviceDate = nextTorontoSendDate();
  const eventKey = `dispatched:${batchId}:${customerCode}:${serviceDate}`;
  const { error } = await admin.from("wecom_daily_notification_events").upsert(
    {
      service_date: serviceDate,
      customer_code: customerCode,
      category: "dispatched",
      source_type: "batch",
      source_id: `${batchId}:${customerCode}:${serviceDate}`,
      event_key: eventKey,
      payload: {
        batchId,
        batchName: String(batch.display_name ?? batch.batch_no ?? "未命名批次"),
        batchNo: String(batch.batch_no ?? "—"),
        unitCount: units.length,
        dispatchedAt,
      },
      occurred_at: dispatchedAt,
    },
    { onConflict: "event_key" },
  );
  if (error) throw new Error(`生成已派送微信通知失败: ${error.message}`);
  await refreshDailyDraft(admin, serviceDate, customerCode);
  return { recorded: 1, serviceDate, customerCode, unitCount: units.length };
}
