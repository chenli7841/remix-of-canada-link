import {partnerRouteSchema,quoteInputSchema,routeOrigin,baseQuote,type PartnerRouteDraft} from './partner-quote';
import {supabaseAdmin} from '@/integrations/supabase/client.server';
import {quotePartnerDelivery} from './partner-delivery.server';
const db:any=supabaseAdmin;
type Auth={userId:string;supabase:any};
async function staff(c:Auth){const rows=await Promise.all(['owner','manager'].map(role=>c.supabase.rpc('has_role',{_user_id:c.userId,_role:role})));if(rows.some(r=>r.error))throw Error('权限读取失败');return rows.some(r=>r.data===true);}
async function admin(c:Auth){if(!await staff(c))throw Error('仅负责人或管理员可管理同行线路');}
function checked(r:any,message:string){if(r.error)throw Error(message);return r.data;}
async function identity(c:Auth){if(await staff(c))return {staff:true,code:''};const p=checked(await db.from('profiles').select('customer_code').eq('id',c.userId).maybeSingle(),'客户资料读取失败');return {staff:false,code:p?.customer_code||''};}
export function canQuote(d:PartnerRouteDraft,who:{staff:boolean;code:string}){return who.staff || (d.enabled&&d.allowQuote&&!!who.code&&(d.audience==='全部同行客户'||d.customers.split(/[,，\s]+/).includes(who.code)));}
export async function listRoutes(c:Auth,management=false){
 if(management)await admin(c);
 const who=await identity(c),rows=checked(await db.from('partner_quote_routes').select('*').order('code'),'同行线路读取失败，请检查数据库迁移');
 if(management)return rows;
 return rows.filter((r:any)=>{const d=partnerRouteSchema.parse(r.config);return d.enabled&&d.allowQuote&&canQuote(d,who);}).map((r:any)=>({id:r.id,code:r.code,name_zh:r.config.name,shipping_method:r.config.method,cargo_type:r.config.cargo,weight_mode:'max',volumetric_divisor:6000}));
}
export async function saveRoute(c:Auth,input:{id?:string;config:unknown}){
 await admin(c);const d=partnerRouteSchema.parse(input.config);
 if(d.enabled){routeOrigin(d);if(d.method!=='sea')throw Error('空运规则未设置，不能启用');if(d.audience==='指定同行客户'&&!d.customers.trim())throw Error('请指定客户号');
 for(const k of ['domesticRate','seaRate','portRate'] as const)if(d[k]==='')throw Error('启用前请补齐各项费用单价');
 for(const k of ['domesticDensity','seaDensity'] as const)if(!d[k]||Number(d[k])<=0)throw Error('启用前请补齐折算重量');
 if([d.domesticCurrency,d.seaCurrency,d.portCurrency].includes('USD')&&(!d.fx||Number(d.fx)<=0))throw Error('启用前请补齐 USD/CAD 汇率');}
 const data={code:d.code,config:d,updated_by:c.userId,updated_at:new Date().toISOString()};
 const query=input.id?db.from('partner_quote_routes').update(data).eq('id',input.id):db.from('partner_quote_routes').insert(data);
 const saved=checked(await query.select('*').single(),'线路保存失败，请检查编号是否重复及数据库迁移');return saved;
}
export async function createQuote(c:Auth,raw:unknown){
 const input=quoteInputSchema.parse(raw),who=await identity(c);
 const route=checked(await db.from('partner_quote_routes').select('*').eq('id',input.routeId).maybeSingle(),'线路读取失败');
 if(!route)throw Error('线路不存在');const config=partnerRouteSchema.parse(route.config);
 if(!config.enabled||!config.allowQuote||!canQuote(config,who))throw Error('线路未启用或您无权查询');
 const hs=checked(await db.from('hs_codes').select('id,hs_code,mfn_rate,gst_rate,anti_dumping_rate').in('id',[...new Set(input.items.map(i=>i.hsId))]).eq('is_active',true),'税率读取失败');
 const base=baseQuote(config,input,hs),from=routeOrigin(config);
 const delivery=await quotePartnerDelivery({draft:{from,to:input.to,packages:base.packages,packageType:'parcel'},rule:{currency:'CAD'}});
 const rates=delivery.rates.filter(r=>r.currency==='CAD');if(!rates.length)throw Error('未返回可用 CAD 派送服务，请核对地址、尺寸和重量');
 const subtotal=base.fees.reduce((s,r)=>s+Math.round(r.amount*100),0);
 const result={...base,rates:rates.map(r=>({...r,total:Math.round(subtotal+r.price*100)/100})),expiresAt:delivery.expiresAt,currency:'CAD',routeName:config.name};
 const saved=checked(await db.from('partner_quote_snapshots').insert({user_id:c.userId,route_id:route.id,input,route_snapshot:route,result,expires_at:delivery.expiresAt}).select('id').single(),'报价已返回，但快照保存失败，请重新查询');
 return {...result,id:saved.id};
}
