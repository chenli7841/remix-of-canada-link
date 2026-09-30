import type { ExpressRate } from '../../lib/express';

export function deliveryChargeLabel(name: string) {
  if (/over.?length|extra.?length|超长/i.test(name)) return '超长附加费';
  if (/over.?size|large.?package|超大/i.test(name)) return '超尺寸附加费';
  if (/over.?weight|超重/i.test(name)) return '超重附加费';
  if (/remote|extended.?area|delivery.?area|偏远/i.test(name)) return '偏远／延伸地区附加费';
  if (/fuel|燃油/i.test(name)) return '燃油附加费';
  if (/residential|住宅/i.test(name)) return '住宅派送附加费';
  if (/additional.?handling|额外处理/i.test(name)) return '额外操作附加费';
  return name || '其他费用';
}

export function DeliveryRateDetails({rate}: {rate: ExpressRate}) {
  const money = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
    ? `${rate.currency} ${value.toFixed(2)}` : '未提供';
  const charges = rate.chargeDetails ?? [], taxes = rate.taxDetails ?? [];
  return <section aria-label="派送费用明细" style={{marginTop:16,padding:16,border:'1px solid #cbd5e1',borderRadius:12}}>
    <h4>派送费用明细 · {rate.carrier} / {rate.service}</h4>
    <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}>
      <thead><tr><th style={{textAlign:'left'}}>费用项目</th><th style={{textAlign:'right'}}>金额</th></tr></thead>
      <tbody>
        <tr><td>基础运费</td><td style={{textAlign:'right'}}>{money(rate.freight)}</td></tr>
        {charges.map((fee,index)=><tr key={`charge-${index}`}><td style={{padding:'6px 0'}}>{deliveryChargeLabel(fee.name)}{deliveryChargeLabel(fee.name)!==fee.name&&fee.name&&<small style={{display:'block'}}>{fee.name}</small>}{fee.code&&<small style={{display:'block'}}>代码：{fee.code}</small>}</td><td style={{textAlign:'right'}}>{money(fee.price)}</td></tr>)}
        {taxes.length ? taxes.map((fee,index)=><tr key={`tax-${index}`}><td>{fee.name||'派送税费'}</td><td style={{textAlign:'right'}}>{money(fee.price)}</td></tr>) : <tr><td>派送税费</td><td style={{textAlign:'right'}}>{money(rate.tax)}</td></tr>}
        <tr><th style={{textAlign:'left',paddingTop:10}}>派送费合计</th><th style={{textAlign:'right',paddingTop:10}}>{money(rate.price)}</th></tr>
      </tbody>
    </table>
    {!charges.length&&<p>接口未提供附加费明细，不能据此判断没有超长或偏远费用。</p>}
    {rate.message&&<p>承运商说明：{rate.message}</p>}
    <small>明细按接口返回展示，合计采用承运商报价，不重复加收明细费用。</small>
  </section>;
}
