import {PartnerCityPicker} from './PartnerCityPicker';
import locations from './canada-locations.json';
import { useState, useEffect } from 'react';
export type AmazonWarehouse = {code:string;company:string;street:string;city:string;province:string;postal:string;phone?:string};
export function PartnerRecipient({warehouses=[],onAddress}:{warehouses?:AmazonWarehouse[];onAddress?:(value:any)=>void}) {
 const [type,setType]=useState('private'),[query,setQuery]=useState(''),[candidate,setCandidate]=useState<AmazonWarehouse|null>(null),[confirmed,setConfirmed]=useState('');
 const [address,setAddress]=useState({company:'',phone:'',street:'',city:'',province:'',postal:'',code:''});
 const change=(key:keyof typeof address,value:string)=>{setAddress(a=>({...a,[key]:value,...(key==='province'?{city:''}:{})}));setConfirmed('');};
 useEffect(()=>{onAddress?.({name:address.company,company:address.company,mobile_phone:address.phone,address:address.street,city:address.city,province:address.province,postalcode:address.postal,region_id:'CA',type:type==='private'?'resident':'commercial'});},[address,type,onAddress]);
 const term=query.trim().toLowerCase();
 const matches=term?warehouses.filter(w=>[w.code,w.company,w.street,w.city,w.province,w.postal].some(v=>v.toLowerCase().includes(term))).slice(0,10):[];
 return <section className="partner-card"><h2><em>03</em>收件信息<span>DESTINATION</span></h2>
 <div className="partner-segments address">{[['private','私人地址'],['amazon','亚马逊地址']].map(([v,l])=><button key={v} type="button" className={type===v?'selected':''} onClick={()=>{setType(v);setCandidate(null);setConfirmed('');setQuery('');setAddress({company:'',phone:'',street:'',city:'',province:'',postal:'',code:''});}}>{l}</button>)}</div>
 {type==='amazon'&&<div className="partner-hs"><label>查找亚马逊仓库<input autoComplete="off" placeholder="输入仓库代码或地址，例如 YYZ1" value={query} onChange={e=>{setQuery(e.target.value);setCandidate(null);}}/></label>
 {!warehouses.length&&<p className="partner-hint">仓库地址库待接入，暂可手动填写下方地址。</p>}
 {term&&warehouses.length>0&&<div className="partner-hs-results">{matches.length?<div className="partner-hs-options">{matches.map(w=><button type="button" key={w.code} onClick={()=>setCandidate(w)}><b>{w.code} · {w.company}</b><span>{w.street}</span><small>{w.city}, {w.province} {w.postal}</small></button>)}</div>:<p>未找到匹配仓库，请调整关键词或手动填写。</p>}</div>}
 {confirmed&&<p role="status" className="partner-rule">已确认并填入 {confirmed} 仓库地址</p>}</div>}
 <p className="partner-hint">询价只需收件地址；收件人姓名和联系电话在创建运单时填写。</p>
 {type==='amazon'&&<div className="partner-grid two partner-mt"><label>亚马逊仓库代码<input required value={address.code} onChange={e=>change('code',e.target.value)}/></label><label>Shipment ID<input placeholder="选填，创建运单时补充"/></label></div>}
 <label className="partner-mt">详细地址 <i>*</i><input required value={address.street} onChange={e=>change('street',e.target.value)}/></label>
 <div className="partner-grid three partner-mt">
 <label>省份 / 地区 <i>*</i>{type==='private'?<select required value={address.province} onChange={e=>change('province',e.target.value)}><option value="">请选择省份</option>{locations.map(p=><option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}</select>:<input required value={address.province} onChange={e=>change('province',e.target.value)}/>}</label>
 <label>城市 <i>*</i>{type==='private'?<PartnerCityPicker key={address.province} disabled={!address.province} cities={locations.find(p=>p.code===address.province)?.cities??[]} value={address.city} onChange={city=>change('city',city)}/>:<input required value={address.city} onChange={e=>change('city',e.target.value)}/>}</label>
 <label>邮编 <i>*</i><input required value={address.postal} onChange={e=>change('postal',e.target.value)}/></label></div>
 {type==='private'&&<p className="partner-hint">地区数据：<a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noreferrer">Countries States Cities Database</a> · ODbL 1.0</p>}
 <label className="partner-mt">备注<textarea rows={2} placeholder="派送要求、货物说明等（选填）"/></label>
 {candidate&&<div className="partner-modal" role="dialog" aria-modal="true" aria-label="确认亚马逊仓库地址"><div><h2>确认亚马逊仓库地址</h2><p><b>{candidate.code} · {candidate.company}</b></p><p>{candidate.street}</p><p>{candidate.city}, {candidate.province} {candidate.postal}</p><p>请与您的亚马逊入仓计划核对后确认。</p><button type="button" className="partner-submit" onClick={()=>{setAddress({...candidate,phone:candidate.phone||''});setConfirmed(candidate.code);setCandidate(null);setQuery('');}}>确认并填入地址</button><button type="button" className="partner-add" onClick={()=>setCandidate(null)}>返回选择</button></div></div>}
 </section>;
}
