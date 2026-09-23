import { Link } from "@tanstack/react-router";
import type { getForwardingLoading, LoadingReference } from "@/lib/forwarding-loading.server";

type Loading = Awaited<ReturnType<typeof getForwardingLoading>>;

function ReferenceLabel({ item }: { item: LoadingReference }) {
  return <>
    <span>{item.missing ? "关联信息异常" : item.name ?? "未命名"}</span>
    <span className="ml-1 font-mono">（{item.number ?? "编号缺失"}）</span>
  </>;
}

export function ForwardingLoadingInfo({ loading }: { loading: Loading | undefined }) {
  if (!loading) return <div className="text-amber-300">装载信息未加载，请刷新重试</div>;
  const groups = [
    { kind: "carton", label: "箱子", empty: "未装箱", items: loading.cartons },
    { kind: "pallet", label: "托盘", empty: "未上托盘", items: loading.pallets },
    { kind: "batch", label: "批次", empty: "未分配批次", items: loading.batches },
  ] as const;
  return <div className="space-y-2 border-t border-white/10 pt-2">
    <div className="text-slate-400">订单装载信息 · 名称与编号</div>
    {groups.map(group => <div key={group.kind} className="flex items-start gap-2">
      <span className="shrink-0">{group.label}：</span>
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
        {group.items.length === 0 ? <span className="text-slate-500">{group.empty}</span> : group.items.map(item => {
          const label = <ReferenceLabel item={item} />;
          const className = "break-all text-brand hover:underline";
          if (item.missing) return <span key={item.id} className="text-amber-300">{label}</span>;
          if (group.kind === "carton") return <Link key={item.id} className={className} to="/admin/cartons/$cartonId" params={{ cartonId: item.id }}>{label}</Link>;
          if (group.kind === "pallet") return <Link key={item.id} className={className} to="/admin/pallets/$palletId" params={{ palletId: item.id }}>{label}</Link>;
          return <Link key={item.id} className={className} to="/admin/batches/$batchId" params={{ batchId: item.id }}>{label}</Link>;
        })}
      </div>
    </div>)}
    {loading.totalWaybills === 0 ? <div className="text-slate-500">此订单尚无运单</div> : loading.unassignedWaybills > 0 && <div className="text-amber-300">
      {loading.unassignedWaybills === loading.totalWaybills ? "全部运单尚未装载" : `${loading.unassignedWaybills} / ${loading.totalWaybills} 个运单尚未装载`}
    </div>}
  </div>;
}
