export interface DeliverySheetRow {
  key: string; address: string; phone?: string | null; customer_code?: string | null;
  batch_no?: string; batch_name?: string; count: number; chargeable_weight_kg?: number | null;
  total_cad?: number | null; fee_cny: number; extra_fee_paid?: boolean;
  payment_label?: string; settlement_note?: string;
}
export interface DeliveryStop { address: string; rows: DeliverySheetRow[] }
export function splitDeliveryStops(stops: DeliveryStop[]): DeliveryStop[][] {
  const result: DeliveryStop[][] = [];
  for (let i=0;i<stops.length;i+=21) result.push(stops.slice(i,i+21));
  return result;
}
export function deliveryStops(rows: DeliverySheetRow[]): DeliveryStop[] {
  const stops = new Map<string, DeliveryStop>();
  for (const row of rows) {
    if (!row.address?.trim()) throw new Error(`客户 ${row.customer_code || '未知'} 缺少地址，请先补全`);
    const key = row.address.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!stops.has(key)) stops.set(key, {address: row.address.trim(), rows: []});
    stops.get(key)!.rows.push(row);
  }
  return [...stops.values()];
}
export function orderedIndexes(value: unknown, count: number): number[] {
  if (!Array.isArray(value) || value.length !== count || new Set(value).size !== count ||
      value.some(n => !Number.isInteger(n) || n < 0 || n >= count)) throw new Error('Google 返回的站点顺序不完整，请重试');
  return value;
}
export const stopLabel = (index: number) => String.fromCharCode(65 + index);
export const googlePlace = (address: string) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
export function navigationLinks(addresses: string[], origin: string, roundTrip: boolean, returnAddress = origin) {
  const targets = [...addresses, ...(roundTrip && returnAddress.trim() ? [returnAddress.trim()] : [])];
  const links: {url: string; from: number; to: number}[] = [];
  let start = origin.trim(), offset = 0;
  while (offset < targets.length) {
    let count = Math.min(4, targets.length - offset), url = '';
    while (count > 0) {
      const part = targets.slice(offset, offset + count);
      const params = new URLSearchParams({api:'1', destination:part.at(-1)!, travelmode:'driving'});
      if (start) params.set('origin', start);
      if (part.length > 1) params.set('waypoints', part.slice(0,-1).join('|'));
      url = 'https://www.google.com/maps/dir/?' + params;
      if (url.length <= 2048) break;
      count--;
    }
    if (!count) throw new Error('地址过长，无法生成 Google 导航链接，请缩短地址');
    links.push({url, from:offset + 1, to:offset + count});
    start = targets[offset + count - 1]; offset += count;
  }
  return links;
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const amount = (value: number | null | undefined, prefix = '') => value == null || !Number.isFinite(Number(value)) ? '待确认' : prefix + Number(value).toFixed(2);
export function deliverySheetHtml(stops: DeliveryStop[], origin: string, roundTrip: boolean, map: string | null, optimized: boolean, options: {sheetNo?:number;totalSheets?:number;returnAddress?:string} = {}) {
  const links = navigationLinks(stops.map(s=>s.address), origin, roundTrip, options.returnAddress || origin);
  const rows = stops.flatMap((stop,i) => stop.rows.map(row => `<tr><td>${stopLabel(i)}</td><td>${escape(row.address)}</td><td>${escape(row.phone || '未填写')}</td><td>${escape(row.customer_code || '未填写')}<br><small>${escape(row.batch_no || row.batch_name)}</small></td><td>${escape(row.count)}</td><td>${amount(row.chargeable_weight_kg)}</td><td>${amount(row.total_cad,'CA$')}<br><small>${escape(row.payment_label)}</small></td><td>${amount(row.fee_cny,'CN¥')}<br><small>${row.extra_fee_paid?'已付款':'未扣款'}</small></td><td class="note">${escape(row.settlement_note || '—')}</td></tr>`)).join('');
  const safeMap = map && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(map) ? map : null;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>派送单</title><style>
  *{box-sizing:border-box}body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#152333;margin:0;background:#e8edf2;font-size:12px}.toolbar{padding:15px;text-align:center}button{padding:8px 20px}.page{background:white;width:277mm;min-height:190mm;margin:12px auto;padding:8mm}h1{font-size:22px;margin:0 0 8px}h2{font-size:16px}p{margin:8px 0}a{color:#125ec0}.map{display:block;width:180mm;height:105mm;object-fit:contain;margin:auto}.legend{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:10px;margin:10px 0}.legend div{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:11px}td,th{border:1px solid #cbd5e1;padding:7px 5px;text-align:left;overflow-wrap:anywhere;vertical-align:top}th{background:#edf4fa}.note{white-space:pre-wrap}small{font-size:9px;color:#475569}tr{break-inside:avoid}.muted{color:#526477;font-size:11px}.missing{padding:25px;border:1px dashed #bbb;margin:15px 0}.links{display:flex;gap:20px;flex-wrap:wrap}#print-error{color:#b91c1c}
  table{font-size:9px;line-height:1.2}td,th{padding:4px}small{font-size:8px}.map{height:94mm}.legend{font-size:9px}
  @page{size:A4 landscape;margin:10mm}@media print{body{background:white}.toolbar{display:none}.page{width:277mm;min-height:0;margin:0;padding:0;break-after:page}.page:last-child{break-after:auto}a{text-decoration:none;color:inherit}}
  </style></head><body><div class="toolbar"><button id="print">打印 / 保存 PDF</button><p>使用 A4 横向、100% 比例，关闭浏览器页眉页脚。Google 导航调整不会自动回写此单。</p><p id="print-error"></p></div>
  <section class="page"><h1>派送单 ${options.sheetNo || 1} / ${options.totalSheets || 1} · 地图与路线</h1><p>${escape(new Date().toLocaleString('zh-CN'))} · ${stops.length} 个地点 · ${stops.reduce((n,s)=>n+s.rows.length,0)} 个客户批次</p><p>出发：${escape(origin || '导航时使用当前位置')}　${roundTrip?'最终返回：'+escape(options.returnAddress || origin):'最后一站结束'}　· ${optimized?'本单内 Google 优化顺序':'人工确认顺序'}</p>
  ${safeMap?`<img class="map" src="${safeMap}" alt="Google 派送路线地图">`:'<div class="missing">尚未生成 Google 地图。请在派送单窗口中配置并生成地图；也可以使用下面的 Google 导航入口查看各站点。</div>'}
  <div class="legend">${stops.map((s,i)=>`<div><b>${stopLabel(i)}.</b> <a href="${escape(googlePlace(s.address))}" target="_blank" rel="noopener noreferrer">${escape(s.address)}</a></div>`).join('')}</div>
  <div class="links">${links.map((l,i)=>`<a href="${escape(l.url)}" target="_blank" rel="noopener noreferrer">Google 导航 ${i+1}（第 ${l.from}–${l.to} 站${roundTrip&&l.to>stops.length?'，含返程':''}）</a>`).join('')}</div><p class="muted">导航按本单顺序分段打开，每段最多 4 个目的地，以兼容手机浏览器。请核对 Google 定位后出发。</p></section>
  <section class="page"><h1>派送单 · 按路线顺序明细</h1><p class="muted">派送单位沿用列表计数：独立运单、带客户号的箱号和托盘。批次总费用与额外费用分列，保留原币种。</p><table><colgroup><col style="width:3%"><col style="width:23%"><col style="width:10%"><col style="width:13%"><col style="width:5%"><col style="width:8%"><col style="width:10%"><col style="width:9%"><col style="width:19%"></colgroup><thead><tr><th>站点</th><th>地址</th><th>电话</th><th>客户号 / 批次</th><th>单位数</th><th>计费重量 kg</th><th>总费用 CAD</th><th>额外费用 CNY</th><th>结算备注</th></tr></thead><tbody>${rows}</tbody></table><p>司机：________________　派送日期：________________</p></section>
  <script>document.getElementById('print').onclick=async function(){await Promise.all(Array.from(document.images).map(img=>img.decode().catch(()=>{})));const overflow=Array.from(document.querySelectorAll('.page')).some(p=>p.scrollHeight>190*96/25.4+2);if(overflow){document.getElementById('print-error').textContent='内容超过两页容量，请返回减少勾选的批次数后再生成；本单未删减任何地址或备注。';return;}window.print();};</script></body></html>`;
}
