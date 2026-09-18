import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect } from "react";
import { scanAddToContainer } from "@/lib/scan.functions";
import { X, ScanLine, Check, AlertCircle } from "lucide-react";

type LogItem = { time: string; code: string; ok: boolean; info: string };

export function ScanAddDialog({
  open, onClose, container, containerId, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  container: "batch" | "pallet" | "carton";
  containerId: string;
  onChanged?: () => void;
}) {
  const scan = useServerFn(scanAddToContainer);
  const [code, setCode] = useState("");
  const [log, setLog] = useState<LogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  if (!open) return null;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    try {
      const r = await scan({ data: { container, containerId, code: c } });
      setLog(l => [{ time, code: c, ok: true, info: r.info }, ...l].slice(0, 50));
      onChanged?.();
    } catch (err: any) {
      setLog(l => [{ time, code: c, ok: false, info: err.message }, ...l].slice(0, 50));
    } finally {
      setCode("");
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-brand"/>扫码加入 ({container === "batch" ? "批次" : container === "carton" ? "箱号" : "托盘"})
          </h2>
          <button onClick={onClose}><X className="h-4 w-4 text-slate-400"/></button>
        </div>
        <p className="mb-3 text-xs text-slate-400">连续扫描运单号 / 箱号 (BOX...) / 托盘号 (PAL...)，系统自动识别。回车提交。</p>
        <form onSubmit={submit} className="flex gap-2">
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="扫描或输入编号后按回车，或点击确认加入"
            className="min-w-0 flex-1 rounded-md border border-brand/40 bg-white/5 px-3 py-2.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!code.trim() || busy}
            className="shrink-0 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
          >
            确认加入
          </button>
        </form>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-white/5 bg-white/[0.02] p-2">
          {log.length === 0 ? <div className="py-4 text-center text-xs text-slate-500">扫描记录将在这里实时显示</div> :
            <ul className="space-y-1">
              {log.map((l, i) => (
                <li key={i} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${l.ok ? "bg-emerald-500/5" : "bg-rose-500/10"}`}>
                  {l.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"/> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400"/>}
                  <span className="font-mono text-[10px] text-slate-500">{l.time}</span>
                  <span className="font-mono text-slate-300">{l.code}</span>
                  <span className={`flex-1 ${l.ok ? "text-emerald-200" : "text-rose-200"}`}>{l.info}</span>
                </li>
              ))}
            </ul>}
        </div>
        <div className="mt-3 flex justify-between text-[11px] text-slate-500">
          <div>共 {log.length} 条记录 · ✓ {log.filter(l => l.ok).length} · ✗ {log.filter(l => !l.ok).length}</div>
          <button onClick={() => setLog([])} className="text-slate-400 hover:text-white">清空</button>
        </div>
      </div>
    </div>
  );
}
