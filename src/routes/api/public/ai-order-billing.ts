import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? +n.toFixed(3) : null;
};

const SHIPPING_ZH: Record<string, string> = {
  air: "空运",
  sea: "海运",
  express: "快递",
  rail: "铁运",
  truck: "陆运",
  storage: "仓储",
};

type EtaBasis = "pending_delivery" | "batch_departure" | "not_available";

type WaybillOut = {
  tracking_no: string;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  actual_weight_kg: number | null;
  volume_weight_kg: number | null;
  chargeable_weight_kg: number | null;
  estimated_arrival_start: string | null;
  estimated_arrival_end: string | null;
  estimated_arrival_text: string;
  eta_basis: EtaBasis;
};

const ETA_DISCLAIMER =
  "以上预计时间为系统根据当前运输进度计算，仅供参考，并非承诺到达时间。如需了解更准确的到达时间，请在货物临近到达时联系客服确认。";

// transit windows (days) by batch shipping method
const TRANSIT_DAYS: Record<string, [number, number]> = {
  air: [9, 15],
  sea: [45, 60],
};
const PENDING_DELIVERY_DAYS: [number, number] = [3, 7];

function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function addDays(base: string, days: number): string | null {
  const t = Date.parse(base.length === 10 ? `${base}T00:00:00Z` : base);
  if (!Number.isFinite(t)) return null;
  return fmtDate(new Date(t + days * 86400000));
}

function etaRange(
  from: string | null,
  window: [number, number] | undefined,
  basis: EtaBasis,
): { start: string | null; end: string | null; text: string; basis: EtaBasis } {
  if (!from || !window) {
    return { start: null, end: null, text: "暂无法预计到达时间，请联系客服确认。", basis: "not_available" };
  }
  const start = addDays(from, window[0]);
  const end = addDays(from, window[1]);
  if (!start || !end) {
    return { start: null, end: null, text: "暂无法预计到达时间，请联系客服确认。", basis: "not_available" };
  }
  return { start, end, text: `预计到达时间：${start}—${end}。\n${ETA_DISCLAIMER}`, basis };
}

function fmtNum(v: number | null, unit: string): string {
  return v === null ? "—" : `${v}${unit}`;
}

function buildBillingText(p: {
  result_code: string;
  query_number: string;
  fw_tracking_no: string | null;
  waybills: WaybillOut[];
  batch: {
    batch_no: string | null;
    shipping_method: string | null;
    customer_waybill_count?: number | null;
  } | null;
  billing: any | null;
  eta?: { start: string | null; end: string | null; basis: EtaBasis } | null;
}): string {
  const L: string[] = [];
  L.push(`订单号：${p.fw_tracking_no ?? p.query_number}`);
  if (!p.waybills.length) {
    L.push("该订单尚未生成运单，请等待仓库收货入库后生成运单。");
    return L.join("\n");
  }
  L.push(`关联运单（共 ${p.waybills.length} 个）：`);
  for (const w of p.waybills) {
    L.push(`运单号：${w.tracking_no}`);
    L.push(
      `  尺寸：${fmtNum(w.length_cm, "")} × ${fmtNum(w.width_cm, "")} × ${fmtNum(w.height_cm, "")} cm`,
    );
    L.push(`  实际重量：${fmtNum(w.actual_weight_kg, " kg")}`);
    L.push(`  体积重量：${fmtNum(w.volume_weight_kg, " kg")}`);
    L.push(`  计费重量：${fmtNum(w.chargeable_weight_kg, " kg")}`);
  }
  if (!p.batch?.batch_no) {
    L.push("这些运单尚未装入批次，暂无批次运费记录。");
    return L.join("\n");
  }
  L.push(
    `所属批次：${p.batch.batch_no}${p.batch.shipping_method ? `（${SHIPPING_ZH[p.batch.shipping_method] ?? p.batch.shipping_method}）` : ""}`,
  );
  if (typeof p.batch.customer_waybill_count === "number") {
    L.push(`您在该批次共有 ${p.batch.customer_waybill_count} 个运单。`);
  }

  // ETA block: merged when all waybills share the same range, otherwise per waybill
  const uniq = Array.from(
    new Set(p.waybills.map((w) => `${w.estimated_arrival_start ?? ""}|${w.estimated_arrival_end ?? ""}`)),
  );
  if (p.eta && p.eta.start && p.eta.end) {
    if (uniq.length === 1) {
      L.push(`预计到达时间：${p.eta.start}—${p.eta.end}。`);
    } else {
      L.push("各运单预计到达时间：");
      for (const w of p.waybills) {
        L.push(
          `  ${w.tracking_no}：${
            w.estimated_arrival_start && w.estimated_arrival_end
              ? `${w.estimated_arrival_start}—${w.estimated_arrival_end}`
              : "暂无法预计"
          }`,
        );
      }
      L.push(`整体预计到达时间：${p.eta.start}—${p.eta.end}。`);
    }
    L.push(ETA_DISCLAIMER);
  } else {
    L.push("该批次暂无实际发货时间，暂无法预计到达时间，请联系客服确认。");
  }

  if (!p.billing) {
    L.push("该批次中您的费用尚未由客服确认，请等待客服确认费用后查询。");
    return L.join("\n");
  }
  const cur = p.billing.currency || "CAD";
  L.push(`费用状态：${p.billing.billing_status === "confirmed" ? "已确认" : "待客服确认"}`);
  L.push(`计费重量合计：${fmtNum(p.billing.quantity, " kg")}`);
  L.push(`费用金额：${cur} ${Number(p.billing.amount ?? 0).toFixed(2)}`);
  if (Array.isArray(p.billing.fee_items) && p.billing.fee_items.length) {
    L.push("费用明细：");
    for (const it of p.billing.fee_items) {
      L.push(`  ${it.fee_name}：${cur} ${Number(it.amount ?? 0).toFixed(2)}`);
    }
  }
  return L.join("\n");
}


export const Route = createFileRoute("/api/public/ai-order-billing")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => json({ found: false, error: "use_post" }, 405),
      POST: async ({ request }) => {
        try {
          let body: any = {};
          try {
            body = await request.json();
          } catch {
            body = {};
          }
          const input = String(body?.tracking_number ?? "").trim();
          if (!input) {
            return json({ found: false, error: "tracking_number_required" }, 400);
          }
          const n = input.toUpperCase();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // ---------- 1. resolve parent order (forwarding_orders / orders) ----------
          let foId: string | null = null;
          let ordId: string | null = null;
          let orderNo: string | null = null;
          let customerCode: string | null = null;
          const domesticNos = new Set<string>();

          const [fo, ord, wbHit] = await Promise.all([
            supabaseAdmin
              .from("forwarding_orders")
              .select("id, request_no, customer_code, domestic_tracking_no")
              .or(
                `request_no.eq.${n},tracking_no.eq.${n},domestic_tracking_no.eq.${n},intl_tracking_no.eq.${n}`,
              )
              .limit(1),
            supabaseAdmin
              .from("orders")
              .select("id, order_no, customer_code, domestic_tracking_no")
              .or(
                `order_no.eq.${n},tracking_no.eq.${n},domestic_tracking_no.eq.${n},intl_tracking_no.eq.${n}`,
              )
              .limit(1),
            supabaseAdmin
              .from("waybills")
              .select("id, order_id, forwarding_id")
              .or(`waybill_no.eq.${n},intl_tracking_no.eq.${n},mark_no.eq.${n}`)
              .limit(5),
          ]);

          const foRow = ((fo.data ?? []) as any[])[0];
          const ordRow = ((ord.data ?? []) as any[])[0];
          if (foRow) {
            foId = foRow.id;
            orderNo = foRow.request_no ?? null;
            customerCode = foRow.customer_code ?? null;
            if (foRow.domestic_tracking_no) domesticNos.add(foRow.domestic_tracking_no);
          } else if (ordRow) {
            ordId = ordRow.id;
            orderNo = ordRow.order_no ?? null;
            customerCode = ordRow.customer_code ?? null;
            if (ordRow.domestic_tracking_no) domesticNos.add(ordRow.domestic_tracking_no);
          } else {
            const rows = (wbHit.data ?? []) as any[];
            const fid = rows.map((r) => r.forwarding_id).find(Boolean);
            const oid = rows.map((r) => r.order_id).find(Boolean);
            if (fid) {
              const { data } = await supabaseAdmin
                .from("forwarding_orders")
                .select("id, request_no, customer_code, domestic_tracking_no")
                .eq("id", fid)
                .maybeSingle();
              if (data) {
                foId = (data as any).id;
                orderNo = (data as any).request_no ?? null;
                customerCode = (data as any).customer_code ?? null;
                if ((data as any).domestic_tracking_no) domesticNos.add((data as any).domestic_tracking_no);
              }
            } else if (oid) {
              const { data } = await supabaseAdmin
                .from("orders")
                .select("id, order_no, customer_code, domestic_tracking_no")
                .eq("id", oid)
                .maybeSingle();
              if (data) {
                ordId = (data as any).id;
                orderNo = (data as any).order_no ?? null;
                customerCode = (data as any).customer_code ?? null;
                if ((data as any).domestic_tracking_no) domesticNos.add((data as any).domestic_tracking_no);
              }
            }
          }

          const base = {
            query_number: input,
            fw_tracking_no: orderNo,
            domestic_tracking_numbers: [] as string[],
            waybills: [] as WaybillOut[],
            batch: null as any,
            customer_billing: null as any,
            estimated_arrival_start: null as string | null,
            estimated_arrival_end: null as string | null,
            estimated_arrival_text: "暂无法预计到达时间，请联系客服确认。",
            eta_basis: "not_available" as EtaBasis,
            eta_disclaimer: ETA_DISCLAIMER,
          };

          if (!foId && !ordId) {
            return json({
              ...base,
              found: false,
              result_code: "not_found",
              billing_text: `未查询到单号 ${input} 对应的订单，请核对后重试。`,
            });
          }

          // ---------- 2. all waybills of this order ----------
          const wbQ = supabaseAdmin
            .from("waybills")
            .select(
              "id, waybill_no, length_cm, width_cm, height_cm, weight_kg, weight_snapshot, assigned_batch_id, batch_no, carton_id, pallet_id",
            )
            .order("waybill_no", { ascending: true });
          const { data: wbData } = foId
            ? await wbQ.eq("forwarding_id", foId)
            : await wbQ.eq("order_id", ordId!);
          const wbRows = (wbData ?? []) as any[];

          const waybills: WaybillOut[] = wbRows.map((w) => {
            const snap = (w.weight_snapshot ?? {}) as any;
            return {
              tracking_no: w.waybill_no,
              length_cm: num(w.length_cm),
              width_cm: num(w.width_cm),
              height_cm: num(w.height_cm),
              actual_weight_kg: num(snap.actual_weight ?? w.weight_kg),
              volume_weight_kg: num(snap.volumetric_weight),
              chargeable_weight_kg: num(snap.chargeable_weight),
              estimated_arrival_start: null,
              estimated_arrival_end: null,
              estimated_arrival_text: "暂无法预计到达时间，请联系客服确认。",
              eta_basis: "not_available" as EtaBasis,
            };
          });

          base.waybills = waybills;
          base.domestic_tracking_numbers = Array.from(domesticNos);

          if (!waybills.length) {
            return json({
              ...base,
              found: true,
              result_code: "waybill_pending",
              billing_text: buildBillingText({
                result_code: "waybill_pending",
                query_number: input,
                fw_tracking_no: orderNo,
                waybills,
                batch: null,
                billing: null,
              }),
            });
          }

          // ---------- 3. unique batch ----------
          const batchIds = Array.from(
            new Set(wbRows.map((w) => w.assigned_batch_id).filter(Boolean) as string[]),
          );
          if (batchIds.length === 0) {
            return json({
              ...base,
              found: true,
              result_code: "batch_pending",
              billing_text: buildBillingText({
                result_code: "batch_pending",
                query_number: input,
                fw_tracking_no: orderNo,
                waybills,
                batch: null,
                billing: null,
              }),
            });
          }
          if (batchIds.length > 1) {
            return json({
              ...base,
              found: true,
              result_code: "batch_data_error",
              billing_text:
                `该订单的运单被分配到了多个批次，数据异常，请联系客服核实后再查询。`,
            });
          }

          const batchId = batchIds[0];
          const { data: batchRow } = await supabaseAdmin
            .from("batches")
            .select("batch_no, shipping_method, status, planned_ship_date")
            .eq("id", batchId)
            .maybeSingle();

          // ---- 3a. this customer's waybill count inside the batch (dedup by waybill id) ----
          const { data: batchWbData } = await supabaseAdmin
            .from("waybills")
            .select("id, waybill_no, order_id, forwarding_id")
            .eq("assigned_batch_id", batchId);
          const batchWbRows = (batchWbData ?? []) as any[];
          let customerWaybillCount: number | null = null;
          if (customerCode) {
            const foIds = Array.from(new Set(batchWbRows.map((w) => w.forwarding_id).filter(Boolean)));
            const orIds = Array.from(new Set(batchWbRows.map((w) => w.order_id).filter(Boolean)));
            const [foOwn, ordOwn] = await Promise.all([
              foIds.length
                ? supabaseAdmin.from("forwarding_orders").select("id, customer_code").in("id", foIds)
                : Promise.resolve({ data: [] as any[] }),
              orIds.length
                ? supabaseAdmin.from("orders").select("id, customer_code").in("id", orIds)
                : Promise.resolve({ data: [] as any[] }),
            ]);
            const owner = new Map<string, string>();
            for (const r of ((foOwn as any).data ?? []) as any[]) owner.set(r.id, r.customer_code);
            for (const r of ((ordOwn as any).data ?? []) as any[]) owner.set(r.id, r.customer_code);
            const mineIds = new Set(
              batchWbRows
                .filter((w) => owner.get(w.forwarding_id ?? w.order_id) === customerCode)
                .map((w) => w.id as string),
            );
            customerWaybillCount = mineIds.size;
          }

          const batchStatus = (batchRow as any)?.status ?? null;
          const shippedStatuses = new Set(["shipped", "arrived", "closed"]);
          const departureDate =
            batchStatus && shippedStatuses.has(batchStatus)
              ? ((batchRow as any)?.planned_ship_date ?? null)
              : null;
          const batch = {
            batch_no: (batchRow as any)?.batch_no ?? null,
            shipping_method: (batchRow as any)?.shipping_method ?? null,
            customer_waybill_count: customerWaybillCount,
          };
          base.batch = batch;

          // ---- 3b. ETA per waybill ----
          const wbIds = wbRows.map((w) => w.id as string);
          const cartonIds = Array.from(new Set(wbRows.map((w) => w.carton_id).filter(Boolean) as string[]));
          const palletIds = Array.from(new Set(wbRows.map((w) => w.pallet_id).filter(Boolean) as string[]));
          const refIds = [...wbIds, ...cartonIds, ...palletIds];
          const { data: dqData } = refIds.length
            ? await supabaseAdmin
                .from("delivery_queue")
                .select("kind, ref_id, created_at")
                .in("ref_id", refIds)
            : { data: [] as any[] };
          const dqEarliest = new Map<string, string>();
          for (const r of ((dqData ?? []) as any[])) {
            const prev = dqEarliest.get(r.ref_id);
            if (!prev || r.created_at < prev) dqEarliest.set(r.ref_id, r.created_at);
          }

          const methodWindow = TRANSIT_DAYS[String(batch.shipping_method ?? "")];
          for (let i = 0; i < waybills.length; i++) {
            const raw = wbRows[i];
            const queuedAt =
              dqEarliest.get(raw.id) ??
              (raw.carton_id ? dqEarliest.get(raw.carton_id) : undefined) ??
              (raw.pallet_id ? dqEarliest.get(raw.pallet_id) : undefined) ??
              null;
            const r = queuedAt
              ? etaRange(queuedAt, PENDING_DELIVERY_DAYS, "pending_delivery")
              : etaRange(departureDate, methodWindow, "batch_departure");
            waybills[i].estimated_arrival_start = r.start;
            waybills[i].estimated_arrival_end = r.end;
            waybills[i].estimated_arrival_text = r.text;
            waybills[i].eta_basis = r.basis;
          }

          const starts = waybills.map((w) => w.estimated_arrival_start).filter(Boolean) as string[];
          const ends = waybills.map((w) => w.estimated_arrival_end).filter(Boolean) as string[];
          const bases = new Set(waybills.map((w) => w.eta_basis));
          const topStart = starts.length ? starts.slice().sort()[0] : null;
          const topEnd = ends.length ? ends.slice().sort().reverse()[0] : null;
          base.estimated_arrival_start = topStart;
          base.estimated_arrival_end = topEnd;
          base.eta_basis =
            topStart && topEnd
              ? bases.has("pending_delivery") && bases.size === 1
                ? "pending_delivery"
                : bases.has("pending_delivery")
                  ? "pending_delivery"
                  : "batch_departure"
              : "not_available";
          base.estimated_arrival_text =
            topStart && topEnd
              ? `预计到达时间：${topStart}—${topEnd}。\n${ETA_DISCLAIMER}`
              : "暂无法预计到达时间，请联系客服确认。";
          const etaTop = { start: topStart, end: topEnd, basis: base.eta_basis as EtaBasis };


          if (!customerCode) {
            return json({
              ...base,
              found: true,
              result_code: "billing_pending",
              billing_text: buildBillingText({
                result_code: "billing_pending",
                query_number: input,
                fw_tracking_no: orderNo,
                waybills,
                batch,
                billing: null,
                eta: etaTop,
              }),
            });
          }

          // ---------- 4. this customer's fee record inside the batch ----------
          const { computeBatchFeeSummary } = await import("@/lib/orders.functions");
          const summary: any = await computeBatchFeeSummary(supabaseAdmin, batchId);
          const mine = ((summary?.per_customer ?? []) as any[]).filter(
            (c) => c.customer_code === customerCode,
          );

          const toBilling = (c: any) => {
            const items = [
              ["运费", c.fee_freight_cad],
              ["关税", c.fee_customs_cad],
              ["保险费", c.fee_insurance_cad],
              ["清关费", c.fee_clearance_cad],
              ["末端派送费", c.fee_delivery_cad],
              ["检查费", c.fee_inspection_cad],
              ["附加费", c.fee_surcharge_cad],
            ]
              .filter(([, v]) => Number(v ?? 0) !== 0)
              .map(([name, v]) => ({
                fee_name: name as string,
                amount: +Number(v).toFixed(2),
                currency: "CAD",
              }));
            return {
              billing_status: c.price_confirmed ? "confirmed" : "pending_confirm",
              fee_name: "批次运费合计",
              quantity: num(c.weight_kg),
              unit: "kg",
              unit_price: null,
              amount: +Number(c.subtotal_cad ?? 0).toFixed(2),
              currency: "CAD",
              description: `批次 ${batch.batch_no ?? ""} 费用合计`,
              fee_items: items,
            };
          };

          if (mine.length === 0) {
            return json({
              ...base,
              found: true,
              result_code: "billing_pending",
              billing_text: buildBillingText({
                result_code: "billing_pending",
                query_number: input,
                fw_tracking_no: orderNo,
                waybills,
                batch,
                billing: null,
                eta: etaTop,
              }),
            });
          }
          if (mine.length > 1) {
            return json({
              ...base,
              found: true,
              result_code: "customer_billing_data_error",
              customer_billing: null,
              billing_text:
                `该批次中查询到多条属于您的运费记录，数据异常，请联系客服核实后再查询。`,
            });
          }

          const c = mine[0];
          const billing = toBilling(c);
          if (!c.price_confirmed) {
            return json({
              ...base,
              found: true,
              result_code: "billing_pending",
              customer_billing: { ...billing, amount: null, fee_items: [] },
              billing_text: buildBillingText({
                result_code: "billing_pending",
                query_number: input,
                fw_tracking_no: orderNo,
                waybills,
                batch,
                billing: null,
                eta: etaTop,
              }),
            });
          }

          return json({
            ...base,
            found: true,
            result_code: "billing_found",
            customer_billing: billing,
            billing_text: buildBillingText({
              result_code: "billing_found",
              query_number: input,
              fw_tracking_no: orderNo,
              waybills,
              batch,
              billing,
              eta: etaTop,
            }),
          });
        } catch (e) {
          console.error("[ai-order-billing] unexpected", e);
          return json({ found: false, error: "billing_lookup_failed" }, 200);
        }
      },
    },
  },
});
