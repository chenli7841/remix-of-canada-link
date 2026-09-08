import JsBarcode from "jsbarcode";

export function barcodeSVG(text: string, height = 40, displayValue = true) {
  if (!text) return "";
  try {
    const svgNS = "http://www.w3.org/2000/svg";
    const doc = document.implementation.createDocument(svgNS, "svg", null);
    const svg = doc.documentElement;
    // 150mm label - 2*5mm padding at 96dpi, leave 10px left/right barcode margin
    const labelInnerPx = 529;
    const marginH = 10;
    const targetContentPx = Math.max(120, labelInnerPx - marginH * 2);
    const chars = text.length || 1;
    const modules = chars * 11 + 35; // CODE128 start + checksum + stop
    const width = Math.max(1.2, Math.min(4.0, targetContentPx / modules));
    JsBarcode(svg as any, text, {
      format: "CODE128",
      width,
      height,
      displayValue,
      fontSize: 11,
      margin: 0,
      marginLeft: marginH,
      marginRight: marginH,
      background: "#ffffff",
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace;font-size:11px">${text}</div>`;
  }
}
