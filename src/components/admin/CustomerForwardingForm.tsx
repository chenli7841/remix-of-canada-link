import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listShippingOptions,
  listCustomerAddresses,
  listCustomerItems,
  createCustomerForwarding,
} from "@/lib/admin-customer-view.functions";
import { Loader2, Plus, Trash2, Send, Package } from "lucide-react";

// 代客发起集运（完整表单）：与客户端 /forwarding 页面同样的字段与
// place_forwarding 载荷结构，只是目标用户由 userId 指定（服务端记录操作人）。
interface ItemRow {
  name: string;
  sku: string;
  hscode: string;
  quantity: number | "";
  unit_price_cad: number | "";
  box_count: number | "";
  inner_qty: number | "";
  weight_kg: number | "";
  material: string;
  origin: string;
  brand: string;
}
interface Parcel {
  tracking_no: string;
  items: ItemRow[];
}

const newItem = (): ItemRow => ({
  name: "",
  sku: "",
  hscode: "",
  quantity: 1,
  unit_price_cad: "",
  box_count: 1,
  inner_qty: "",
  weight_kg: "",
  material: "",
  origin: "",
  brand: "",
});

const inputCls =
  "h-8 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs text-slate-100 outline-none focus:border-brand placeholder:text-slate-600";

export function CustomerForwardingForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const fetchOpts = useServerFn(listShippingOptions);
  const fetchAddresses = useServerFn(listCustomerAddresses);
  const fetchItems = useServerFn(listCustomerItems);
  const doCreate = useServerFn(createCustomerForwarding);

  const optsQ = useQuery({ queryKey: ["admin-shipping-options"], queryFn: () => fetchOpts() });
  const addrQ = useQuery({
    queryKey: ["admin-customer-addresses", userId],
    queryFn: () => fetchAddresses({ data: { userId } }),
  });
  const itemsQ = useQuery({
    queryKey: ["admin-customer-items", userId],
    queryFn: () => fetchItems({ data: { userId } }),
  });

  const warehouses: any[] = (optsQ.data as any)?.warehouses ?? [];
  const routes: any[] = (optsQ.data as any)?.routes ?? [];
  const addresses: any[] = (addrQ.data as any)?.items ?? [];
  const myItems: any[] = (itemsQ.data as any)?.items ?? [];

  const [warehouseId, setWarehouseId] = useState("");
  const [routeCode, setRouteCode] = useState("");
  const [addressId, setAddressId] = useState("");
  const [insured, setInsured] = useState(false);
  const [note, setNote] = useState("");
  const [parcels, setParcels] = useState<Parcel[]>([{ tracking_no: "", items: [newItem()] }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const selectedRoute = routes.find((r) => r.code === routeCode) ?? null;
  // 线路可配置「物品必填项」（shipping_routes.item_field_required），后端
  // place_forwarding 会二次校验并直接报错，这里提前提示，字段名与客户端一致。
  const FIELD_LABEL: Record<string, string> = {
    name: "品名",
    sku: "SKU",
    hscode: "HS 编码",
    quantity: "数量",
    unit_price: "单价 (CAD)",
    box_count: "箱数",
    inner_qty: "内件数",
    weight_kg: "重量 (KG)",
    material: "材质",
    origin: "产地",
    brand: "品牌",
  };
  const reqMap = (selectedRoute?.item_field_required ?? {}) as Record<string, boolean>;
  const reqKeys = Object.keys(reqMap).filter((k) => reqMap[k]);
  const req = (k: string) => reqKeys.includes(k);
  const star = (k: string) => (req(k) ? <span className="text-rose-400"> *</span> : null);

  const availableRoutes = warehouseId
    ? routes.filter(
        (r) =>
          r.origin_warehouse_id === warehouseId || (r.is_bidirectional && r.destination_warehouse_id === warehouseId),
      )
    : [];

  const patchItem = (pi: number, ii: number, patch: Partial<ItemRow>) =>
    setParcels((ps) =>
      ps.map((p, i) =>
        i !== pi ? p : { ...p, items: p.items.map((it, j) => (j !== ii ? it : { ...it, ...patch })) },
      ),
    );

  const applySaved = (pi: number, ii: number, name: string) => {
    const key = (name ?? "").trim().toLowerCase();
    const row = myItems.find(
      (m) => (m.name ?? "").trim().toLowerCase() === key || (m.sku ?? "").trim().toLowerCase() === key,
    );
    if (!row) return;
    // 读取「我的物品」里保存的全部信息，一次性填满发货信息
    patchItem(pi, ii, {
      name: row.name ?? name,
      sku: row.sku ?? "",
      hscode: row.hs_code ?? "",
      unit_price_cad: row.declared_value_cad ?? "",
      inner_qty: row.inner_qty ?? "",
      weight_kg: row.weight_kg ?? "",
      material: row.material ?? "",
      origin: row.origin ?? "China",
      brand: row.brand ?? "",
    });
  };


  const submit = async () => {
    const warehouse = warehouses.find((w) => w.id === warehouseId);
    if (!warehouse) return setMsg({ kind: "err", text: "请选择发货仓库" });
    if (!routeCode) return setMsg({ kind: "err", text: "请选择运输线路" });
    if (!addressId) return setMsg({ kind: "err", text: "请选择该客户的收货地址" });
    const valid = parcels.filter((p) => p.tracking_no.trim() && p.items.some((i) => i.name.trim()));
    if (!valid.length) return setMsg({ kind: "err", text: "请至少填写一个国内单号并添加物品" });
    const nos = valid.map((p) => p.tracking_no.trim().replace(/\s+/g, ""));
    if (new Set(nos).size !== nos.length) return setMsg({ kind: "err", text: "国内单号有重复" });
    for (const p of valid) {
      for (const it of p.items) {
        if (!it.name.trim()) continue;
        for (const k of reqKeys) {
          const v = (it as any)[k === "unit_price" ? "unit_price_cad" : k];
          if (v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v))) {
            return setMsg({ kind: "err", text: `物品「${it.name}」缺少必填项：${FIELD_LABEL[k] ?? k}` });
          }
        }
      }
    }

    setBusy(true);
    setMsg(null);
    let created = 0;
    let waybills = 0;
    const errors: string[] = [];
    for (const parcel of valid) {
      const payload = {
        warehouse: warehouse.code,
        route_code: routeCode,
        address_id: addressId,
        domestic_tracking_no: parcel.tracking_no.trim().replace(/\s+/g, ""),
        note: ["[代客发起集运]", insured ? "[已购买保险]" : null, note.trim() || null].filter(Boolean).join(" "),
        insured,
        items: parcel.items
          .filter((i) => i.name.trim())
          .map((i) => ({
            name: i.name.trim(),
            quantity: Number(i.quantity || 1),
            unit_price_cad: Number(i.unit_price_cad || 0),
            extras: {
              sku: i.sku.trim() || null,
              hscode: i.hscode.trim() || null,
              box_count: i.box_count === "" ? null : Number(i.box_count),
              inner_qty: i.inner_qty === "" ? null : Number(i.inner_qty),
              weight_kg: i.weight_kg === "" ? null : Number(i.weight_kg),
              material: i.material.trim() || null,
              origin: i.origin.trim() || null,
              brand: i.brand.trim() || null,
            },
          })),
      };
      try {
        const r: any = await doCreate({ data: { userId, payload } });
        created++;
        waybills += Number(r?.waybills ?? 0);
      } catch (e: any) {
        errors.push(`${parcel.tracking_no}: ${e?.message ?? "失败"}`);
      }
    }
    setBusy(false);
    if (created > 0) {
      setMsg({
        kind: errors.length ? "err" : "ok",
        text:
          `已代客发起 ${created} 个集运单，生成运单 ${waybills} 个` + (errors.length ? `；失败：${errors.join("；")}` : ""),
      });
      setParcels([{ tracking_no: "", items: [newItem()] }]);
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin-customer-orders", userId] });
      qc.invalidateQueries({ queryKey: ["admin-customer-overview", userId] });
    } else {
      setMsg({ kind: "err", text: errors.join("；") || "发起失败" });
    }
  };

  if (optsQ.isLoading || addrQ.isLoading)
    return (
      <div className="grid h-32 place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-base font-bold">代客发起集运</h3>
        <p className="mt-1 text-xs text-slate-400">与客户端「发起集运」完全一致：仓库、线路、收货地址、国内单号与物品明细。</p>
      </div>

      {msg && (
        <div
          className={`rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 sm:grid-cols-3">
        <label className="block text-xs text-slate-400">
          发货仓库
          <select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setRouteCode("");
            }}
            className={`mt-1 ${inputCls} h-9 [&>option]:bg-[#0E1626]`}
          >
            <option value="">请选择仓库…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name_zh}（{w.code}）
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          运输线路
          <select
            value={routeCode}
            onChange={(e) => setRouteCode(e.target.value)}
            className={`mt-1 ${inputCls} h-9 [&>option]:bg-[#0E1626]`}
          >
            <option value="">请选择线路…</option>
            {availableRoutes.map((r) => (
              <option key={r.id} value={r.code}>
                {r.name_zh}（{r.shipping_method === "air" ? "空运" : "海运"}）
              </option>
            ))}
          </select>
          {warehouseId && availableRoutes.length === 0 && (
            <span className="mt-1 block text-[11px] text-amber-400">该仓库暂无可用集运线路</span>
          )}
        </label>
        <label className="block text-xs text-slate-400">
          收货地址
          <select
            value={addressId}
            onChange={(e) => setAddressId(e.target.value)}
            className={`mt-1 ${inputCls} h-9 [&>option]:bg-[#0E1626]`}
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
            <span className="mt-1 block text-[11px] text-amber-400">该客户还没有收货地址，请先到「收货地址」新增</span>
          )}
        </label>
      </div>

      <datalist id="cv-my-items">
        {myItems.map((m) => (
          <option key={m.id} value={m.name ?? ""}>
            {m.sku ? `SKU ${m.sku}` : ""}
          </option>
        ))}
      </datalist>

      {parcels.map((p, pi) => (
        <div key={pi} className="space-y-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-slate-100">包裹 {pi + 1}</span>
            <input
              value={p.tracking_no}
              onChange={(e) =>
                setParcels((ps) => ps.map((x, i) => (i === pi ? { ...x, tracking_no: e.target.value } : x)))
              }
              placeholder="国内快递单号"
              className={`${inputCls} max-w-[240px]`}
            />
            {parcels.length > 1 && (
              <button
                onClick={() => setParcels((ps) => ps.filter((_, i) => i !== pi))}
                className="ml-auto rounded-md border border-rose-500/30 p-1.5 text-rose-300 hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="space-y-2">
            {p.items.map((it, ii) => (
              <div key={ii} className="grid gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:grid-cols-6">
                <label className="block text-[11px] text-slate-500 sm:col-span-2">
                  品名
                  <input
                    list="cv-my-items"
                    value={it.name}
                    onChange={(e) => patchItem(pi, ii, { name: e.target.value })}
                    onBlur={(e) => applySaved(pi, ii, e.target.value)}
                    placeholder="物品名称 / 从该客户物品库选择"
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  SKU
                  {star("sku")}
                  <input
                    value={it.sku}
                    onChange={(e) => patchItem(pi, ii, { sku: e.target.value })}
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  HS 编码
                  {star("hscode")}
                  <input
                    value={it.hscode}
                    onChange={(e) => patchItem(pi, ii, { hscode: e.target.value })}
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  数量
                  {star("quantity")}
                  <input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => patchItem(pi, ii, { quantity: e.target.value === "" ? "" : Number(e.target.value) })}
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  单价 (CAD)
                  {star("unit_price")}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.unit_price_cad}
                    onChange={(e) =>
                      patchItem(pi, ii, { unit_price_cad: e.target.value === "" ? "" : Number(e.target.value) })
                    }
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  箱数
                  {star("box_count")}
                  <input
                    type="number"
                    min={0}
                    value={it.box_count}
                    onChange={(e) =>
                      patchItem(pi, ii, { box_count: e.target.value === "" ? "" : Number(e.target.value) })
                    }
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  内件数
                  {star("inner_qty")}
                  <input
                    type="number"
                    min={0}
                    value={it.inner_qty}
                    onChange={(e) =>
                      patchItem(pi, ii, { inner_qty: e.target.value === "" ? "" : Number(e.target.value) })
                    }
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  重量 (KG)
                  {star("weight_kg")}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.weight_kg}
                    onChange={(e) =>
                      patchItem(pi, ii, { weight_kg: e.target.value === "" ? "" : Number(e.target.value) })
                    }
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  材质
                  {star("material")}
                  <input
                    value={it.material}
                    onChange={(e) => patchItem(pi, ii, { material: e.target.value })}
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  产地
                  {star("origin")}
                  <input
                    value={it.origin}
                    onChange={(e) => patchItem(pi, ii, { origin: e.target.value })}
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <label className="block text-[11px] text-slate-500">
                  品牌
                  {star("brand")}
                  <input
                    value={it.brand}
                    onChange={(e) => patchItem(pi, ii, { brand: e.target.value })}
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
                <div className="flex items-end">
                  {p.items.length > 1 && (
                    <button
                      onClick={() =>
                        setParcels((ps) =>
                          ps.map((x, i) => (i === pi ? { ...x, items: x.items.filter((_, j) => j !== ii) } : x)),
                        )
                      }
                      className="rounded-md border border-rose-500/30 p-1.5 text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() =>
              setParcels((ps) => ps.map((x, i) => (i === pi ? { ...x, items: [...x.items, newItem()] } : x)))
            }
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
          >
            <Plus className="h-3.5 w-3.5" />
            添加物品
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setParcels((ps) => [...ps, { tracking_no: "", items: [newItem()] }])}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
        >
          <Plus className="h-3.5 w-3.5" />
          添加包裹
        </button>
        <label className="inline-flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} />
          购买保险
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可选）"
          className={`${inputCls} max-w-[320px]`}
        />
      </div>

      <button
        onClick={submit}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        提交集运申请
      </button>
    </div>
  );
}
