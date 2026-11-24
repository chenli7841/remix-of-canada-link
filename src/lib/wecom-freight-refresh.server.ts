/** Rebuild only measurement figures from saved waybill fees; never send a message here. */
export async function currentMeasurementSections(admin: any, draft: { service_date: string; customer_code: string; sections?: any }) {
  const events = await admin.from("wecom_daily_notification_events").select("payload")
    .eq("service_date", draft.service_date).eq("customer_code", draft.customer_code).eq("category", "measurement");
  if (events.error) throw new Error(events.error.message);
  const sections = { ...(draft.sections ?? {}) };
  if (!events.data?.length) { delete sections.measurements; return sections; }
  const unique = (xs: any[]) => [...new Set(xs.filter(Boolean))];
  async function read(table: string, columns: string, ids: any[]) {
    const rows: any[] = [];
    for (let i=0;i<ids.length;i+=100) {
      const result = await admin.from(table).select(columns).in("id",ids.slice(i,i+100));
      if (result.error) throw new Error(result.error.message);
      rows.push(...result.data);
    }
    return rows;
  }
  const leaves = await read("waybills","id,forwarding_id,order_id,weight_kg,weight_snapshot,freight_cad,carton_id,pallet_id",unique(events.data.map((e:any)=>e.payload?.waybillId)));
  const parents = [...await read("forwarding_orders","id,customer_code",unique(leaves.map(w=>w.forwarding_id))),
    ...await read("orders","id,customer_code",unique(leaves.map(w=>w.order_id)))];
  const cartons = await read("cartons","id,pallet_id,billing_mode",unique(leaves.map(w=>w.carton_id)));
  const pallets = await read("pallets","id,billing_mode",unique([...leaves.map(w=>w.pallet_id),...cartons.map(c=>c.pallet_id)]));
  const totals = new Map<string, any>(), seen = new Set<string>();
  for (const event of events.data) {
    const id=event.payload?.waybillId;
    if(seen.has(id)) continue;
    seen.add(id);
    const w=leaves.find(w=>w.id===id);
    if(!w) throw new Error("通知关联的运单不存在，请重新生成通知");
    const parent=parents.find(p=>p.id===(w.forwarding_id??w.order_id));
    if(parent?.customer_code!==draft.customer_code) throw new Error("通知与运单客户不一致，请重新生成通知");
    const snapshot=w.weight_snapshot;
    const values=[w.freight_cad,w.weight_kg,snapshot?.volumetric_weight,snapshot?.chargeable_weight];
    if(values.some(v=>v==null || !Number.isFinite(Number(v)) || Number(v)<0)) throw new Error("运单量尺费用未完整保存，不能发送旧金额");
    const key=String(event.payload.trackingNo??"");
    if(!key) throw new Error("通知缺少对应单号");
    const total=totals.get(key)??{trackingNo:key,totalActualWeightKg:0,totalVolumetricWeightKg:0,totalChargeableWeightKg:0,totalFeeCad:0};
    total.totalActualWeightKg+=Number(w.weight_kg);
    total.totalVolumetricWeightKg+=Number(snapshot.volumetric_weight);
    total.totalChargeableWeightKg+=Number(snapshot.chargeable_weight);
    total.totalFeeCad+=Number(w.freight_cad);
    const carton=cartons.find(c=>c.id===w.carton_id),pallet=pallets.find(p=>p.id===(carton?.pallet_id??w.pallet_id));
    total.billingReferenceOnly ||= pallet?.billing_mode==="merged" || carton?.billing_mode==="merged";
    totals.set(key,total);
  }
  sections.measurements=[...totals.values()].map(t=>({...t,totalFeeCad:+t.totalFeeCad.toFixed(2),
    totalActualWeightKg:+t.totalActualWeightKg.toFixed(3),totalVolumetricWeightKg:+t.totalVolumetricWeightKg.toFixed(3),totalChargeableWeightKg:+t.totalChargeableWeightKg.toFixed(3)}));
  return sections;
}
