declare module "qrcode/lib/core/qrcode.js" {
  import type { QRCode, QRCodeOptions } from "qrcode";
  const encoder: { create(text: string, options: QRCodeOptions): QRCode };
  export default encoder;
}

declare module "qrcode/lib/renderer/svg-tag.js" {
  import type { QRCode, QRCodeRenderersOptions } from "qrcode";
  export function render(data: QRCode, options: QRCodeRenderersOptions): string;
}
