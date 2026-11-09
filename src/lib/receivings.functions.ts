import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

import { SCAN_KIND_LABEL } from "@/lib/scan-detect";

// ===== List receivings =====
export const listReceivings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("receivings")
      .select(
        "id, receiving_no, batch_id, batch_ids, warehouse_code, status, notes, confirmed_at, created_at, batches:batch_id(batch_no, display_name, planned_ship_date, shipping_method, status)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).flatMap(r => r.batch_ids ?? (r.batch_id ? [r.batch_id] : [])))];
    const batches = ids.length ? await supabaseAdmin.from('batches').select('id,batch_no,display_name,planned_ship_date,shipping_method,status').in('id',ids) : {data:[],error:null};
    if (batches.error) throw new Error(batches.error.message);
    return { receivings: (data ?? []).map(r => ({...r, matched_batches:(batches.data ?? []).filter(b => (r.batch_ids ?? []).includes(b.id))})) };
  });

// ===== Create receiving =====
export const createReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { warehouse_code?: string; notes?: string; batch_id?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const { count } = await supabaseAdmin
      .from("receivings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${today.toISOString().slice(0, 10)}T00:00:00Z`);
    const seq = String((count ?? 0) + 1).padStart(3, "0");
    const receiving_no = `RCV${ymd}${seq}`;
    const { data: row, error } = await supabaseAdmin
      .from("receivings")
      .insert({
        receiving_no,
        warehouse_code: data.warehouse_code || null,
        notes: data.notes || null,
        batch_id: data.batch_id || null,
        status: data.batch_id ? "matched" : "open",
        created_by: context.userId,
      })
      .select("id, receiving_no")
      .single();
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: row!.id,
      action: "create",
      after: { receiving_no, warehouse_code: data.warehouse_code, batch_id: data.batch_id },
      operator_id: context.userId,
    });
    return row;
  });

// ===== Match a batch (or unmatch when batch_id null) =====
export const matchReceivingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; batchId?: string | null; batchIds?: string[] }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const batchIds = data.batchIds ?? (data.batchId ? [data.batchId] : []);
    const { error } = await (supabaseAdmin as any).rpc('set_receiving_batches', {
      _receiving_id: data.receivingId, _batch_ids: batchIds, _operator_id: context.userId,
    });
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: data.receivingId,
      action: batchIds.length ? "match_batch" : "unmatch_batch",
      after: { batch_ids: batchIds },
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ===== Scan a code into receiving =====
export const scanReceive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; code: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertReturnReminder } = await import('./return-reminder.server');
    await assertReturnReminder(supabaseAdmin, 'scanReceive', data, { code: data.code });
    const code = data.code.trim();
    if (!code) throw new Error("空扫描");
    const { data: recv, error: recvError } = await (supabaseAdmin as any).from('receivings')
      .select('batch_id,batch_ids,included_units,status').eq('id', data.receivingId).single();
    if (recvError || !recv) throw new Error('收货单读取失败');
    if (!['open','matched'].includes(recv.status)) throw new Error('收货单已确认，不能继续扫描');
    const batchIds: string[] = recv.batch_ids ?? (recv.batch_id ? [recv.batch_id] : []);
    const { resolveReceivingCode, ReceivingCodeError } = await import('./receiving-scan.server');
    let item;
    try {item = await resolveReceivingCode(supabaseAdmin, code);}
    catch(error) {
      if(!(error instanceof ReceivingCodeError)) throw error;
      const saved = await (supabaseAdmin as any).rpc('record_receiving_scan_issue',{
        _receiving_id:data.receivingId,_code:code,_reason:error.message,_operator_id:context.userId,_matches:error.candidates,
      });
      if(saved.error) throw new Error('未能保存差异，请重新扫描：'+saved.error.message);
      return {ok:true,kind:'unknown',extra:true,needsSelection:error.message.includes('多个'),scan_id:null,info:error.message+'；已保存到多扫/差异'};
    }
    const resolveIssue = async()=>{
      const result=await (supabaseAdmin as any).rpc('record_receiving_scan_issue',{
        _receiving_id:data.receivingId,_code:code,_reason:'',_operator_id:context.userId,_status:'resolved',
      });
      if(result.error) throw new Error('收货已记录，但差异更新失败，请重新扫描：'+result.error.message);
    };
    const { kind, ref_id, label } = item;
    if (kind === 'batch') {
      const { error } = await (supabaseAdmin as any).rpc('set_receiving_batches', {
        _receiving_id: data.receivingId, _batch_ids: [ref_id], _operator_id: context.userId, _append: true,
      });
      if (error) throw new Error(error.message);
      await recordAdminLog(supabaseAdmin, { entity_type:'receiving', entity_id:data.receivingId,
        action:'scan_match_batch', after:{batch_id:ref_id}, operator_id:context.userId });
      return { ok:true,kind,extra:false,scan_id:null,info: '已添加匹配批次 ' + label };
    }
    // Infer membership through all nesting levels, including legacy cartons without batch IDs.
    const { loadReceivingContents } = await import('./receiving-bulk.server');
    let currentBatchIds = batchIds;
    if (!batchIds.length && item.batchId) {
      const { error } = await (supabaseAdmin as any).rpc('set_receiving_batches', {
        _receiving_id:data.receivingId, _batch_ids:[item.batchId], _operator_id:context.userId, _append:true,
      });
      if (error) throw new Error(error.message);
      currentBatchIds = [item.batchId];
    }
    const contents = await loadReceivingContents(supabaseAdmin, currentBatchIds, recv.included_units ?? []);
    const collection = kind === 'carton' ? contents.cartons : kind === 'pallet' ? contents.pallets : contents.waybills;
    const extra = currentBatchIds.length > 0 && !collection.some(x => x.id === ref_id);

    if (extra) {
      const {error} = await supabaseAdmin.from('receiving_scans').upsert({receiving_id:data.receivingId,kind,ref_id,
        code:label,operator_id:context.userId,scanned_at:new Date().toISOString()},
        {onConflict:'receiving_id,kind,ref_id',ignoreDuplicates:true});
      if(error) throw new Error(error.message);
      await recordAdminLog(supabaseAdmin,{entity_type:'receiving',entity_id:data.receivingId,action:'unmatched_scan',after:{kind,ref_id,code:label},operator_id:context.userId});
      await resolveIssue();
      return {ok:true,kind,extra:true,scan_id:null,info:label+' 不属于匹配清单，已单独列入未匹配单子，等待合并或踢出去'};
    }
    const {error: scanError} = await (supabaseAdmin as any).rpc('scan_receiving_hierarchy', {
      _receiving_id:data.receivingId, _kind:kind, _ref_id:ref_id, _operator_id:context.userId,
    });
    if (scanError) throw new Error(scanError.message);
    await resolveIssue();
    return {ok:true,kind,extra:false,scan_id:null,info:SCAN_KIND_LABEL[kind]+' '+label+' 已确认，已同步内部明细及收齐的上层容器'};
  });

// ===== Record all expected items as received, without finalizing the receiving =====
export const matchAllReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; batchId?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const recv = await supabaseAdmin.from('receivings').select('batch_id,batch_ids,status').eq('id', data.receivingId).single();
    if (recv.error || !recv.data) throw new Error('收货单读取失败');
    if (!recv.data.batch_id || (data.batchId && recv.data.batch_id !== data.batchId)) throw new Error('请先匹配批次，或刷新后重试');
    if (!['open', 'matched'].includes(recv.data.status)) throw new Error('收货单已确认，不能一键匹配');
    const { assertReturnReminder } = await import('./return-reminder.server');
    await assertReturnReminder(supabaseAdmin, 'matchAllReceiving', data, { batchIds: (recv.data as any).batch_ids ?? [recv.data.batch_id] });
    const { recordAllReceivingScans } = await import('./receiving-bulk.server');
    const counts = await recordAllReceivingScans(supabaseAdmin, data.receivingId, (recv.data as any).batch_ids ?? [recv.data.batch_id], context.userId);
    await recordAdminLog(supabaseAdmin, {
      entity_type: 'receiving', entity_id: data.receivingId, action: 'match_all_receiving',
      after: { batch_ids: recv.data.batch_ids, ...counts }, operator_id: context.userId,
      note: '一键匹配全部到货（含内部运单、箱号及托盘），已有扫描记录保留',
    });
    return { ok: true, counts };
  });

// ===== Remove a scan =====
export const removeReceivingScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scanId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("receiving_scans")
      .select("*")
      .eq("id", data.scanId)
      .maybeSingle();
    if (!before) throw new Error('扫描记录不存在');
    const {error} = await (supabaseAdmin as any).rpc('scan_receiving_hierarchy', {
      _receiving_id:before.receiving_id, _kind:before.kind, _ref_id:before.ref_id,
      _operator_id:context.userId, _remove:true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===== Detail with batch-vs-received diff =====
export const getReceivingDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: recv, error } = await supabaseAdmin
      .from("receivings")
      .select("*, batches:batch_id(id, batch_no, display_name, planned_ship_date, shipping_method, status, destination_code)")
      .eq("id", data.receivingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!recv) throw new Error("收货单不存在");

    const scans: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await supabaseAdmin.from('receiving_scans').select('*')
        .eq('receiving_id', data.receivingId).order('scanned_at', { ascending: false }).order('id')
        .range(offset, offset + 499);
      if (result.error) throw new Error('收货记录读取失败，请重试');
      scans.push(...(result.data ?? []));
      if ((result.data ?? []).length < 500) break;
    }

    // batch expected contents
    let expected = { waybills: [] as any[], cartons: [] as any[], pallets: [] as any[] };
    if (recv.batch_id) {
      const { loadReceivingContents } = await import('./receiving-bulk.server');
      expected = await loadReceivingContents(supabaseAdmin, (recv as any).batch_ids ?? [recv.batch_id], (recv as any).included_units ?? []);
    }

    const scanned = {
      waybills: new Set((scans ?? []).filter((s) => s.kind === "waybill").map((s) => s.ref_id)),
      cartons: new Set((scans ?? []).filter((s) => s.kind === "carton").map((s) => s.ref_id)),
      pallets: new Set((scans ?? []).filter((s) => s.kind === "pallet").map((s) => s.ref_id)),
    };
    const expectedIds = {
      waybills: new Set(expected.waybills.map((w) => w.id)),
      cartons: new Set(expected.cartons.map((c) => c.id)),
      pallets: new Set(expected.pallets.map((p) => p.id)),
    };

    // 直挂 (direct) split — only items not nested inside a higher container
    const direct = {
      waybills: expected.waybills.filter((w: any) => !w.carton_id && !w.pallet_id),
      cartons: expected.cartons.filter((c: any) => !c.pallet_id),
      pallets: expected.pallets,
    };

    // 待二次扫描确认: 已扫描箱号 → 内部运单; 已扫描托盘 → 内部箱号
    const scannedCartonIds = Array.from(scanned.cartons);
    const scannedPalletIds = Array.from(scanned.pallets);
    const innerWaybills = expected.waybills
      .filter((w: any) => w.carton_id && scannedCartonIds.includes(w.carton_id))
      .map((w: any) => ({ ...w, scanned: scanned.waybills.has(w.id) }));
    const innerCartons = expected.cartons
      .filter((c: any) => c.pallet_id && scannedPalletIds.includes(c.pallet_id))
      .map((c: any) => ({ ...c, scanned: scanned.cartons.has(c.id) }));
    const secondary = {
      inner_waybills: innerWaybills,
      inner_cartons: innerCartons,
      pending_count: innerWaybills.filter((x) => !x.scanned).length + innerCartons.filter((x) => !x.scanned).length,
      total_count: innerWaybills.length + innerCartons.length,
    };

    const diff = {
      missing_waybills: direct.waybills.filter((w: any) => !scanned.waybills.has(w.id)),
      missing_cartons: direct.cartons.filter((c: any) => !scanned.cartons.has(c.id)),
      missing_pallets: direct.pallets.filter((p: any) => !scanned.pallets.has(p.id)),
      extra_scans: (scans ?? []).filter(
        (s) =>
          (s.kind === "waybill" && !expectedIds.waybills.has(s.ref_id)) ||
          (s.kind === "carton" && !expectedIds.cartons.has(s.ref_id)) ||
          (s.kind === "pallet" && !expectedIds.pallets.has(s.ref_id)),
      ),
    };

    const batchIds = (recv as any).batch_ids ?? (recv.batch_id ? [recv.batch_id] : []);
    const hierarchyBatchIds = [...new Set([...batchIds,...expected.pallets.map(x=>x.batch_id),...expected.cartons.map(x=>x.batch_id),...expected.waybills.map(x=>x.assigned_batch_id)].filter(Boolean))];
    const matched = hierarchyBatchIds.length ? await supabaseAdmin.from('batches')
      .select('id,batch_no,display_name,planned_ship_date,shipping_method,status,destination_code').in('id',hierarchyBatchIds) : {data:[],error:null};
    if (matched.error) throw new Error(matched.error.message);
    const issues:any[]=[];
    for(let offset=0;;offset+=500){
      const result=await (supabaseAdmin as any).from('receiving_scan_issues').select('*').eq('receiving_id',data.receivingId).eq('status','pending').order('scanned_at',{ascending:false}).order('id').range(offset,offset+499);
      if(result.error) throw new Error(result.error.message);
      issues.push(...(result.data ?? []));if((result.data ?? []).length<500) break;
    }
    const {receivingDifferenceDetails}=await import('./receiving-differences.server');
    diff.extra_scans=await receivingDifferenceDetails(supabaseAdmin,diff.extra_scans);
    const candidates=await receivingDifferenceDetails(supabaseAdmin,issues.flatMap(i=>(i.matches ?? []).map((m:any)=>({...m,issue_id:i.id}))));
    return { issues:issues.map(i=>({...i,matches:candidates.filter(c=>c.issue_id===i.id)})), receiving: {...recv, batch_ids:batchIds, matched_batches:(matched.data ?? []).filter(b=>batchIds.includes(b.id)), hierarchy_batches:matched.data ?? []}, scans: scans ?? [], expected, direct, secondary, diff };
  });

// ===== Confirm receiving: mark batch arrived + sync waybills + add tracking event =====
export const confirmReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; location_zh?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: recv } = await supabaseAdmin
      .from("receivings")
      .select("id, batch_id, batch_ids, status, warehouse_code")
      .eq("id", data.receivingId)
      .maybeSingle();
    if (!recv) throw new Error("收货单不存在");
    if (!recv.batch_id) throw new Error("请先匹配批次");
    if (recv.status === "confirmed" || recv.status === "closed") throw new Error("收货单已确认");

    const { assertReturnReminder } = await import('./return-reminder.server');
    await assertReturnReminder(supabaseAdmin, 'confirmReceiving', data, { batchIds: (recv as any).batch_ids ?? [recv.batch_id] });

    const { data: result, error } = await (supabaseAdmin as any).rpc("confirm_receiving_multi_atomic", {
      _receiving_id: data.receivingId,
      _batch_id: recv.batch_id,
      _expected_batch_ids: recv.batch_ids,
      _operator_id: context.userId,
      _location: data.location_zh || null,
    });
    if (error) throw new Error("确认到件失败：" + error.message);
    return result as { ok: boolean; already_confirmed?: boolean; waybills_updated: number; orders_updated: number };
  });

// ===== Update notes / warehouse / close =====
export const updateReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { receivingId: string; patch: { warehouse_code?: string | null; notes?: string | null; status?: string } }) =>
      d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("receivings").update(data.patch).eq("id", data.receivingId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: data.receivingId,
      action: "update",
      after: data.patch,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// Include only the explicitly selected unit and descendants; never its entire foreign batch.
export const mergeReceivingScan = createServerFn({method:'POST'})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:{scanId:string})=>d)
  .handler(async({data,context})=>{
    await assertStaff(context.supabase,context.userId);
    const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
    const {data:scan,error}=await supabaseAdmin.from('receiving_scans').select('*').eq('id',data.scanId).single();
    if(error || !scan) throw new Error('扫描记录不存在');
    const {assertReturnReminder}=await import('./return-reminder.server');
    await assertReturnReminder(supabaseAdmin,'mergeReceivingScan',data,{code:scan.code});
    const result=await (supabaseAdmin as any).rpc('scan_receiving_hierarchy',{
      _receiving_id:scan.receiving_id,_kind:scan.kind,_ref_id:scan.ref_id,_operator_id:context.userId,_include:true,
    });
    if(result.error) throw new Error(result.error.message);
    return {ok:true};
  });

export const dismissReceivingIssue=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
.inputValidator((d:{receivingId:string;code:string})=>d).handler(async({data,context})=>{
 await assertStaff(context.supabase,context.userId);
 const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
 const result=await (supabaseAdmin as any).rpc('record_receiving_scan_issue',{_receiving_id:data.receivingId,_code:data.code,_reason:'',_operator_id:context.userId,_status:'dismissed'});
 if(result.error)throw new Error(result.error.message);
 return {ok:true};
});
