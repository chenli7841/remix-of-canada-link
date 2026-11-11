import { describe, expect, it } from "bun:test";
import { normalizeScanCode, sameScanCode, scanKey } from "./scan-normalize";

describe("normalizeScanCode", () => {
  it("removes spaces, tabs and invisible characters", () => {
    expect(normalizeScanCode("  FW 123\t456\u200B ")).toBe("FW123456");
  });
  it("uppercases letters", () => {
    expect(normalizeScanCode("bab0674410280001")).toBe("BAB0674410280001");
  });
  it("converts full-width letters and digits to normal ones", () => {
    expect(normalizeScanCode("ｓｆ５１０７８４７６１２４１６")).toBe("SF5107847612416");
  });
  it("unifies dash variants", () => {
    expect(normalizeScanCode("34109－2")).toBe("34109-2");
    expect(normalizeScanCode("34109—2")).toBe("34109-2");
  });
  it("drops stray symbols at the ends", () => {
    expect(normalizeScanCode("*JT3158568407915*")).toBe("JT3158568407915");
  });
});

describe("scanKey / sameScanCode", () => {
  it("compares by letters and digits only", () => {
    expect(scanKey("sf-510 784")).toBe("SF510784");
    expect(sameScanCode("ｂｏｘ 12-3", "BOX123")).toBe(true);
    expect(sameScanCode("BOX123", "BOX124")).toBe(false);
    expect(sameScanCode("", "")).toBe(false);
  });
});
