import type { ExpressRate } from '../../lib/express';

export function deliveryChargeLabel(name: string) {
  const peak = /peak|demand|旺季/i.test(name);
  if (peak && /large.?package/i.test(name)) return '旺季大型包裹附加费';
  if (peak && /additional.?handling/i.test(name)) return '旺季额外操作附加费';
  if (peak) return '旺季／高峰需求附加费';
  if (/large.?package/i.test(name)) return '大型包裹附加费';
  if (/over.?length|extra.?length|超长/i.test(name)) return '超长附加费';
  if (/over.?size|超大/i.test(name)) return '超尺寸附加费';
  if (/over.?weight|超重/i.test(name)) return '超重附加费';
  if (/remote|extended.?area|delivery.?area|偏远/i.test(name)) return '偏远／延伸地区附加费';
  if (/fuel|燃油/i.test(name)) return '燃油附加费';
  if (/residential|住宅/i.test(name)) return '住宅派送附加费';
  if (/additional.?handling|额外处理/i.test(name)) return '额外操作附加费';
  if (/^GST$/i.test(name)) return '商品及服务税（GST）';
  if (/^HST$/i.test(name)) return '统一销售税（HST）';
  if (/^PST$/i.test(name)) return '省销售税（PST）';
  if (/^QST$/i.test(name)) return '魁北克销售税（QST）';
  return name || '其他费用';
}

// Reference: UPS Canada dimensions/fees guidance, checked 2026-09-29.
export function deliveryChargeHint(carrier: string, name: string) {
  if (!/\bUPS\b/i.test(carrier)) return '';
  if (/peak|demand|旺季/i.test(name)) return '旺季期间额外收取';
  if (/large.?package/i.test(name)) return '标准示例：长加围长 > 330 cm';
  if (/over.?length|extra.?length|additional.?handling/i.test(name)) return '标准示例：最长边 > 122 cm';
  return '';
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
        {charges.map((fee,index)=><tr key={`charge-${index}`}><td style={{padding:'6px 0'}} title={[fee.name,fee.code].filter(Boolean).join(' · ')}>{deliveryChargeLabel(fee.name)}{deliveryChargeHint(rate.carrier,fee.name)&&<small style={{display:'block',fontSize:11,color:'#64748b',lineHeight:1.5}}>{deliveryChargeHint(rate.carrier,fee.name)}</small>}</td><td style={{textAlign:'right',whiteSpace:'nowrap'}}>{money(fee.price)}</td></tr>)}
        {taxes.length ? taxes.map((fee,index)=><tr key={`tax-${index}`}><td>{deliveryChargeLabel(fee.name||'派送税费')}</td><td style={{textAlign:'right',whiteSpace:'nowrap'}}>{money(fee.price)}</td></tr>) : <tr><td>派送税费</td><td style={{textAlign:'right'}}>{money(rate.tax)}</td></tr>}
        <tr><th style={{textAlign:'left',paddingTop:10}}>派送费合计</th><th style={{textAlign:'right',paddingTop:10}}>{money(rate.price)}</th></tr>
      </tbody>
    </table>
    {!charges.length&&<p>接口未提供附加费明细，不能据此判断没有超长或偏远费用。</p>}
    {rate.message&&<p>承运商说明：{rate.message}</p>}
    <small>明细按接口返回展示，合计采用承运商报价，不重复加收明细费用。</small>
  </section>;
}
