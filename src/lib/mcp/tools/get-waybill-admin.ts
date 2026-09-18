import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name:"get_waybill_admin", title:"Get waybill with admin permissions",
  description:"Mapping of the existing EPLUS admin waybill detail view. Uses the signed-in account's normal staff permission.",
  inputSchema:{waybill_no:z.string().min(1).max(100)}, annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false},
  handler:async({waybill_no},ctx)=>{if(!ctx.isAuthenticated())return unauthenticatedResult();
    const{data,error}=await supabaseForUser(ctx).rpc("chatgpt_admin_get_waybill",{_waybill_no:waybill_no});
    if(error)return isPermissionError(error)?permissionDeniedResult():queryFailedResult();
    return{content:[{type:"text",text:JSON.stringify(data,null,2)}],structuredContent:{result:data}};}
});
