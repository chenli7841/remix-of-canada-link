import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {partnerRouteSchema,quoteInputSchema} from './partner-quote';
export const listPartnerRouteConfigs=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>(await import('./partner-quote.server')).listRoutes(context,true));
export const savePartnerRouteConfig=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((v:unknown)=>z.object({id:z.string().uuid().optional(),config:partnerRouteSchema}).parse(v)).handler(async({context,data})=>(await import('./partner-quote.server')).saveRoute(context,data));
export const requestPartnerQuote=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((v:unknown)=>quoteInputSchema.parse(v)).handler(async({context,data})=>(await import('./partner-quote.server')).createQuote(context,data));
