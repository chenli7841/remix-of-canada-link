import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRoles } from "@/lib/admin.functions";
import { Trash2, Loader2 } from "lucide-react";

/** 只有 owner / manager 可见的行内删除按键（带二次确认弹窗）。 */
export function useCanDelete() {
  const fetchRoles = useServerFn(getMyRoles);
  const q = useQuery({
    queryKey: ["my-roles"],
    queryFn: () => fetchRoles(),
    staleTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const roles = q.data?.roles ?? [];
  return roles.includes("owner" as any) || roles.includes("manager" as any);
}

export function DeleteRowButton({
  label,
  name,
  extra,
  onDelete,
}: {
  label: string; // 实体名，如 "运单"
  name: string; // 单号
  extra?: string; // 额外提示文字
  onDelete: () => Promise<any>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        title={`删除${label}`}
        className="ml-2 inline-flex items-center rounded-md border border-rose-500/30 px-1.5 py-1 text-rose-300 hover:bg-rose-500/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 text-left" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold text-slate-100">确认删除{label}？</div>
            <div className="mt-2 text-sm text-slate-300">
              即将删除{label} <span className="font-mono text-rose-300">{name}</span>，此操作不可撤销。
            </div>
            {extra && <div className="mt-1 text-xs text-amber-300">{extra}</div>}
            {err && <div className="mt-2 rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-300">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={busy} onClick={() => setOpen(false)}
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">取消</button>
              <button disabled={busy} onClick={run}
                className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
