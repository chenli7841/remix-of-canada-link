import { describe, expect, test } from "bun:test";
import { cnyToCad, forwardingTotalCad } from "./currency";

describe("GPT App customer-facing CAD amounts", () => {
  test("converts internal CNY fields using the stored order rate", () => {
    expect(cnyToCad(100, 0.2)).toBe(20);
    expect(cnyToCad(12.34, 0.19)).toBe(2.34);
  });

  test("uses a safe CAD fallback rate when the stored rate is missing or invalid", () => {
    expect(cnyToCad(100, null)).toBe(19);
    expect(cnyToCad(100, 0)).toBe(19);
  });

  test("uses forwarding total_cad as the authoritative total", () => {
    expect(forwardingTotalCad(9999, { total_cad: 48.75, fx_rate: 0.19 })).toBe(48.75);
  });

  test("adds CAD snapshot components when total_cad is absent", () => {
    expect(forwardingTotalCad(9999, { freight_cad: 20, duty_cad: 3, insurance_cad: 2, surcharges_cad: 1.5 })).toBe(26.5);
  });

  test("converts the legacy fee only when no CAD snapshot amount exists", () => {
    expect(forwardingTotalCad(100, { fx_rate: 0.2 })).toBe(20);
  });
});
