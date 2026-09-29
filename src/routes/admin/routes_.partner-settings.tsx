import {createFileRoute} from '@tanstack/react-router';
import {useServerFn} from '@tanstack/react-start';
import {PartnerRouteSettings} from '@/components/partner/PartnerRouteSettings';
import {getPartnerDeliveryConnection,testPartnerDeliveryQuote} from '@/lib/partner-delivery.functions';
export const Route=createFileRoute('/admin/routes_/partner-settings')({ssr:false,head:()=>({meta:[{title:'同行专属线路设置 · 管理后台'},{name:'robots',content:'noindex,nofollow'}]}),component:Page});
function Page(){const connection=useServerFn(getPartnerDeliveryConnection),quote=useServerFn(testPartnerDeliveryQuote);return <PartnerRouteSettings embedded deliveryApi={{connection:probe=>connection({data:{probe}}),quote:data=>quote({data})}}/>;}
