import {partnerDeliverySchema} from './partner-delivery';
import {normalizeRates,chooseRate} from './express';
import {accountUnits,providerConfig,providerPayload,verykRequest} from './verykship.server';
type Auth={userId:string;supabase:any};
async function authorize(c:Auth){
 const results=await Promise.all(['owner','manager'].map(role=>c.supabase.rpc('has_role',{_user_id:c.userId,_role:role})));
 if(results.some(r=>r.error)||!results.some(r=>r.data===true))throw new Error('仅负责人或管理员可测试快递接口');
}
export async function deliveryConnection(c:Auth,probe=false){
 await authorize(c);const cfg=providerConfig();
 const status={environment:cfg.environment,configured:cfg.configured,purchasing:false,connected:false};
 if(!probe||!cfg.configured)return status;
 const units=await accountUnits();return {...status,connected:true,units};
}
// This endpoint deliberately never imports order creation, purchase, or label functions.
export async function testPartnerDelivery(input:unknown,c:Auth){
 await authorize(c);
 const {draft,rule}=partnerDeliverySchema.parse(input);
 if(draft.from.region_id!=='CA'||draft.to.region_id!=='CA')throw new Error('同行派送报价目前仅支持加拿大境内');
 if(draft.signature||draft.liftgate)throw new Error('当前同行报价仅支持普通包裹，不支持签名或尾板附加服务');
 if(!providerConfig().configured)throw new Error('未配置当前环境的 VerykShip 服务端凭证');
 const units=await accountUnits();
 let rates=normalizeRates(await verykRequest('shipment/quote',providerPayload(draft,units)));
 // Purolator requires explicit no-signature mapping; do not use its initial unqualified rate.
 const special=rates.filter(r=>r.carrier.toLowerCase().replace(/[^a-z]/g,'')==='purolator');
 if(special.length>40)throw new Error('可用服务过多，请缩小服务范围');
 for(const rate of special){
  const updated=normalizeRates(await verykRequest('shipment/quote',{...providerPayload(draft,units,rate),carrier_ids:[rate.carrierId]})).find(r=>r.key===rate.key);
  rates=rates.filter(r=>r.key!==rate.key);if(updated)rates.push(updated);
 }
 const recommendation=chooseRate(rates,rule).rate;
 return {rates,recommendation,expiresAt:new Date(Date.now()+600000).toISOString(),environment:providerConfig().environment};
}

