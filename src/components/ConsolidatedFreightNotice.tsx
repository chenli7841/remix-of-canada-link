import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getConsolidatedFreightNotice } from "@/lib/consolidated-freight.functions";

export function ConsolidatedFreightNotice({ id, kind = "forwarding" }: { id: string; kind?: "forwarding" | "order" }) {
  const load = useServerFn(getConsolidatedFreightNotice);
  const query = useQuery({ queryKey: ["consolidated-freight-notice", kind, id], queryFn: () => load({ data: { id, kind } }), refetchOnMount: "always" });
  if (query.isError) return <p className="my-2 text-xs text-amber-600" role="status">合箱收费状态暂时无法读取，请刷新重试。</p>;
  if (!query.data?.covered) return null;
  const partial = query.data.covered < query.data.total;
  return <div className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600" role="note">
    <p className="font-semibold">{partial ? "部分运单已合箱收费，订单费用只做参考" : "已合箱收费，订单费用只做参考"}</p>
    <p className="mt-1">{query.data.references.join(" / ")} · 覆盖 {query.data.covered}/{query.data.total} 个运单</p>
  </div>;
}
