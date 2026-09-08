import * as React from "react";

/**
 * Continuous-typing date input.
 * User types digits; component auto-inserts "-" so the value reads YYYY-MM-DD.
 * Emits an ISO date string (YYYY-MM-DD) or "" via onChange.
 */
export function DateInput({
  value, onChange, disabled, placeholder = "YYYY-MM-DD", className,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const format = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(format(e.target.value))}
      className={
        className ??
        "mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 font-mono tracking-wider"
      }
    />
  );
}
