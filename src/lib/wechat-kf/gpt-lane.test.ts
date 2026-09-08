/**
 * 微信客服 GPT 全自然语言通道自动测试（bun test）。
 * 全程使用内存桩，不访问真实微信/OpenAI/数据库。
 */
import { describe, expect, mock, test, beforeEach } from "bun:test";

// ---------- 内存数据库桩 ----------
const dedup = new Set<string>();
const welcomeSent = new Set<string>();
const cursors = new Map<string, string>();
const locks = new Map<string, number>();
const sessions = new Map<string, any>();
/** 永久记录表的通用内存存储 */
export const store: Record<string, any[]> = {};
let seq = 0;

const sessionKey = (o: string, u: string) => `${o}|${u}`;

const rowsOf = (t: string) => (store[t] ??= []);

function tableApi(table: string) {
  const filters: Record<string, any> = {};
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;

  const matched = () => {
    let list = rowsOf(table).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    if (orderCol) {
      list = list
        .slice()
        .sort((a, b) => String(a[orderCol!] ?? "").localeCompare(String(b[orderCol!] ?? "")) * (orderAsc ? 1 : -1));
    }
    if (limitN != null) list = list.slice(0, limitN);
    return list;
  };

  const api: any = {
    select: () => api,
    eq: (col: string, val: any) => {
      filters[col] = val;
      return api;
    },
    in: () => api,
    order: (col: string, opts?: any) => {
      orderCol = col;
      orderAsc = opts?.ascending !== false;
      return api;
    },
    limit: (n: number) => {
      limitN = n;
      return api;
    },
    then: (resolve: any) => resolve({ data: matched(), error: null }),
    maybeSingle: async () => {
      if (table === "wechat_kf_cursor")
        return { data: cursors.has("kfid") ? { cursor: cursors.get("kfid") } : null, error: null };
      if (table === "wechat_gpt_session") {
        const k = sessionKey(filters["open_kfid"] ?? "", filters["external_userid"] ?? "");
        return { data: sessions.get(k) ?? null, error: null };
      }
      return { data: matched()[0] ?? null, error: null };
    },
    insert: (row: any) => {
      const list = Array.isArray(row) ? row : [row];
      const created = list.map((r) => ({ id: `id-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...r }));
      rowsOf(table).push(...created);
      const ins: any = {
        select: () => ins,
        maybeSingle: async () => ({ data: created[0], error: null }),
        then: (resolve: any) => resolve({ data: created, error: null }),
      };
      return ins;
    },
    update: (patch: any) => {
      const upd: any = {
        eq: (col: string, val: any) => {
          for (const r of rowsOf(table)) if (r[col] === val) Object.assign(r, patch);
          return upd;
        },
        select: () => upd,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
      return upd;
    },
    upsert: async (rows: any) => {
      if (table === "wechat_kf_cursor") cursors.set("kfid", rows.cursor);
      if (table === "wechat_kf_msg_dedup") for (const r of rows) dedup.add(r.msgid);
      if (table === "wechat_gpt_session") {
        const k = sessionKey(rows.open_kfid, rows.external_userid);
        sessions.set(k, { ...(sessions.get(k) ?? {}), ...rows });
      }
      return { data: null, error: null };
    },
  };
  return api;
}


const db = {
  rpc: async (fn: string, args: any) => {
    if (fn === "wechat_kf_msg_claim") {
      if (dedup.has(args._msgid)) return { data: false, error: null };
      dedup.add(args._msgid);
      return { data: true, error: null };
    }
    if (fn === "wechat_gpt_claim_welcome") {
      const key = `${args._open_kfid}|${args._external_userid}`;
      if (welcomeSent.has(key)) return { data: false, error: null };
      welcomeSent.add(key);
      return { data: true, error: null };
    }
    if (fn === "wechat_kf_try_lock") {
      const until = locks.get(args._open_kfid) ?? 0;
      if (until > Date.now()) return { data: false, error: null };
      locks.set(args._open_kfid, Date.now() + (args._ttl_seconds ?? 60) * 1000);
      return { data: true, error: null };
    }
    if (fn === "wechat_kf_release_lock") {
      locks.delete(args._open_kfid);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  },
  from: (table: string) => tableApi(table),
};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));

// ---------- 身份解析桩 ----------
let bound = false;
mock.module("@/lib/wechat-identity.server", () => ({
  resolveWechatCustomer: async () =>
    bound
      ? {
          found: true,
          result_code: "customer_resolved",
          customer_display_name: "张*",
          user_id: "u1",
          customer_code: "00012",
        }
      : { found: false, result_code: "customer_not_bound", customer_display_name: null, message: "未绑定" },
  maskName: (s: string) => s,
}));

// ---------- 微信 API 桩 ----------
const sent: Array<{ kind: string; content: string }> = [];
let syncCalls = 0;
let syncPayload: any[] = [];

mock.module("@/lib/wechat-kf/api.server", () => ({
  getAccessToken: async () => "token",
  kfApiCall: async (path: string) => {
    if (path === "/kf/sync_msg") {
      syncCalls += 1;
      return { errcode: 0, next_cursor: "cursor-1", has_more: 0, msg_list: syncPayload };
    }
    return { errcode: 0 };
  },
  sendText: async (_k: string, _u: string, content: string) => {
    sent.push({ kind: "text", content });
    return { errcode: 0 };
  },
  sendMenu: async (_k: string, _u: string, head: string) => {
    sent.push({ kind: "menu", content: head });
    return { errcode: 0 };
  },
}));

// ---------- OpenAI 桩 ----------
let oaiConfigured = true;
let oaiQueue: any[] = [];
let oaiCalls = 0;
const oaiInputs: any[] = [];

const gptText = (text: string) => ({
  status: 200,
  ms: 100,
  body: { output: [{ type: "message", content: [{ type: "output_text", text }] }] },
});
const gptCall = (name: string, args: any) => ({
  status: 200,
  ms: 100,
  body: {
    output: [{ type: "function_call", call_id: `c${Math.random()}`, name, arguments: JSON.stringify(args) }],
  },
});
const gptFail = (err: string) => ({ status: null, body: null, ms: 50, err });

mock.module("@/lib/openai.server", () => ({
  OPENAI_DEFAULT_MODEL: "gpt-5.6-luna",
  openAiConfigured: () => oaiConfigured,
  callOpenAiRaw: async (payload: any) => {
    oaiCalls += 1;
    oaiInputs.push(payload.input);
    return oaiQueue.shift() ?? gptText("默认回复");
  },
}));

// ---------- 业务接口桩（同源 fetch） ----------
const apiCalls: string[] = [];
let apiResponses: Record<string, any> = {};
const stubFetch = (async (url: any, init?: any) => {
  const path = new URL(String(url)).pathname;
  apiCalls.push(path);
  const body = init?.body ? JSON.parse(init.body) : {};
  const handler = apiResponses[path];
  const data = typeof handler === "function" ? handler(body) : (handler ?? { found: false });
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
globalThis.fetch = stubFetch;

const { processGptCallback } = await import("./gpt-lane.server");
const { runAgent } = await import("./agent.server");

const xml = "<xml><Event>kf_msg_or_event</Event><OpenKfId>kfid</OpenKfId><Token>tk</Token></xml>";

function customerMsg(msgid: string, content: string, sendTime: number) {
  return {
    msgid,
    open_kfid: "kfid",
    external_userid: "user-1",
    origin: 3,
    send_time: sendTime,
    msgtype: "text",
    text: { content },
  };
}

const agent = (text: string) => runAgent({ text, openKfid: "kfid", externalUserid: "user-1", baseUrl: "http://x" });

function reset() {
  dedup.clear();
  welcomeSent.clear();
  cursors.clear();
  locks.clear();
  sessions.clear();
  sent.length = 0;
  syncCalls = 0;
  oaiCalls = 0;
  oaiQueue = [];
  oaiInputs.length = 0;
  apiCalls.length = 0;
  apiResponses = {};
  syncPayload = [];
  for (const k of Object.keys(store)) delete store[k];
  oaiConfigured = true;
  bound = false;
  globalThis.fetch = stubFetch;
}

beforeEach(reset);

// ================================================================ 通道层

describe("wxkf-gpt 通道", () => {
  test("bootstrap：10 条历史 + 1 条最新“您好” → 只回 1 次欢迎语，不调用 GPT", async () => {
    syncPayload = [
      ...Array.from({ length: 10 }, (_, i) => customerMsg(`old-${i}`, `历史消息${i}`, 1000 + i)),
      customerMsg("new-1", "您好", 2000),
    ];
    await processGptCallback(xml, "http://x");
    expect(sent.length).toBe(1);
    expect(sent[0]!.content).toContain("EPLUS AI客服");
    expect(oaiCalls).toBe(0);
  });

  test("同一回调并发 5 次：只执行 1 次 sync_msg，只回复 1 次", async () => {
    syncPayload = [customerMsg("new-1", "您好", 2000)];
    await Promise.all(Array.from({ length: 5 }, () => processGptCallback(xml, "http://x")));
    expect(syncCalls).toBe(1);
    expect(sent.length).toBe(1);
  });

  test("重复 msgid：不重复调用 GPT 或工具", async () => {
    cursors.set("kfid", "cursor-0");
    welcomeSent.add("kfid|user-1");
    oaiQueue = [gptText("好的")];
    syncPayload = [customerMsg("dup-1", "运费怎么算", 3000)];
    await processGptCallback(xml, "http://x");
    await processGptCallback(xml, "http://x");
    expect(oaiCalls).toBe(1);
    expect(sent.length).toBe(1);
  });

  test("客服自身消息（origin!=3）不回复", async () => {
    cursors.set("kfid", "cursor-0");
    syncPayload = [{ ...customerMsg("s-1", "客服消息", 5000), origin: 5 }];
    await processGptCallback(xml, "http://x");
    expect(sent.length).toBe(0);
    expect(oaiCalls).toBe(0);
  });
});

// ================================================================ 代理层

describe("wxkf-gpt 代理", () => {
  test("自然语言查询物流状态 → query_tracking_status", async () => {
    apiResponses["/api/public/ai-track"] = {
      found: true,
      status_code: "in_progress",
      status_text: "运输中",
      tracking_text: "当前状态：运输中",
    };
    oaiQueue = [gptCall("query_tracking_status", { tracking_number: "FW09013" }), gptText("您的包裹正在运输中。")];
    const r = await agent("帮我查一下FW09013到哪了");
    expect(apiCalls).toContain("/api/public/ai-track");
    expect(r.reply).toContain("运输中");
    expect(r.via).toBe("gpt_tool");
  });

  test("pending_intake 自动继续查询到仓扫描", async () => {
    apiResponses["/api/public/ai-track"] = { found: true, status_code: "pending_intake", tracking_text: "待入库" };
    apiResponses["/api/public/ai-warehouse-scan"] = {
      found: true,
      result_code: "pending_second_scan",
      scan_text: "已到仓，等待二次扫描",
    };
    oaiQueue = [gptCall("query_tracking_status", { tracking_number: "7734001" }), gptText("已到仓，等待二次扫描。")];
    await agent("7734001 到仓了吗");
    expect(apiCalls).toContain("/api/public/ai-warehouse-scan");
  });

  test("track not_found 但扫描 found", async () => {
    apiResponses["/api/public/ai-track"] = { found: false, status_code: "not_found" };
    apiResponses["/api/public/ai-warehouse-scan"] = {
      found: true,
      result_code: "needs_order_entry",
      needs_order_entry: true,
      scan_text: "已扫描但未录单",
    };
    oaiQueue = [gptCall("query_tracking_status", { tracking_number: "7734002" }), gptText("包裹已到仓，请先录单。")];
    const r = await agent("7734002");
    expect(r.reply).toContain("录单");
  });

  test("单独发送单号：GPT 可以追问用途", async () => {
    oaiQueue = [gptText("请问您是想查询这个单的物流状态，还是运费？")];
    const r = await agent("7734003");
    expect(r.via).toBe("gpt");
    expect(r.reply).toContain("物流状态");
  });

  test("使用 last_tracking_number 追问运费 / 重量 / ETA", async () => {
    sessions.set("kfid|user-1", { last_tracking_number: "FW0901", create_order_draft: {} });
    apiResponses["/api/public/ai-order-billing"] = {
      found: true,
      result_code: "billing_found",
      billing_text: "计费重量 12kg，运费 96 加元",
      estimated_arrival_text: "预计 9-15 天到达",
    };
    oaiQueue = [gptCall("query_order_billing", {}), gptText("计费重量 12kg，运费 96 加元，预计 9-15 天到达。")];
    const r = await agent("运费呢，什么时候到");
    expect(apiCalls).toContain("/api/public/ai-order-billing");
    expect(r.reply).toContain("96");
    expect(sessions.get("kfid|user-1").last_tracking_number).toBe("FW0901");
  });

  test("未绑定客户索要绑定码", async () => {
    bound = false;
    oaiQueue = [gptCall("resolve_or_bind_customer", { bind_code: null }), gptText("请先在网站生成 6 位绑定码并发给我。")];
    const r = await agent("帮我录单");
    expect(r.reply).toContain("绑定码");
  });

  test("创建运单：逐项收集 + 一次多字段提取，只追问线路", async () => {
    bound = true;
    apiResponses["/api/public/ai-forwarding-options"] = {
      found: true,
      routes: [{ route_id: "r1", route_code: "TH", route_name: "义乌海运普货" }],
      options_text: "1. 义乌海运普货",
      default_address_found: true,
    };
    oaiQueue = [gptCall("get_forwarding_options", {}), gptText("请选择线路：1. 义乌海运普货")];
    const r = await agent("衣服2件，100元，国内单号7734004");
    expect(apiCalls).toContain("/api/public/ai-forwarding-options");
    expect(r.reply).toContain("义乌海运普货");
  });

  test("创建前必须确认：confirm=false 返回确认话术", async () => {
    bound = true;
    apiResponses["/api/public/ai-create-forwarding-order"] = (b: any) => ({
      success: true,
      result_code: b.confirm ? "order_created" : "validation_passed",
      created: b.confirm,
      confirmation_text: b.confirm ? null : "请确认以下录单资料…",
      created_text: b.confirm ? "录单成功！集运单号：FW123" : null,
    });
    oaiQueue = [
      gptCall("create_forwarding_order", {
        route_id: "r1",
        domestic_tracking_no: "7734004",
        item_name: "衣服",
        quantity: 2,
        unit_price: 100,
        confirm: false,
        idempotency_key: null,
      }),
      gptText("请确认以下录单资料…确认无误请回复「确认创建」。"),
    ];
    const r = await agent("就用海普");
    expect(r.reply).toContain("确认创建");
    expect(sessions.get("kfid|user-1").create_order_draft.awaiting_confirmation).toBe(true);
    expect(sessions.get("kfid|user-1").pending_action).toBe("awaiting_confirmation");
  });

  test("明确确认后 confirm=true 创建成功", async () => {
    bound = true;
    apiResponses["/api/public/ai-create-forwarding-order"] = () => ({
      success: true,
      result_code: "order_created",
      created: true,
      created_text: "录单成功！集运单号：FW123",
    });
    oaiQueue = [
      gptCall("create_forwarding_order", {
        route_id: "r1",
        domestic_tracking_no: "7734004",
        item_name: "衣服",
        quantity: 2,
        unit_price: 100,
        confirm: true,
        idempotency_key: "k1",
      }),
      gptText("录单成功！集运单号：FW123"),
    ];
    const r = await agent("确认创建");
    expect(r.reply).toContain("FW123");
    expect(sessions.get("kfid|user-1").pending_action).toBe(null);
  });

  test("GPT 失败但有明确单号 → 直接调用真实工具降级", async () => {
    oaiQueue = [gptFail("timeout")];
    apiResponses["/api/public/ai-track"] = {
      found: true,
      status_code: "in_progress",
      tracking_text: "当前状态：已到达加拿大仓库",
    };
    const r = await agent("FW09013 到哪了");
    expect(r.via).toBe("fallback_tool");
    expect(r.reply).toContain("已到达加拿大仓库");
  });

  test("GPT 失败且无单号 → 只回一次繁忙提示", async () => {
    oaiQueue = [gptFail("network_error")];
    const r = await agent("你们公司地址在哪");
    expect(r.via).toBe("busy");
  });

  test("业务工具不可用 → 只回一次固定提示", async () => {
    apiResponses["/api/public/ai-order-billing"] = null;
    oaiQueue = [gptCall("query_order_billing", { tracking_number: "FW1" })];
    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const r = await agent("FW1 运费多少");
    expect(r.reply).toBe("查询服务暂时不可用，请稍后重试或联系人工客服。");
  });

  test("转人工", async () => {
    globalThis.fetch = (async (url: any, init?: any) => {
      const path = new URL(String(url)).pathname;
      apiCalls.push(path);
      void init;
      return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    oaiQueue = [gptCall("transfer_to_human", { reason: "customer_request" })];
    const r = await agent("转人工");
    expect(r.via).toBe("transfer");
    expect(r.reply).toContain("人工客服");
  });
});

// ================================================================ 绑定码优先处理

describe("wxkf-gpt 绑定码优先处理", () => {
  const waiting = (draft: any = {}) =>
    sessions.set("kfid|user-1", {
      pending_action: "awaiting_bind_code",
      current_intent: "bind_customer",
      create_order_draft: draft,
    });

  test("等待绑定码 + “123456” → 只调用绑定接口，0 次物流查询", async () => {
    waiting();
    apiResponses["/api/public/ai-bind-wechat"] = { success: true, result_code: "bound" };
    const r = await agent("123456");
    expect(apiCalls).toEqual(["/api/public/ai-bind-wechat"]);
    expect(apiCalls).not.toContain("/api/public/ai-track");
    expect(apiCalls).not.toContain("/api/public/ai-order-billing");
    expect(r.reply.length).toBeGreaterThan(0);
  });

  test("等待绑定码 + “我的绑定码是 123456” → 正确绑定并恢复草稿", async () => {
    waiting({ domestic_tracking_no: "7734004", item_name: "衣服", quantity: 2, unit_price: 100 });
    apiResponses["/api/public/ai-bind-wechat"] = { success: true, result_code: "bound" };
    oaiQueue = [gptText("绑定成功，请选择线路。")];
    const r = await agent("我的绑定码是 123456");
    expect(apiCalls).toContain("/api/public/ai-bind-wechat");
    expect(apiCalls).not.toContain("/api/public/ai-track");
    expect(r.reply).toContain("线路");
    const s = sessions.get("kfid|user-1");
    expect(s.pending_action).toBe(null);
    expect(s.create_order_draft.domestic_tracking_no).toBe("7734004");
    expect(s.create_order_draft.item_name).toBe("衣服");
  });

  test("绑定码错误 → 保持等待状态", async () => {
    waiting();
    apiResponses["/api/public/ai-bind-wechat"] = { success: false, result_code: "invalid_bind_code" };
    const r = await agent("654321");
    expect(r.reply).toBe("绑定码无效，请核对后重新发送；绑定码为6位数字。");
    expect(sessions.get("kfid|user-1").pending_action).toBe("awaiting_bind_code");
  });

  test("绑定码过期 → 保持等待状态", async () => {
    waiting();
    apiResponses["/api/public/ai-bind-wechat"] = { success: false, result_code: "expired_bind_code" };
    const r = await agent("654321");
    expect(r.reply).toBe("绑定码已过期，请登录系统重新生成绑定码后发送。");
    expect(sessions.get("kfid|user-1").pending_action).toBe("awaiting_bind_code");
  });

  test("非绑定状态发送 6 位数字 → 不自动绑定，交给 GPT", async () => {
    oaiQueue = [gptText("请问这是绑定码还是运单号？")];
    const r = await agent("123456");
    expect(apiCalls).not.toContain("/api/public/ai-bind-wechat");
    expect(r.reply).toContain("绑定码还是运单号");
  });

  test("“取消” → 清除等待状态和草稿", async () => {
    waiting({ domestic_tracking_no: "7734004" });
    const r = await agent("取消");
    expect(apiCalls.length).toBe(0);
    expect(r.reply).toContain("已取消");
    const s = sessions.get("kfid|user-1");
    expect(s.pending_action).toBe(null);
    expect(s.create_order_draft).toEqual({});
  });

  test("重复 msgid：绑定接口只调用一次", async () => {
    cursors.set("kfid", "cursor-0");
    welcomeSent.add("kfid|user-1");
    waiting();
    apiResponses["/api/public/ai-bind-wechat"] = { success: true, result_code: "bound" };
    syncPayload = [customerMsg("bind-1", "123456", 4000)];
    await processGptCallback(xml, "http://x");
    await processGptCallback(xml, "http://x");
    expect(apiCalls.filter((p) => p === "/api/public/ai-bind-wechat").length).toBe(1);
  });
});

// ================================================================ 永久记录层

describe("wxkf-gpt 永久记录", () => {
  test("一次对话：会话、客户消息、AI 回复、运行记录全部落库", async () => {
    cursors.set("kfid", "cursor-0");
    welcomeSent.add("kfid|user-1");
    oaiQueue = [gptText("好的，请提供单号")];
    syncPayload = [customerMsg("rec-1", "帮我查一下我的包裹", 6000)];
    await processGptCallback(xml, "http://x");

    expect((store["wechat_ai_conversations"] ?? []).length).toBe(1);
    const msgs = store["wechat_ai_messages"] ?? [];
    expect(msgs.filter((m) => m.direction === "in").length).toBe(1);
    expect(msgs.filter((m) => m.direction === "out").length).toBe(1);
    expect(msgs[0]!.text_content).toBe("帮我查一下我的包裹");
    expect((store["wechat_ai_agent_runs"] ?? []).length).toBe(1);
  });

  test("工具调用写入 wechat_ai_tool_runs（入参脱敏）", async () => {
    cursors.set("kfid", "cursor-0");
    welcomeSent.add("kfid|user-1");
    bound = true;
    apiResponses["/api/public/ai-track"] = { found: true, tracking_text: "已到仓" };
    oaiQueue = [gptCall("query_tracking_status", { tracking_number: "SF123456" }), gptText("已到仓")];
    syncPayload = [customerMsg("rec-2", "查 SF123456", 7000)];
    await processGptCallback(xml, "http://x");

    const runs = store["wechat_ai_tool_runs"] ?? [];
    expect(runs.length).toBe(1);
    expect(runs[0]!.tool_name).toBe("query_tracking_status");
    expect(JSON.stringify(runs[0]!.request_summary)).not.toContain("bind_code\":\"");
  });

  test("第二轮对话会带上历史上下文", async () => {
    cursors.set("kfid", "cursor-0");
    welcomeSent.add("kfid|user-1");
    oaiQueue = [gptText("第一轮回复"), gptText("第二轮回复")];
    syncPayload = [customerMsg("h-1", "第一句话", 8000)];
    await processGptCallback(xml, "http://x");
    syncPayload = [customerMsg("h-2", "第二句话", 8100)];
    await processGptCallback(xml, "http://x");

    const secondInput = JSON.stringify(oaiInputs[oaiInputs.length - 1]);
    expect(secondInput).toContain("第一句话");
    expect(secondInput).toContain("第二句话");
  });
});

// ================================================================ 状态污染与职责边界

const gptJson = (reply: string, statePatch: any = {}) =>
  gptText(JSON.stringify({ reply, state_patch: statePatch, tool_call: null }));

function seedConversation(id = "conv-1") {
  rowsOf("wechat_ai_conversations").push({
    id,
    open_kfid: "kfid",
    external_userid: "user-1",
    customer_code: null,
    current_intent: null,
    pending_action: null,
    awaiting_field: null,
    last_tracking_number: null,
  });
  return id;
}
const conv = (id = "conv-1") => (store["wechat_ai_conversations"] ?? []).find((r) => r.id === id);
const agentIn = (text: string, conversationId: string) =>
  runAgent({ text, openKfid: "kfid", externalUserid: "user-1", baseUrl: "http://x", conversationId });

describe("wxkf-gpt 状态污染与职责边界", () => {
  const staleCreateIntent = (draft: any = {}) =>
    sessions.set("kfid|user-1", {
      open_kfid: "kfid",
      external_userid: "user-1",
      current_intent: "create_forwarding_order",
      pending_action: null,
      last_tracking_number: null,
      create_order_draft: draft,
    });

  test("旧创建意图 + “您好” → GPT 可切换为普通问候并清除旧临时状态", async () => {
    staleCreateIntent();
    oaiQueue = [gptJson("您好，请问需要查询运单还是创建运单？", { current_intent: null, pending_action: null, awaiting_field: null })];
    const r = await agent("您好");
    expect(r.reply).toContain("您好");
    const s = sessions.get("kfid|user-1");
    expect(s.current_intent).toBe(null);
    expect(s.pending_action).toBe(null);
  });

  test("即使 GPT 未清状态，无草稿的创建意图也不会被服务端保留", async () => {
    staleCreateIntent();
    oaiQueue = [gptText("您好，有什么可以帮您？")];
    await agent("您好");
    expect(sessions.get("kfid|user-1").current_intent).toBe(null);
  });

  test("普通问候不会调用 get_forwarding_options 或创建工具", async () => {
    staleCreateIntent();
    oaiQueue = [gptJson("您好！")];
    await agent("您好");
    expect(apiCalls).toEqual([]);
  });

  test("明确说“帮我创建运单” → 仍可正常进入创建流程", async () => {
    bound = true;
    apiResponses["/api/public/ai-forwarding-options"] = { success: true, routes: [{ route_id: "r1", route_name: "TH海普" }] };
    oaiQueue = [gptCall("get_forwarding_options", {}), gptJson("请提供国内快递单号。", { current_intent: "create_forwarding_order" })];
    await agent("帮我创建运单");
    expect(apiCalls).toContain("/api/public/ai-forwarding-options");
    expect(sessions.get("kfid|user-1").current_intent).toBe("create_forwarding_order");
  });

  test("绑定码不会写入 last_tracking_number", async () => {
    oaiQueue = [gptJson("请问这是绑定码还是运单号？", { last_tracking_number: "E26SX7", current_intent: "bind_customer" })];
    await agent("客户好 E26SX7");
    expect(sessions.get("kfid|user-1").last_tracking_number).toBe(null);
  });

  test("customer_resolved 后会话记录写入服务端 customer_code", async () => {
    bound = true;
    const id = seedConversation();
    oaiQueue = [gptCall("resolve_or_bind_customer", {}), gptJson("已确认您的账号。")];
    await agentIn("我是谁", id);
    expect(conv(id).customer_code).toBe("00012");
  });

  test("GPT 不能覆盖服务端确认的客户身份", async () => {
    bound = true;
    const id = seedConversation();
    oaiQueue = [gptJson("好的", { customer_code: "99999", customer_bound: false })];
    await agentIn("你好", id);
    expect(conv(id).customer_code).toBe("00012");
  });

  test("普通问候后再次查询物流 → 意图正确切换", async () => {
    staleCreateIntent();
    oaiQueue = [gptJson("您好！", { current_intent: null })];
    await agent("您好");
    apiResponses["/api/public/ai-track"] = { found: true, tracking_text: "已到仓" };
    oaiQueue = [gptCall("query_tracking_status", { tracking_number: "SF12345678" }), gptJson("已到仓")];
    await agent("帮我查 SF12345678");
    const s = sessions.get("kfid|user-1");
    expect(s.current_intent).toBe("query_tracking_status");
    expect(s.last_tracking_number).toBe("SF12345678");
  });

  test("清除污染状态时保留永久消息与运行记录", async () => {
    cursors.set("kfid", "cursor-0");
    welcomeSent.add("kfid|user-1");
    oaiQueue = [gptJson("好的，请提供单号", { current_intent: "create_forwarding_order" })];
    syncPayload = [customerMsg("p-1", "我要创建运单", 9000)];
    await processGptCallback(xml, "http://x");
    const msgsAfterFirst = (store["wechat_ai_messages"] ?? []).length;

    oaiQueue = [gptJson("您好！", { current_intent: null, pending_action: null })];
    syncPayload = [customerMsg("p-2", "您好", 9100)];
    await processGptCallback(xml, "http://x");

    expect((store["wechat_ai_messages"] ?? []).length).toBeGreaterThan(msgsAfterFirst);
    expect((store["wechat_ai_agent_runs"] ?? []).length).toBe(2);
    expect(sessions.get("kfid|user-1").current_intent).toBe(null);
  });
});
