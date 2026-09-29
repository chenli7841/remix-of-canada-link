import { partnerDuty, type PartnerHsRates } from './partner-duty';
import { useEffect, useState } from 'react';
export type HsOption = PartnerHsRates & {id:string;hs_code:string;name_zh:string|null;name_en:string|null};
export type HsSearch = (query:string)=>Promise<HsOption[]>;
export function PartnerHsPicker({name,value,onChange,search}:{name:string;value:HsOption|null;onChange:(value:HsOption|null)=>void;search?:HsSearch}){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false),[rows,setRows]=useState<HsOption[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{setQuery(name);setOpen(false);},[name]);
 useEffect(()=>{if(!open)return;let active=true;setRows([]);setError('');const term=query.trim();if(!term){setLoading(false);return;}setLoading(true);const timer=setTimeout(()=>{if(!search){setLoading(false);setError('编码库未连接');return;}search(term).then(r=>{if(active)setRows(r);}).catch(()=>{if(active)setError('编码库读取失败，请重试');}).finally(()=>{if(active)setLoading(false);});},300);return()=>{active=false;clearTimeout(timer);};},[query,open,search,attempt]);
 return <div className="partner-hs"><div className="partner-hs-label">HS Code <span>从编码库选择</span></div>{value?<div className="partner-hs-selected"><div><b>{value.hs_code}</b><span>{value.name_zh||'暂无中文名'}</span><small>{value.name_en}</small><small>{partnerDuty(100,value)?`合计税率 ${(partnerDuty(100,value)!.rate*100).toFixed(2)}%（MFN + GST + 反倾销）`:'税率缺失，请核对编码库'}</small></div><button type="button" onClick={()=>{onChange(null);setQuery(name);setOpen(true);}}>重新选择</button></div>:<input aria-label="搜索 HS 编码或中英文名称" autoComplete="off" placeholder="输入编码 / 中文名 / 英文名模糊搜索" value={query} onFocus={()=>{setOpen(true);if(!query)setQuery(name);}} onChange={e=>{setQuery(e.target.value);setOpen(true);}}/>}
 {open&&!value&&<div className="partner-hs-results"><div className="partner-hs-result-head"><span>搜索编码库</span><button type="button" onClick={()=>setOpen(false)}>收起</button></div>{loading?<p role="status">正在搜索…</p>:error?<p role="alert">{error} <button type="button" onClick={()=>setAttempt(n=>n+1)}>重试</button></p>:!query.trim()?<p>请输入品名或编码开始搜索</p>:!rows.length?<p>没有匹配结果，请尝试更简短的关键词。</p>:<><div className="partner-hs-options">{rows.map(row=><button type="button" key={row.id} onClick={()=>{onChange(row);setOpen(false);}}><b>{row.hs_code}</b><span>{row.name_zh||'暂无中文名'}</span><small>{row.name_en}</small></button>)}</div>{rows.length===30&&<p>显示前 30 项，请细化关键词。</p>}</>}</div>}
 </div>;
}

