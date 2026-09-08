import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  listInventoryIntakeOrders,
  inventoryIntakeCheckWaybill,
  inventoryIntakeCommit,
} from "@/lib/inventory-intake.functions";
import { Warehouse, ChevronDown, ChevronRight, Check, AlertCircle, Loader2, ScanLine, Trash2 } from "lucide-react";

type Scanned = { id: string; no: string; itemKey: string; name: string; sku: string | null };

export function InventoryIntakePanel() {
  const list = useServerFn(listInventoryIntakeOrders);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["inventory-intake-orders"],
    queryFn: () => list({ data: undefined as any }),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const orders: any[] = (data as any)?.orders ?? [];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Warehouse className="h-4 w-4 text-brand" />
          库存发货订单待入库 ({orders.length})
        </h3>
        <button onClick={() => refetch()} className="text-xs text-slate-400 hover:text-white">
          刷新
        </button>
      </div>
      {isLoading ? (
        <div className="py-3 text-center text-xs text-slate-500">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="py-3 text-center text-xs text-slate-500">暂无从库存发货的待入库订单</div>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="rounded-lg border border-white/10 bg-white/[0.02]">
              <button
                onClick={() => setOpenId(openId === o.id ? null : o.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <span className="inline-flex items-center gap-2 text-sm">
                  {openId === o.id ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                  <span className="font-mono font-semibold text-slate-200">{o.request_no}</span>
                  <span className="font-mono text-xs text-brand">{o.customer_code ?? "—"}</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  {o.warehouse ?? "—"} · {o.route_code ?? "—"} ·{" "}
                  {o.items.reduce((s: number, i: any) => s + i.required_boxes, 0)} 箱
                </span>
              </button>
              {openId === o.id && <OrderCard order={o} onDone={() => { setOpenId(null); refetch(); }} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({ order, onDone }: { order: any; onDone: () => void }) {
  const check = useServerFn(inventoryIntakeCheckWaybill);
  const commit = useServerFn(inventoryIntakeCommit);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState<Scanned[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const countFor = (key: string) => scanned.filter((s) => s.itemKey === key).length;
  const keyOf = (it: any) => `${(it.sku ?? "-").toString().trim().toLowerCase()}__${String(it.name).trim().toLowerCase()}`;
  const allOk = order.items.every((it: any) => countFor(keyOf(it)) === it.required_boxes);

  const submitScan = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r: any = await check({ data: { forwardingId: order.id, code: c, alreadyIds: scanned.map((s) => s.id) } });
      const already = scanned.filter((s) => s.itemKey === r.itemKey).length;
      if (already >= r.requiredBoxes) {
        setMsg({ ok: false, text: `「${r.name}」只需 ${r.requiredBoxes} 箱，已扫满` });
      } else {
        setScanned((s) => [...s, { id: r.waybillId, no: r.waybillNo, itemKey: r.itemKey, name: r.name, sku: r.sku }]);
        setMsg({ ok: true, text: `✓ ${r.waybillNo} → ${r.name}` });
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setCode("");
      setBusy(false);
    }
  };

  const doCommit = async (makePallet = false) => {
    setBusy(true);
    setMsg(null);
    try {
      const r: any = await commit({ data: { forwardingId: order.id, waybillIds: scanned.map((s) => s.id), makePallet } });
      setMsg({
        ok: true,
        text: `✓ ${r.requestNo} 已入库 ${r.count} 箱，运单转为「已到达集运仓」${r.palletNo ? `，并已成托 ${r.palletNo}` : ""}`,
      });
      setTimeout(onDone, 1200);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-white/10 px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {order.items.map((it: any) => {
          const n = countFor(keyOf(it));
          const done = n === it.required_boxes;
          return (
            <div
              key={it.id}
              className={`rounded-lg border p-2.5 text-xs ${done ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 bg-white/[0.03]"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">{it.name}</span>
                <span className={done ? "text-emerald-300" : "text-amber-300"}>
                  {n} / {it.required_boxes} 箱
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
                <span>
                  SKU/条码: <span className="font-mono text-slate-300">{it.sku ?? "—"}</span>
                </span>
                <span>内件数: {it.inner_qty ?? "—"}</span>
                <span>客户号: <span className="font-mono text-slate-300">{order.customer_code ?? "—"}</span></span>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submitScan} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="扫描该物品的运单号后回车"
          autoComplete="off"
          className="flex-1 rounded-md border border-brand/40 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        />
        <button type="submit" disabled={busy} className="rounded-md bg-brand px-3 py-2 text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
        </button>
      </form>

      {msg && (
        <div className={`inline-flex items-start gap-1.5 text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>
          {msg.ok ? <Check className="mt-0.5 h-3.5 w-3.5" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5" />}
          {msg.text}
        </div>
      )}

      {scanned.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-white/[0.02] p-2">
          {scanned.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-[11px]">
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="font-mono text-slate-300">{s.no}</span>
              <span className="flex-1 text-slate-400">{s.name}</span>
              <button
                onClick={() => setScanned((l) => l.filter((x) => x.id !== s.id))}
                className="text-slate-500 hover:text-rose-300"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => doCommit(false)}
          disabled={!allOk || busy}
          className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500/90 disabled:opacity-40"
        >
          {allOk ? `确认入库 (${scanned.length} 箱)` : "请扫齐所有物品的箱数"}
        </button>
        <button
          onClick={() => doCommit(true)}
          disabled={!allOk || busy}
          className="w-full rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500/90 disabled:opacity-40"
        >
          {allOk ? `入库并直接成托盘 (${scanned.length} 箱)` : "入库并直接成托盘"}
        </button>
      </div>
    </div>
  );
}
