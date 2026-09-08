import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

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

// 去掉状态文案中的内部信息（员工邮箱 / 操作员 / 内部备注）
function sanitizeText(v: unknown): string {
  let s = typeof v === "string" ? v : "";
  s = s.replace(/[\s/|,·，、-]*(操作员|操作人|Operator|By)\s*[:：]?\s*\S*@\S+/gi, "");
  s = s.replace(/\S+@\S+\.\S+/g, "");
  s = s.replace(/[\s/|,·，、]*(操作员|操作人|Operator)\s*[:：]?\s*\S*/gi, "");
  return s.replace(/[\s/|·-]+$/g, "").trim();
}
const SHIPPING_ZH: Record<string, string> = {
  air: "空运",
  sea: "海运",
  express: "快递",
  rail: "铁运",
  truck: "陆运",
  storage: "仓储",
};

function fmtDate(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (isNaN(+d)) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return p;
}

function buildTrackingText(payload: {
  tracking_no: string;
  shipping_method: string | null;
  status: string | null;
  current_location: string | null;
  eta: string | null;
  carrier: string | null;
  events: Array<{
    status_en: string;
    status_zh: string;
    event_time: string | null;
    location_en: string | null;
    location_zh: string | null;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`运单号：${payload.tracking_no}`);
  if (payload.shipping_method) {
    lines.push(
      `运输方式：${SHIPPING_ZH[payload.shipping_method] ?? payload.shipping_method}`,
    );
  }
  const evts = payload.events ?? [];
  const label = (e: (typeof evts)[number]) => {
    const head = [fmtDate(e.event_time), e.status_zh || e.status_en || ""]
      .filter(Boolean)
      .join(" ");
    const loc = e.location_zh || e.location_en || "";
    return loc ? `${head} - ${loc}` : head;
  };


  const last = evts.length ? evts[evts.length - 1] : null;
  const statusText = last?.status_zh || last?.status_en || payload.status || "";
  if (statusText) lines.push(`当前状态：${statusText}`);
  if (payload.current_location) lines.push(`当前位置：${payload.current_location}`);
  if (payload.eta) lines.push(`预计到达：${fmtDate(payload.eta) || payload.eta}`);
  if (payload.carrier) lines.push(`承运商：${payload.carrier}`);
  if (last) lines.push(`最新物流：${label(last)}`);
  if (evts.length) {
    lines.push("历史物流：");
    for (const e of evts) lines.push(label(e));
  }
  return lines.join("\n");
}


export const Route = createFileRoute("/api/public/ai-track")({
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
          const trackingNumber = String(body?.tracking_number ?? "").trim();
          if (!trackingNumber) {
            return json({ found: false, error: "tracking_number_required" }, 400);
          }

          const supabase = createClient(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_PUBLISHABLE_KEY"]!,
            { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
          );

          const { data, error } = await supabase.rpc("track_by_any_no", { _input: trackingNumber });
          if (error) {
            console.error("[ai-track] rpc error", error.message);
            return json({ found: false, error: "tracking_lookup_failed" }, 200);
          }
          const row: any = Array.isArray(data) ? data[0] : data;
          if (!row || !row.tracking_no) {
            return json(
              {
                found: false,
                tracking_number: trackingNumber,
                status_code: "not_found",
                status_text: "未查询到",
                tracking_text: `未查询到运单号 ${trackingNumber} 的物流信息。`,
              },
              200,
            );
          }


          const rawEvents = Array.isArray(row.events) ? row.events : [];
          const events = rawEvents
            .map((e: any) => ({
              status_en: sanitizeText(e?.status_en),
              status_zh: sanitizeText(e?.status_zh),
              event_time: e?.event_time ?? null,
              location_en: e?.location_en ? sanitizeText(e.location_en) : null,
              location_zh: e?.location_zh ? sanitizeText(e.location_zh) : null,
            }))
            .sort(
              (a: any, b: any) =>
                +new Date(a.event_time ?? 0) - +new Date(b.event_time ?? 0),
            );

          const received = events.some(
            (e: any) =>
              /仓库已收件|已到达集运仓|仓储中|已入库/.test(e.status_zh ?? "") ||
              /received at warehouse|in storage|arrived/i.test(e.status_en ?? ""),
          );
          const statusCode = received ? "in_progress" : "pending_intake";
          const statusText = received
            ? events[events.length - 1]?.status_zh || row.status || "运输中"
            : "待入库";

          const payload = {
            found: true,
            tracking_no: row.tracking_no ?? trackingNumber,
            shipping_method: row.shipping_method ?? null,
            status: row.status ?? null,
            current_location: row.current_location ?? null,
            eta: row.eta ?? null,
            carrier: row.carrier ?? null,
            created_at: row.created_at ?? null,
            events,
          };
          return json({
            ...payload,
            status_code: statusCode,
            status_text: statusText,
            tracking_text: buildTrackingText(payload),
          });

        } catch (e) {
          console.error("[ai-track] unexpected", e);
          return json({ found: false, error: "tracking_lookup_failed" }, 200);
        }
      },
    },
  },
});
