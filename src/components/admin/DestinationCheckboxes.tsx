import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDestinations } from "@/lib/presets.functions";

/** Multi-select destinations via checkboxes (batch can accept several). */
export function DestinationCheckboxes({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const fetchDests = useServerFn(listDestinations);
  const destQ = useQuery({ queryKey: ["destinations"], queryFn: () => fetchDests(), staleTime: 10 * 60_000 });
  const items = ((destQ.data?.items ?? []) as any[]).filter((d) => d.active);

  const toggle = (code: string) => {
    const set = new Set(value);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onChange(Array.from(set));
  };

  if (destQ.isLoading) return <div className="mt-1 text-[11px] text-slate-500">加载目的地…</div>;
  if (!items.length) return <div className="mt-1 text-[11px] text-slate-500">暂无可选目的地</div>;

  return (
    <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-white/10 bg-white/5 p-2">
      {items.map((d: any) => {
        const checked = value.includes(d.code);
        return (
          <label
            key={d.id}
            className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs ${checked ? "bg-brand/15 text-slate-100" : "text-slate-300"} ${disabled ? "opacity-50" : "hover:bg-white/10"}`}
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={checked}
              onChange={() => toggle(d.code)}
              className="h-3.5 w-3.5 accent-[#2563eb]"
            />
            <span className="font-mono">{d.code}</span>
            <span className="truncate text-slate-400">{d.name_zh}</span>
          </label>
        );
      })}
    </div>
  );
}
