// Client-side label rendering with CODE128 barcodes (jsbarcode).
// Two sizes are supported: 150mm × 100mm (existing default) and 100mm × 80mm
// (compact thermal label, matches the 7333_shipping_label_100x80mm sample).
// The preview window lets the operator switch size for a single print and
// pin an account default (persisted to localStorage via label-size.ts).
import JsBarcode from "jsbarcode";
import { getDefaultLabelSize, type LabelSize } from "./label-size";

type WaybillEntry = {
  waybill_no: string;
  weight_kg?: number | null;
  items_name?: string | null;
  mark_no?: string | null;
};

export type LabelData = {
  entityType: "order" | "forwarding" | "carton" | "pallet" | "batch";
  entityNo: string;
  parent?: any;
  waybills?: WaybillEntry[];
  address?: any;
  user?: any;
  total?: number;
  meta?: Record<string, any>;
};

type SizeMeta = {
  barcodeH: number;
  barcodeFs: number;
  innerPx: number;
  marginH: number;
  textMargin: number;
  minBar: number;
};

const SIZE_META: Record<LabelSize, SizeMeta> = {
  // 150mm label: ~140mm printable inner width ≈ 529px @96dpi
  "150x100": { barcodeH: 46, barcodeFs: 20, innerPx: 529, marginH: 10, textMargin: 8, minBar: 1.2 },
  // 100mm label: ~94mm printable inner width ≈ 355px @96dpi
  "100x80": { barcodeH: 32, barcodeFs: 13, innerPx: 355, marginH: 6, textMargin: 4, minBar: 1.0 },
};

function barcodeSVG(text: string, m: SizeMeta, displayValue = true) {
  if (!text) return "";
  try {
    const svgNS = "http://www.w3.org/2000/svg";
    const doc = document.implementation.createDocument(svgNS, "svg", null);
    const svg = doc.documentElement;
    const targetContentPx = Math.max(120, m.innerPx - m.marginH * 2);
    const chars = text.length || 1;
    const modules = chars * 11 + 35; // CODE128 start + checksum + stop
    const width = Math.max(m.minBar, Math.min(4.0, targetContentPx / modules));
    JsBarcode(svg as any, text, {
      format: "CODE128",
      width,
      height: m.barcodeH,
      displayValue,
      fontSize: m.barcodeFs,
      textMargin: m.textMargin,
      fontOptions: "bold",
      lineColor: "#000000",
      margin: 0,
      marginLeft: m.marginH,
      marginRight: m.marginH,
      background: "#ffffff",
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace;font-size:11px">${text}</div>`;
  }
}

function renderOrderOrForwarding(d: LabelData, m: SizeMeta): string {
  const addr = d.address ?? {};
  const u = d.user ?? {};
  const recipient = addr.recipient ?? addr.name ?? u.full_name ?? "—";
  const phone = addr.phone ?? u.phone ?? "—";
  const addressLine =
    [
      addr.line1 ?? addr.address1,
      addr.line2,
      addr.city,
      addr.province ?? addr.state,
      addr.postal_code ?? addr.zip,
      addr.country,
    ]
      .filter(Boolean)
      .join(", ") || "—";
  // Destination on order/forwarding labels comes from the RECIPIENT ADDRESS,
  // not from the shipping route (the route may be re-mapped later).
  const destCode = addr.destination_code ?? addr.destination ?? (d.meta as any)?.address_destination_code ?? "—";
  const list = d.waybills?.length ? d.waybills : [{ waybill_no: "—" } as WaybillEntry];
  const xx = String(d.total || list.length).padStart(2, "0");
  const entityLabel = d.entityType === "order" ? "订单" : "集运单";

  return list
    .map((w, i) => {
      const aa = String(i + 1).padStart(2, "0");
      const markNo = w.mark_no ?? (d.parent as any)?.mark_no ?? null;
      return `
<div class="label">
  ${markNo ? `<div class="mark">唛头号 · ${markNo}</div>` : ""}
  <div class="stack">
    <div class="barcodes">
      <div class="block">
        <div class="muted">${entityLabel}</div>
        <div class="bc-lg">${barcodeSVG(d.entityNo || "—", m)}</div>
      </div>
      <div class="block">
        <div class="muted">运单号 · 箱号 ${aa}/${xx}</div>
        <div class="bc-lg">${barcodeSVG(w.waybill_no || "—", m)}</div>
      </div>
    </div>
    <div class="info">
      <div class="colL">
        <div class="row"><span class="muted">客户号</span><b class="mono">${u.customer_code ?? "—"}</b></div>
        <div class="row"><span class="muted">重量</span><b>${w.weight_kg ?? "—"} kg</b></div>
        <div class="row"><span class="muted">物品</span><b>${w.items_name ?? d.parent?.items_desc ?? "—"}</b></div>
      </div>
      <div class="colR">
        <div class="row"><span class="muted">目的地</span><b>${destCode}</b></div>
        <div class="row"><span class="muted">收件人</span><b>${recipient}</b></div>
        <div class="row"><span class="muted">电话</span><b>${phone}</b></div>
        <div class="row addr"><span class="muted">地址</span><b class="addr-body">${addressLine}</b></div>

      </div>
    </div>
  </div>
</div>`;
    })
    .join("");
}

function renderContainer(d: LabelData, m: SizeMeta): string {
  const meta = d.meta ?? {};
  const titleMap = { carton: "箱号", pallet: "托盘号", batch: "批次号" } as const;
  const title = titleMap[d.entityType as "carton" | "pallet" | "batch"];
  const markNoEarly = meta.mark_no ?? null;

  // Carton, pallet and batch labels all follow the order/forwarding standard layout
  // (top barcode, bold black two-column info below) instead of the generic field list.
  if (d.entityType === "carton" || d.entityType === "pallet") {
    const counts = meta.counts || {};
    const pieces =
      d.entityType === "pallet"
        ? `${counts.cartons ?? 0} 箱 · ${counts.waybills ?? 0} 单`
        : `${counts.waybills ?? 0} 单`;
    // Only bound once this container has locked onto a single customer's address
    // (see assignToCarton/assignToPallet) — otherwise it's a mixed container and
    // there's no one recipient to print, so every identity field reads "--".
    const addr = meta.address ?? null;
    const addressLine = addr
      ? [
          addr.line1 ?? addr.address1,
          addr.line2,
          addr.city,
          addr.province ?? addr.state,
          addr.postal_code ?? addr.zip,
          addr.country,
        ]
          .filter(Boolean)
          .join(", ") || "--"
      : "--";
    const left: [string, any][] = [
      ["客户号", meta.customer_code ?? "--"],
      ["件数", pieces],
      ["目的地", meta.destination_code ?? "—"],
      ["运输方式", meta.shipping_method ?? "—"],
    ];
    return `
<div class="label">
  ${markNoEarly ? `<div class="mark">唛头号 · ${markNoEarly}</div>` : ""}
  <div class="stack">
    <div class="barcodes">
      <div class="block">
        <div class="muted">${title}</div>
        <div class="entity">${d.entityNo}</div>
        <div class="bc-lg">${barcodeSVG(d.entityNo, m)}</div>
      </div>
    </div>
    <div class="info">
      <div class="colL">
        ${left.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><b>${v}</b></div>`).join("")}
      </div>
      <div class="colR">
        <div class="row"><span class="muted">收件人</span><b>${addr?.recipient ?? "--"}</b></div>
        <div class="row"><span class="muted">电话</span><b>${addr?.phone ?? "--"}</b></div>
        <div class="row addr"><span class="muted">地址</span><b class="addr-body">${addressLine}</b></div>
      </div>
    </div>
  </div>
</div>`;
  }

  if (d.entityType === "batch") {
    const counts = meta.counts || {};
    const left: [string, any][] = [
      ["重量（实重）", meta.weight_kg != null ? `${meta.weight_kg} kg` : "—"],
      ["体积", meta.volume_m3 != null ? `${meta.volume_m3} m³` : "—"],
      ["件数", `${counts.waybills ?? 0} 单 · ${counts.cartons ?? 0} 箱 · ${counts.pallets ?? 0} 托`],
    ];
    const right: [string, any][] = [
      ["运输方式", meta.shipping_method ?? "—"],
      ["目的地", meta.destination_code ?? "—"],
      ["船号/航空号", meta.vessel_no ?? "—"],
    ];
    return `
<div class="label">
  ${markNoEarly ? `<div class="mark">唛头号 · ${markNoEarly}</div>` : ""}
  <div class="stack">
    <div class="barcodes">
      <div class="block">
        <div class="muted">${title}</div>
        <div class="entity">${d.entityNo}</div>
        <div class="bc-lg">${barcodeSVG(d.entityNo, m)}</div>
      </div>
    </div>
    <div class="info">
      <div class="colL">
        ${left.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><b>${v}</b></div>`).join("")}
      </div>
      <div class="colR">
        ${right.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><b>${v}</b></div>`).join("")}
      </div>
    </div>
  </div>
</div>`;
  }

  // entityType is always one of carton/pallet/batch here (order/forwarding go through
  // renderOrderOrForwarding above) and all three now return early, so this is unreachable —
  // kept only as a defensive fallback in case a new container kind is added later.
  return `
<div class="label">
  ${markNoEarly ? `<div class="mark">唛头号 · ${markNoEarly}</div>` : ""}
  <div class="grid">
    <div class="left">
      <div class="block">
        <div class="muted">${title}</div>
        <div class="entity">${d.entityNo}</div>
      </div>
      <div class="bc-lg">${barcodeSVG(d.entityNo, m)}</div>
    </div>
    <div class="right"></div>
  </div>
</div>`;
}

function buildBody(list: LabelData[], size: LabelSize): string {
  const m = SIZE_META[size];
  return list
    .map((item) =>
      item.entityType === "order" || item.entityType === "forwarding"
        ? renderOrderOrForwarding(item, m)
        : renderContainer(item, m),
    )
    .join("");
}

export function renderLabel(d: LabelData | LabelData[], opts?: { size?: LabelSize }) {
  const list = Array.isArray(d) ? d : [d];
  if (!list.length) return;

  const initial: LabelSize = opts?.size ?? getDefaultLabelSize();
  const title = list.length === 1 ? `面单 ${list[0].entityNo}` : `面单 (${list.length})`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<style id="pagesize">@page { size: 150mm 100mm; margin: 0; }</style>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #f0f0f0; color: #000; }

  .sheet { display: none; }
  body[data-size="150x100"] .sheet[data-sheet="150x100"] { display: block; }
  body[data-size="100x80"] .sheet[data-sheet="100x80"] { display: block; }

  .label { background: #fff; page-break-after: always; break-after: page; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .sheet .label:last-child { page-break-after: auto; break-after: auto; }
  .mark { text-align: center; font-weight: 900; border: 1.5px solid #000; background: #000; color: #fff; flex-shrink: 0; }
  .grid { flex: 1; display: grid; grid-template-columns: 72mm 1fr; gap: 4mm; min-height: 0; }
  .left { display: flex; flex-direction: column; gap: 1.5mm; border-right: 1.5px dashed #999; padding-right: 3mm; min-width: 0; }
  .right { display: flex; flex-direction: column; gap: 1mm; min-width: 0; }
  .stack { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .stack .barcodes { display: flex; flex-direction: column; border-bottom: 1.5px dashed #999; flex-shrink: 0; }
  .stack .info { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
  .stack .info .colL { display: flex; flex-direction: column; min-width: 0; border-right: 1.5px dashed #999; }
  .stack .info .colR { display: flex; flex-direction: column; min-width: 0; }
  .block .muted { margin-bottom: 0.5mm; }
  .entity { font-weight: 800; font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.6px; word-break: break-all; line-height: 1.2; }
  .bc { max-width: 100%; overflow: hidden; }
  .bc svg, .bc-lg svg { max-width: 100%; height: auto; display: block; }
  .bc-lg { display: flex; justify-content: center; margin-top: 0.5mm; width: 100%; }
  .row { display: flex; font-weight: 800; border-bottom: 1px dotted #ccc; align-items: baseline; min-width: 0; }
  .row b { flex: 1; font-weight: 900; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .addr { align-items: flex-start; }
  /* .row b.addr-body (not .addr-body alone) — needs to out-specificity the
     nowrap/ellipsis .row b already sets, or those win and the address never wraps. */
  .row b.addr-body { white-space: normal; text-overflow: clip; line-height: 1.3; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .muted { color: #000; font-weight: 800; text-transform: uppercase; flex-shrink: 0; }
  .mono { font-family: ui-monospace, Menlo, monospace; }

  /* ---- 150 × 100 mm ---- */
  body[data-size="150x100"] .label { width: 150mm; height: 100mm; padding: 4mm 5mm; gap: 2mm; margin: 4mm auto; }
  body[data-size="150x100"] .mark { font-size: 19px; letter-spacing: 2px; padding: 0.8mm 0; border-radius: 1.5mm; }
  body[data-size="150x100"] .stack { gap: 2mm; }
  body[data-size="150x100"] .stack .barcodes { gap: 1.5mm; padding-bottom: 2mm; }
  body[data-size="150x100"] .stack .info { gap: 4mm; }
  body[data-size="150x100"] .stack .info .colL { gap: 1mm; padding-right: 3mm; }
  body[data-size="150x100"] .stack .info .colR { gap: 1mm; }
  body[data-size="150x100"] .entity { font-size: 18px; }
  body[data-size="150x100"] .row { font-size: 13.7px; gap: 3mm; padding: 0.5mm 0; }
  body[data-size="150x100"] .muted { font-size: 11.7px; letter-spacing: 0.65px; }
  body[data-size="150x100"] .row b.addr-body { -webkit-line-clamp: 3; }

  /* ---- 100 × 80 mm ---- */
  body[data-size="100x80"] .label { width: 100mm; height: 80mm; padding: 2.6mm 3mm; gap: 1.3mm; margin: 4mm auto; }
  body[data-size="100x80"] .mark { font-size: 13px; letter-spacing: 1px; padding: 0.5mm 0; border-radius: 1mm; }
  body[data-size="100x80"] .stack { gap: 1.3mm; }
  body[data-size="100x80"] .stack .barcodes { gap: 1mm; padding-bottom: 1.3mm; }
  body[data-size="100x80"] .stack .info { gap: 2.5mm; }
  body[data-size="100x80"] .stack .info .colL { gap: 0.4mm; padding-right: 2mm; }
  body[data-size="100x80"] .stack .info .colR { gap: 0.4mm; }
  body[data-size="100x80"] .entity { font-size: 12.5px; }
  body[data-size="100x80"] .row { font-size: 9.7px; gap: 2mm; padding: 0.25mm 0; }
  body[data-size="100x80"] .muted { font-size: 8.4px; letter-spacing: 0.4px; }
  body[data-size="100x80"] .row b.addr-body { -webkit-line-clamp: 2; line-height: 1.25; }
  body[data-size="100x80"] .bc-lg svg { max-height: 13mm; }

  .toolbar { position: fixed; top: 8px; right: 8px; display: flex; gap: 6px; z-index: 10; align-items: stretch; }
  .toolbar button { padding: 6px 12px; font-size: 12px; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 4px; }
  .toolbar .seg { display: inline-flex; border: 1px solid #ccc; border-radius: 4px; overflow: hidden; }
  .toolbar .seg button { border: 0; border-radius: 0; }
  .toolbar .seg button + button { border-left: 1px solid #ccc; }
  .toolbar [data-size-btn][aria-pressed="true"] { background: #111; color: #fff; }
  .count { position: fixed; top: 12px; left: 12px; font-size: 12px; color: #666; z-index: 10; }
  @media print {
    .toolbar, .count { display: none; }
    body { background: #fff; }
    .label { margin: 0 !important; box-shadow: none !important; }
    .sheet { display: none !important; }
    body[data-size="150x100"] .sheet[data-sheet="150x100"] { display: block !important; }
    body[data-size="100x80"] .sheet[data-sheet="100x80"] { display: block !important; }
  }
</style></head><body>
<div class="count">共 ${list.length} 张面单</div>
<div class="toolbar">
  <div class="seg">
    <button type="button" data-size-btn="150x100" onclick="window.__applyLabelSize('150x100')">150×100</button>
    <button type="button" data-size-btn="100x80" onclick="window.__applyLabelSize('100x80')">100×80</button>
  </div>
  <button type="button" id="mkdefault" onclick="window.__setLabelDefault()">设为默认尺寸</button>
  <button type="button" onclick="window.print()">打印全部</button>
  <button type="button" onclick="window.close()">关闭</button>
</div>
<div class="sheet" data-sheet="150x100">${buildBody(list, "150x100")}</div>
<div class="sheet" data-sheet="100x80">${buildBody(list, "100x80")}</div>
<script>
(function(){
  var PAGES = { "150x100": "@page { size: 150mm 100mm; margin: 0; }", "100x80": "@page { size: 100mm 80mm; margin: 0; }" };
  var current = ${JSON.stringify(initial)};
  window.__applyLabelSize = function(s){
    if (s !== "150x100" && s !== "100x80") s = "150x100";
    current = s;
    document.body.setAttribute("data-size", s);
    var st = document.getElementById("pagesize");
    if (st) st.textContent = PAGES[s];
    var btns = document.querySelectorAll("[data-size-btn]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-size-btn") === s ? "true" : "false");
    }
  };
  window.__setLabelDefault = function(){
    try {
      (window.opener || window).localStorage.setItem("eplus.admin.labelSize", current);
      var b = document.getElementById("mkdefault");
      if (b) { var t = b.textContent; b.textContent = "已设为默认 ✓"; setTimeout(function(){ b.textContent = t; }, 1500); }
    } catch (e) { /* storage blocked */ }
  };
  window.__applyLabelSize(current);
})();
</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=900");
  if (!w) {
    alert("请允许弹窗以打印面单");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
