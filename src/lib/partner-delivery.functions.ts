import {createServerFn} from '@tanstack/react-start';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {partnerDeliverySchema} from './partner-delivery';
export const getPartnerDeliveryConnection=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((d:{probe:boolean})=>({probe:d?.probe===true})).handler(async({data,context})=>(await import('./partner-delivery.server')).deliveryConnection(context,data.probe));
export const testPartnerDeliveryQuote=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((d:unknown)=>partnerDeliverySchema.parse(d)).handler(async({data,context})=>(await import('./partner-delivery.server')).testPartnerDelivery(data,context));
