import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAdminLogs, listAuditChildren } from "@/lib/admin-logs.functions";
import { logActionLabel, logDetailsText, logEntityLabel } from "@/lib/admin-log-labels";
import { fmtDate } from "@/lib/admin-shared";

export function EntityActionLogs({
  entityType,
  entityId,
  title = "操作记录",
  defaultOpen = false,
  compact = false,
}: {
  entityType: string | string[];
  entityId: string;
  title?: string;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fetchLogs = useServerFn(listAdminLogs);
  const types = (Array.isArray(entityType) ? [...entityType] : [entityType]).sort();
  const query = useInfiniteQuery({
    queryKey: ["entity-action-logs", types, entityId],
    initialPageParam: 1,
    enabled: open && !!entityId && types.length > 0,
    queryFn: ({ pageParam }) =>
      fetchLogs({
        data: { entity_types: types, entity_id: entityId, page: pageParam, pageSize: 50 },
      }),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    staleTime: 0,
  });
  const rows = [
    ...new Map(
      (query.data?.pages.flatMap((p) => p.items) ?? []).map((row) => [row.id, row]),
    ).values(),
  ];
  return (
    <details
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open && query.data) void query.refetch();
      }}
      className={
        compact
          ? "mt-2 min-w-0 print:hidden"
          : "my-4 min-w-0 rounded-xl border border-white/10 bg-white/[0.02] print:hidden"
      }
    >
      <summary
        className={
          compact
            ? "cursor-pointer text-xs text-sky-300"
            : "cursor-pointer p-4 text-sm font-semibold text-slate-200"
        }
      >
        {title}
        {query.data ? `（${query.data.pages[0].total}）` : ""}
      </summary>
      {open && (
        <div className="max-h-96 space-y-2 overflow-y-auto p-3">
          <button
            type="button"
            className="text-xs text-sky-300 underline"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            刷新记录
          </button>
          {query.isPending && <p className="text-xs text-slate-400">正在读取…</p>}
          {query.isError && (
            <p role="alert" className="text-xs text-rose-300">
              读取失败，请重试刷新。
            </p>
          )}
          {query.isSuccess && !rows.length && (
            <p className="text-xs text-slate-400">暂无操作记录</p>
          )}
          {rows.map((row) => (
            <article key={row.id} className="rounded border border-white/10 p-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2 text-slate-200">
                <strong>{logActionLabel(row.action)}</strong>
                <span>{fmtDate(row.created_at)}</span>
              </div>
              {types.length > 1 && (
                <p className="text-slate-400">{logEntityLabel(row.entity_type)}</p>
              )}
              <p className="break-words text-slate-400">操作人：{row.operator_name || "—"}</p>
              {row.note && (
                <p className="whitespace-pre-wrap break-words text-slate-300">{row.note}</p>
              )}
              {(row.before || row.after) && (
                <details>
                  <summary className="mt-1 cursor-pointer text-sky-300">变更详情</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-slate-400">
                    {logDetailsText({ before: row.before, after: row.after })}
                  </pre>
                </details>
              )}
            </article>
          ))}
          {query.hasNextPage && (
            <button
              type="button"
              className="text-xs text-sky-300"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "正在读取…" : "加载更早记录"}
            </button>
          )}
        </div>
      )}
    </details>
  );
}

export function RelatedActionLogs({ kind, id }: { kind: "batch" | "route" | "trip"; id: string }) {
  const [open, setOpen] = useState(false);
  const fetchChildren = useServerFn(listAuditChildren);
  const query = useQuery({
    queryKey: ["audit-children", kind, id],
    queryFn: () => fetchChildren({ data: { kind, id } }),
    enabled: open && !!id,
  });
  return (
    <details
      className="my-3 print:hidden"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs text-sky-300">
        {kind === "batch" ? "客户批次结算操作记录" : kind === "route" ? "运费规则操作记录" : "关联派送趟操作记录"}
      </summary>
      {open && (
        <div className="p-2">
          {query.isPending && <p className="text-xs text-slate-400">正在读取…</p>}
          {query.isError && (
            <button type="button" className="text-xs text-rose-300" onClick={() => query.refetch()}>
              读取失败，点击重试
            </button>
          )}
          {query.isSuccess && !query.data.length && (
            <p className="text-xs text-slate-400">暂无关联记录</p>
          )}
          {query.data?.map((row) => (
            <EntityActionLogs
              key={row.id}
              entityType={kind === "batch" ? "batch_settlement" : kind === "route" ? "freight_rule" : "driver_trip"}
              entityId={row.id}
              title={row.label}
            />
          ))}
        </div>
      )}
    </details>
  );
}
