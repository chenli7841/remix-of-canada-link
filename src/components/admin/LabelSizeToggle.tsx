import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import {
  getDefaultLabelSize,
  setDefaultLabelSize,
  LABEL_SIZES,
  type LabelSize,
} from "@/lib/label-size";

/**
 * Inline segmented control for the account's default label size. Used where
 * labels are produced without opening the preview window first (e.g. the
 * 量尺称重 auto-print). The choice is remembered in localStorage and shared
 * with every other "生成面单 / 打印面单" entry point.
 *
 * `onChange` fires with the new size so a parent can react immediately;
 * reading `getDefaultLabelSize()` at print time also works on its own.
 */
export function LabelSizeToggle({
  className = "",
  onChange,
}: {
  className?: string;
  onChange?: (size: LabelSize) => void;
}) {
  const [size, setSize] = useState<LabelSize>("150x100");

  // localStorage is client-only — read it after mount to avoid SSR mismatch.
  useEffect(() => {
    setSize(getDefaultLabelSize());
  }, []);

  const pick = (next: LabelSize) => {
    setSize(next);
    setDefaultLabelSize(next);
    onChange?.(next);
  };

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs text-slate-400 ${className}`}>
      <Printer className="h-3.5 w-3.5" />
      <span>面单尺寸</span>
      <div className="inline-flex overflow-hidden rounded-md border border-white/10">
        {LABEL_SIZES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => pick(s.value)}
            aria-pressed={size === s.value}
            className={`px-2 py-1 font-semibold transition-colors ${
              size === s.value
                ? "bg-brand text-white"
                : "bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {s.short}
          </button>
        ))}
      </div>
    </div>
  );
}
