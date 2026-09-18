import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { cnyToCad } from "../currency";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name:"list_my_invoices", title:"List my invoices",
  description:"List the signed-in customer's invoices with optional invoice-number, status and date filters. Returns a small page; ask before loading more. All money is CAD.",
  inputSchema:{invoice_no:z.string().max(100).optional(),status:z.string().max(30).optional(),date_from:z.string().date().optional(),date_to:z.string().date().optional(),offset:z.number().int().min(0).max(10000).optional(),limit:z.number().int().min(1).max(10).optional()},
  annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false},
  handler:async({invoice_no,status,date_from,date_to,offset,limit},ctx)=>{
    if(!ctx.isAuthenticated())return unauthenticatedResult();
    const pageSize=limit??5,start=offset??0;
    let q=supabaseForUser(ctx).from("invoices").select("id,invoice_no,type,status,batch_no,due_date,total_cny,fx_rate,paid_cad,payment_method,paid_at,created_at").order("created_at",{ascending:false});
    if(invoice_no)q=q.ilike("invoice_no",`%${invoice_no}%`); if(status)q=q.eq("status",status as never);
    if(date_from)q=q.gte("created_at",`${date_from}T00:00:00.000Z`); if(date_to)q=q.lte("created_at",`${date_to}T23:59:59.999Z`);
    const{data,error}=await q.range(start,start+pageSize); if(error)return isPermissionError(error)?permissionDeniedResult():queryFailedResult();
    const hasMore=(data?.length??0)>pageSize;
    const invoices=(data??[]).slice(0,pageSize).map((x:any)=>({id:x.id,invoice_no:x.invoice_no,type:x.type,status:x.status,batch_no:x.batch_no,due_date:x.due_date,total_cad:cnyToCad(x.total_cny,x.fx_rate),paid_cad:Number(x.paid_cad??0),payment_method:x.payment_method,paid_at:x.paid_at,created_at:x.created_at}));
    const result={currency:"CAD",invoices,page:{offset:start,limit:pageSize,has_more:hasMore,next_offset:hasMore?start+pageSize:null}};
    return{content:[{type:"text",text:JSON.stringify(result,null,2)}],structuredContent:result};
  }
});
