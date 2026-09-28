export type PickingRow = {name:string; hs:string; count:number; inner:number|null; weight:number|null; net:number};
export type PickingGroup = {mark:string; type:string; miscellaneous:boolean; dimensions:number[]; volume:number; rows:PickingRow[]};
export type PickingList = {batchNo:string; groups:PickingGroup[]; count:number; net:number; volume:number};

// Reads saved measurements and manifests only. Never reassigns goods or changes fees.
export function buildPickingList(source:{batch:any; pallets:any[]; cartons:any[]; wbs:any[]; fitems:any[]}):PickingList {
  const pallets=new Map(source.pallets.map(p=>[p.id,p]));
  const cartons=new Map(source.cartons.map(c=>[c.id,c]));
  const grouped=new Map<string,{object:any; type:string; wbs:any[]}>();
  const unique=new Map(source.wbs.map(w=>[w.id,w]));
  for(const w of unique.values()) {
    const carton=cartons.get(w.carton_id);
    const pallet=pallets.get(carton?.pallet_id||w.pallet_id);
    if((w.carton_id&&!carton)||((carton?.pallet_id||w.pallet_id)&&!pallet)) throw new Error(`运单 ${w.waybill_no} 装载关联不完整，请核对箱号或托盘`);
    const object=pallet||carton||w, type=pallet?'托盘':'单箱';
    const key=(pallet?'p:':carton?'c:':'w:')+object.id;
    if(!grouped.has(key))grouped.set(key,{object,type,wbs:[]});
    grouped.get(key)!.wbs.push(w);
  }
  const groups:PickingGroup[]=[];
  for(const g of grouped.values()) {
    const container=!!(g.object.pallet_no||g.object.carton_no);
    const mark=g.object.pallet_no||g.object.carton_no||g.object.waybill_no;
    const dims=(container?['self_length_cm','self_width_cm','self_height_cm']:['length_cm','width_cm','height_cm']).map(k=>Number(g.object[k]));
    if(!dims.every(v=>Number.isFinite(v)&&v>0))throw new Error(`${mark} 缺少有效长宽高，请补录后下载`);
    const customerPallet=g.type==='托盘'&&!!(g.object.customer_user_id||String(g.object.customer_code||'').trim());
    const miscellaneous=g.type==='托盘'&&!customerPallet;
    const rows=new Map<string,PickingRow>();
    for(const w of g.wbs) {
      const weight=Number(w.weight_kg);
      if(!Number.isFinite(weight)||weight<=0)throw new Error(`运单 ${w.waybill_no} 缺少有效重量，请补录后下载`);
      const items=Array.isArray(w.items_summary)?w.items_summary:[];
      if(customerPallet&&(items.length!==1||!items[0].name))throw new Error(`运单 ${w.waybill_no} 的品名与重量无法唯一对应，请先核对物品分配`);
      const names=[...new Set<string>(items.map((i:any)=>String(i.name||'').trim()).filter(Boolean))];
      if(!miscellaneous&&!names.length)throw new Error(`运单 ${w.waybill_no} 缺少品名`);
      const name=miscellaneous?'杂货':customerPallet?names[0]:names.length>3?'杂货':names.join('，');
      const metadata=items.map((i:any)=>{const matches=source.fitems.filter(p=>p.forwarding_id===w.forwarding_id&&p.name===i.name);const parent=matches.length===1?matches[0]:null;return {hs:parent?.hs_code||i.hs_code||i.extras?.hscode||parent?.extras?.hscode||'',inner:i.extras?.inner_qty??parent?.inner_qty??parent?.extras?.inner_qty??1};});
      const hs=name==='杂货'?'':[...new Set(metadata.map((m:any)=>m.hs).filter(Boolean))].join('，');
      const inner=miscellaneous?null:items.length===1?Number(metadata[0].inner)||1:1;
      if(inner!==null&&(!Number.isSafeInteger(inner)||inner<1))throw new Error(`运单 ${w.waybill_no} 内件数无效`);
      const key=miscellaneous?'misc':JSON.stringify([name,hs,inner,weight]);
      if(!rows.has(key))rows.set(key,{name,hs,count:0,inner,weight:miscellaneous?null:weight,net:0});
      const row=rows.get(key)!;row.count++;row.net+=weight;
    }
    groups.push({mark,type:g.type,miscellaneous,dimensions:dims,volume:dims.reduce((a,b)=>a*b,1)/1e6,rows:[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name)||Number(a.inner)-Number(b.inner)||Number(a.weight)-Number(b.weight))});
  }
  groups.sort((a,b)=>a.mark.localeCompare(b.mark,undefined,{numeric:true}));
  return {batchNo:source.batch.batch_no,groups,count:unique.size,net:groups.reduce((sum,g)=>sum+g.rows.reduce((n,r)=>n+r.net,0),0),volume:groups.reduce((sum,g)=>sum+g.volume,0)};
}
