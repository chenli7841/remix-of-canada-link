import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { X, Package } from "lucide-react";
import { listRoutes, listWarehouses } from "@/lib/settings.functions";
import { listDestinations } from "@/lib/presets.functions";
import { listUsers } from "@/lib/admin.functions";

export type ContainerForm = {
  display_name: string;
  notes: string; route_id: string; route_code: string;
  customer_user_id: string; customer_code: string;
  pickup_warehouse: string; destination_code: string;
};

export function ContainerCreateDialog({
  kind, onClose, onSubmit,
}: {
  kind: "carton" | "pallet";
  onClose: () => void;
  onSubmit: (data: Omit<ContainerForm, "route_id"> & { route_id?: string }) => Promise<void> | void;
}) {
  const fetchRoutes = useServerFn(listRoutes);
  const fetchWarehouses = useServerFn(listWarehouses);
  const fetchDestinations = useServerFn(listDestinations);
  const fetchUsers = useServerFn(listUsers);

  const routesQ = useQuery({ queryKey: ["admin-routes"], queryFn: () => fetchRoutes() });
  const whQ = useQuery({ queryKey: ["admin-warehouses"], queryFn: () => fetchWarehouses() });
  const destQ = useQuery({ queryKey: ["admin-destinations"], queryFn: () => fetchDestinations() });

  const [form, setForm] = useState<ContainerForm>({
    display_name: "",
    notes: "", route_id: "", route_code: "",
    customer_user_id: "", customer_code: "",
    pickup_warehouse: "", destination_code: "",
  });
  const [busy, setBusy] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const usersQ = useQuery({
    queryKey: ["admin-users-cust", custQuery],
    queryFn: () => fetchUsers({ data: { search: custQuery, page: 1, pageSize: 8 } }),
    enabled: custQuery.length >= 1,
  });

  const selectedRoute = routesQ.data?.routes.find((r: any) => r.id === form.route_id);
  // Linkage: when a route is selected, suggest its origin warehouse + destination
  const filteredWarehouses = useMemo(() => {
    const all = whQ.data?.warehouses ?? [];
    if (!selectedRoute) return all.filter((w: any) => w.can_origin);
    if (selectedRoute.origin?.code) return all.filter((w: any) => w.can_origin && w.country === selectedRoute.origin?.country);
    return all.filter((w: any) => w.can_origin);
  }, [whQ.data, selectedRoute]);
  const filteredDests = useMemo(() => {
    const all = destQ.data?.items ?? [];
    if (!selectedRoute?.destination?.country) return all;
    return all.filter((d: any) => !d.country || d.country === selectedRoute.destination?.country);
  }, [destQ.data, selectedRoute]);

  const prefix = kind === "carton" ? "BOX" : "PAL";
  const ds = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const previewNo = useMemo(() => {
    let s = prefix + ds;
    if (form.route_code) s += form.route_code.toUpperCase();
    if (form.customer_code) s += form.customer_code;
    if (form.pickup_warehouse) s += form.pickup_warehouse.toUpperCase();
    if (form.destination_code) s += form.destination_code.toUpperCase();
    return s + "###";
  }, [form, prefix, ds]);

  const onSelectRoute = (id: string) => {
    const r = routesQ.data?.routes.find((x: any) => x.id === id);
    setForm((f) => ({
      ...f, route_id: id, route_code: r?.code ?? "",
      pickup_warehouse: r?.origin?.code ?? f.pickup_warehouse,
      destination_code: r?.destination?.code ?? f.destination_code,
    }));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try {
          await onSubmit({
            display_name: form.display_name.trim(),
            notes: form.notes || "",
            route_id: form.route_id || undefined,
            route_code: form.route_code || "",
            customer_user_id: form.customer_user_id || "",
            customer_code: form.customer_code || "",
            pickup_warehouse: form.pickup_warehouse || "",
            destination_code: form.destination_code || "",
          });
        } finally { setBusy(false); }
      }} className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0A0F1A] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
            <Package className="h-4 w-4 text-brand"/>新建{kind === "carton" ? "箱号" : "托盘"}
          </h2>
          <button type="button" onClick={onClose}><X className="h-4 w-4 text-slate-400"/></button>
        </div>
        <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
          <div>命名公式：<span className="font-mono text-slate-200">{prefix} + 日期(YYYYMMDD) + [线路] + [客户号] + [取货点] + [目的地] + 序号(3位)</span></div>
          <div className="mt-1">预览：<span className="font-mono text-amber-300">{previewNo}</span></div>
        </div>
        <label className="block text-xs text-slate-400">名称（可选，可手动填写）
          <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            placeholder={kind === "carton" ? "例如：客户A服装箱" : "例如：多伦多一号托盘"}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-400">线路
            <select value={form.route_id} onChange={(e) => onSelectRoute(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
              <option value="">— 不限 —</option>
              {routesQ.data?.routes.map((r: any) => <option key={r.id} value={r.id}>{r.code} - {r.name_zh}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">客户号（搜索）
            <input value={custQuery || form.customer_code} onChange={(e) => { setCustQuery(e.target.value); setForm({ ...form, customer_code: e.target.value, customer_user_id: "" }); }}
              placeholder="客户号 / 邮箱 / 姓名"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 font-mono"/>
            {usersQ.data && usersQ.data.users.length > 0 && custQuery && !form.customer_user_id && (
              <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-white/10 bg-[#0E1626]">
                {usersQ.data.users.map((u: any) => (
                  <button type="button" key={u.id} onClick={() => { setForm({ ...form, customer_user_id: u.id, customer_code: u.customer_code ?? "" }); setCustQuery(""); }}
                    className="block w-full px-2 py-1 text-left text-xs text-slate-200 hover:bg-white/10">
                    <span className="font-mono">{u.customer_code ?? "—"}</span> · {u.full_name ?? u.email}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label className="text-xs text-slate-400">取货点（仓库）
            <select value={form.pickup_warehouse} onChange={(e) => setForm({ ...form, pickup_warehouse: e.target.value })}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
              <option value="">— 不限 —</option>
              {filteredWarehouses.map((w: any) => <option key={w.id} value={w.code}>{w.code} - {w.name_zh}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">目的地
            <select value={form.destination_code} onChange={(e) => setForm({ ...form, destination_code: e.target.value })}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
              <option value="">— 不限 —</option>
              {filteredDests.map((d: any) => <option key={d.id} value={d.code}>{d.code} - {d.name_zh}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs text-slate-400">备注
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
        </label>
        <button disabled={busy} className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "创建中…" : "创建"}</button>
      </form>
    </div>
  );
}
