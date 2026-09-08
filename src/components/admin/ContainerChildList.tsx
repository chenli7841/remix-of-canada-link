import { useState, Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusBadge, WAYBILL_STATUS_LABEL, WAYBILL_STATUS_COLOR } from "@/lib/admin-shared";

type Waybill = {
  id: string;
  waybill_no: string;
  status?: string | null;
  customer_code?: string | null;
  weight_kg?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  volume_m3?: number | null;
  chargeable_weight_kg?: number | null;
  total_cad?: number | null;
  freight_cad?: number | null;
  duty_cad?: number | null;
  insurance_cad?: number | null;
  clearance_cad?: number | null;
  surcharge_cad?: number | null;
  payment_status?: string | null;
};

function chargeableKg(w: Waybill) {
  if (w.chargeable_weight_kg != null) return Number(w.chargeable_weight_kg);
  const wt = Number(w.weight_kg ?? 0);
  const L = Number(w.length_cm ?? 0),
    W = Number(w.width_cm ?? 0),
    H = Number(w.height_cm ?? 0);
  const vol = L && W && H ? (L * W * H) / 6000 : 0;
  return Math.max(wt, vol);
}
function totalCad(w: Waybill) {
  if (w.total_cad != null) return Number(w.total_cad);
  return (
    Number(w.freight_cad ?? 0) +
    Number(w.duty_cad ?? 0) +
    Number(w.insurance_cad ?? 0) +
    Number(w.clearance_cad ?? 0) +
    Number(w.surcharge_cad ?? 0)
  );
}

function PaymentTag({ v }: { v?: string | null }) {
  if (v === "paid")
    return (
      <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
        已付款
      </span>
    );
  return (
    <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
      未付款
    </span>
  );
}

export function WaybillCompactList({
  waybills,
  onKick,
}: {
  waybills: Waybill[];
  onKick?: (w: Waybill) => Promise<void> | void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!waybills.length) return <div className="py-6 text-center text-xs text-slate-500">—</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-slate-500">
          <tr>
            <th className="w-6"></th>
            <th className="py-2">运单号</th>
            <th>客户号</th>
            <th>状态</th>
            <th>付款</th>
            <th>计费重</th>
            <th className="text-right">总费用</th>
            {onKick && <th></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {waybills.map((w) => {
            const isOpen = !!open[w.id];
            const total = totalCad(w);
            const ck = chargeableKg(w);
            const colSpan = onKick ? 6 : 5;
            return (
              <Fragment key={w.id}>
                <tr
                  className="cursor-pointer hover:bg-white/[0.03]"
                  onClick={() => setOpen((o) => ({ ...o, [w.id]: !o[w.id] }))}
                >
                  <td className="px-2">
                    {isOpen ? (
                      <ChevronDown className="h-3 w-3 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-slate-400" />
                    )}
                  </td>
                  <td className="py-2">
                    <Link
                      to="/admin/waybills/$waybillId"
                      params={{ waybillId: w.id }}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-brand"
                    >
                      {w.waybill_no}
                    </Link>
                  </td>
                  <td className="font-mono text-xs text-slate-300">{w.customer_code ?? "—"}</td>
                  <td>
                    <StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={w.status ?? ""} />
                  </td>
                  <td>
                    <PaymentTag v={w.payment_status} />
                  </td>
                  <td className="font-mono text-xs text-amber-300">{ck ? ck.toFixed(3) : "—"} kg</td>
                  <td className="text-right font-mono text-xs font-semibold text-emerald-300">CA${total.toFixed(2)}</td>
                  {onKick && (
                    <td className="text-right">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm(`确认将运单 ${w.waybill_no} 踢出？`)) await onKick(w);
                        }}
                        className="rounded-md border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10"
                      >
                        踢出
                      </button>
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="bg-white/[0.02]">
                    <td></td>
                    <td colSpan={colSpan} className="px-2 py-3">
                      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-[11px]">
                        <D label="运费" v={`CA$${Number(w.freight_cad ?? 0).toFixed(2)}`} />
                        <D label="关税" v={`CA$${Number(w.duty_cad ?? 0).toFixed(2)}`} />
                        <D label="保险" v={`CA$${Number(w.insurance_cad ?? 0).toFixed(2)}`} />
                        <D label="清关费" v={`CA$${Number(w.clearance_cad ?? 0).toFixed(2)}`} />
                        <D label="附加费" v={`CA$${Number(w.surcharge_cad ?? 0).toFixed(2)}`} />
                        <D label="实重" v={w.weight_kg != null ? `${Number(w.weight_kg).toFixed(2)} kg` : "—"} />
                        <D
                          label="尺寸 cm"
                          v={
                            w.length_cm && w.width_cm && w.height_cm
                              ? `${w.length_cm}×${w.width_cm}×${w.height_cm}`
                              : "—"
                          }
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type CartonRow = {
  id: string;
  carton_no: string;
  display_name?: string | null;
  status?: string | null;
  payment_status?: string | null;
  chargeable_weight_kg?: number | null;
  self_freight_cad?: number | null;
  child_freight_cad?: number | null;
  child_customs_cad?: number | null;
  child_insurance_cad?: number | null;
  clearance_fee_cad?: number | null;
  surcharge_cad?: number | null;
  with_customer_total_cad?: number | null;
  without_customer_total_cad?: number | null;
  customer_code?: string | null;
};

export function CartonCompactList({
  cartons,
  onKick,
}: {
  cartons: CartonRow[];
  onKick?: (c: CartonRow) => Promise<void> | void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!cartons.length) return <div className="py-6 text-center text-xs text-slate-500">暂无 · 点击 "扫码加入"</div>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase text-slate-500">
        <tr>
          <th className="w-6"></th>
          <th className="py-2">箱号</th>
          <th>客户号</th>
          <th>状态</th>
          <th>付款</th>
          <th>计费重</th>
          <th className="text-right">总费用</th>
          {onKick && <th></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {cartons.map((c) => {
          const isOpen = !!open[c.id];
          const total = c.customer_code
            ? Number(c.with_customer_total_cad ?? 0)
            : Number(c.without_customer_total_cad ?? 0);
          const colSpan = onKick ? 6 : 5;
          return (
            <Fragment key={c.id}>
              <tr
                className="cursor-pointer hover:bg-white/[0.03]"
                onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
              >
                <td className="px-2">
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                  )}
                </td>
                <td className="py-2">
                  {c.display_name && <div className="text-xs font-semibold text-slate-200">{c.display_name}</div>}
                  <Link
                    to="/admin/cartons/$cartonId"
                    params={{ cartonId: c.id }}
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-xs text-brand"
                  >
                    {c.carton_no}
                  </Link>
                </td>
                <td className="font-mono text-xs text-slate-300">{c.customer_code ?? "—"}</td>
                <td className="text-xs">{c.status ?? "—"}</td>
                <td>
                  <PaymentTag v={c.payment_status} />
                </td>
                <td className="font-mono text-xs text-amber-300">
                  {c.chargeable_weight_kg != null ? `${Number(c.chargeable_weight_kg).toFixed(3)} kg` : "—"}
                </td>
                <td className="text-right font-mono text-xs font-semibold text-emerald-300">CA${total.toFixed(2)}</td>
                {onKick && (
                  <td className="text-right">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`确认将箱号 ${c.carton_no} 踢出？`)) await onKick(c);
                      }}
                      className="rounded-md border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10"
                    >
                      踢出
                    </button>
                  </td>
                )}
              </tr>
              {isOpen && (
                <tr className="bg-white/[0.02]">
                  <td></td>
                  <td colSpan={colSpan} className="px-2 py-3">
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-[11px]">
                      <D label="自身运费" v={`CA$${Number(c.self_freight_cad ?? 0).toFixed(2)}`} />
                      <D label="下属运费之和" v={`CA$${Number(c.child_freight_cad ?? 0).toFixed(2)}`} />
                      <D label="关税之和" v={`CA$${Number(c.child_customs_cad ?? 0).toFixed(2)}`} />
                      <D label="保险之和" v={`CA$${Number(c.child_insurance_cad ?? 0).toFixed(2)}`} />
                      <D label="清关费" v={`CA$${Number(c.clearance_fee_cad ?? 0).toFixed(2)}`} />
                      <D label="附加费" v={`CA$${Number(c.surcharge_cad ?? 0).toFixed(2)}`} />
                      <D label="方案" v={c.customer_code ? "A · 合并" : "B · 不合并"} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export type PalletRow = {
  id: string;
  pallet_no: string;
  display_name?: string | null;
  status?: string | null;
  payment_status?: string | null;
  chargeable_weight_kg?: number | null;
  self_freight_cad?: number | null;
  child_freight_cad_a?: number | null;
  child_freight_cad_b?: number | null;
  child_customs_cad?: number | null;
  child_insurance_cad?: number | null;
  clearance_fee_cad?: number | null;
  surcharge_cad?: number | null;
  with_customer_total_cad?: number | null;
  without_customer_total_cad?: number | null;
  customer_code?: string | null;
};

export function PalletCompactList({
  pallets,
  onKick,
  onSplit,
}: {
  pallets: PalletRow[];
  onKick?: (p: PalletRow) => Promise<void> | void;
  onSplit?: (p: PalletRow) => Promise<void> | void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!pallets.length) return <div className="py-6 text-center text-xs text-slate-500">暂无 · 点击 "扫码加入"</div>;
  const hasActions = !!(onKick || onSplit);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[11px] uppercase text-slate-500">
        <tr>
          <th className="w-6"></th>
          <th className="py-2">托盘号</th>
          <th>客户号</th>
          <th>状态</th>
          <th>付款</th>
          <th>计费重</th>
          <th className="text-right">总费用</th>
          {hasActions && <th></th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {pallets.map((p) => {
          const isOpen = !!open[p.id];
          const total = p.customer_code
            ? Number(p.with_customer_total_cad ?? 0)
            : Number(p.without_customer_total_cad ?? 0);
          const colSpan = hasActions ? 6 : 5;
          return (
            <Fragment key={p.id}>
              <tr
                className="cursor-pointer hover:bg-white/[0.03]"
                onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
              >
                <td className="px-2">
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                  )}
                </td>
                <td className="py-2">
                  {p.display_name && <div className="text-xs font-semibold text-slate-200">{p.display_name}</div>}
                  <Link
                    to="/admin/pallets/$palletId"
                    params={{ palletId: p.id }}
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-xs text-brand"
                  >
                    {p.pallet_no}
                  </Link>
                </td>
                <td className="font-mono text-xs text-slate-300">{p.customer_code ?? "—"}</td>
                <td className="text-xs">{p.status ?? "—"}</td>
                <td>
                  <PaymentTag v={p.payment_status} />
                </td>
                <td className="font-mono text-xs text-amber-300">
                  {p.chargeable_weight_kg != null ? `${Number(p.chargeable_weight_kg).toFixed(3)} kg` : "—"}
                </td>
                <td className="text-right font-mono text-xs font-semibold text-emerald-300">CA${total.toFixed(2)}</td>
                {hasActions && (
                  <td className="text-right whitespace-nowrap">
                    {onSplit && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await onSplit(p);
                        }}
                        className="mr-1 rounded-md border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10"
                      >
                        拆分
                      </button>
                    )}
                    {onKick && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm(`确认将托盘 ${p.pallet_no} 踢出？`)) await onKick(p);
                        }}
                        className="rounded-md border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10"
                      >
                        踢出
                      </button>
                    )}
                  </td>
                )}
              </tr>
              {isOpen && (
                <tr className="bg-white/[0.02]">
                  <td></td>
                  <td colSpan={colSpan} className="px-2 py-3">
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-[11px]">
                      <D label="自身运费" v={`CA$${Number(p.self_freight_cad ?? 0).toFixed(2)}`} />
                      <D label="下属运费 A" v={`CA$${Number(p.child_freight_cad_a ?? 0).toFixed(2)}`} />
                      <D label="下属运费 B" v={`CA$${Number(p.child_freight_cad_b ?? 0).toFixed(2)}`} />
                      <D label="关税之和" v={`CA$${Number(p.child_customs_cad ?? 0).toFixed(2)}`} />
                      <D label="保险之和" v={`CA$${Number(p.child_insurance_cad ?? 0).toFixed(2)}`} />
                      <D label="清关费" v={`CA$${Number(p.clearance_fee_cad ?? 0).toFixed(2)}`} />
                      <D label="附加费" v={`CA$${Number(p.surcharge_cad ?? 0).toFixed(2)}`} />
                      <D label="方案" v={p.customer_code ? "A · 合并" : "B · 不合并"} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function D({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-slate-100">{v}</div>
    </div>
  );
}
