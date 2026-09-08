/**
 * 本地条形码 / 二维码识别（内存中完成，不落盘、不外发图片）。
 * 使用 zbar-wasm + 纯 JS JPEG 解码；任何环境问题都降级为“无条码结果”，交给 OCR。
 */

export type BarcodeHit = { value: string; format: string };

export async function decodeBarcodes(bytes: Uint8Array, contentType: string): Promise<BarcodeHit[]> {
  try {
    if (!/jpe?g/i.test(contentType) && bytes[0] !== 0xff) return [];
    const jpeg = await import("jpeg-js");
    const decoded = jpeg.default.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 128 });
    const zbar = await import("@undecaf/zbar-wasm");

    const { width, height, data } = decoded;
    // RGBA -> 灰度
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    const symbols = await zbar.scanGrayBuffer(gray.buffer, width, height);
    return symbols
      .map((s: any) => ({ value: String(s.decode() ?? "").trim(), format: String(s.typeName ?? "barcode") }))
      .filter((s: BarcodeHit) => s.value.length >= 6);
  } catch (e) {
    console.error(`[wechat-kf] barcode_unavailable ${(e as Error)?.message ?? "unknown"}`);
    return [];
  }
}
