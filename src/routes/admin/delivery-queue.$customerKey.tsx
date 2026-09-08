import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getCustomerDelivery,
  bulkUpdateCustomerDelivery,
  deductCustomerWallet,
  updateDeliveryQueueItem,
  addDeliveryTrackingEvent,
} from "@/lib/delivery-queue.functions";
import { Page, fmtDate, fmtCNY } from "@/lib/admin-shared";
import {
  Loader2,
  ArrowLeft,
  Truck,
  Wallet,
  Check,
  X,
  MapPin,
  Package,
  Layers,
  History,
  Route as RouteIcon,
} from "lucide-react";

export const Route = createFileRoute("/admin/delivery-queue/$customerKey")({
  component: CustomerDeliveryDetail,
});

const STATUS_LABEL: Record<string, string> = { pending: "待派送", dispatched: "已派送", cancelled: "已取消" };
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  dispatched: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cancelled: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};
const KIND_LABEL: Record<string, string> = { waybill: "运单", carton: "箱号", pallet: "托盘" };
const KIND_ICON: Record<string, any> = { waybill: Truck, carton: Package, pallet: Layers };

function CustomerDeliveryDetail() {
  const { customerKey } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getCustomerDelivery);
  const bulkUpdate = useServerFn(bulkUpdateCustomerDelivery);
  const updateItem = useServerFn(updateDeliveryQueueItem);
  const deduct = useServerFn(deductCustomerWallet);
  const addTrack = useServerFn(addDeliveryTrackingEvent);

  const isCode = customerKey.startsWith("code:");
  const customerUserId = isCode ? null : customerKey;
  const customerCode = isCode ? customerKey.slice(5) : null;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["delivery-queue-customer", customerKey],
    queryFn: () => fetchDetail({ data: { customerUserId, customerCode } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["delivery-queue-customer", customerKey] });

  const items: any[] = q.data?.items ?? [];
  const profile = q.data?.profile;
  const address = q.data?.address;
  const wallet = q.data?.wallet;
  const logs: any[] = q.data?.logs ?? [];
  const fx = q.data?.fx ?? 0.19;

  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const toggleAll = () => {
    const pending = items.filter((i) => i.status === "pending").map((i) => i.id);
    if (pending.every((id) => selected.has(id))) setSelected(new Set());
    else setSelected(new Set(pending));
  };

  const totals = items
    .filter((i) => i.status === "pending")
    .reduce(
      (acc, it) => ({
        count: acc.count + 1,
        weight: acc.weight + Number(it.weight_kg || 0),
        fee: acc.fee + Number(it.fee_cny || 0),
      }),
      { count: 0, weight: 0, fee: 0 },
    );

  const onBulk = async (status: "dispatched" | "cancelled") => {
    const ids = Array.from(selected);
    if (!ids.length) return alert("请先选择项");
    if (!window.confirm(`确认将 ${ids.length} 项标记为 ${STATUS_LABEL[status]}？`)) return;
    await bulkUpdate({ data: { customerUserId, customerCode, status, ids } });
    setSelected(new Set());
    await refresh();
  };

  const onItemAction = async (id: string, status: "dispatched" | "cancelled") => {
    await updateItem({ data: { id, status } });
    await refresh();
  };

  const onDeduct = async () => {
    if (!customerUserId) return alert("该客户未注册账号，无法扣款");
    const ids = Array.from(selected);
    const selectedFee = items.filter((i) => ids.includes(i.id)).reduce((s, i) => s + Number(i.fee_cny || 0), 0);
    const suggestedCad = (selectedFee > 0 ? selectedFee : totals.fee) * fx;
    const input = window.prompt(
      `扣款金额 (CAD)，当前余额 ${wallet ? "CA$" + Number(wallet.balance_cad).toFixed(2) : "—"}`,
      suggestedCad.toFixed(2),
    );
    if (!input) return;
    const amt = Number(input);
    if (!(amt > 0)) return alert("金额无效");
    const note = window.prompt("备注（可空）", "派送费用扣款") ?? undefined;
    await deduct({ data: { customerUserId, amountCad: amt, note } });
    await refresh();
    alert("扣款成功");
  };

  const onTracking = async (id: string) => {
    const st = window.prompt("轨迹状态（中文）", "已派送");
    if (!st) return;
    const loc = window.prompt("位置（可空）", "") ?? undefined;
    await addTrack({ data: { queueItemId: id, statusZh: st, locationZh: loc } });
    await refresh();
    alert("已记录");
  };

  const addressText = address
    ? [address.line1, address.line2, address.city, address.province, address.country, address.postal_code]
        .filter(Boolean)
        .join(" ")
    : profile
      ? [profile.reg_address, profile.reg_city, profile.reg_province, profile.reg_country, profile.reg_postal_code]
          .filter(Boolean)
          .join(" ")
      : "";
  const phone = address?.phone || profile?.phone || profile?.reg_phone || "—";
  const name = profile?.full_name || address?.recipient || "—";

  return (
    <Page
      title={`派送详情 · ${profile?.customer_code ?? customerCode ?? "—"}`}
      subtitle={`共 ${items.length} 项 · 待派送 ${totals.count} · 总重 ${totals.weight.toFixed(2)} kg · 总费用 ${fmtCNY(totals.fee)}`}
      action={
        <Link
          to="/admin/delivery-queue"
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" /> 返回列表
        </Link>
      }
    >
      {/* customer card */}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">客户</div>
          <div className="text-sm font-semibold">{name}</div>
          <div className="mt-1 text-xs text-slate-400">{profile?.email ?? "—"}</div>
          <div className="text-xs text-slate-400">电话：{phone}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-slate-500">
            <MapPin className="h-3 w-3" /> 收货地址
          </div>
          <div className="text-xs text-slate-200">{addressText || <span className="text-slate-500">—</span>}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-slate-500">
            <Wallet className="h-3 w-3" /> 钱包
          </div>
          <div className="text-lg font-semibold text-emerald-300">
            {wallet ? `CA$${Number(wallet.balance_cad).toFixed(2)}` : "—"}
          </div>
          <button
            onClick={onDeduct}
            className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20"
          >
            扣款
          </button>
        </div>
      </div>

      {/* bulk actions */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onBulk("dispatched")}
          disabled={!selected.size}
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
        >
          <Check className="mr-1 inline h-3 w-3" /> 批量派送 ({selected.size})
        </button>
        <button
          onClick={() => onBulk("cancelled")}
          disabled={!selected.size}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40"
        >
          <X className="mr-1 inline h-3 w-3" /> 批量取消
        </button>
      </div>

      {/* items table */}
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">
                <input type="checkbox" onChange={toggleAll} className="accent-brand" />
              </th>
              <th className="px-4 py-2.5">类型</th>
              <th className="px-4 py-2.5">编号</th>
              <th className="px-4 py-2.5 text-right">重量 (kg)</th>
              <th className="px-4 py-2.5">尺寸 (cm)</th>
              <th className="px-4 py-2.5 text-right">费用</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">加入时间</th>
              <th className="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={9} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {!q.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-slate-500">
                  暂无
                </td>
              </tr>
            )}
            {items.map((it) => {
              const Icon = KIND_ICON[it.kind];
              const dims = [it.length_cm, it.width_cm, it.height_cm].filter((v) => v != null);
              return (
                <tr key={it.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    {it.status === "pending" && (
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggle(it.id)}
                        className="accent-brand"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-0.5">
                      <Icon className="h-3 w-3 text-slate-400" />
                      {KIND_LABEL[it.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-200">{it.code}</td>
                  <td className="px-4 py-3 text-right text-xs">{Number(it.weight_kg || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {dims.length === 3 ? `${dims[0]} × ${dims[1]} × ${dims[2]}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">{fmtCNY(it.fee_cny)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_COLOR[it.status]}`}>
                      {STATUS_LABEL[it.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(it.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      {it.status === "pending" && (
                        <>
                          <button
                            onClick={() => onItemAction(it.id, "dispatched")}
                            title="标记派送"
                            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => onItemAction(it.id, "cancelled")}
                            title="取消"
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => onTracking(it.id)}
                        title="添加轨迹"
                        className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] text-brand hover:bg-brand/20"
                      >
                        <RouteIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Operation logs */}
      <div className="mt-6 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <History className="h-4 w-4" /> 操作记录
        </div>
        {logs.length === 0 ? (
          <div className="text-xs text-slate-500">暂无记录</div>
        ) : (
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {logs.map((lg) => (
              <div key={lg.id} className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-slate-200">{lg.action}</span>
                  <span className="text-slate-500">{fmtDate(lg.created_at)}</span>
                </div>
                {lg.note && <div className="mt-1 text-slate-400">{lg.note}</div>}
                {lg.after && (
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[10px] text-slate-500">
                    {typeof lg.after === "string" ? lg.after : JSON.stringify(lg.after)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
