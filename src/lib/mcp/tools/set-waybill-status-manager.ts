import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";
const statuses=["procurement","pending","received","storage","packed","shipped","arrived","in_transit","ready_pickup","delivered","cancelled"] as const;
export default defineTool({
  name:"set_waybill_status_manager",title:"Set waybill status with manager permissions",
  description:"Mapping of the existing EPLUS setWaybillStatus operation. Requires Owner/Manager permission, a fresh review, explicit confirmation, reason, and audit.",
  inputSchema:{waybill_no:z.string().min(1).max(100),expected_updated_at:z.string().datetime(),status:z.enum(statuses),
    reason:z.string().min(2).max(500),confirmation:z.literal("CONFIRM_WAYBILL_STATUS"),
    public_event:z.object({status_zh:z.string().min(1).max(200),status_en:z.string().max(200).optional(),location_zh:z.string().max(200).optional(),location_en:z.string().max(200).optional()}).optional()},
  annotations:{readOnlyHint:false,idempotentHint:false,destructiveHint:true,openWorldHint:false},
  handler:async(input,ctx)=>{if(!ctx.isAuthenticated())return unauthenticatedResult();
    const{data,error}=await supabaseForUser(ctx).rpc("chatgpt_manager_set_waybill_status",{_waybill_no:input.waybill_no,
      _expected_updated_at:input.expected_updated_at,_status:input.status,_reason:input.reason,_confirmation:input.confirmation,_public_event:input.public_event??null});
    if(error)return isPermissionError(error)?permissionDeniedResult():queryFailedResult();
    return{content:[{type:"text",text:JSON.stringify(data,null,2)}],structuredContent:{result:data}};}
});
