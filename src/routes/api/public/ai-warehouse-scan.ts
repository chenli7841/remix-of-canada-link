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

function fmt(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (isNaN(+d)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export const Route = createFileRoute("/api/public/ai-warehouse-scan")({
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

          // ---- 1. resolve FW / order relation + domestic tracking no ----
          const codes = new Set<string>([n]);
          let fwNo: string | null = null;
          let domesticNo: string | null = null;
          let orderFound = false;

          const addCode = (v: unknown) => {
            if (v) codes.add(String(v).toUpperCase());
          };

          const [fo, ord, wb] = await Promise.all([
            supabaseAdmin
              .from("forwarding_orders")
              .select("id, request_no, domestic_tracking_no")
              .or(
                `request_no.eq.${n},tracking_no.eq.${n},domestic_tracking_no.eq.${n},intl_tracking_no.eq.${n}`,
              )
              .limit(5),
            supabaseAdmin
              .from("orders")
              .select("id, order_no, domestic_tracking_no")
              .or(
                `order_no.eq.${n},tracking_no.eq.${n},domestic_tracking_no.eq.${n},intl_tracking_no.eq.${n}`,
              )
              .limit(5),
            supabaseAdmin
              .from("waybills")
              .select("id, waybill_no, order_id, forwarding_id")
              .or(`waybill_no.eq.${n},intl_tracking_no.eq.${n},mark_no.eq.${n}`)
              .limit(20),
          ]);

          const foRow = ((fo.data ?? []) as any[])[0];
          const ordRow = ((ord.data ?? []) as any[])[0];
          if (foRow) {
            orderFound = true;
            fwNo = foRow.request_no ?? null;
            domesticNo = foRow.domestic_tracking_no ?? null;
            addCode(foRow.domestic_tracking_no);
          } else if (ordRow) {
            orderFound = true;
            fwNo = ordRow.order_no ?? null;
            domesticNo = ordRow.domestic_tracking_no ?? null;
            addCode(ordRow.domestic_tracking_no);
          }

          // via waybill -> parent order
          if (!orderFound) {
            const wbRows = (wb.data ?? []) as any[];
            const foId = wbRows.map((w) => w.forwarding_id).find(Boolean);
            const ordId = wbRows.map((w) => w.order_id).find(Boolean);
            if (foId) {
              const { data } = await supabaseAdmin
                .from("forwarding_orders")
                .select("request_no, domestic_tracking_no")
                .eq("id", foId)
                .maybeSingle();
              if (data) {
                orderFound = true;
                fwNo = (data as any).request_no ?? null;
                domesticNo = (data as any).domestic_tracking_no ?? null;
                addCode((data as any).domestic_tracking_no);
              }
            } else if (ordId) {
              const { data } = await supabaseAdmin
                .from("orders")
                .select("order_no, domestic_tracking_no")
                .eq("id", ordId)
                .maybeSingle();
              if (data) {
                orderFound = true;
                fwNo = (data as any).order_no ?? null;
                domesticNo = (data as any).domestic_tracking_no ?? null;
                addCode((data as any).domestic_tracking_no);
              }
            }
          }

          const looksLikeOrderNo = /^(FW|SC)/i.test(n);
          if (!orderFound && !looksLikeOrderNo) domesticNo = input;

          const codeList = Array.from(codes);

          // ---- 2. scan / detained records by domestic tracking no ----
          const [det, scans] = await Promise.all([
            supabaseAdmin
              .from("detained_packages")
              .select("domestic_tracking_no, status, created_at, released_at")
              .in("domestic_tracking_no", codeList)
              .order("created_at", { ascending: true })
              .limit(1),
            supabaseAdmin
              .from("receiving_scans")
              .select("code, scanned_at")
              .in("code", codeList)
              .order("scanned_at", { ascending: true })
              .limit(1),
          ]);

          const d = (det.data ?? [])[0] as any | undefined;
          const s = (scans.data ?? [])[0] as any | undefined;

          const candidates: Array<{ at: string; source: string; code: string }> = [];
          if (d?.created_at) candidates.push({ at: d.created_at, source: "detained_package", code: d.domestic_tracking_no });
          if (s?.scanned_at) candidates.push({ at: s.scanned_at, source: "receiving_scan", code: s.code });
          candidates.sort((a, b) => +new Date(a.at) - +new Date(b.at));
          const first = candidates[0];
          if (first?.code) domesticNo = first.code;

          const base = {
            tracking_number: input,
            order_found: orderFound,
            fw_tracking_no: fwNo,
            domestic_tracking_no: domesticNo ?? null,
            detained_status: d?.status ?? null,
            released_at: d?.released_at ?? null,
          };

          // ---- 3. branch ----
          if (!first) {
            if (!orderFound && looksLikeOrderNo) {
              return json({
                ...base,
                found: false,
                needs_order_entry: false,
                result_code: "fw_not_found",
                first_scan_at: null,
                first_scan_at_text: null,
                scan_source: null,
                scan_text: `未查询到集运单号 ${input}，请核对单号是否正确。`,
              });
            }
            return json({
              ...base,
              found: false,
              needs_order_entry: false,
              result_code: "scan_not_found",
              first_scan_at: null,
              first_scan_at_text: null,
              scan_source: null,
              scan_text: `未查询到运单号 ${input} 的到仓扫描记录。`,
            });
          }

          const at = fmt(first.at);

          if (!orderFound) {
            return json({
              ...base,
              found: true,
              needs_order_entry: true,
              result_code: "needs_order_entry",
              first_scan_at: first.at,
              first_scan_at_text: at,
              scan_source: first.source,
              scan_text:
                `系统已查询到该包裹的到仓扫描记录（首次到仓时间 ${at}），但尚未找到对应的集运订单。` +
                `请先登录系统录入该国内快递单号并生成 FW 运单，完成后等待仓库二次扫描入库。`,
            });
          }

          return json({
            ...base,
            found: true,
            needs_order_entry: false,
            result_code: "pending_second_scan",
            first_scan_at: first.at,
            first_scan_at_text: at,
            scan_source: first.source,
            scan_text:
              `您的包裹（集运单号 ${fwNo ?? "—"}）已于 ${at} 到达仓库并完成首次扫描。` +
              `由于运单录入时间晚于包裹到仓时间，需要等待仓库二次扫描后才能完成入库，请耐心等待。`,
          });
        } catch (e) {
          console.error("[ai-warehouse-scan] unexpected", e);
          return json({ found: false, error: "scan_lookup_failed" }, 200);
        }
      },
    },
  },
});
