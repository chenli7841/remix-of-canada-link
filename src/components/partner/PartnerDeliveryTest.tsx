import {useState} from 'react';
import type {ExpressAddress,ExpressRate} from '@/lib/express';
import type {PartnerDeliveryRequest} from '@/lib/partner-delivery';
export type DeliveryApi={connection:(probe:boolean)=>Promise<{configured:boolean;connected:boolean;environment:string;units?:{weight:string;length:string}}>;quote:(request:PartnerDeliveryRequest)=>Promise<{rates:ExpressRate[];recommendation:ExpressRate|null;expiresAt:string;environment:string}>};
export function PartnerDeliveryTest({origin,api}:{origin:ExpressAddress;api?:DeliveryApi}){
 const [to,setTo]=useState({name:'',mobile_phone:'',address:'',city:'',province:'',postalcode:''});
 const [pkg,setPkg]=useState({lengthCm:'',widthCm:'',heightCm:'',weightKg:''});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[result,setResult]=useState<Awaited<ReturnType<DeliveryApi['quote']>>|null>(null);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e instanceof Error?e.message:'查询失败，请重试')}finally{setBusy(false)}};
 return <section><h2>快递报价测试 <small>仅查询连接和价格，不创建面单</small></h2><p className="prs-note">凭证只从服务端环境变量读取，本页面不接收密钥。测试报价使用所选仓库的发货地址和下方收件资料。</p>
 {!api&&<p role="status">独立预览不连接 API，请从系统后台的同名页面测试。</p>}
 <div className="prs-actions"><button disabled={!api||busy} onClick={()=>run(async()=>{const r=await api!.connection(true);setMessage(r.connected?`连接成功：${r.environment}，单位 ${r.units?.weight}/${r.units?.length}`:`未配置 ${r.environment} 凭证，请在服务端填写对应 App ID 和 App Secret`);})}>{busy?'处理中…':'检查凭证连接'}</button></div>
 <div className="prs-grid">{([['name','测试收件人'],['mobile_phone','测试联系电话'],['address','测试详细地址'],['city','测试城市'],['province','测试省份代码（如 ON）'],['postalcode','测试邮编']] as const).map(([k,l])=><label key={k}>{l}<input value={to[k]} onChange={e=>{setTo({...to,[k]:e.target.value});setResult(null);}}/></label>)}</div>
 <div className="prs-grid prs-gap">{([['lengthCm','长 cm'],['widthCm','宽 cm'],['heightCm','高 cm'],['weightKg','实际重量 kg']] as const).map(([k,l])=><label key={k}>{l}<input type="number" min="0.001" step="any" value={pkg[k]} onChange={e=>{setPkg({...pkg,[k]:e.target.value});setResult(null);}}/></label>)}</div>
 <div className="prs-actions"><button disabled={!api||busy} onClick={()=>run(async()=>{setResult(null);const r=await api!.quote({draft:{from:origin,to:{...to,region_id:'CA',type:'resident'},packageType:'parcel',packages:[{lengthCm:Number(pkg.lengthCm),widthCm:Number(pkg.widthCm),heightCm:Number(pkg.heightCm),weightKg:Number(pkg.weightKg)}]},rule:{strategy:'cheapest',currency:'CAD'}});setResult(r);setMessage(r.rates.length?'报价查询完成，未创建面单':'平台未返回有效报价');})}>查询测试派送费</button></div>
 {message&&<p role="status" className="prs-note">{message}</p>}{result&&<><p>环境：{result.environment} · 报价有效至 {new Date(result.expiresAt).toLocaleTimeString()}</p><p>参考最低 CAD 报价：{result.recommendation?`${result.recommendation.carrier} / ${result.recommendation.service} · CAD ${result.recommendation.price.toFixed(2)}`:'无符合条件服务'}</p>{result.rates.map(r=><div className="prs-rule" key={r.key}><b>{r.carrier}</b><p>{r.service} · {r.currency} {r.price.toFixed(2)} · {r.eta||'时效未提供'}</p></div>)}<p className="prs-note">显示平台返回费用，税额不重复叠加；最低价仅作测试参考，不自动下单。</p></>}
 </section>;
}
