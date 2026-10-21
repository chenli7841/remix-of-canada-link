const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function driverTripPrintHtml(trip: any, maps: (string | null)[], tr: (text: string) => string, date: string) {
  const plans = trip.route?.plans || [];
  if (!plans.length || plans.some((_: unknown, i: number) => !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(maps[i] || ''))) {
    throw new Error(tr('地图未加载完整，请重试'));
  }
  let station = 0;
  const pages = plans.map((plan: any, i: number) => {
    const rows = plan.stops.flatMap((stop: any) => {
      const number = ++station;
      return stop.customers.map((customer: any) => {
        const items = (trip.items || []).filter((item: any) => customer.ids.includes(item.queue_id)).sort((a: any, b: any) => a.sequence - b.sequence);
        return `<tr><td>${number}</td><td>${escape(customer.customer_code)}<br>${escape(customer.name)}</td><td>${escape(stop.address)}<br>${escape(customer.phone)}</td><td>${items.map((item: any) => `<div><b>${escape(item.sequence)}</b> · ${escape(item.unit?.code)} · ${escape(tr(item.unit?.status === 'dispatched' ? '已派送' : item.unit?.status === 'cancelled' ? '已取消' : '待派送'))}</div>`).join('')}</td></tr>`;
      });
    }).join('');
    return `<section><h1>${escape(tr('司机派送'))} · ${i + 1}/${plans.length}</h1><p>${escape(trip.driver_name)} · ${escape(date)}</p><p>${escape(tr('出发：'))}${escape(plan.origin)}</p><table><thead><tr><th>${escape(tr('站点'))}</th><th>${escape(tr('客户号'))}</th><th>${escape(tr('地址 / 电话'))}</th><th>${escape(tr('上车编号 / 包裹 / 状态'))}</th></tr></thead><tbody>${rows}</tbody></table><img alt="${escape(tr('Google 派送路线地图'))}" src="${maps[i]}"></section>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(tr('打印地图和列表'))}</title><style>
  body{font:12px Arial,"Microsoft YaHei",sans-serif;color:#111;background:white;margin:20px}h1{font-size:20px}section{break-after:page}section:last-child{break-after:auto}img{display:block;width:100%;max-height:145mm;object-fit:contain}table{width:100%;border-collapse:collapse;margin-top:16px;table-layout:fixed}th,td{border:1px solid #999;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th:first-child{width:7%}th:nth-child(2){width:15%}td div{margin-bottom:5px}thead{display:table-header-group}tr{break-inside:avoid}button{padding:12px;margin-bottom:16px}@page{size:A4 portrait;margin:12mm}@media print{body{margin:0}button{display:none}}
  </style></head><body><button id="print">${escape(tr('打印 / 保存 PDF'))}</button>${pages}<script>document.getElementById('print').onclick=async()=>{await Promise.all(Array.from(document.images).map(img=>img.decode()));window.print();};</script></body></html>`;
}
