import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getFxCadPerCny, computeMyBatchesForUser } from "@/lib/orders.functions";
import { normalizeHsCodeForStorage } from "@/lib/hs-code-format";

// Backs the admin "客户视图" page: owner/warehouse/support/sales (see
// NAV_GROUPS in admin/route.tsx, where this link overrides its group's
// default owner+manager access) can look a customer up by customer_code and
// view/edit a slice of their account data on their behalf, without ever
// switching sessions (the acting admin's identity is preserved
// end-to-end). Every write here is attributed via admin_action_logs — same
// table/shape src/lib/orders.functions.ts already uses for staff actions.
// The nav hides this from everyone else, but that's client-side only —
// this check is what actually enforces it.
const CUSTOMER_VIEW_ROLES = ["owner", "warehouse_cn", "warehouse_ca", "support", "sales", "sales_rep"] as const;
// targetUserId 传了才做"归属"这层额外限制——只对纯 sales_rep（不同时是
// owner/manager）生效；sales/warehouse_*/support 这些原有角色保持不受限，
// 这次只加新角色的限制，不收紧老角色。
async function assertCustomerViewAccess(supabase: any, userId: string, targetUserId?: string) {
  const results = await Promise.all(
    CUSTOMER_VIEW_ROLES.map((role) => supabase.rpc("has_role", { _user_id: userId, _role: role })),
  );
  for (const { error } of results) if (error) throw new Error(error.message);
  if (!results.some((r) => r.data)) throw new Error("Forbidden: no customer-view access");

  if (!targetUserId) return;
  const [{ data: isSalesRep, error: srErr }, { data: isOwner, error: ownerErr }, { data: isManager, error: mgrErr }] =
    await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "sales_rep" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
    ]);
  if (srErr) throw new Error(srErr.message);
  if (ownerErr) throw new Error(ownerErr.message);
  if (mgrErr) throw new Error(mgrErr.message);
  if (!isSalesRep || isOwner || isManager) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: target } = await (supabaseAdmin as any)
    .from("profiles")
    .select("sales_rep_id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!target || target.sales_rep_id !== userId) throw new Error("Forbidden: not your assigned customer");
}

async function getOperatorName(admin: any, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return data?.full_name || data?.email || userId;
}

async function recordLog(
  admin: any,
  opts: {
    entity_type: string;
    entity_id: string;
    action: string;
    before?: any;
    after?: any;
    operator_id: string;
    operator_name?: string;
    note?: string;
  },
) {
  await admin.from("admin_action_logs").insert({
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: opts.action,
    before: opts.before ?? null,
    after: opts.after ?? null,
    operator_id: opts.operator_id,
    operator_name: opts.operator_name ?? null,
    note: opts.note ?? null,
  });
}

// ============ Look up a customer by customer_code ============
export const findCustomerByCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data, context }) => {
    // 这里还不知道目标客户是谁（正在按客户号查），先只做"有没有客户视图访问权"这层
    // 基础检查；查到人以后再补"归属"这层检查——sales_rep 查到不是自己客户的号，
    // 按"查无此客户"处理（跟真的没查到一个返回形状），不是一个吓人的权限报错。
    await assertCustomerViewAccess(context.supabase, context.userId);
    const code = data.code.trim();
    if (!code) throw new Error("请输入客户号");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // sales_rep_id 还没进生成的 types.ts（新迁移列），select 串带上它会让整行的类型
    // 推断塌成 SelectQueryError——这里转 any 绕过，运行时字段是真实存在的。
    const { data: profile, error } = (await supabaseAdmin
      .from("profiles")
      .select(
        "id, customer_code, full_name, email, phone, username, preferred_lang, vip_level, points, is_blacklisted, blacklist_reason, created_at, sales_rep_id",
      )
      .ilike("customer_code", code)
      .maybeSingle()) as any;
    if (error) throw new Error(error.message);
    if (!profile) return { profile: null, roles: [] as string[] };
    try {
      await assertCustomerViewAccess(context.supabase, context.userId, profile.id);
    } catch {
      return { profile: null, roles: [] as string[] };
    }
    const { data: roleRows } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", profile.id);
    return { profile, roles: (roleRows ?? []).map((r: any) => r.role as string) };
  });

// ============ Overview (read-only) ============
export const getCustomerOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: wallet }, { data: orders }, { data: fwd }, { data: unpaidInv }] = await Promise.all([
      supabaseAdmin.from("wallets").select("balance_cad").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("orders").select("id,status").eq("user_id", data.userId),
      supabaseAdmin.from("forwarding_orders").select("id,status").eq("user_id", data.userId),
      supabaseAdmin
        .from("invoices")
        .select("invoice_no,total_cny,paid_cny,status,due_date")
        .eq("user_id", data.userId)
        .in("status", ["unpaid", "overdue"]),
    ]);
    // 用系统设定汇率（app_settings.fx_rate）换算，不用每张账单快照的 fx_rate
    const fx = await getFxCadPerCny(supabaseAdmin);
    const oRows = orders ?? [];
    const fRows = fwd ?? [];
    const inTransit =
      oRows.filter((r: any) => r.status === "shipped").length +
      fRows.filter((r: any) => ["shipped", "in_transit"].includes(r.status)).length;
    const unwarehoused = fRows.filter((r: any) => r.status === "pending").length;
    const unpaidInvoices = (unpaidInv ?? []).map((inv: any) => {
      const dueCny = Math.max(0, Number(inv.total_cny ?? 0) - Number(inv.paid_cny ?? 0));
      return {
        invoice_no: inv.invoice_no,
        due_cad: +(dueCny * fx).toFixed(2),
        status: inv.status,
        due_date: inv.due_date,
      };
    });
    return {
      wallet_balance_cad: Number((wallet as any)?.balance_cad ?? 0),
      total_orders: oRows.length + fRows.length,
      in_transit: inTransit,
      unwarehoused,
      unpaid_invoices: unpaidInvoices,
      unpaid_total_cad: +unpaidInvoices.reduce((s, i) => s + i.due_cad, 0).toFixed(2),
    };
  });

// ============ Profile: view + edit (business fields only — never email/password) ============
export const saveCustomerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      userId: string;
      full_name?: string | null;
      phone?: string | null;
      username?: string;
      preferred_lang?: string;
      reg_country?: string | null;
      reg_province?: string | null;
      reg_city?: string | null;
      reg_address?: string | null;
      reg_postal_code?: string | null;
      reg_phone?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { userId, username, ...rest } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!before) throw new Error("客户不存在");

    const patch: Record<string, unknown> = { ...rest };
    if (username !== undefined) {
      const trimmed = username.trim();
      if (!trimmed) throw new Error("登录名不能为空");
      if (trimmed.toLowerCase() !== ((before as any).username ?? "").toLowerCase()) {
        const { data: available, error: checkErr } = await supabaseAdmin.rpc("check_username_available", {
          p_username: trimmed,
        });
        if (checkErr) throw new Error(checkErr.message);
        if (!available) throw new Error("登录名已被占用");
      }
      patch.username = trimmed;
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update(patch as any)
      .eq("id", userId);
    if (error) throw new Error(error.message);

    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_profile",
      entity_id: userId,
      action: "admin_edit_profile",
      before,
      after: patch,
      operator_id: context.userId,
      operator_name,
    });
    return { ok: true };
  });

// ============ 客户归属销售代表 ============
async function assertOwnerOrManager(supabase: any, userId: string) {
  const [{ data: isOwner, error: e1 }, { data: isManager, error: e2 }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  if (!isOwner && !isManager) throw new Error("Forbidden: owner/manager only");
}

// 分配下拉框的候选名单——持有 sales_rep 角色的员工账号。任何有客户视图访问权的人
// 都能读（好显示"当前归属：xxx"），实际改归属另外由 assertOwnerOrManager 把关。
export const listSalesReps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roleRows, error } = (await (supabaseAdmin as any)
      .from("user_roles")
      .select("user_id")
      .eq("role", "sales_rep")) as { data: { user_id: string }[] | null; error: any };
    if (error) throw new Error(error.message);
    const ids: string[] = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (!ids.length) return { items: [] as { id: string; full_name: string | null; email: string | null }[] };
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)
      .order("full_name", { ascending: true });
    return { items: (profs ?? []) as { id: string; full_name: string | null; email: string | null }[] };
  });

// 改客户归属——只有 owner/manager 能操作，销售代表自己不能改自己名下有哪些客户。
export const assignCustomerSalesRep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; salesRepId: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    await assertOwnerOrManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const salesRepId = data.salesRepId || null;
    if (salesRepId) {
      const { data: isRep, error } = await context.supabase.rpc("has_role", {
        _user_id: salesRepId,
        _role: "sales_rep" as any,
      });
      if (error) throw new Error(error.message);
      if (!isRep) throw new Error("指定的账号不是销售代表角色");
    }
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("sales_rep_id" as any)
      .eq("id", data.userId)
      .maybeSingle();
    const { error: updErr } = await (supabaseAdmin as any)
      .from("profiles")
      .update({ sales_rep_id: salesRepId })
      .eq("id", data.userId);
    if (updErr) throw new Error(updErr.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_profile",
      entity_id: data.userId,
      action: "assign_sales_rep",
      before: { sales_rep_id: (before as any)?.sales_rep_id ?? null },
      after: { sales_rep_id: salesRepId },
      operator_id: context.userId,
      operator_name,
    });
    return { ok: true };
  });

// ============ 账号安全：免密登录链接 / 重置密码 ============
// 都只有 owner/manager 能用——这两个操作比"客户视图"本身的只读代客操作权限
// 大得多（能让操作者直接以客户身份登录，或者让客户原密码失效），复用
// assertCustomerViewAccess(...,targetUserId) 不够，单独再叠一层
// assertOwnerOrManager，跟客户归属那边同一个权限模型。

// 免密登录链接——生成一次性 magiclink，谁拿到这个链接谁就能以这个客户身份登录，
// 不改客户原密码、客户完全无感知。跟微信登录回调（wechat.callback.ts）用的是
// 同一个 supabaseAdmin.auth.admin.generateLink 写法。链接本身很敏感，只在这次
// 响应里返回一次，前端不做任何持久化存储。
export const generateCustomerLoginLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    await assertOwnerOrManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email, customer_code")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile || !(profile as any).email) throw new Error("客户没有可用的登录邮箱");
    const origin = (process.env.WECHAT_REDIRECT_ORIGIN || "https://shopper.epluscanada.com").replace(/\/+$/, "");
    const { data: link, error } = await (supabaseAdmin as any).auth.admin.generateLink({
      type: "magiclink",
      email: (profile as any).email,
      options: { redirectTo: `${origin}/account` },
    });
    if (error || !link?.properties?.action_link) throw new Error(error?.message ?? "生成登录链接失败");
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    // 日志不记链接本身——记了等于把这个敏感凭证永久存进了日志表。
    await recordLog(supabaseAdmin, {
      entity_type: "customer_profile",
      entity_id: data.userId,
      action: "generate_login_link",
      operator_id: context.userId,
      operator_name,
      note: `生成免密登录链接（客户 ${(profile as any).customer_code ?? data.userId}）`,
    });
    return { ok: true, link: link.properties.action_link as string };
  });

// 重置密码——生成一个新的随机密码直接写进去，客户原密码立即失效。密码明文只在
// 这次响应里返回一次，服务端和日志都不留底，需要员工自己通过其它渠道转告客户。
export const resetCustomerPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    await assertOwnerOrManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, customer_code")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile) throw new Error("客户不存在");
    const { randomBytes } = await import("node:crypto");
    const newPassword = randomBytes(12).toString("base64url"); // 16 字符，够强，也够短方便口述/转告
    const { error } = await (supabaseAdmin as any).auth.admin.updateUserById(data.userId, { password: newPassword });
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_profile",
      entity_id: data.userId,
      action: "reset_password",
      operator_id: context.userId,
      operator_name,
      note: `重置登录密码（客户 ${(profile as any).customer_code ?? data.userId}），新密码未记录在日志中`,
    });
    return { ok: true, password: newPassword };
  });

// ============ Addresses: full CRUD on behalf of the customer ============
export const listCustomerAddresses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("addresses")
      .select("*")
      .eq("user_id", data.userId)
      .order("is_default", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const saveCustomerAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; address: any }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data.address ?? {};
    if (rest.is_default) {
      await supabaseAdmin.from("addresses").update({ is_default: false }).eq("user_id", data.userId);
    }
    const payload = { ...rest, user_id: data.userId };
    const op = id
      ? supabaseAdmin.from("addresses").update(payload).eq("id", id).eq("user_id", data.userId)
      : supabaseAdmin.from("addresses").insert(payload);
    const { error } = await op;
    if (error) throw new Error(error.message);

    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_address",
      entity_id: id || data.userId,
      action: id ? "admin_edit_address" : "admin_add_address",
      after: payload,
      operator_id: context.userId,
      operator_name,
    });
    return { ok: true };
  });

export const deleteCustomerAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; addressId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("addresses")
      .delete()
      .eq("id", data.addressId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_address",
      entity_id: data.addressId,
      action: "admin_delete_address",
      operator_id: context.userId,
      operator_name,
    });
    return { ok: true };
  });

// ============ My Items (SKU library): full CRUD on behalf of the customer ============
export const listCustomerItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("my_items")
      .select("*")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const saveCustomerItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      userId: string;
      id?: string;
      name: string;
      hs_code: string;
      sku?: string | null;
      declared_value_cad?: number;
      inner_qty?: number | null;
      unit?: string | null;
      mfn_rate?: number;
      gst_rate?: number;
      sima_involved?: boolean;
      material?: string | null;
      origin?: string | null;
      brand?: string | null;
      weight_kg?: number | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    if (!data.name.trim()) throw new Error("请填写物品名称");
    const hsCode = normalizeHsCodeForStorage(data.hs_code);
    if (!hsCode) throw new Error("请填写 HS 编码");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: resolved, error: resolveError } = await supabaseAdmin.rpc("resolve_hs_code_rates", {
      p_hs_code: hsCode,
      p_name_zh: data.name.trim(),
      p_unit: data.unit?.trim() || "",
      p_mfn_rate: data.mfn_rate ?? 0,
      p_gst_rate: data.gst_rate ?? 0.05,
      p_sima_involved: data.sima_involved ?? false,
    });
    if (resolveError) throw new Error(resolveError.message);

    const payload = {
      user_id: data.userId,
      name: data.name.trim(),
      hs_code: hsCode,
      sku: data.sku?.trim() || null,
      declared_value_cad: data.declared_value_cad ?? 0,
      inner_qty: data.inner_qty ?? null,
      unit: (resolved as any)?.unit ?? (data.unit?.trim() || null),
      mfn_rate: (resolved as any)?.mfn_rate ?? data.mfn_rate ?? 0,
      gst_rate: (resolved as any)?.gst_rate ?? data.gst_rate ?? 0.05,
      sima_involved: (resolved as any)?.sima_involved ?? data.sima_involved ?? false,
      // 材质优先跟随 HS 编码库；产地默认 China
      material: (resolved as any)?.material ?? (data.material?.trim() || null),
      origin: data.origin?.trim() || "China",
      brand: data.brand?.trim() || null,
      weight_kg: data.weight_kg ?? null,
    };
    const op = data.id
      ? supabaseAdmin.from("my_items").update(payload).eq("id", data.id).eq("user_id", data.userId)
      : supabaseAdmin.from("my_items").insert(payload);
    const { error } = await op;
    if (error) throw new Error(error.message);

    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_item",
      entity_id: data.id || data.userId,
      action: data.id ? "admin_edit_item" : "admin_add_item",
      after: payload,
      operator_id: context.userId,
      operator_name,
    });
    return { ok: true };
  });

export const deleteCustomerItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; itemId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("my_items").delete().eq("id", data.itemId).eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await recordLog(supabaseAdmin, {
      entity_type: "customer_item",
      entity_id: data.itemId,
      action: "admin_delete_item",
      operator_id: context.userId,
      operator_name,
    });
    return { ok: true };
  });

// ============ Orders / waybills (read-only) — mirrors the customer's own
// "我的订单/运单" tab. Rows link out to the existing /admin/orders/$orderId and
// /admin/forwardings/$forwardingId pages, which already have the full staff
// toolset (status changes, payment, tracking) — this list doesn't duplicate that. ============
export const getCustomerOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: orders, error: oErr }, { data: fwds, error: fErr }] = await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("id, order_no, status, payment_status, total_cny, tracking_no, shipping_method, created_at")
        .eq("user_id", data.userId)
        .eq("source", "shop")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("forwarding_orders")
        .select("id, request_no, status, payment_status, fee_cny, items_desc, tracking_no, shipping_method, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false }),
    ]);
    if (oErr) throw new Error(oErr.message);
    if (fErr) throw new Error(fErr.message);
    const items = [
      ...(orders ?? []).map((o: any) => ({
        kind: "order" as const,
        id: o.id,
        no: o.order_no,
        status: o.status,
        payment_status: o.payment_status,
        amount_cny: o.total_cny,
        tracking_no: o.tracking_no,
        shipping_method: o.shipping_method,
        created_at: o.created_at,
      })),
      ...(fwds ?? []).map((f: any) => ({
        kind: "forwarding" as const,
        id: f.id,
        no: f.request_no,
        status: f.status,
        payment_status: f.payment_status,
        amount_cny: f.fee_cny,
        label: f.items_desc,
        tracking_no: f.tracking_no,
        shipping_method: f.shipping_method,
        created_at: f.created_at,
      })),
    ].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return { items };
  });

// ============ Inventory (read-only) — mirrors "我的库存": waybills currently
// sitting in a warehouse (status='storage'), grouped by product/SKU/warehouse.
// The real page's "发起集运" handoff creates a NEW forwarding order under the
// customer's own session (sessionStorage prefill → /forwarding); there's no
// admin-safe equivalent yet, so this view is read-only — staff can see what's
// in storage but not start a shipment from here. Flagged in the UI, not silently
// dropped. ============
export const getCustomerInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wbRows, error } = await supabaseAdmin
      .from("waybills")
      .select("id,waybill_no,items_summary,updated_at,forwarding_id")
      .eq("user_id", data.userId)
      .eq("status", "storage")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = wbRows ?? [];
    const fwdIds = Array.from(new Set(rows.map((w: any) => w.forwarding_id).filter(Boolean)));
    const [{ data: fwdRows }, { data: whRows }] = await Promise.all([
      fwdIds.length
        ? supabaseAdmin.from("forwarding_orders").select("id,warehouse").in("id", fwdIds)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.from("warehouses").select("id,code,name_zh,name_en").eq("is_active", true),
    ]);
    const whByCode = new Map((whRows ?? []).map((w: any) => [w.code, w]));
    const warehouseByFwdId = new Map(
      (fwdRows ?? []).map((f: any) => [f.id, f.warehouse ? (whByCode.get(f.warehouse) ?? null) : null]),
    );
    const items = rows.map((w: any) => ({
      ...w,
      warehouse: w.forwarding_id ? (warehouseByFwdId.get(w.forwarding_id) ?? null) : null,
    }));
    return { items };
  });

// ============ Reference data for the "代客发起集运" form ============
// Warehouses + active forwarding-usable routes — same tables/filters the
// customer's own /forwarding page reads directly (public reference data,
// nothing customer-specific), just re-exposed through a server fn to keep
// this whole page's convention of "every read goes through
// admin-customer-view.functions.ts".
export const listShippingOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // 通用参考数据（仓库/线路），不是某个客户的资料，不需要按归属再筛一遍。
    await assertCustomerViewAccess(context.supabase, context.userId);
    const [{ data: warehouses }, { data: routes }] = await Promise.all([
      context.supabase.from("warehouses").select("id,code,name_zh,name_en").eq("is_active", true).order("sort_order"),
      context.supabase
        .from("shipping_routes")
        .select(
          "id,code,name_zh,name_en,cargo_type,shipping_method,origin_warehouse_id,destination_warehouse_id,is_bidirectional,item_fields,item_field_required",
        )
        .eq("is_active", true)
        .in("usage_scope", ["forwarding", "both"])
        .order("sort_order"),
    ]);
    return { warehouses: warehouses ?? [], routes: routes ?? [] };
  });

// ============ Storage fee: preview + pay on behalf of the customer ============
// Both wrap the storage-fee RPCs' new optional _target_user_id (see the
// pay_storage_fees/preview_storage_fees migration) — same fee math, same
// invoice, the only difference is whose wallet gets charged. Uses
// context.supabase (not supabaseAdmin) so auth.uid() inside the RPC resolves
// to the acting staff member, which is what the RPC's own staff check and
// admin_action_logs entry are keyed on.
export const previewCustomerStorageFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { data: result, error } = await context.supabase.rpc("preview_storage_fees", {
      _target_user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

export const payCustomerStorageFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { data: result, error } = await context.supabase.rpc("pay_storage_fees", {
      _target_user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return result as any;
  });

// ============ Forwarding: file a new request on behalf of the customer ============
// Same wrap of place_forwarding's new optional _target_user_id. The admin-side
// form is deliberately simpler than the customer's own /forwarding page (no
// per-route dynamic required-field validation UI) — if a route needs fields
// this form doesn't collect, place_forwarding still rejects it with a clear
// message, it just won't be caught client-side first.
export const createCustomerForwarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; payload: any }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    // Auto-fill HS code / material / origin from the customer's saved items when
    // staff typed a品名 without picking it from the library — place_forwarding
    // rejects rows missing route-required fields like hscode.
    const payload = { ...(data.payload ?? {}) } as any;
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: saved } = await supabaseAdmin
        .from("my_items")
        .select("sku, name, hs_code, material, origin, weight_kg, declared_value_cad, inner_qty")
        .eq("user_id", data.userId);
      const rows = (saved ?? []) as any[];
      const norm = (v: any) => String(v ?? "").trim().toLowerCase();
      payload.items = items.map((it: any) => {
        const ex = { ...(it.extras ?? {}) };
        if (ex.hscode) {
          try {
            ex.hscode = normalizeHsCodeForStorage(ex.hscode);
          } catch (e: any) {
            throw new Error(`物品「${it.name}」的 HS 编码格式不正确：${e.message}`);
          }
        }
        if (!ex.hscode || !ex.material || !ex.origin) {
          const hit = rows.find((r) => norm(r.name) === norm(it.name) || (ex.sku && norm(r.sku) === norm(ex.sku)));
          if (hit) {
            ex.hscode = ex.hscode || hit.hs_code || null;
            ex.material = ex.material || hit.material || null;
            ex.origin = ex.origin || hit.origin || "China";
            ex.weight_kg = ex.weight_kg ?? hit.weight_kg ?? null;
            ex.inner_qty = ex.inner_qty ?? hit.inner_qty ?? null;
          }
        }
        if (!ex.origin) ex.origin = "China";
        // sensible defaults so a blank optional box doesn't fail the RPC —
        // 库存发货（extras.inv_box_count）除外：货已在仓，不能再生成新运单。
        const fromInventory = ex.inv_box_count !== null && ex.inv_box_count !== undefined && ex.inv_box_count !== "";
        if (!fromInventory) {
          if (ex.box_count === null || ex.box_count === undefined || ex.box_count === "") ex.box_count = 1;
          if (ex.inner_qty === null || ex.inner_qty === undefined || ex.inner_qty === "") ex.inner_qty = 1;
        }
        const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
        return { ...it, quantity: qty, extras: ex };
      });
    }
    let { data: result, error } = await context.supabase.rpc("place_forwarding", {
      _payload: payload,
      _target_user_id: data.userId,
    });
    // statement_timeout (57014) aborts and rolls back the whole RPC, so nothing
    // was committed — one bounded retry is safe. Mirrors the customer-facing
    // form's retry (forwarding.index.tsx); this admin path lacked it entirely,
    // and it's the one staff use for large multi-item/multi-box commercial and
    // storage-route entries most likely to be slow.
    const isStatementTimeout = error?.code === "57014" || /statement timeout/i.test(error?.message ?? "");
    if (isStatementTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const retry = await context.supabase.rpc("place_forwarding", {
        _payload: payload,
        _target_user_id: data.userId,
      });
      result = retry.data;
      error = retry.error;
    }
    if (error) throw new Error(error.message);
    const r = result as any;
    if (!r?.ok) throw new Error(r?.reason ?? "发起集运失败");
    return r;
  });

// ============ Batches (read-only list) — mirrors "我的批次". The pay action
// itself already has an admin-safe equivalent (deductWalletForBatch, used
// elsewhere in the batch admin screens) — this list just surfaces it here too. ============
// 与客户自己在「我的批次」看到的完全同口径（同一份 computeMyBatchesForUser：直读
// batch_settlements 快照，不在请求里现算整批）——这本来就是"客户视图"该有的语义：
// 后台看到的应该等于客户自己看到的，而不是另算一套、还更贵（原先这里对每个批次都现调
// computeBatchFeeSummary，一个客户点开几个批次就是几次整批重算）。
export const getCustomerBatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertCustomerViewAccess(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return computeMyBatchesForUser(supabaseAdmin, data.userId);
  });
