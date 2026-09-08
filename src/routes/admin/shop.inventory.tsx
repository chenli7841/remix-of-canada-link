import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listInventoryMovements, adjustStock, listProducts, getProduct } from "@/lib/shop.functions";
import { listWarehouses } from "@/lib/settings.functions";
import { Boxes, Loader2, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/shop/inventory")({ component: InventoryPage });

const REASON_LABEL: Record<string, string> = { in: "入库", out: "出库", adjust: "调整", sale: "销售", return: "退货" };
const REASON_COLOR: Record<string, string> = {
  in: "text-emerald-300", out: "text-rose-300", adjust: "text-amber-300", sale: "text-blue-300", return: "text-violet-300",
};

function InventoryPage() {
  const fetchMv = useServerFn(listInventoryMovements);
  const adjust = useServerFn(adjustStock);
  const fetchProducts = useServerFn(listProducts);
  const fetchProduct = useServerFn(getProduct);
  const fetchWarehouses = useServerFn(listWarehouses);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filterWh, setFilterWh] = useState("");

  const whQ = useQuery({ queryKey: ["wh-list"], queryFn: () => fetchWarehouses() });
  const invWarehouses = useMemo(
    () => (whQ.data?.warehouses ?? []).filter((w: any) => w.can_inventory !== false && w.is_active),
    [whQ.data]
  );

  const movQ = useQuery({
    queryKey: ["inventory-mov", page, filterWh],
    queryFn: () => fetchMv({ data: { page, pageSize: 30, warehouse_id: filterWh || undefined } }),
  });
  const productsQ = useQuery({ queryKey: ["shop-products-all"], queryFn: () => fetchProducts({ data: { page: 1, pageSize: 100, status: "active" } }) });

  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("in");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const variantsQ = useQuery({
    queryKey: ["product-variants", productId],
    queryFn: () => fetchProduct({ data: { id: productId } }),
    enabled: !!productId,
  });

  // build per-warehouse stock map for selected variant
  const stockMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of (variantsQ.data?.stocks ?? []) as any[]) {
      if (s.variant_id === variantId) m[s.warehouse_id] = (m[s.warehouse_id] ?? 0) + (s.stock ?? 0);
    }
    return m;
  }, [variantsQ.data, variantId]);

  const onSubmit = async () => {
    if (!variantId || !warehouseId || !qty) return alert("请选择仓库、变体并填写数量");
    setBusy(true);
    try {
      const n = Number(qty);
      const delta = reason === "out" || reason === "sale" ? -Math.abs(n) : (reason === "adjust" ? n : Math.abs(n));
      await adjust({ data: { variant_id: variantId, warehouse_id: warehouseId, qty_delta: delta, reason, note: note || undefined } });
      setQty(""); setNote("");
      qc.invalidateQueries({ queryKey: ["inventory-mov"] });
      qc.invalidateQueries({ queryKey: ["product-variants", productId] });
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  const items = movQ.data?.items ?? [];
  const total = movQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="mb-5 font-display text-2xl font-bold inline-flex items-center gap-2"><Boxes className="h-5 w-5 text-blue-400"/>库存流水</h1>

      <div className="mb-5 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
        <div className="mb-3 font-bold">手动调拨</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_120px_120px_1fr_auto]">
          <select value={productId} onChange={e => { setProductId(e.target.value); setVariantId(""); }}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
            <option value="">选择商品</option>
            {(productsQ.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={variantId} onChange={e => setVariantId(e.target.value)} disabled={!productId}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626] disabled:opacity-50">
            <option value="">选择变体</option>
            {(variantsQ.data?.variants ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.sku} (总 {v.stock})</option>)}
          </select>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
            <option value="">选择仓库</option>
            {invWarehouses.map((w: any) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name_zh}{variantId ? ` (${stockMap[w.id] ?? 0})` : ""}
              </option>
            ))}
          </select>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
            {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="数量"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"/>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="备注（可选）"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"/>
          <button onClick={onSubmit} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Plus className="h-3.5 w-3.5"/>}提交
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">入库/退货为正，出库/销售为负，调整按输入符号。每条记录归属选定仓库。</p>

        {variantId && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {invWarehouses.map((w: any) => (
              <span key={w.id} className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                <span className="text-slate-400">{w.code}</span>
                <span className="ml-1 font-bold text-slate-100">{stockMap[w.id] ?? 0}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-slate-400">按仓库筛选：</span>
        <select value={filterWh} onChange={e => { setFilterWh(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs [&>option]:bg-[#0E1626]">
          <option value="">全部仓库</option>
          {invWarehouses.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name_zh}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
        {movQ.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin"/></div> : (
          <table className="w-full text-sm">
            <thead className="border-b border-white/5 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="p-3">时间</th><th className="p-3">仓库</th><th className="p-3">SKU</th><th className="p-3">商品</th><th className="p-3">原因</th><th className="p-3 text-right">变动</th><th className="p-3">备注</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((m: any) => (
                <tr key={m.id} className="hover:bg-white/5">
                  <td className="p-3 text-xs text-slate-400">{new Date(m.created_at).toLocaleString("zh-CN")}</td>
                  <td className="p-3 text-xs">{m.warehouse ? `${m.warehouse.code} · ${m.warehouse.name_zh}` : "—"}</td>
                  <td className="p-3 font-mono text-xs">{m.variant?.sku ?? "—"}</td>
                  <td className="p-3 text-xs">{m.variant?.product?.name ?? "—"}</td>
                  <td className={`p-3 text-xs ${REASON_COLOR[m.reason]}`}>{REASON_LABEL[m.reason]}</td>
                  <td className={`p-3 text-right font-bold ${m.qty_delta > 0 ? "text-emerald-300" : "text-rose-300"}`}>{m.qty_delta > 0 ? "+" : ""}{m.qty_delta}</td>
                  <td className="p-3 text-xs text-slate-400">{m.note ?? "—"}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">暂无流水</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-400">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-30">上一页</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-30">下一页</button>
      </div>
    </div>
  );
}
