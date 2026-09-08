// Shared label-size preference (client-only). The account's default size is
// remembered in localStorage so every "生成面单 / 打印面单" entry point and the
// 量尺称重 auto-print all agree on one size, while still letting the operator
// pick a different size for a single print from the label preview window.

export type LabelSize = "150x100" | "100x80";

export const DEFAULT_LABEL_SIZE: LabelSize = "150x100";

export const LABEL_SIZES: { value: LabelSize; label: string; short: string }[] = [
  { value: "150x100", label: "150 × 100 mm", short: "150×100" },
  { value: "100x80", label: "100 × 80 mm", short: "100×80" },
];

const STORAGE_KEY = "eplus.admin.labelSize";

export function isLabelSize(v: unknown): v is LabelSize {
  return v === "150x100" || v === "100x80";
}

export function getDefaultLabelSize(): LabelSize {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isLabelSize(v)) return v;
  } catch {
    /* private mode / storage blocked — fall through to the built-in default */
  }
  return DEFAULT_LABEL_SIZE;
}

export function setDefaultLabelSize(size: LabelSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, size);
  } catch {
    /* ignore — the size still applies for this print, just isn't remembered */
  }
}
