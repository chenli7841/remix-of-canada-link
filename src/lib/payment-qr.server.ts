// Import the pure QR encoder and SVG renderer directly. The package's server
// entry eagerly loads pngjs/zlib, which cannot initialize in our Worker runtime.
import QRCode from "qrcode/lib/core/qrcode.js";
import { render } from "qrcode/lib/renderer/svg-tag.js";

export function paymentQrDataUrl(text: string): string {
  const svg = render(QRCode.create(text, {}), { width: 320, margin: 4 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
