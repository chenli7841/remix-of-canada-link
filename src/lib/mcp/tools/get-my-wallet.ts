import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name:"get_my_wallet", title:"Get my wallet and transactions",
  description:"Show the signed-in customer's CAD wallet balance and a small filtered page of completed transactions. Ask before loading more. Read-only and cannot recharge, deduct or refund.",
  inputSchema:{transaction_type:z.string().max(30).optional(),date_from:z.string().date().optional(),date_to:z.string().date().optional(),offset:z.number().int().min(0).max(10000).optional(),limit:z.number().int().min(1).max(10).optional()},
  annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false},
  handler:async({transaction_type,date_from,date_to,offset,limit},ctx)=>{
    if(!ctx.isAuthenticated())return unauthenticatedResult();
    const sb=supabaseForUser(ctx),pageSize=limit??5,start=offset??0;
    let tq=sb.from("wallet_transactions").select("id,type,amount_cad,channel,ref_no,note,status,related_order_id,created_at").eq("status","completed").order("created_at",{ascending:false});
    if(transaction_type)tq=tq.eq("type",transaction_type as never);
    if(date_from)tq=tq.gte("created_at",`${date_from}T00:00:00.000Z`); if(date_to)tq=tq.lte("created_at",`${date_to}T23:59:59.999Z`);
    const[{data:w,error:we},{data:t,error:te}]=await Promise.all([sb.from("wallets").select("balance_cad,updated_at").maybeSingle(),tq.range(start,start+pageSize)]);
    if(we||te){const e=we??te;return isPermissionError(e)?permissionDeniedResult():queryFailedResult();}
    const hasMore=(t?.length??0)>pageSize;
    const result={currency:"CAD",balance_cad:Number(w?.balance_cad??0),updated_at:w?.updated_at??null,transactions:(t??[]).slice(0,pageSize),page:{offset:start,limit:pageSize,has_more:hasMore,next_offset:hasMore?start+pageSize:null},payment_available_here:false};
    return{content:[{type:"text",text:JSON.stringify(result,null,2)}],structuredContent:result};
  }
});
