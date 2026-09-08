import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getShopDashboard } from "@/lib/shop.functions";
import { seedShopData } from "@/lib/seed.functions";
import { ShoppingBag, Package, AlertTriangle, DollarSign, Truck, Database, Loader2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin/shop/")({ component: ShopHome });

function ShopHome() {
  const fetchDash = useServerFn(getShopDashboard);
  const seed = useServerFn(seedShopData);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shop-dashboard"], queryFn: () => fetchDash() });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onSeed = async () => {
    if (!confirm("⚠️ 将清空所有商品、电商订单与库存，并重新生成 20 商品 + 50 电商订单（含一单多运单）。继续？")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await seed();
      setMsg(`✓ 已生成 ${r.categories} 分类 / ${r.products} 商品 / ${r.orders} 订单 / ${r.waybills} 运单（${r.multiWaybillOrders} 个订单含多运单）`);
      qc.invalidateQueries({ queryKey: ["shop-dashboard"] });
    } catch (e: any) { setMsg("✗ " + e.message); }
    finally { setBusy(false); }
  };

  if (q.isLoading) return <div className="grid h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;
  const d = q.data!;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-blue-400"/>电商概览</h1>
          <p className="mt-1 text-sm text-slate-400">商品销售 · 库存 · 订单</p>
        </div>
        <button onClick={onSeed} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Database className="h-3.5 w-3.5"/>}
          重置测试数据
        </button>
      </div>
      {msg && <div className="mb-4 rounded-md border border-white/10 bg-white/5 p-2 text-xs">{msg}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KPI icon={ShoppingBag} label="今日订单" value={d.kpi.todayOrders} accent="from-blue-500 to-cyan-500"/>
        <KPI icon={DollarSign} label="今日销售 CNY" value={`¥${d.kpi.todaySalesCNY.toLocaleString()}`} accent="from-emerald-500 to-teal-500"/>
        <KPI icon={DollarSign} label="本月销售 CNY" value={`¥${d.kpi.monthSalesCNY.toLocaleString()}`} accent="from-violet-500 to-fuchsia-500"/>
        <KPI icon={Truck} label="待发货订单" value={d.kpi.pendingShip} accent="from-amber-500 to-orange-500"/>
        <KPI icon={Package} label="在售商品" value={d.kpi.activeProducts} accent="from-sky-500 to-indigo-500"/>
        <KPI icon={AlertTriangle} label="低库存 SKU" value={d.kpi.lowStockCount} accent="from-rose-500 to-pink-500"/>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="低库存预警" link="/admin/shop/inventory">
          {d.lowStock.length === 0 ? <div className="py-6 text-center text-xs text-slate-500">无</div> : (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="py-1.5 pr-3">SKU</th><th className="py-1.5 pr-3">商品</th><th className="py-1.5 text-right">库存</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {d.lowStock.map((v: any) => (
                  <tr key={v.id}>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">{v.sku}</td>
                    <td className="py-1.5 pr-3">{v.product?.name ?? "—"}</td>
                    <td className="py-1.5 text-right font-bold text-rose-400">{v.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="快捷入口">
          <div className="grid grid-cols-2 gap-2">
            <QuickLink to="/admin/shop/products" label="商品管理" icon={Package}/>
            <QuickLink to="/admin/shop/categories" label="分类管理" icon={ShoppingBag}/>
            <QuickLink to="/admin/orders" label="电商订单" icon={Truck}/>
            <QuickLink to="/admin/shop/inventory" label="库存流水" icon={AlertTriangle}/>
            <QuickLink to="/admin/shop/coupons" label="优惠券" icon={DollarSign}/>
            <QuickLink to="/admin/shop/banners" label="Banner 装修" icon={ShoppingBag}/>
            <QuickLink to="/admin/shop/articles" label="文章管理" icon={ShoppingBag}/>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value, accent }: any) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className={`mb-3 inline-grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br ${accent} text-white`}><Icon className="h-4 w-4"/></div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 font-display text-xl font-bold">{value}</div>
    </div>
  );
}
function Panel({ title, children, link }: any) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        {link && <Link to={link} className="inline-flex items-center gap-1 text-xs text-brand hover:underline">查看 <ArrowRight className="h-3 w-3"/></Link>}
      </div>
      {children}
    </div>
  );
}
function QuickLink({ to, label, icon: Icon }: any) {
  return <Link to={to} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm hover:bg-white/10"><Icon className="h-4 w-4 text-blue-400"/>{label}</Link>;
}
