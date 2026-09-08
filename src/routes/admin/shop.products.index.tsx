import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listProducts, setProductStatus, listCategories } from "@/lib/shop.functions";
import { Package, Loader2, Plus, Search } from "lucide-react";

export const Route = createFileRoute("/admin/shop/products/")({ component: ProductsPage });

const STATUS_COLOR: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  draft: "border-slate-500/30 bg-slate-500/10 text-slate-400",
  archived: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};
const STATUS_LABEL: Record<string, string> = { active: "在售", draft: "草稿", archived: "下架" };

function ProductsPage() {
  const fetchList = useServerFn(listProducts);
  const fetchCats = useServerFn(listCategories);
  const setStatus = useServerFn(setProductStatus);
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus_] = useState("");
  const [catId, setCatId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const listQ = useQuery({
    queryKey: ["shop-products", page, q, status, catId],
    queryFn: () => fetchList({ data: { page, pageSize: 20, q: q || undefined, status: status || undefined, category_id: catId || undefined } }),
  });
  const catsQ = useQuery({ queryKey: ["shop-cats"], queryFn: () => fetchCats() });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };
  const toggle = (id: string) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const bulk = async (s: "active" | "archived" | "draft") => {
    if (!selected.size) return;
    await setStatus({ data: { ids: Array.from(selected), status: s } });
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["shop-products"] });
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2"><Package className="h-5 w-5 text-blue-400"/>商品管理</h1>
          <p className="mt-1 text-sm text-slate-400">共 {total} 件商品</p>
        </div>
        <Link to="/admin/shop/products/$productId" params={{ productId: "new" }}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand/90">
          <Plus className="h-3.5 w-3.5"/>新增商品
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"/>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="搜索商品名/SKU"
            className="w-56 rounded-md border border-white/10 bg-white/5 py-1.5 pl-7 pr-2 text-sm focus:border-brand focus:outline-none"/>
        </div>
        <select value={status} onChange={(e) => { setStatus_(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
          <option value="">全部状态</option>
          <option value="active">在售</option><option value="draft">草稿</option><option value="archived">下架</option>
        </select>
        <select value={catId} onChange={(e) => { setCatId(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
          <option value="">全部分类</option>
          {(catsQ.data?.items ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-slate-400">已选 {selected.size} 项</span>
            <button onClick={() => bulk("active")} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300 hover:bg-emerald-500/20">批量上架</button>
            <button onClick={() => bulk("archived")} className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-300 hover:bg-rose-500/20">批量下架</button>
          </div>
        )}
      </div>

      {listQ.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-slate-500"/></div> : (
        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
          <table className="w-full text-sm">
            <thead className="border-b border-white/5 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="p-3"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll}/></th>
                <th className="p-3">SKU</th>
                <th className="p-3">商品名</th>
                <th className="p-3">分类</th>
                <th className="p-3 text-right">价格 CNY</th>
                <th className="p-3 text-right">库存</th>
                <th className="p-3 text-right">销量</th>
                <th className="p-3">状态</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-500">暂无商品</td></tr>}
              {items.map((p: any) => (
                <tr key={p.id} className="hover:bg-white/5">
                  <td className="p-3"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}/></td>
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3 text-xs text-slate-400">{p.category?.name ?? "—"}</td>
                  <td className="p-3 text-right">¥{Number(p.price_cny).toFixed(2)}</td>
                  <td className="p-3 text-right">{p.total_stock}</td>
                  <td className="p-3 text-right">{p.sold_count}</td>
                  <td className="p-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                  <td className="p-3 text-right">
                    <Link to="/admin/shop/products/$productId" params={{ productId: p.id }} className="text-xs text-brand hover:underline">编辑</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-400">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-30">上一页</button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-30">下一页</button>
      </div>
    </div>
  );
}
