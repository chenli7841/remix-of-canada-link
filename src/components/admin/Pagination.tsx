import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

export function Pagination({ page, pageSize, total, onChange }: {
  page: number; pageSize: number; total: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));
  const [jump, setJump] = useState(String(page));
  useEffect(() => { setJump(String(page)); }, [page]);

  if (!total || total <= pageSize) return null;

  const go = () => {
    const n = Number(jump);
    if (!Number.isFinite(n)) { setJump(String(page)); return; }
    const target = Math.min(totalPages, Math.max(1, Math.floor(n)));
    setJump(String(target));
    if (target !== page) onChange(target);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
      <div>第 {page} / {totalPages} 页 · 共 {total} 条</div>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40">
          <ChevronLeft className="h-3 w-3"/>上一页
        </button>
        <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40">
          下一页<ChevronRight className="h-3 w-3"/>
        </button>
        <span className="ml-2">跳至</span>
        <input
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }}
          onBlur={go}
          className="w-14 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-center text-xs text-slate-100 focus:border-brand focus:outline-none"
        />
        <span>页</span>
        <button onClick={go} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">确定</button>
      </div>
    </div>
  );
}
