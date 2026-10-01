import {DeliveryRateDetails} from './DeliveryRateDetails';
import {useEffect,useState} from 'react';
export function PartnerQuoteResult({quote}:{quote:any}){
 const [key,setKey]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{setKey(quote.rates[0]?.key || '');const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[quote.id]);
 const rate=quote.rates.find((r:any)=>r.key===key),expired=now>=Date.parse(quote.expiresAt);
 const money=(n:number)=>'CA$'+n.toFixed(2);
 return <section className="partner-domestic-detail" aria-label="后台报价结果"><h3>{quote.routeName} · 报价结果</h3><p>实重 {quote.actual.toFixed(3)} kg · 计费重 {quote.chargeable.toFixed(3)} kg<br/>体积 {quote.volume.toFixed(6)} m³</p>{quote.fees.map((f:any)=><p key={f.name}>{f.name}：<b>{money(f.amount)}</b></p>)}<label>选择派送服务<select value={key} disabled={expired} onChange={e=>setKey(e.target.value)}><option value="">请选择承运商和服务</option>{quote.rates.map((r:any)=><option key={r.key} value={r.key}>{r.dispatchWarehouse?.label} · {r.carrier} · {r.service} · 总费用 {money(r.total)}</option>)}</select></label>{rate&&<><p>快递发货仓库：{rate.dispatchWarehouse?.label}</p><p>本地长途运输：{rate.transfer?.from} → {rate.transfer?.to} · {money(rate.transfer?.amount || 0)}</p>{rate.transfer?.baseAmount!=null&&<div><p>基础转运费：{money(rate.transfer.baseAmount)}</p>{rate.transfer.surcharges?.map((f:any)=><p key={f.name}>{f.name}（{f.count} 件）：{money(f.amount)}</p>)}</div>}<DeliveryRateDetails rate={rate}/><h3>预计总费用：{money(rate.total)}</h3></>}<p>{expired?'报价已过期，请重新查询':`有效至 ${new Date(quote.expiresAt).toLocaleString()}`}</p>{quote.localOversizePending && <p>此历史报价尚未计入本地长途运输超长费，预计总费用暂未计入该项；快递 API 返回的附加费已包含在派送报价中。</p>}<small>报价编号：{quote.id}。此操作不创建运单、不购买面单。</small></section>;
}

