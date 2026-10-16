import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summarizeReceivables, shippedBatchAges } from "./operations-summary";
import { settleBatchForCustomer } from "./orders.functions";
import {
  recordWecomDailyCustomerPayment,
  removeWecomDailyCustomerPayment,
} from "./wecom-daily-notify.server";
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

async function assertWalletManager(supabase: any, userId: string) {
  const roles = await Promise.all(
    ["owner", "manager"].map((_role) => supabase.rpc("has_role", { _user_id: userId, _role })),
  );
  if (roles.some((r) => r.error) || !roles.some((r) => r.data))
    throw new Error("无权执行客户代付款操作");
}

async function readCustomerReceivable(admin: any, userId: string) {
  const [
    { data: invoices, error: invoiceError },
    { data: profile, error: profileError },
    { data: wallet, error: walletError },
  ] = await Promise.all([
    admin
      .from("invoices")
      .select("id,user_id,type,batch_no,status,total_cny,paid_cny,paid_cad,fx_rate")
      .eq("user_id", userId)
      .in("status", ["unpaid", "overdue"]),
    admin.from("profiles").select("customer_code,full_name").eq("id", userId).maybeSingle(),
    admin.from("wallets").select("balance_cad").eq("user_id", userId).maybeSingle(),
  ]);
  if (invoiceError || profileError || walletError) throw new Error("读取客户待付款数据失败");
  const rows = summarizeReceivables(invoices ?? [], profile ? [{ id: userId, ...profile }] : [], [
    { user_id: userId, balance_cad: wallet?.balance_cad ?? 0 },
  ]);
  const summary = rows[0];
  if (!summary || !(summary.due_cad > 0)) throw new Error("该客户没有待付款账单");
  if (!profile?.customer_code) throw new Error("客户未关联客户号");
  return { invoices: invoices ?? [], profile, summary };
}

export const notifyCustomerReceivable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertWalletManager(context.supabase, context.userId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { profile, summary } = await readCustomerReceivable(admin, data.userId);
    if (summary.balance_cad >= summary.due_cad)
      throw new Error("客户余额充足，不需要发送余额不足通知");
    return recordWecomDailyCustomerPayment(
      admin,
      profile.customer_code,
      summary.due_cad,
      summary.balance_cad,
    );
  });

export const deductCustomerReceivable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertWalletManager(context.supabase, context.userId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { invoices, profile, summary } = await readCustomerReceivable(admin, data.userId);
    if (summary.balance_cad < summary.due_cad) throw new Error("客户余额不足，未执行任何扣款");
    const unsupported = invoices.filter((invoice: any) => invoice.type !== "batch");
    if (unsupported.length) throw new Error("客户存在非批次待付账单，请前往账单管理单独处理");

    const batchNos = [...new Set(invoices.map((invoice: any) => invoice.batch_no).filter(Boolean))];
    const { data: batches, error: batchError } = await admin
      .from("batches")
      .select("id,batch_no")
      .in("batch_no", batchNos);
    if (batchError) throw new Error(`读取账单批次失败: ${batchError.message}`);
    const batchByNo = new Map((batches ?? []).map((batch: any) => [batch.batch_no, batch.id]));
    let paidCad = 0;
    for (const invoice of invoices as any[]) {
      const batchId = batchByNo.get(invoice.batch_no);
      if (!batchId) throw new Error(`账单 ${invoice.id} 关联批次不存在，未继续扣款`);
      const amountCad = +(Number(invoice.total_cny) * Number(invoice.fx_rate)).toFixed(2);
      const result = await settleBatchForCustomer(admin, {
        batchId,
        customerUserId: data.userId,
        customerCode: profile.customer_code,
        method: "wallet",
        expectedCad: amountCad,
        operatorId: context.userId,
        operatorName: context.userId,
        enforceBalance: true,
        awardPoints: true,
      });
      if (!result.ok)
        throw new Error(
          result.reason === "insufficient_balance"
            ? "客户余额不足，扣款已停止"
            : `账单扣款失败: ${result.reason}`,
        );
      paidCad += Number(result.paid_cad ?? amountCad);
    }
    await removeWecomDailyCustomerPayment(admin, profile.customer_code);
    return { ok: true, invoiceCount: invoices.length, paidCad: +paidCad.toFixed(2) };
  });
