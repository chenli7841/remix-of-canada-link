import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { computeBatchFeeSummary } from "@/lib/orders.functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "list_my_batches",
  title: "List my shipping batches",
  description:
    "List the signed-in customer's visible EPLUS batches using the same fee-summary logic as the customer website. When the customer mentions a month, call this tool immediately with month=YYYY-MM before asking for a batch or waybill number. If exactly one batch matches, answer from it. If multiple match, show only their batch names/numbers and ask the customer to choose. If none match, then ask for a waybill number or approximate order-creation date. Amounts are CAD. This tool cannot pay a batch.",
  inputSchema: {
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("Planned shipping month in YYYY-MM, using the customer's intended year."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data: authData } = await supabaseForUser(ctx).auth.getUser();
    const uid = authData.user?.id;
    if (!uid) return unauthenticatedResult();
    try {
      const [{ data: profile }, { data: myWbs }] = await Promise.all([
        supabaseAdmin.from("profiles").select("customer_code").eq("id", uid).maybeSingle(),
        supabaseAdmin
          .from("waybills")
          .select("id,assigned_batch_id,order_id,forwarding_id,waybill_no,status,payment_status,intl_tracking_no")
          .eq("user_id", uid)
          .not("assigned_batch_id", "is", null),
      ]);
      const customerCode = profile?.customer_code ?? null;
      const wbs = myWbs ?? [];
      const batchIds = Array.from(new Set(wbs.map((w: any) => w.assigned_batch_id).filter(Boolean)));
      if (!batchIds.length) return { content: [{ type: "text", text: "[]" }], structuredContent: { currency: "CAD", batches: [] } };
      let batchQuery = supabaseAdmin.from("batches").select("id,batch_no,status,shipping_method,planned_ship_date,eta_date")
        .in("id", batchIds).in("status", ["shipped", "arrived", "closed"]);
      if (month) {
        const [year, monthNumber] = month.split("-").map(Number);
        const from = `${month}-01`;
        const nextMonth = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
        batchQuery = batchQuery.gte("planned_ship_date", from).lt("planned_ship_date", nextMonth);
      }
      const { data: batchRows } = await batchQuery.order("planned_ship_date", { ascending: false }).limit(limit ?? 20);
      const batches = [];
      for (const b of batchRows ?? []) {
        const mineWbs = wbs.filter((w: any) => w.assigned_batch_id === b.id);
        const summary: any = await computeBatchFeeSummary(supabaseAdmin, b.id);
        const mine = customerCode ? summary.per_customer.filter((p: any) => p.customer_code === customerCode) : [];
        const priceConfirmed = mine.length > 0 && mine.every((p: any) => p.price_confirmed);
        const subtotalCad = +mine.reduce((sum: number, p: any) => sum + Number(p.subtotal_cny ?? 0), 0).toFixed(2);
        batches.push({
          batch_id: b.id, batch_no: b.batch_no, status: b.status, shipping_method: b.shipping_method, planned_ship_date: b.planned_ship_date,
          eta: b.eta_date, subtotal_cad: priceConfirmed ? subtotalCad : null, price_confirmed: priceConfirmed,
          is_paid: mineWbs.length > 0 && mineWbs.every((w: any) => w.payment_status === "paid"),
          payment_available_here: false, payment_instruction: "请前往 EPLUS 网页完成支付",
          waybills: mineWbs.map((w: any) => ({ waybill_no: w.waybill_no, status: w.status,
            payment_status: w.payment_status, intl_tracking_no: w.intl_tracking_no })),
        });
      }
      return { content: [{ type: "text", text: JSON.stringify({ currency: "CAD", month: month ?? null, match_count: batches.length, batches }, null, 2) }], structuredContent: { currency: "CAD", month: month ?? null, match_count: batches.length, batches } };
    } catch (error) {
      console.error("MCP list_my_batches failed", error);
      return queryFailedResult();
    }
  },
});
