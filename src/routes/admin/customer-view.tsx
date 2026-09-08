import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  findCustomerByCode,
  getCustomerOverview,
  saveCustomerProfile,
  listCustomerAddresses,
  saveCustomerAddress,
  deleteCustomerAddress,
  listCustomerItems,
  saveCustomerItem,
  deleteCustomerItem,
  getCustomerOrders,
  getCustomerInventory,
  getCustomerBatches,
  listShippingOptions,
  previewCustomerStorageFee,
  payCustomerStorageFee,
  createCustomerForwarding,
} from "@/lib/admin-customer-view.functions";
import { deductWalletForBatch } from "@/lib/orders.functions";
import { ROLE_LABEL, ROLE_COLOR } from "@/lib/admin-roles";
import { VIP_LABEL, VIP_COLOR } from "@/lib/vip-levels";
import {
  Search,
  Loader2,
  Hash,
  Mail,
  Phone,
  Ban,
  Wallet,
  Package,
  Truck,
  Receipt,
  User as UserIcon,
  MapPin,
  Tags,
  Plus,
  Trash2,
  Save,
  Warehouse,
  Layers,
  Plane,
  Ship,
  Box,
  CreditCard,
  ArrowRight,
  AlertTriangle,
  Send,
  ChevronDown,

} from "lucide-react";
import { CustomerForwardingForm } from "@/components/admin/CustomerForwardingForm";

export const Route = createFileRoute("/admin/customer-view")({
  head: () => ({
    meta: [{ title: "客户视图 — SinoCargo Admin" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: CustomerViewPage,
});

type Tab = "overview" | "newForwarding" | "myOrders" | "inventory" | "items" | "batches" | "addresses" | "profile";

// This page never switches the acting session — every read/write goes
// through admin-customer-view.functions.ts (service role, explicit
// target user_id, logged to admin_action_logs). The staff member's own
// identity is preserved end-to-end; see the "只读+代客操作面板" decision.
function CustomerViewPage() {
  const fetchCustomer = useServerFn(findCustomerByCode);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<Tab>("overview");

  const q = useQuery({
    queryKey: ["admin-customer-view", code],
    queryFn: () => fetchCustomer({ data: { code } }),
    enabled: !!code,
  });

  const profile = q.data?.profile ?? null;
  const roles = (q.data?.roles ?? []) as string[];

  // Same order as the real customer-facing "我的账户" sidebar, minus 我的钱包
  // (that tab is recharge/transaction-history for the customer's own payment
  // method — not something staff act on; the wallet balance is still visible
  // as a read-only stat on 概览, and batch payment on 我的批次 still works).
  const nav: { k: Tab; l: string; i: React.ReactNode }[] = [
    { k: "overview", l: "概览", i: <LayoutIcon /> },
    { k: "newForwarding", l: "发起集运", i: <Send className="h-4 w-4" /> },
    { k: "myOrders", l: "我的订单/运单", i: <Package className="h-4 w-4" /> },
    { k: "inventory", l: "我的库存", i: <Warehouse className="h-4 w-4" /> },
    { k: "items", l: "我的物品", i: <Tags className="h-4 w-4" /> },
    { k: "batches", l: "我的批次", i: <Layers className="h-4 w-4" /> },
    { k: "addresses", l: "收货地址", i: <MapPin className="h-4 w-4" /> },
    { k: "profile", l: "个人资料", i: <UserIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">客户视图</h1>
        <p className="mt-1 text-sm text-slate-400">
          按客户号查找客户，跟客户自己看到的「我的账户」一样的栏目——订单/运单、库存、我的物品、批次、地址、资料
          （不含钱包充值/流水） — 以你自己的员工身份操作，不会切换登录状态。
        </p>
      </div>

      <form
        className="mb-5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCode(codeInput.trim());
          setTab("overview");
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="输入客户号，如 SC000123"
            className="w-72 rounded-md border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm placeholder:text-slate-500 focus:border-brand focus:outline-none"
          />
        </div>
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          查找
        </button>
      </form>

      {q.isFetching && (
        <div className="grid h-32 place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        </div>
      )}
      {code && !q.isFetching && !profile && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 text-sm text-slate-400">
          未找到客户号「{code}」对应的账户。
        </div>
      )}

      {profile && (
        <>
          <section className="mb-5 rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-6">
            <div className="flex flex-wrap items-center gap-5">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand/15 text-xl font-bold text-brand">
                {(profile.full_name ?? profile.email ?? "?").trim().slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-[200px] flex-1">
                <h2 className="font-display text-xl font-bold">{profile.full_name ?? "未命名用户"}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Hash className="h-3.5 w-3.5" />
                    <span className="font-mono">{profile.customer_code ?? "—"}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    {profile.email ?? "—"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {profile.phone ?? "—"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${VIP_COLOR[(profile.vip_level ?? "normal") as keyof typeof VIP_COLOR]}`}
                  >
                    {VIP_LABEL[(profile.vip_level ?? "normal") as keyof typeof VIP_LABEL]}
                  </span>
                  {profile.is_blacklisted && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                      <Ban className="h-3 w-3" />
                      已加入黑名单
                    </span>
                  )}
                  {roles
                    .filter((r) => r !== "customer")
                    .map((r) => (
                      <span
                        key={r}
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ROLE_COLOR[r as keyof typeof ROLE_COLOR]}`}
                      >
                        {ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.zh ?? r}
                      </span>
                    ))}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  to="/admin/users/$userId"
                  params={{ userId: profile.id }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                >
                  <UserIcon className="h-4 w-4" />
                  角色 / 钱包 / 黑名单
                </Link>
                <Link
                  to="/admin/invoices"
                  search={{ userId: profile.id }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-500/20"
                >
                  <Receipt className="h-4 w-4" />
                  全部账单
                </Link>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[160px_1fr]">
            <nav className="flex gap-2 overflow-x-auto lg:flex-col">
              {nav.map((it) => (
                <button
                  key={it.k}
                  onClick={() => setTab(it.k)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${tab === it.k ? "border-brand/40 bg-brand/10 text-white" : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20"}`}
                >
                  {it.i}
                  {it.l}
                </button>
              ))}
            </nav>

            <section>
              {tab === "overview" && <OverviewTab userId={profile.id} />}
              {tab === "newForwarding" && <CustomerForwardingForm userId={profile.id} />}
              {tab === "myOrders" && <MyOrdersTab userId={profile.id} />}
              {tab === "inventory" && <InventoryTab userId={profile.id} />}
              {tab === "items" && <ItemsTab userId={profile.id} />}
              {tab === "batches" && <BatchesTab userId={profile.id} />}
              {tab === "profile" && <ProfileTab userId={profile.id} initial={profile} />}
              {tab === "addresses" && <AddressesTab userId={profile.id} />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function LayoutIcon() {
  return <Package className="h-4 w-4" />;
}

// ===================== Overview =====================
function OverviewTab({ userId }: { userId: string }) {
  const fetchOverview = useServerFn(getCustomerOverview);
  const q = useQuery({
    queryKey: ["admin-customer-overview", userId],
    queryFn: () => fetchOverview({ data: { userId } }),
  });

  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="钱包余额"
          value={`CA$${d.wallet_balance_cad.toFixed(2)}`}
          accent="text-emerald-400"
        />
        <StatCard
          icon={<Package className="h-4 w-4" />}
          label="订单/运单总数"
          value={String(d.total_orders)}
          accent="text-blue-400"
        />
        <StatCard
          icon={<Truck className="h-4 w-4" />}
          label="运输中 / 未入库"
          value={`${d.in_transit} / ${d.unwarehoused}`}
          accent="text-amber-400"
        />
      </div>

      <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-bold inline-flex items-center gap-2">
            <Receipt className="h-4 w-4 text-rose-400" />
            未付账单
          </h3>
          <div className="text-xs">
            <span className="text-slate-400">合计 </span>
            <span className="font-bold text-rose-300">¥{d.unpaid_total_cny.toFixed(2)}</span>
          </div>
        </div>
        {d.unpaid_invoices.length === 0 ? (
          <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
            无未付账单
          </div>
        ) : (
          <ul className="divide-y divide-white/5 rounded-md border border-white/5 bg-white/[0.02]">
            {d.unpaid_invoices.map((inv: any) => (
              <li key={inv.invoice_no} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="font-mono text-slate-300">{inv.invoice_no}</span>
                <span className="text-slate-500">{inv.status === "overdue" ? "已逾期" : "未付"}</span>
                <span className="font-bold text-rose-300">¥{inv.due_cny.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          批次结算 / 代客付款请前往{" "}
          <Link to="/admin/batches" className="text-brand hover:underline">
            批次管理
          </Link>
          ；运单与订单状态请前往{" "}
          <Link to="/admin/waybills" className="text-brand hover:underline">
            运单列表
          </Link>
          。
        </p>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
      <div className={`inline-flex items-center gap-1.5 text-xs ${accent}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1.5 font-display text-lg font-bold text-slate-100">{value}</div>
    </div>
  );
}

// ===================== My orders / waybills (read-only list) =====================
const PAY_LABEL: Record<string, [string, string]> = {
  paid: ["已付款", "bg-emerald-500/15 text-emerald-300"],
  unpaid: ["待付款", "bg-amber-500/15 text-amber-300"],
  partial: ["部分付款", "bg-amber-500/15 text-amber-300"],
};

function MyOrdersTab({ userId }: { userId: string }) {
  const fetchOrders = useServerFn(getCustomerOrders);
  const q = useQuery({
    queryKey: ["admin-customer-orders", userId],
    queryFn: () => fetchOrders({ data: { userId } }),
  });

  if (q.isLoading) return <Spinner />;
  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <h3 className="font-display text-base font-bold">我的订单/运单（{items.length}）</h3>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          还没有订单或集运单
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">单号</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">付款</th>
                <th className="px-3 py-2 text-right">金额 ¥</th>
                <th className="px-3 py-2">运输方式</th>
                <th className="px-3 py-2">国际单号</th>
                <th className="px-3 py-2">创建时间</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r: any) => {
                const pay = PAY_LABEL[r.payment_status] ?? [r.payment_status ?? "—", "bg-white/5 text-slate-400"];
                return (
                  <tr key={`${r.kind}-${r.id}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.kind === "order" ? "bg-brand/15 text-brand" : "bg-cyan-500/15 text-cyan-300"}`}
                      >
                        {r.kind === "order" ? <Package className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                        {r.kind === "order" ? "商城" : "集运"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-200">{r.no ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-300">{r.status ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pay[1]}`}>{pay[0]}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {r.amount_cny != null ? `¥${Number(r.amount_cny).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{r.shipping_method ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">{r.tracking_no ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.created_at ? new Date(r.created_at).toLocaleString("zh-CN", { hour12: false }) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={r.kind === "order" ? "/admin/orders/$orderId" : "/admin/forwardings/$forwardingId"}
                        params={r.kind === "order" ? { orderId: r.id } : { forwardingId: r.id }}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-brand hover:bg-brand/10"
                      >
                        详情 <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===================== My inventory (read-only, grouped by product/SKU/warehouse) =====================
interface InvGroup {
  key: string;
  productName: string;
  sku: string;
  qtyPerBox: number;
  warehouseId: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  boxes: { id: string; waybillNo: string; storedAt: string }[];
}

function buildInvGroups(rows: any[]): InvGroup[] {
  const map = new Map<string, InvGroup>();
  for (const wb of rows) {
    const summary = Array.isArray(wb.items_summary) ? wb.items_summary : [];
    const entries = summary.length > 0 ? summary : [{ name: null, sku: null, quantity: null }];
    const warehouseId = wb.warehouse?.id ?? null;
    const warehouseCode = wb.warehouse?.code ?? null;
    const warehouseName = wb.warehouse?.name_zh ?? null;
    for (const it of entries) {
      const productName = it?.name || it?.name_zh || it?.name_en || "—";
      const sku = it?.sku || "—";
      const qtyPerBox = Number(it?.quantity ?? 0);
      const k = `${productName}__${sku}__${qtyPerBox}__${warehouseId ?? "unknown"}`;
      if (!map.has(k))
        map.set(k, {
          key: k,
          productName,
          sku,
          qtyPerBox,
          warehouseId,
          warehouseCode,
          warehouseName,
          boxes: [],
        });
      map.get(k)!.boxes.push({ id: wb.id, waybillNo: wb.waybill_no, storedAt: wb.updated_at });
    }
  }
  return Array.from(map.values());
}

function InventoryTab({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const fetchInv = useServerFn(getCustomerInventory);
  const fetchAddresses = useServerFn(listCustomerAddresses);
  const fetchOpts = useServerFn(listShippingOptions);
  const previewFee = useServerFn(previewCustomerStorageFee);
  const doPayFee = useServerFn(payCustomerStorageFee);
  const doCreateFwd = useServerFn(createCustomerForwarding);

  const invQ = useQuery({
    queryKey: ["admin-customer-inventory", userId],
    queryFn: () => fetchInv({ data: { userId } }),
  });
  const addrQ = useQuery({
    queryKey: ["admin-customer-addresses", userId],
    queryFn: () => fetchAddresses({ data: { userId } }),
  });
  const optsQ = useQuery({
    queryKey: ["admin-shipping-options"],
    queryFn: () => fetchOpts(),
  });
  const feeQ = useQuery({
    queryKey: ["admin-customer-storage-fee", userId],
    queryFn: () => previewFee({ data: { userId } }),
  });

  const [shipBoxes, setShipBoxes] = useState<Record<string, number>>({});
  const [addressId, setAddressId] = useState("");
  const [routeCode, setRouteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payingFee, setPayingFee] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (invQ.isLoading) return <Spinner />;
  const groups = buildInvGroups(invQ.data?.items ?? []);
  const totalBoxes = groups.reduce((s, g) => s + g.boxes.length, 0);
  const addresses: any[] = addrQ.data?.items ?? [];
  const warehouses: any[] = optsQ.data?.warehouses ?? [];
  const routes: any[] = optsQ.data?.routes ?? [];
  const fee = feeQ.data as { total_cad?: number } | undefined;

  const setBoxesFor = (g: InvGroup, raw: number) => {
    const n = Math.max(0, Math.min(g.boxes.length, Math.floor(raw) || 0));
    setShipBoxes((s) => ({ ...s, [g.key]: n }));
  };

  const toShip = groups.filter((g) => (shipBoxes[g.key] ?? 0) > 0);
  const totalBoxesToShip = toShip.reduce((s, g) => s + (shipBoxes[g.key] ?? 0), 0);
  const shipWarehouseIds = new Set(toShip.map((g) => g.warehouseId ?? "unknown"));
  const shipWarehouseId = shipWarehouseIds.size === 1 ? [...shipWarehouseIds][0] : null;
  const multiWarehouse = shipWarehouseIds.size > 1 || shipWarehouseIds.has("unknown");
  const availableRoutes = shipWarehouseId
    ? routes.filter(
        (r) =>
          r.origin_warehouse_id === shipWarehouseId ||
          (r.is_bidirectional && r.destination_warehouse_id === shipWarehouseId),
      )
    : [];

  const submitForwarding = async () => {
    if (toShip.length === 0 || multiWarehouse) return;
    if (!addressId) return setMsg({ kind: "err", text: "请选择该客户的收货地址" });
    if (!routeCode) return setMsg({ kind: "err", text: "请选择运输线路" });
    const warehouse = warehouses.find((w) => w.id === shipWarehouseId);
    if (!warehouse) return setMsg({ kind: "err", text: "仓库信息缺失" });
    const payload = {
      warehouse: warehouse.code,
      route_code: routeCode,
      address_id: addressId,
      domestic_tracking_no: null,
      note: "[代客户发起集运]",
      insured: false,
      items: toShip.map((g) => {
        const boxCount = shipBoxes[g.key] ?? 0;
        return {
          name: g.productName,
          quantity: boxCount * g.qtyPerBox,
          unit_price_cad: 0,
          extras: {
            sku: g.sku !== "—" ? g.sku : null,
            // These boxes already have real waybills in storage — withhold
            // box_count/inner_qty so place_forwarding doesn't spawn new ones,
            // same as the customer's own "ship from inventory" flow.
            box_count: null,
            inner_qty: null,
            // 库存发货标记 + 应到箱数，供入库扫描页核对。
            inv_box_count: boxCount,
          },
        };
      }),
    };
    setSubmitting(true);
    setMsg(null);
    try {
      const r: any = await doCreateFwd({ data: { userId, payload } });
      setMsg({ kind: "ok", text: `已代客户发起集运，生成运单 ${r.waybills ?? 0} 个` });
      setShipBoxes({});
      setRouteCode("");
      await qc.invalidateQueries({ queryKey: ["admin-customer-inventory", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-customer-batches", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-customer-orders", userId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "发起集运失败" });
    } finally {
      setSubmitting(false);
    }
  };

  const payStorageFee = async () => {
    if (!fee?.total_cad || fee.total_cad <= 0) return;
    if (!confirm(`确认代客户从其钱包支付仓储费 CA$${fee.total_cad.toFixed(2)}？`)) return;
    setPayingFee(true);
    setMsg(null);
    try {
      const r: any = await doPayFee({ data: { userId } });
      if (!r?.ok) {
        setMsg({
          kind: "err",
          text:
            r?.reason === "insufficient" ? `钱包余额不足：需要 CA$${r.need_cad}，当前 CA$${r.balance_cad}` : "付款失败",
        });
      } else {
        setMsg({ kind: "ok", text: `仓储费付款成功 CA$${r.paid_cad}，账单 ${r.invoice_no}` });
      }
      await qc.invalidateQueries({ queryKey: ["admin-customer-storage-fee", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-customer-overview", userId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "付款失败" });
    } finally {
      setPayingFee(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-base font-bold">我的库存（{totalBoxes} 箱）</h3>
        <p className="mt-1 text-xs text-slate-400">仓库里等待发货的货物，按品名/SKU/仓库分组。</p>
      </div>

      {msg && (
        <div
          className={`rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          icon={<Warehouse className="h-4 w-4" />}
          label="库存总箱数"
          value={String(totalBoxes)}
          accent="text-amber-400"
        />
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <div className="inline-flex items-center gap-1.5 text-xs text-brand">
            <Wallet className="h-4 w-4" />
            待付仓储费
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="font-display text-lg font-bold text-slate-100">CA${(fee?.total_cad ?? 0).toFixed(2)}</span>
            {(fee?.total_cad ?? 0) > 0 && (
              <button
                onClick={payStorageFee}
                disabled={payingFee}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {payingFee && <Loader2 className="h-3 w-3 animate-spin" />}
                代客户支付
              </button>
            )}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          仓库里没有该客户的货物
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.key} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 font-semibold text-slate-100">
                <Box className="h-4 w-4 text-slate-400" />
                {g.productName}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                SKU {g.sku} · 每箱 {g.qtyPerBox} 件 · {g.warehouseName ?? "未知仓库"}
              </div>
              <details className="group mt-2 rounded-md border border-white/5 bg-white/[0.02]">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[11px] text-slate-400 hover:text-slate-200">
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                  运单号（{g.boxes.length}）
                </summary>
                <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto px-2 pb-2">
                  {g.boxes.map((b) => (
                    <span key={b.id} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      {b.waybillNo}
                    </span>
                  ))}
                </div>
              </details>

              <div className="mt-2 flex items-center gap-2">
                <label className="text-[11px] text-slate-500">发货箱数</label>
                <input
                  type="number"
                  min={0}
                  max={g.boxes.length}
                  step={1}
                  value={shipBoxes[g.key] ?? ""}
                  onChange={(e) => setBoxesFor(g, Number(e.target.value))}
                  placeholder="0"
                  className="h-8 w-20 rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs text-slate-100 outline-none focus:border-brand"
                />
                <span className="text-[11px] text-slate-500">/ {g.boxes.length} 箱</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalBoxesToShip > 0 && (
        <div className="space-y-3 rounded-2xl border border-brand/30 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-100">
            <Send className="h-4 w-4 text-brand" />
            代客户发起集运（已选 {totalBoxesToShip} 箱）
          </div>
          {multiWarehouse ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              所选货物分属不同仓库，请分开发起集运
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs text-slate-400">
                收货地址
                <select
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                  className="mt-1 block h-9 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs text-slate-100 outline-none focus:border-brand [&>option]:bg-[#0E1626] [&>option]:text-slate-100"
                >
                  <option value="">请选择该客户的地址…</option>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.recipient} · {a.line1}
                      {a.is_default ? "（默认）" : ""}
                    </option>
                  ))}
                </select>
                {addresses.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-400">
                    该客户还没有收货地址，请先到"地址"页新增
                  </span>
                )}
              </label>
              <label className="block text-xs text-slate-400">
                运输线路
                <select
                  value={routeCode}
                  onChange={(e) => setRouteCode(e.target.value)}
                  className="mt-1 block h-9 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs text-slate-100 outline-none focus:border-brand [&>option]:bg-[#0E1626] [&>option]:text-slate-100"
                >
                  <option value="">请选择线路…</option>
                  {availableRoutes.map((r) => (
                    <option key={r.id} value={r.code}>
                      {r.name_zh}（{r.shipping_method === "air" ? "空运" : "海运"}）
                    </option>
                  ))}
                </select>
                {shipWarehouseId && availableRoutes.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-400">该仓库暂无可用集运线路</span>
                )}
              </label>
            </div>
          )}
          <button
            onClick={submitForwarding}
            disabled={submitting || multiWarehouse || !addressId || !routeCode}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            <ArrowRight className="h-4 w-4" />
            提交集运申请
          </button>
        </div>
      )}
    </div>
  );
}

// ===================== My batches (list + pay-from-wallet) =====================
const BATCH_STATUS_LABEL: Record<string, [string, string]> = {
  shipped: ["运输中", "bg-blue-500/15 text-blue-300"],
  arrived: ["已到达", "bg-cyan-500/15 text-cyan-300"],
  closed: ["已关闭", "bg-white/5 text-slate-400"],
};

function BatchesTab({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const fetchBatches = useServerFn(getCustomerBatches);
  const doPay = useServerFn(deductWalletForBatch);
  const q = useQuery({
    queryKey: ["admin-customer-batches", userId],
    queryFn: () => fetchBatches({ data: { userId } }),
  });
  const [paying, setPaying] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const pay = async (batchId: string, batchNo: string, amountCad: number) => {
    if (!confirm(`确认代客户从其钱包支付 CA$${amountCad.toFixed(2)} 给批次 ${batchNo}？`)) return;
    setPaying(batchId);
    setMsg(null);
    try {
      const r: any = await doPay({ data: { batchId, userId, amountCad } });
      if (!r?.ok) {
        if (r?.reason === "already_paid") {
          setMsg({ kind: "ok", text: "该批次已结清" });
        } else {
          setMsg({ kind: "err", text: r?.reason ?? "付款失败" });
        }
      } else {
        setMsg({ kind: "ok", text: `付款成功 CA$${r.deducted_cad}，账单已生成` });
      }
      await qc.invalidateQueries({ queryKey: ["admin-customer-batches", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-customer-overview", userId] });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "付款失败" });
    } finally {
      setPaying(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  const batches = q.data?.batches ?? [];

  return (
    <div className="space-y-4">
      <h3 className="font-display text-base font-bold">我的批次（{batches.length}）</h3>
      {msg && (
        <div
          className={`rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}
      {batches.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          该客户还没有可结算的批次
        </div>
      ) : (
        batches.map((b: any) => {
          const [zh, cls] = BATCH_STATUS_LABEL[b.status] ?? [b.status, "bg-white/5 text-slate-400"];
          return (
            <div key={b.batch_id} className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03]">
              <header
                className={`flex flex-wrap items-center gap-3 border-b border-white/5 px-5 py-3 ${b.is_paid ? "bg-emerald-500/5" : "bg-white/[0.02]"}`}
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-brand">
                  {b.shipping_method === "air" ? <Plane className="h-4 w-4" /> : <Ship className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-bold text-slate-100">{b.batch_no}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{zh}</span>
                    {b.is_paid ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        已结清
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        待付款
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {b.items.length} 项 {b.eta ? `· 预计到达 ${new Date(b.eta).toLocaleDateString("zh-CN")}` : ""}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {b.is_paid ? "批次合计" : "批次待付"}
                  </div>
                  <div className="font-display text-lg font-bold text-brand">CA${b.subtotal_cad.toFixed(2)}</div>
                </div>
              </header>
              <ul className="divide-y divide-white/5">
                {b.items.map((it: any) => (
                  <li key={`${it.kind}-${it.id}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.kind === "order" ? "bg-brand/15 text-brand" : "bg-cyan-500/15 text-cyan-300"}`}
                    >
                      {it.kind === "order" ? "商城" : "集运"}
                    </span>
                    <span className="font-mono text-slate-300">{it.no}</span>
                    {it.tracking_no && <span className="text-slate-500">· {it.tracking_no}</span>}
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.payment_status === "paid" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
                    >
                      {it.payment_status === "paid" ? "已付款" : "待付款"}
                    </span>
                    <Link
                      to={it.kind === "order" ? "/admin/orders/$orderId" : "/admin/forwardings/$forwardingId"}
                      params={it.kind === "order" ? { orderId: it.id } : { forwardingId: it.id }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-brand hover:bg-brand/10"
                    >
                      详情 <ArrowRight className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
              {!b.is_paid && b.subtotal_cad > 0 && (
                <div className="flex items-center gap-3 border-t border-white/5 px-5 py-3">
                  <div className="text-xs text-slate-400">
                    待付{" "}
                    <span className="font-display text-sm font-bold text-slate-100">
                      CA${b.subtotal_cad.toFixed(2)}
                    </span>
                  </div>
                  <button
                    disabled={paying === b.batch_id}
                    onClick={() => pay(b.batch_id, b.batch_no, b.subtotal_cad)}
                    className="ml-auto inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                  >
                    {paying === b.batch_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CreditCard className="h-3.5 w-3.5" />
                    )}
                    代客户从钱包付款
                  </button>
                </div>
              )}
              <Link
                to="/admin/batches/$batchId"
                params={{ batchId: b.batch_id }}
                className="flex items-center justify-center gap-1 border-t border-white/5 px-5 py-2 text-[11px] text-slate-500 hover:bg-white/[0.02] hover:text-brand"
              >
                批次完整详情（线路/费用明细/日志）
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          );
        })
      )}
    </div>
  );
}

// ===================== Profile =====================
function ProfileTab({ userId, initial }: { userId: string; initial: any }) {
  const qc = useQueryClient();
  const save = useServerFn(saveCustomerProfile);
  const [form, setForm] = useState({
    full_name: initial.full_name ?? "",
    phone: initial.phone ?? "",
    username: initial.username ?? "",
    preferred_lang: initial.preferred_lang ?? "zh",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await save({ data: { userId, ...form } });
      await qc.invalidateQueries({ queryKey: ["admin-customer-view"] });
      setMsg({ kind: "ok", text: "已保存" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <h3 className="font-display text-base font-bold">基本资料</h3>
      <p className="mt-1 text-xs text-slate-400">
        邮箱 / 密码 / 微信绑定属于客户账号安全设置，代客视图不提供修改 — 如需变更请客户本人在「我的账户」操作。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <AField label="邮箱">
          <input disabled value={initial.email ?? ""} className={inputCls + " opacity-60"} />
        </AField>
        <AField label="登录名">
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s+/g, "") })}
            className={inputCls}
          />
        </AField>
        <AField label="姓名">
          <input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className={inputCls}
          />
        </AField>
        <AField label="手机号">
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputCls}
          />
        </AField>
        <AField label="偏好语言">
          <select
            value={form.preferred_lang}
            onChange={(e) => setForm({ ...form, preferred_lang: e.target.value })}
            className={inputCls}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </AField>
      </div>
      {msg && (
        <div
          className={`mt-3 rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}
      <button
        onClick={onSave}
        disabled={busy}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        保存修改
      </button>
    </section>
  );
}

// ===================== Addresses =====================
function AddressesTab({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listCustomerAddresses);
  const save = useServerFn(saveCustomerAddress);
  const doDelete = useServerFn(deleteCustomerAddress);
  const q = useQuery({
    queryKey: ["admin-customer-addresses", userId],
    queryFn: () => fetchList({ data: { userId } }),
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-customer-addresses", userId] });

  const onSave = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await save({ data: { userId, address: editing } });
      setEditing(null);
      refresh();
    } catch (e: any) {
      alert(e?.message ?? "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("确定删除该地址？")) return;
    await doDelete({ data: { userId, addressId: id } });
    refresh();
  };

  if (q.isLoading) return <Spinner />;
  const list = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold">收货地址（{list.length}）</h3>
        <button
          onClick={() => setEditing({ country: "CA" })}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
        >
          <Plus className="h-3.5 w-3.5" /> 新增地址
        </button>
      </div>

      {editing && (
        <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <AField label="收件人">
              <input
                className={inputCls}
                value={editing.recipient ?? ""}
                onChange={(e) => setEditing({ ...editing, recipient: e.target.value })}
              />
            </AField>
            <AField label="电话">
              <input
                className={inputCls}
                value={editing.phone ?? ""}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </AField>
            <AField label="地址行1">
              <input
                className={inputCls}
                value={editing.line1 ?? ""}
                onChange={(e) => setEditing({ ...editing, line1: e.target.value })}
              />
            </AField>
            <AField label="地址行2">
              <input
                className={inputCls}
                value={editing.line2 ?? ""}
                onChange={(e) => setEditing({ ...editing, line2: e.target.value })}
              />
            </AField>
            <AField label="城市">
              <input
                className={inputCls}
                value={editing.city ?? ""}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
              />
            </AField>
            <AField label="省份">
              <input
                className={inputCls}
                value={editing.province ?? ""}
                onChange={(e) => setEditing({ ...editing, province: e.target.value })}
              />
            </AField>
            <AField label="邮编">
              <input
                className={inputCls}
                value={editing.postal_code ?? ""}
                onChange={(e) => setEditing({ ...editing, postal_code: e.target.value })}
              />
            </AField>
            <AField label="默认地址">
              <label className="flex h-9 items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={!!editing.is_default}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })}
                />
                设为默认
              </label>
            </AField>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              取消
            </button>
          </div>
        </section>
      )}

      {list.length === 0 && !editing ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          还没有地址
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a: any) => (
            <div key={a.id} className="relative rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-100">
                {a.recipient}
                {a.is_default && (
                  <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">
                    默认
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400">{a.phone}</p>
              <p className="mt-2 text-slate-300">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ""}
              </p>
              <p className="text-xs text-slate-400">
                {a.city}, {a.province} {a.postal_code} · {a.country}
              </p>
              <div className="absolute right-3 top-3 flex gap-1">
                <button
                  onClick={() => setEditing(a)}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-white/10"
                >
                  编辑
                </button>
                <button
                  onClick={() => onDelete(a.id)}
                  className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== My Items (SKU library) =====================
function ItemsTab({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listCustomerItems);
  const save = useServerFn(saveCustomerItem);
  const doDelete = useServerFn(deleteCustomerItem);
  const q = useQuery({
    queryKey: ["admin-customer-items", userId],
    queryFn: () => fetchList({ data: { userId } }),
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-customer-items", userId] });

  const onSave = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await save({ data: { userId, ...editing } });
      setEditing(null);
      refresh();
    } catch (e: any) {
      alert(e?.message ?? "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("确定删除该物品？")) return;
    await doDelete({ data: { userId, itemId: id } });
    refresh();
  };

  if (q.isLoading) return <Spinner />;
  const list = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold">我的物品 / SKU 库（{list.length}）</h3>
        <button
          onClick={() => setEditing({ name: "", hs_code: "", sku: "", declared_value_cad: 0, inner_qty: null, origin: "China" })}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
        >
          <Plus className="h-3.5 w-3.5" /> 新增物品
        </button>
      </div>
      <p className="text-xs text-slate-500">
        这里维护的是集运申请「内件清单」里 SKU 模糊搜索会匹配到的资料（品名 / HSCODE / 单价 / 内件数）。
      </p>

      {editing && (
        <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <AField label="SKU">
              <input
                className={inputCls}
                value={editing.sku ?? ""}
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
              />
            </AField>
            <AField label="品名 *">
              <input
                className={inputCls}
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </AField>
            <AField label="HS 编码 *">
              <input
                className={inputCls}
                value={editing.hs_code ?? ""}
                onChange={(e) => setEditing({ ...editing, hs_code: e.target.value })}
              />
            </AField>
            <AField label="单价 CAD">
              <input
                type="number"
                className={inputCls}
                value={editing.declared_value_cad ?? 0}
                onChange={(e) => setEditing({ ...editing, declared_value_cad: Number(e.target.value) || 0 })}
              />
            </AField>
            <AField label="内件数">
              <input
                type="number"
                className={inputCls}
                value={editing.inner_qty ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    inner_qty: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </AField>
            <AField label="材质（留空自动跟随 HS 编码库）">
              <input
                className={inputCls}
                value={editing.material ?? ""}
                onChange={(e) => setEditing({ ...editing, material: e.target.value })}
              />
            </AField>
            <AField label="产地">
              <input
                className={inputCls}
                value={editing.origin ?? "China"}
                onChange={(e) => setEditing({ ...editing, origin: e.target.value })}
              />
            </AField>
            <AField label="品牌">
              <input
                className={inputCls}
                value={editing.brand ?? ""}
                onChange={(e) => setEditing({ ...editing, brand: e.target.value })}
              />
            </AField>
            <AField label="单件重量 KG">
              <input
                type="number"
                step="0.001"
                className={inputCls}
                value={editing.weight_kg ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, weight_kg: e.target.value ? Number(e.target.value) : null })
                }
              />
            </AField>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            >
              取消
            </button>
          </div>
        </section>
      )}

      {list.length === 0 && !editing ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
          还没有物品资料
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">品名</th>
                <th className="px-3 py-2">HS 编码</th>
                <th className="px-3 py-2 text-right">单价 CAD</th>
                <th className="px-3 py-2 text-right">内件数</th>
                <th className="px-3 py-2">材质</th>
                <th className="px-3 py-2">产地</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r: any) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 font-mono text-slate-300">{r.sku ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-100">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-cyan-300">{r.hs_code}</td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    ${Number(r.declared_value_cad ?? 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">{r.inner_qty ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{r.material ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{r.origin ?? "China"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(r)}
                      className="rounded px-2 py-1 text-slate-300 hover:bg-white/10"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => onDelete(r.id)}
                      className="ml-1 rounded px-2 py-1 text-rose-300 hover:bg-rose-500/10"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===================== Shared bits =====================
const inputCls =
  "h-9 w-full rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-100 outline-none focus:border-brand";

function AField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      {children}
    </label>
  );
}

function Spinner() {
  return (
    <div className="grid h-40 place-items-center">
      <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
    </div>
  );
}
