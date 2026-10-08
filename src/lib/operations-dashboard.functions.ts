import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarizeReceivables, shippedBatchAges } from "./operations-summary";
async function readAll(makeQuery: () => any, key = "id") {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await makeQuery()
      .order(key)
      .range(offset, offset + 499);
    if (r.error) throw new Error(r.error.message);
    rows.push(...(r.data ?? []));
    if ((r.data ?? []).length < 500) return rows;
  }
}
export const getOperationsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const staff = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (staff.error || !staff.data) throw new Error("无权查看运营概况");
    const roles = await Promise.all(
      ["owner", "manager"].map((_role) =>
        context.supabase.rpc("has_role", { _user_id: context.userId, _role: _role as any }),
      ),
    );
    if (roles.some((r) => r.error)) throw new Error("权限读取失败");
    const canSeeWallet = roles.some((r) => r.data);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [messages, wallet, batches] = await Promise.all([
      admin
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "new"),
      canSeeWallet
        ? admin
            .from("wallet_transactions")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve(null),
      readAll(() =>
        admin
          .from("batches")
          .select(
            "id,batch_no,display_name,status,shipping_method,actual_ship_date,planned_ship_date",
          ),
      ),
    ]);
    if (messages.error || wallet?.error) throw new Error("待办数量读取失败");
    let unpaidBatches = 0;
    // Use the same payment status as the batch list; bound concurrent database calls.
    for (let offset = 0; offset < batches.length; offset += 10) {
      const results = await Promise.all(
        batches
          .slice(offset, offset + 10)
          .map((b) => admin.rpc("batch_payment_status", { _batch_id: b.id })),
      );
      for (const r of results) {
        if (r.error) throw new Error("批次付款状态读取失败");
        if (["partial", "unpaid"].includes(r.data as string)) unpaidBatches++;
      }
    }
    let customers: ReturnType<typeof summarizeReceivables> = [];
    if (canSeeWallet) {
      const invoices = await readAll(() =>
        admin
          .from("invoices")
          .select("id,user_id,batch_no,status,total_cny,paid_cny,paid_cad,fx_rate")
          .in("status", ["unpaid", "overdue"]),
      );
      const ids = [...new Set(invoices.map((i) => i.user_id))];
      const profiles: any[] = [];
      const wallets: any[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100);
        const [p, w] = await Promise.all([
          readAll(() =>
            admin.from("profiles").select("id,customer_code,full_name").in("id", chunk),
          ),
          readAll(
            () => admin.from("wallets").select("user_id,balance_cad").in("user_id", chunk),
            "user_id",
          ),
        ]);
        profiles.push(...p);
        wallets.push(...w);
      }
      customers = summarizeReceivables(invoices, profiles, wallets);
    }
    return {
      unreadMessages: messages.count ?? 0,
      pendingWallet: wallet?.count ?? null,
      unpaidBatches,
      unconfirmedBatches: batches.filter((b) => b.status === "shipped").length,
      customers,
      canSeeWallet,
      transit: shippedBatchAges(batches),
    };
  });
