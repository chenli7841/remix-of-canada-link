/**
 * 微信客服快速通道消息调度（本地处理，不经过腾讯云 ADP）。
 * 日志中只记录消息类型、耗时、状态码，绝不记录图片、OCR 全文、客户资料或密钥。
 */
import { downloadMedia, sendMenu, sendText, syncMsg } from "./api.server";
import { extractWithCache, normalizeNo, type ExtractResult } from "./extract.server";
import { clearState, getState, mergeDraft, setState, type KfDraft } from "./state.server";
import { T, confirmText } from "./templates";

type Ctx = { origin: string; openKfid: string; externalUserid: string };

async function api(origin: string, path: string, body: unknown) {
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as any;
}

/** 单号必须能在业务系统中查到才算有效（禁止仅凭识别结果猜测） */
async function verifyNo(origin: string, no: string) {
  const track = await api(origin, "/api/public/ai-track", { tracking_number: no });
  if (track?.found) return { valid: true, track };
  const scan = await api(origin, "/api/public/ai-warehouse-scan", { tracking_number: no });
  if (scan?.order_found || scan?.found) return { valid: true, track, scan };
  return { valid: false, track, scan };
}

async function pickVerified(origin: string, ex: ExtractResult) {
  const verified: string[] = [];
  const results = await Promise.all(
    ex.tracking_candidates.map(async (c) => ({ c, r: await verifyNo(origin, c.value) })),
  );
  for (const { c, r } of results) if (r.valid) verified.push(c.value);
  return { verified, results };
}

// ---------- 查询 ----------

async function replyTracking(ctx: Ctx, no: string) {
  const track = await api(ctx.origin, "/api/public/ai-track", { tracking_number: no });
  if (track?.found && track.status_code !== "pending_intake") {
    await sendText(ctx.openKfid, ctx.externalUserid, track.tracking_text);
    return;
  }
  const scan = await api(ctx.origin, "/api/public/ai-warehouse-scan", { tracking_number: no });
  await sendText(
    ctx.openKfid,
    ctx.externalUserid,
    scan?.scan_text || track?.tracking_text || `未查询到运单号 ${no} 的物流信息。`,
  );
}

async function replyBilling(ctx: Ctx, no: string) {
  const b = await api(ctx.origin, "/api/public/ai-order-billing", { tracking_number: no });
  await sendText(ctx.openKfid, ctx.externalUserid, b?.billing_text || b?.message || `未查询到 ${no} 的费用信息。`);
}

async function replyEta(ctx: Ctx, no: string) {
  const b = await api(ctx.origin, "/api/public/ai-order-billing", { tracking_number: no });
  const text = b?.estimated_arrival_text
    ? `${b.estimated_arrival_text}\n${b.eta_disclaimer || T.etaDisclaimer}`
    : b?.message || `未查询到 ${no} 的预计到达时间。`;
  await sendText(ctx.openKfid, ctx.externalUserid, text);
}

// ---------- 创建运单 ----------

async function ensureBound(ctx: Ctx): Promise<boolean> {
  const r = await api(ctx.origin, "/api/public/ai-resolve-wechat-customer", {
    external_userid: ctx.externalUserid,
  });
  return Boolean(r?.found);
}

async function routesFor(ctx: Ctx) {
  const r = await api(ctx.origin, "/api/public/ai-forwarding-options", {
    external_userid: ctx.externalUserid,
  });
  return (r?.routes ?? []) as Array<{ route_id: string; route_code: string; route_name?: string; name_zh?: string }>;
}

async function askNextMissing(ctx: Ctx, draft: KfDraft) {
  if (!draft.domestic_tracking_no) return sendText(ctx.openKfid, ctx.externalUserid, T.askDomestic);
  if (!draft.item_name) return sendText(ctx.openKfid, ctx.externalUserid, T.askItemName);
  if (draft.quantity == null) return sendText(ctx.openKfid, ctx.externalUserid, T.askQuantity);
  if (draft.unit_price == null) return sendText(ctx.openKfid, ctx.externalUserid, T.askUnitPrice);

  if (!draft.route_code) {
    const routes = await routesFor(ctx);
    if (!routes.length) return sendText(ctx.openKfid, ctx.externalUserid, T.routeUnavailable);
    return sendMenu(
      ctx.openKfid,
      ctx.externalUserid,
      T.chooseRoute,
      routes.slice(0, 10).map((r) => ({ id: `route:${r.route_id}`, content: r.route_name || r.name_zh || r.route_code })),
    );
  }
  return showConfirm(ctx, draft);
}

async function showConfirm(ctx: Ctx, draft: KfDraft) {
  const routes = await routesFor(ctx);
  const route = routes.find((r) => String(r.route_id) === String(draft.route_code));
  await setState(ctx.externalUserid, "creating_confirm", draft, ctx.openKfid);
  await sendMenu(
    ctx.openKfid,
    ctx.externalUserid,
    confirmText({ ...draft, route_name: route?.route_name || route?.name_zh || route?.route_code }),
    T.confirmItems,
  );
}

async function doCreate(ctx: Ctx, draft: KfDraft) {
  const r = await api(ctx.origin, "/api/public/ai-create-forwarding-order", {
    external_userid: ctx.externalUserid,
    confirm: true,
    idempotency_key: `kf:${ctx.externalUserid}:${draft.domestic_tracking_no}`,
    route_id: draft.route_code,
    domestic_tracking_no: draft.domestic_tracking_no,
    item_name: draft.item_name,
    quantity: draft.quantity,
    unit_price: draft.unit_price,
    currency: "CNY",
  });
  await sendText(ctx.openKfid, ctx.externalUserid, r?.created_text || r?.message || T.createFailed);
  await clearState(ctx.externalUserid);
}

// ---------- 消息处理 ----------

async function handleImage(ctx: Ctx, mediaId: string) {
  await sendText(ctx.openKfid, ctx.externalUserid, T.imageReceived);

  let ex: ExtractResult;
  let media: { bytes: Uint8Array; contentType: string } | null = null;
  try {
    media = await downloadMedia(mediaId);
    ex = await extractWithCache(media.bytes, media.contentType);
  } catch (e) {
    console.error(`[wechat-kf] image_failed ${(e as Error)?.message ?? "unknown"}`);
    await sendText(ctx.openKfid, ctx.externalUserid, T.noTrackingFound);
    return;
  } finally {
    // 处理完成立即释放临时数据
    if (media) media.bytes = new Uint8Array(0);
  }

  const { state, draft } = await getState(ctx.externalUserid);

  // 创建流程中：图片自动填充字段
  if (state === "creating_order" || state === "creating_confirm") {
    const patch: KfDraft = {};
    if (ex.domestic_tracking_no) patch.domestic_tracking_no = ex.domestic_tracking_no;
    if (ex.item_name) patch.item_name = ex.item_name;
    if (ex.quantity != null) patch.quantity = ex.quantity;
    if (ex.unit_price != null) patch.unit_price = ex.unit_price;
    const merged = await mergeDraft(ctx.externalUserid, patch, "creating_order", ctx.openKfid);
    await askNextMissing(ctx, merged);
    return;
  }

  const { verified } = await pickVerified(ctx.origin, ex);

  if (!verified.length && !ex.tracking_candidates.length) {
    await sendText(ctx.openKfid, ctx.externalUserid, T.noTrackingFound);
    return;
  }

  const usable = verified.length ? verified : ex.tracking_candidates.map((c) => c.value);

  // 正在等待某项查询：识别到唯一高可信单号直接查
  const queryStates = ["waiting_tracking_status", "waiting_order_billing", "waiting_order_eta"] as const;
  if ((queryStates as readonly string[]).includes(state) && usable.length === 1) {
    await runQuery(ctx, state, usable[0]);
    await clearState(ctx.externalUserid);
    return;
  }

  if (usable.length > 1) {
    await mergeDraft(ctx.externalUserid, { candidates: usable, pending_action: state }, state, ctx.openKfid);
    await sendMenu(
      ctx.openKfid,
      ctx.externalUserid,
      T.chooseTracking,
      usable.slice(0, 8).map((v, i) => ({ id: `no:${v}`, content: `${i + 1}. ${v}` })),
    );
    return;
  }

  const no = usable[0];
  if ((queryStates as readonly string[]).includes(state)) {
    await runQuery(ctx, state, no);
    await clearState(ctx.externalUserid);
    return;
  }

  // 无活动流程：给出操作菜单
  await mergeDraft(
    ctx.externalUserid,
    {
      pending_tracking_no: no,
      item_name: ex.item_name ?? null,
      quantity: ex.quantity ?? null,
      unit_price: ex.unit_price ?? null,
    },
    "idle",
    ctx.openKfid,
  );
  await sendMenu(ctx.openKfid, ctx.externalUserid, T.actionMenuHead(no), T.actionItems);
}

async function runQuery(ctx: Ctx, state: string, no: string) {
  if (state === "waiting_order_billing") return replyBilling(ctx, no);
  if (state === "waiting_order_eta") return replyEta(ctx, no);
  return replyTracking(ctx, no);
}

async function handleText(ctx: Ctx, contentRaw: string, menuId?: string | null) {
  const content = String(contentRaw ?? "").trim();
  const { state, draft } = await getState(ctx.externalUserid);
  const id = menuId ?? "";

  // 菜单：选择单号
  if (id.startsWith("no:") || (draft.candidates?.length && draft.candidates.includes(normalizeNo(content.replace(/^\d+\.\s*/, ""))))) {
    const no = id.startsWith("no:") ? id.slice(3) : normalizeNo(content.replace(/^\d+\.\s*/, ""));
    const action = draft.pending_action ?? "waiting_tracking_status";
    await runQuery(ctx, action, no);
    await clearState(ctx.externalUserid);
    return;
  }

  // 菜单：线路选择
  if (id.startsWith("route:")) {
    const merged = await mergeDraft(ctx.externalUserid, { route_code: id.slice(6) }, "creating_order", ctx.openKfid);
    await showConfirm(ctx, merged);
    return;
  }

  // 菜单：操作选择
  const no = draft.pending_tracking_no ?? null;
  if (id === "act_track" || content === "查询物流状态") {
    if (no) return replyTracking(ctx, no);
    return setState(ctx.externalUserid, "waiting_tracking_status", draft, ctx.openKfid);
  }
  if (id === "act_billing" || content === "查询运费及计费重量") {
    if (no) return replyBilling(ctx, no);
    return setState(ctx.externalUserid, "waiting_order_billing", draft, ctx.openKfid);
  }
  if (id === "act_eta" || content === "查询预计到达时间") {
    if (no) return replyEta(ctx, no);
    return setState(ctx.externalUserid, "waiting_order_eta", draft, ctx.openKfid);
  }
  if (id === "act_wrong" || content === "单号识别错误") {
    await clearState(ctx.externalUserid);
    return sendText(ctx.openKfid, ctx.externalUserid, T.noTrackingFound);
  }
  if (id === "act_create" || content === "使用该单号创建运单") {
    const nextDraft: KfDraft = { ...draft, domestic_tracking_no: no ?? draft.domestic_tracking_no ?? null };
    if (!(await ensureBound(ctx))) {
      await setState(ctx.externalUserid, "waiting_bind_code", nextDraft, ctx.openKfid);
      return sendText(ctx.openKfid, ctx.externalUserid, T.bindRequired);
    }
    await setState(ctx.externalUserid, "creating_order", nextDraft, ctx.openKfid);
    return askNextMissing(ctx, nextDraft);
  }

  // 确认菜单
  if (state === "creating_confirm") {
    if (id === "cfm_yes" || content === "确认创建") return doCreate(ctx, draft);
    if (id === "cfm_no" || content === "取消") {
      await clearState(ctx.externalUserid);
      return sendText(ctx.openKfid, ctx.externalUserid, T.cancelled);
    }
    if (id === "cfm_edit" || content === "修改信息") {
      const cleared = { ...draft, item_name: null, quantity: null, unit_price: null };
      await setState(ctx.externalUserid, "creating_order", cleared, ctx.openKfid);
      return askNextMissing(ctx, cleared);
    }
  }

  // 绑定码
  if (state === "waiting_bind_code") {
    const code = content.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length === 6) {
      const r = await api(ctx.origin, "/api/public/ai-bind-wechat", {
        code,
        external_userid: ctx.externalUserid,
      });
      if (r?.success || r?.bound) {
        await sendText(ctx.openKfid, ctx.externalUserid, T.bindSuccess);
        await setState(ctx.externalUserid, "creating_order", draft, ctx.openKfid);
        return askNextMissing(ctx, draft);
      }
      return sendText(ctx.openKfid, ctx.externalUserid, r?.message || T.bindInvalid);
    }
    return sendText(ctx.openKfid, ctx.externalUserid, T.bindRequired);
  }

  // 创建流程中的逐项补齐
  if (state === "creating_order") {
    const patch: KfDraft = {};
    if (!draft.domestic_tracking_no) patch.domestic_tracking_no = normalizeNo(content);
    else if (!draft.item_name) patch.item_name = content.slice(0, 30);
    else if (draft.quantity == null) patch.quantity = Number(content.replace(/[^\d]/g, "")) || null;
    else if (draft.unit_price == null) patch.unit_price = Number(content.replace(/[^\d.]/g, "")) || null;
    const merged = await mergeDraft(ctx.externalUserid, patch, "creating_order", ctx.openKfid);
    return askNextMissing(ctx, merged);
  }

  // 纯文本单号：直接查物流
  const candidate = normalizeNo(content);
  if (candidate.length >= 8) {
    const v = await verifyNo(ctx.origin, candidate);
    if (v.valid) return replyTracking(ctx, candidate);
  }

  await sendMenu(ctx.openKfid, ctx.externalUserid, "请选择需要办理的操作：", T.actionItems.slice(0, 4));
}

/** 回调事件 -> 拉取消息 -> 逐条处理（msgid 去重）
 *  allowUsers 非空时为测试模式：只处理名单内的 external_userid，其余留给 ADP。 */
export async function processCallback(
  plainXml: string,
  origin: string,
  allowUsers?: string[],
): Promise<number> {
  const { xmlValue } = await import("./crypto.server");
  const openKfid = xmlValue(plainXml, "OpenKfId") ?? xmlValue(plainXml, "OpenKfID") ?? "";
  const eventToken = xmlValue(plainXml, "Token");
  if (!openKfid) return 0;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { msgList } = await syncMsg({ eventToken, openKfid });
  let handled = 0;

  for (const msg of msgList) {
    const msgid = String(msg?.msgid ?? "");
    const externalUserid = String(msg?.external_userid ?? "");
    if (!msgid || !externalUserid) continue;
    if (String(msg?.origin) === "3") continue; // 客服/系统发出的消息不处理
    if (allowUsers?.length && !allowUsers.includes(externalUserid)) continue; // 测试模式：交给 ADP

    const { data: first } = await supabaseAdmin.rpc("wechat_kf_msg_claim", { _msgid: msgid });
    if (first === false) continue;


    const ctx: Ctx = { origin, openKfid, externalUserid };
    const startedAt = Date.now();
    try {
      if (msg.msgtype === "image" && msg.image?.media_id) {
        await handleImage(ctx, String(msg.image.media_id));
      } else if (msg.msgtype === "text") {
        await handleText(ctx, String(msg.text?.content ?? ""), msg.text?.menu_id ?? null);
      } else if (msg.msgtype === "msgmenu") {
        await handleText(ctx, String(msg.msgmenu?.content ?? ""), msg.msgmenu?.menu_id ?? null);
      }
      handled += 1;
      console.info(`[wechat-kf] handled type=${msg.msgtype} duration_ms=${Date.now() - startedAt}`);
    } catch (e) {
      console.error(`[wechat-kf] handle_failed type=${msg.msgtype} ${(e as Error)?.message ?? "unknown"}`);
    }
  }
  return handled;
}
