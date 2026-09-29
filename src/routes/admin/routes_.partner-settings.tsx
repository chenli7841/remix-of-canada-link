import { createFileRoute } from '@tanstack/react-router';
import { PartnerRouteSettings } from '@/components/partner/PartnerRouteSettings';
// Inherits the existing /admin/routes navigation permission. No backend writes.
export const Route = createFileRoute('/admin/routes_/partner-settings')({
 ssr:false,
 head:()=>({meta:[{title:'同行专属线路设置 · 管理后台'},{name:'robots',content:'noindex,nofollow'}]}),
 component:()=> <PartnerRouteSettings embedded/>,
});
