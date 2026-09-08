import { Card } from "@/lib/admin-shared";

type Fees = {
  self_freight_cny: number;
  child_freight_cny: number;
  child_customs_cny: number;
  child_insurance_cny: number;
  clearance_fee_cny: number;
  surcharge_cny?: number;
  self_surcharge_cny?: number;
  child_surcharge_cny?: number;
  with_customer_total_cny: number;
  without_customer_total_cny: number;
  has_customer: boolean;
  customer_fee_scheme?: "merged" | "split" | null;
  fx_rate?: number;
  self_freight_cad?: number;
  child_freight_cad?: number;
  child_customs_cad?: number;
  child_insurance_cad?: number;
  clearance_fee_cad?: number;
  surcharge_cad?: number;
  self_surcharge_cad?: number;
  child_surcharge_cad?: number;
  with_customer_total_cad?: number;
  without_customer_total_cad?: number;
  last_mile_cad?: number;
  child_freight_cad_a?: number;
  child_freight_cad_b?: number;
};

function makeFmt(currency: "CNY" | "CAD") {
  return (n: any) => {
    const v = Number(n ?? 0);
    return currency === "CAD" ? `CA$${v.toFixed(2)}` : `¥${v.toFixed(2)}`;
  };
}

function FeeRow({ label, value, dim, fmt }: { label: string; value: any; dim?: boolean; fmt: (n: any) => string }) {
  return (
    <div className={`flex justify-between py-1 ${dim ? "text-slate-500 line-through" : "text-slate-200"}`}>
      <span className="text-xs">{label}</span>
      <span className="text-xs font-mono">{fmt(value)}</span>
    </div>
  );
}

export function FeeComparisonCard({ fees, currency = "CAD" }: { fees: Fees; currency?: "CNY" | "CAD" }) {
  // 系统统一使用 CAD (加元)
  // 有客户号: 客户偏好 split→采用 B; merged→采用 A
  // 无客户号: 只能用 B
  const scheme = fees.customer_fee_scheme ?? "split";
  const active: "with" | "without" = fees.has_customer ? (scheme === "split" ? "without" : "with") : "without";
  const disableWith = !fees.has_customer;
  const fmt = makeFmt("CAD");
  const num = (v: any) => Number(v ?? 0);
  const withTotal = num(fees.with_customer_total_cad);
  const withoutTotal = num(fees.without_customer_total_cad);
  return (
    <Card title="费用明细 (CAD)">
      <div className="mb-2 text-[11px] text-slate-400">
        当前模式：<span className="font-semibold text-brand">
          {disableWith
            ? "无客户号 — 仅启用「不合并」方案 (B)"
            : `有客户号 — 客户偏好「${scheme === "split" ? "不合并 (B)" : "合并 (A)"}」`}
        </span>
        <div className="mt-1 text-[10px] text-slate-500">两种方案同时展示便于对比；实际计费按"采用"标记方案。客户偏好在用户详情页设置。</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-lg border p-3 ${disableWith ? "border-white/5 bg-white/[0.02] opacity-40" : active === "with" ? "border-brand/40 bg-brand/5" : "border-white/5 bg-white/[0.02] opacity-70"}`}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-200">A. 有客户号 · 合并</h3>
            {disableWith ? <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] text-slate-400">无客户号不可用</span>
              : active === "with" ? <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[10px] text-brand">采用</span>
              : <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] text-slate-400">备选</span>}
          </div>
          <FeeRow label="自身运费" value={fees.self_freight_cad} dim={active !== "with"} fmt={fmt}/>
          {fees.child_freight_cad_a != null && (
            <FeeRow label="下属运费之和 (采用方案)" value={fees.child_freight_cad_a} dim={active !== "with"} fmt={fmt}/>
          )}
          <FeeRow label="下属关税之和" value={fees.child_customs_cad} dim={active !== "with"} fmt={fmt}/>
          <FeeRow label="下属保险之和" value={fees.child_insurance_cad} dim={active !== "with"} fmt={fmt}/>
          <FeeRow label="附加费之和 (自身+下属)" value={num(fees.self_surcharge_cad) + num(fees.child_surcharge_cad)} dim={active !== "with"} fmt={fmt}/>
          <FeeRow label="末端派送费" value={fees.last_mile_cad ?? 0} dim={active !== "with"} fmt={fmt}/>
          <div className={`mt-2 flex justify-between border-t border-white/5 pt-2 ${active === "with" ? "text-emerald-300" : "text-slate-500 line-through"}`}>
            <span className="text-xs font-semibold">合计 (方案 A)</span>
            <span className="text-sm font-mono font-bold">{fmt(withTotal)}</span>
          </div>
        </div>

        <div className={`rounded-lg border p-3 ${active === "without" ? "border-brand/40 bg-brand/5" : "border-white/5 bg-white/[0.02] opacity-60"}`}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-200">B. 无客户号 · 不合并</h3>
            {active === "without" ? <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[10px] text-brand">采用</span>
              : <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] text-slate-400">备选</span>}
          </div>
          <FeeRow label="下属运费之和" value={fees.child_freight_cad} dim={active !== "without"} fmt={fmt}/>
          <FeeRow label="下属关税之和" value={fees.child_customs_cad} dim={active !== "without"} fmt={fmt}/>
          <FeeRow label="下属保险之和" value={fees.child_insurance_cad} dim={active !== "without"} fmt={fmt}/>
          <FeeRow label="下属清关费" value={fees.clearance_fee_cad} dim={active !== "without"} fmt={fmt}/>
          <FeeRow label="下属附加费之和" value={fees.child_surcharge_cad ?? 0} dim={active !== "without"} fmt={fmt}/>
          <FeeRow label="末端派送费" value={fees.last_mile_cad ?? 0} dim={active !== "without"} fmt={fmt}/>
          <div className="mt-1 text-[10px] text-slate-500">自身运费 / 自身附加费 ({fmt(fees.self_surcharge_cad ?? 0)}) 不计入本方案</div>
          <div className={`mt-2 flex justify-between border-t border-white/5 pt-2 ${active === "without" ? "text-emerald-300" : "text-slate-500 line-through"}`}>
            <span className="text-xs font-semibold">合计 (方案 B)</span>
            <span className="text-sm font-mono font-bold">{fmt(withoutTotal)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}


function InfoField({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  const empty = value == null || value === "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-sm ${mono ? "font-mono" : ""} ${empty ? "text-slate-600" : "text-slate-100"}`}>
        {empty ? "—" : String(value)}
      </div>
    </div>
  );
}

export function ContainerInfoCard({ kind, row, currency = "CNY" }: { kind: "carton" | "pallet"; row: any; currency?: "CNY" | "CAD" }) {
  const freightLabel = currency === "CAD" ? "自身运费 (CA$)" : "自身运费 (¥)";
  const freightValue = currency === "CAD"
    ? (row.self_freight_cad != null ? Number(row.self_freight_cad).toFixed(2) : null)
    : row.self_freight_cny;
  return (
    <Card title={kind === "carton" ? "箱号信息" : "托盘信息"}>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Tag label="线路" value={row.route_code}/>
        <Tag label="客户号" value={row.customer_code}/>
        <Tag label="取货点" value={row.pickup_warehouse}/>
        <Tag label="目的地" value={row.destination_code}/>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <InfoField label={kind === "carton" ? "箱号" : "托盘号"} value={kind === "carton" ? row.carton_no : row.pallet_no} mono/>
        <InfoField label="状态" value={row.status}/>
        <InfoField label="付款" value={row.payment_status}/>
        <InfoField label="所属批次" value={row.batch_no} mono/>
        {kind === "carton" && <InfoField label="所属托盘" value={row.pallet_no} mono/>}
        <InfoField label="线路代码" value={row.route_code} mono/>
        <InfoField label="客户号" value={row.customer_code} mono/>
        <InfoField label="取货点" value={row.pickup_warehouse}/>
        <InfoField label="目的地" value={row.destination_code}/>
        <InfoField label="总重量 (kg) · 下属之和" value={row.child_weight_kg}/>
        <InfoField label="总体积 (m³) · 下属之和" value={row.child_volume_m3}/>
        <InfoField label="自身重量 (kg)" value={row.self_weight_kg}/>
        <InfoField label="自身长 × 宽 × 高 (cm)" value={[row.self_length_cm, row.self_width_cm, row.self_height_cm].some(Boolean) ? `${row.self_length_cm ?? "—"} × ${row.self_width_cm ?? "—"} × ${row.self_height_cm ?? "—"}` : null}/>
        <InfoField label="自身体积 (m³)" value={row.self_volume_m3}/>
        <InfoField label={freightLabel} value={freightValue}/>
        <InfoField label="备注" value={row.notes}/>
      </div>
    </Card>
  );
}

function Tag({ label, value }: { label: string; value: any }) {
  const empty = value == null || value === "";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${empty ? "border-white/5 text-slate-500" : "border-brand/30 bg-brand/10 text-brand"}`}>
      <span className="text-[10px] text-slate-400">{label}</span>
      <span className="font-mono text-xs">{empty ? "—" : value}</span>
    </span>
  );
}
