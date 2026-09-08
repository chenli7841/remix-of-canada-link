import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listProcurementByProduct, adminShipShopOrder, getLabelData } from "@/lib/orders.functions";
import { METHOD_LABEL, Page, fmtDate, fmtCNY } from "@/lib/admin-shared";
import { renderLabel } from "@/lib/label-render";
import { Loader2, ArrowRight, Truck, Package, ChevronDown, ChevronRight, Boxes, Printer } from "lucide-react";

export const Route = createFileRoute("/admin/shop/orders/procurement")({ component: ProcurementListPage });

function ProcurementListPage() {
  const fetchList = useServerFn(listProcurementByProduct);
  const ship = useServerFn(adminShipShopOrder);
  const fetchLabel = useServerFn(getLabelData);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const q = useQuery({
    queryKey: ["shop-procurement-grouped"],
    queryFn: () => fetchList(),
  });

  const m = useMutation({
    mutationFn: (orderId: string) => ship({ data: { orderId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shop-procurement-grouped"] }),
  });

  const products = q.data?.products ?? [];
  const totalBoxes = products.reduce((s: number, p: any) => s + p.total_boxes, 0);
  const totalQty = products.reduce((s: number, p: any) => s + p.total_qty, 0);

  return (
    <Page
      title="代采购列表"
      subtitle={q.data
        ? `${products.length} 个商品 · ${q.data.total_orders} 个订单 · 合计 ${totalQty} 件 / ${totalBoxes} 箱`
        : "加载中…"}
      action={
        <Link to="/admin/shop/orders" className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
          ← 全部电商订单
        </Link>
      }
    >
      {q.isLoading && (
        <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      )}
      {q.isError && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-sm text-rose-300">{(q.error as Error).message}</div>}
      {!q.isLoading && products.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-10 text-center text-sm text-slate-500">暂无代采购订单</div>
      )}

      <div className="space-y-3">
        {products.map((p: any) => {
          const key = p.product_id ?? p.sku ?? p.name_zh ?? "x";
          const isOpen = expanded[key] ?? true;
          return (
            <div key={key} className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
              <button
                onClick={() => setExpanded({ ...expanded, [key]: !isOpen })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
              >
                {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="h-12 w-12 rounded-lg border border-white/10 object-cover" />
                ) : (
                  <div className="grid h-12 w-12 place-items-center rounded-lg border border-white/10 bg-white/[0.02]"><Package className="h-5 w-5 text-slate-500" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-100">{p.name_zh ?? "未命名"}</span>
                    {p.sku && <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{p.sku}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    单价 {fmtCNY(p.unit_price_cny)} · 内件数 {p.pack_qty ?? 1} · {p.lines.length} 笔订单
                  </div>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <Stat label="采购数" value={p.total_qty} accent="text-emerald-300" suffix="件" />
                  <Stat label="打包" value={p.total_boxes} accent="text-amber-300" suffix="箱" icon={<Boxes className="h-3 w-3" />} />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-white/5">
                  <table className="w-full text-sm">
                    <thead className="bg-white/[0.02] text-left text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">订单号</th>
                        <th className="px-4 py-2 font-medium">客户</th>
                        <th className="px-4 py-2 font-medium">采购类型</th>
                        <th className="px-4 py-2 font-medium text-right">数量</th>
                        <th className="px-4 py-2 font-medium text-right">打包箱数</th>
                        <th className="px-4 py-2 font-medium">线路</th>
                        <th className="px-4 py-2 font-medium">创建</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {p.lines.map((l: any) => (
                        <tr key={l.order_id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-2 font-mono text-[11px]">{l.order_no}</td>
                          <td className="px-4 py-2 text-xs">{l.customer_code ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] ${l.purchase_type === "business" ? "bg-blue-500/15 text-blue-300" : "bg-slate-500/15 text-slate-300"}`}>
                              {l.purchase_type === "business" ? "企业/批发" : "个人/零售"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-emerald-300">{l.quantity}</td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-amber-300" title={`${l.quantity} ÷ ${l.pack_qty}/箱`}>{l.box_count} 箱</td>
                          <td className="px-4 py-2 text-xs">
                            <div>{METHOD_LABEL[l.shipping_method] ?? l.shipping_method}</div>
                            <div className="text-slate-500">{l.route_code ?? "—"} → {l.destination_code ?? "—"}</div>
                          </td>
                          <td className="px-4 py-2 text-[11px] text-slate-400">{fmtDate(l.created_at)}</td>
                          <td className="px-4 py-2 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                disabled={m.isPending}
                                onClick={() => {
                                  if (confirm(`确认将订单 ${l.order_no} 标记为"已发货等待入库"？`)) m.mutate(l.order_id);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                              >
                                <Truck className="h-3 w-3" /> 已发货
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    const d = await fetchLabel({ data: { entityType: "order", entityId: l.order_id } });
                                    renderLabel(d as any);
                                  } catch (e: any) { alert(e.message); }
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/20"
                              >
                                <Printer className="h-3 w-3" /> 打印面单
                              </button>
                              <Link
                                to="/admin/orders/$orderId"
                                params={{ orderId: l.order_id }}
                                className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                              >
                                详情 <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Page>
  );
}

function Stat({ label, value, accent, suffix, icon }: { label: string; value: number; accent: string; suffix?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-right">
      <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        {icon}{label}
      </div>
      <div className={`text-base font-bold ${accent}`}>
        {value}<span className="ml-0.5 text-[10px] font-normal text-slate-400">{suffix}</span>
      </div>
    </div>
  );
}
