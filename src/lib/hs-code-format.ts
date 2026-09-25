// Canonical HS code shape everywhere in the app: 0000.00.00.00 (10 digits,
// grouped 4-2-2-2). Comparisons elsewhere (duty.server.ts's normalizeHs)
// already strip separators, so this only fixes what gets typed and stored.
export const HS_CODE_GROUP_LENGTHS = [4, 2, 2, 2] as const;

export function hsCodeDigitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function isCompleteHsCode(value: string | null | undefined): boolean {
  return hsCodeDigitsOnly(value).length === 10;
}

/** Digits (any length) -> canonical display form, grouped as typed so far. */
export function formatHsCode(value: string | null | undefined): string {
  const d = hsCodeDigitsOnly(value).slice(0, 10);
  const groups: string[] = [];
  let i = 0;
  for (const len of HS_CODE_GROUP_LENGTHS) {
    if (i >= d.length) break;
    groups.push(d.slice(i, i + len));
    i += len;
  }
  return groups.join(".");
}

/**
 * Normalizes free-form input for storage. Empty input is a valid "not set"
 * (returns null) — HS code entry can still be optional in some flows — but
 * anything non-empty must be exactly 10 digits; a partial or garbled value
 * is rejected rather than silently saved. This runs server-side wherever
 * hs_code is written, since a masked client input can be bypassed by any
 * direct API/RPC call.
 */
export function normalizeHsCodeForStorage(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const digits = hsCodeDigitsOnly(trimmed);
  if (digits.length !== 10) throw new Error("HS 编码必须是 10 位数字，格式 0000.00.00.00");
  return formatHsCode(digits);
}
