import { groupDeliveriesByCity } from '@/lib/delivery-city-groups';
import { DeliveryAddressEditor } from '@/components/admin/DeliveryAddressEditor';
import { DeliveryExtraFeeEditor } from '@/components/admin/DeliveryExtraFeeEditor';
import { BatchCustomerNote } from '@/components/admin/BatchCustomerNote';
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import {
  listDeliveryByCustomer,
  bulkUpdateCustomerDelivery,
  deductCustomerWallet,
} from "@/lib/delivery-queue.functions";
import { Page, fmtCNY } from "@/lib/admin-shared";
import { Loader2, ArrowRight, Truck, Wallet, Check } from "lucide-react";

export const Route = createFileRoute("/admin/delivery-queue/")({ component: DeliveryQueuePage });

const STATUS_LABEL: Record<string, string> = { pending: "待派送", dispatched: "已派送", cancelled: "已取消" };

function DeliveryQueuePage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listDeliveryByCustomer);
  const bulkUpdate = useServerFn(bulkUpdateCustomerDelivery);
  const deduct = useServerFn(deductCustomerWallet);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [collapsedCities,setCollapsedCities] = useState<Set<string>>(new Set());
  const [selectedBatches,setSelectedBatches] = useState<Set<string>>(new Set());
  const toggleBatches = (keys:string[],checked:boolean) => setSelectedBatches(previous=>{const next=new Set(previous);keys.forEach(key=>checked?next.add(key):next.delete(key));return next;});
  const [feeEdit, setFeeEdit] = useState<any>(null);
  const [addressEdit, setAddressEdit] = useState<any>(null);
  const [status, setStatus] = useState<string>("pending");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["delivery-queue-groups", status],
    queryFn: () => fetchList({ data: { status } }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["delivery-queue-groups"] });

  const groups = (q.data?.groups ?? []).filter((g: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (g.customer_code ?? "").toLowerCase().includes(s) ||
      (g.full_name ?? "").toLowerCase().includes(s) ||
      (g.city ?? "").toLowerCase().includes(s) || (g.province ?? "").toLowerCase().includes(s) || (g.phone ?? "").toLowerCase().includes(s) || (g.batch_name ?? "").toLowerCase().includes(s) || (g.batch_no ?? "").toLowerCase().includes(s)
    );
  });

  const cityGroups = groupDeliveriesByCity(groups);

  const totals = groups.reduce(
    (acc: any, g: any) => ({
      count: acc.count + g.count,
      weight: acc.weight + Number(g.weight_kg || 0),
      fee: acc.fee + Number(g.fee_cny || 0),
    }),
    { count: 0, weight: 0, fee: 0 },
  );

  const onDispatchAll = async (g: any) => {
    if (!g.customer_user_id && !g.customer_code) return;
    if (!window.confirm(`将客户 ${g.customer_code ?? ""} 在批次 ${g.batch_name} 的 ${g.count} 项标记为已派送？`)) return;
    await bulkUpdate({
      data: {
        customerUserId: g.customer_user_id,
        ids: g.ids,
        batchId: g.batch_id,
        customerCode: g.customer_user_id ? null : g.customer_code,
        status: "dispatched",
      },
    });
    await refresh();
  };

  const onCancelAll = async (g: any) => {
    if (!window.confirm(`取消客户 ${g.customer_code ?? ""} 在批次 ${g.batch_name} 的 ${g.count} 项待派送？`)) return;
    await bulkUpdate({
      data: {
        customerUserId: g.customer_user_id,
        ids: g.ids,
        batchId: g.batch_id,
        customerCode: g.customer_user_id ? null : g.customer_code,
        status: "cancelled",
      },
    });
    await refresh();
  };

  const onDeduct = async (g: any) => {
    if (!g.customer_user_id) {
      alert("该客户未注册账号，无法扣款");
      return;
    }
    const suggested = g.fee_cad > 0 ? g.fee_cad.toFixed(2) : "";
    const input = window.prompt(
      `扣款金额 (CAD)，客户余额 ${g.wallet_balance_cad != null ? "CA$" + g.wallet_balance_cad.toFixed(2) : "—"}`,
      suggested,
    );
    if (!input) return;
    const amt = Number(input);
    if (!(amt > 0)) {
      alert("金额无效");
      return;
    }
    const note = window.prompt("备注（可空）", "派送费用扣款") ?? undefined;
    await deduct({ data: { customerUserId: g.customer_user_id, amountCad: amt, note, batchId: g.batch_id, customerCode: g.customer_code } });
    await refresh();
    alert("扣款成功");
  };

  const onMore = async (action: string, g: any) => {
    if (!action || busyKey) return;
    setBusyKey(g.key);
    try {
      if (action === 'cancel') await onCancelAll(g);
      if (action === 'deduct') await onDeduct(g);
    } catch (e: any) { alert(e.message || '操作失败，请重试'); }
    finally { setBusyKey(null); }
  };

  return (
    <Page
      title="待派送列表"
      subtitle={`${new Set(groups.map((g: any) => g.customer_user_id || g.customer_code)).size} 个客户 · ${groups.length} 个客户批次 · 共 ${totals.count} 个派送单位`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">状态：</span>
        {["pending", "dispatched", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => {setStatus(s);setSelectedBatches(new Set());}}
            className={`rounded-md border px-2.5 py-1 text-xs ${status === s ? "border-brand bg-brand/20 text-brand" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <button type="button" disabled={q.isFetching} onClick={()=>{setSelectedBatches(new Set());void refresh();}} className="rounded-md border border-white/10 px-3 py-1 text-xs text-sky-200 disabled:opacity-50">
          {q.isFetching ? '更新中…' : '刷新地址与列表'}
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索城市 / 客户号 / 姓名 / 电话 / 批次"
          className="ml-3 w-80 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs placeholder:text-slate-500 focus:border-brand focus:outline-none"
        />
      </div>

      {selectedBatches.size > 0 && <div className="mb-3 flex items-center gap-3 text-sm text-sky-200"><span>已勾选 {selectedBatches.size} 个客户批次</span><button className="text-xs underline" onClick={()=>setSelectedBatches(new Set())}>清空勾选</button></div>}
      <div className="w-full min-w-0 overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">客户号</th>
              <th className="px-4 py-2.5">批次 / 付款</th>
              <th className="px-4 py-2.5 text-center">派送单位</th>
              <th className="px-4 py-2.5">地址</th>
              <th className="px-4 py-2.5">电话</th>
              <th className="px-4 py-2.5 text-right">批次计费重量 (kg)</th>
              <th className="px-4 py-2.5 text-right">批次总费用 (CAD)</th>
              <th className="px-4 py-2.5 text-right">额外费用</th>
              <th className="px-4 py-2.5">结算备注</th>

              <th className="sticky right-0 z-10 min-w-36 bg-slate-900 px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={10} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {q.isError && <tr><td colSpan={10} className="p-4 text-rose-300">{q.error.message}</td></tr>}
            {!q.isLoading && !q.isError && groups.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-slate-500">
                  暂无
                </td>
              </tr>
            )}
            {cityGroups.map(cityGroup => <Fragment key={cityGroup.key}>
              <tr className="bg-sky-950/50"><th colSpan={10} scope="rowgroup" className="px-4 py-3 text-left">
                <input type="checkbox" aria-label={`勾选${cityGroup.city}全部批次`} className="mr-3 accent-brand" checked={cityGroup.rows.every(g=>selectedBatches.has(g.key))} ref={node=>{if(node)node.indeterminate=cityGroup.rows.some(g=>selectedBatches.has(g.key))&&!cityGroup.rows.every(g=>selectedBatches.has(g.key));}} onChange={e=>toggleBatches(cityGroup.rows.map(g=>g.key),e.target.checked)}/>
                <button type="button" aria-expanded={!collapsedCities.has(cityGroup.key)} onClick={()=>setCollapsedCities(previous=>{const next=new Set(previous);next.has(cityGroup.key)?next.delete(cityGroup.key):next.add(cityGroup.key);return next;})} className="text-sm font-semibold text-sky-200">{collapsedCities.has(cityGroup.key)?'▶':'▼'} {cityGroup.city}</button>
                <span className="ml-2 text-xs font-normal text-slate-400">{[cityGroup.province, cityGroup.country].filter(Boolean).join(' · ')}</span>
                <span className="ml-4 text-xs font-normal text-slate-300">{cityGroup.customers.size} 个客户 · {cityGroup.rows.length} 个客户批次 · {cityGroup.count} 个派送单位</span>
              </th></tr>
            {!collapsedCities.has(cityGroup.key) && cityGroup.rows.map((g: any) => (
              <tr key={g.key} className="hover:bg-white/[0.03] align-top">
                <td className="px-4 py-3 text-xs">
                  <div className="font-mono text-slate-100">{g.customer_code ?? "—"}</div>
                  {g.full_name && <div className="text-[11px] text-slate-500">{g.full_name}</div>}
                  {g.wallet_balance_cad != null && (
                    <div className="mt-2 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs font-bold text-amber-200">
                      <Wallet className="h-3 w-3" /> 余额 CA${Number(g.wallet_balance_cad).toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs min-w-40">
                  {g.batch_id ? <Link to="/admin/batches/$batchId" params={{batchId:g.batch_id}} className="text-brand">{g.batch_name}</Link> : '未关联批次'}
                  <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-slate-300"><input type="checkbox" className="accent-brand" checked={selectedBatches.has(g.key)} onChange={e=>toggleBatches([g.key],e.target.checked)}/>{g.batch_no || '未关联批次'}</label>
                  <div className={g.payment_label === '已付款' ? 'mt-1 text-emerald-300' : 'mt-1 text-amber-300'}>{g.payment_label}</div>
                </td>
                <td className="px-4 py-3 text-center text-xs whitespace-nowrap"><strong className="text-brand">{g.count}</strong><div className="mt-1 text-slate-400">独立运单 {g.waybill_count}<br/>客户箱 {g.carton_count} · 客户托盘 {g.pallet_count}</div></td>
                <td className="px-4 py-3 text-xs text-slate-300 max-w-xs">
                  <button type="button" disabled={!g.editable_address} onClick={()=>setAddressEdit(g)} title="点击修改收货地址" className="text-left underline decoration-dotted underline-offset-4 hover:text-brand disabled:no-underline">{g.address || '点击填写地址'}</button>
                </td>
                <td className="px-4 py-3 text-xs">{g.phone ?? <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right text-xs">{g.chargeable_weight_kg == null ? '待更新' : Number(g.chargeable_weight_kg).toFixed(3)}</td>
                <td className="px-4 py-3 text-right text-xs">{g.total_cad == null ? '待确认' : 'CAD ' + Number(g.total_cad).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-xs whitespace-nowrap">
<button disabled={!g.batch_id || !g.customer_code || !!busyKey || g.extra_fee_paid} title="点击修改额外费用" className="text-brand underline decoration-dotted underline-offset-4 disabled:no-underline disabled:text-slate-300" onClick={()=>setFeeEdit(g)}>{fmtCNY(g.fee_cny)}</button>
{g.extra_fee_paid ? <div className="mt-2 text-emerald-300">已付款</div> : <button disabled={!!busyKey || !g.batch_id || !g.customer_user_id || !(g.fee_cny > 0)} className="mt-2 block ml-auto text-amber-300 disabled:opacity-40" onClick={()=>void onMore('deduct',g)}>{busyKey === g.key ? '处理中…' : '扣款'}</button>}
</td>
                <td className="px-4 py-3">{g.batch_id && g.customer_code ? <BatchCustomerNote batchId={g.batch_id} customerCode={g.customer_code}/> : '—'}</td>

                <td className="sticky right-0 z-10 min-w-36 bg-slate-900 px-4 py-3 text-right shadow-lg">
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    {status === "pending" && (
                      <>
                        <button
                          disabled={busyKey !== null}
                          onClick={async () => { if (busyKey) return; setBusyKey(g.key); try { await onDispatchAll(g); } catch (e: any) { alert(e.message); } finally { setBusyKey(null); } }}
                          title="全部标记派送"
                          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <Check className="inline h-3 w-3" /> 派送
                        </button>
                      </>
                    )}
                    <Link
                      to="/admin/delivery-queue/$customerKey"
                      params={{ customerKey: g.customer_user_id || `code:${g.customer_code ?? "unknown"}` }}
                      search={{batchId:g.batch_id || "unassigned"}}
                      className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] text-brand hover:bg-brand/20"
                    >
                      <Truck className="h-3 w-3" /> 详情 <ArrowRight className="h-3 w-3" />
                    </Link>

                  </div>
                </td>
              </tr>
            ))}
            </Fragment>)}
          </tbody>
        </table>
      </div>
      {feeEdit && <DeliveryExtraFeeEditor group={feeEdit} onClose={()=>setFeeEdit(null)} onSaved={refresh}/>}
      {addressEdit && <DeliveryAddressEditor group={addressEdit} onClose={()=>setAddressEdit(null)} onSaved={refresh}/>}
    </Page>
  );
}
