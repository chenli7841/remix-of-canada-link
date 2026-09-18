import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getWechatConversation,
  getAiSupportThread,
  listAiSupportThreads,
  listWechatAiAudit,
  listWechatBindings,
  listWechatConversations,
  updateWechatBinding,
} from "@/lib/wechat-ai-records.functions";
import { Pagination } from "@/components/admin/Pagination";
import { Bot, Loader2, MessageSquare, Link2, ShieldCheck, Bell } from "lucide-react";

export const Route = createFileRoute("/admin/wechat-ai-records")({
  head: () => ({
    meta: [{ title: "AI 客服记录 — SinoCargo Admin" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: WechatAiRecordsPage,
});

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString("zh-CN") : "-");

type Tab = "support" | "conversations" | "bindings" | "audit";

function WechatAiRecordsPage() {
  const [tab, setTab] = useState<Tab>("support");

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">AI 客服记录</h1>
      </div>

      <div className="mb-4 flex gap-2">
        {(
          [
            ["support", "GPT / 站内留言", Bell],
            ["conversations", "历史微信会话", MessageSquare],
            ["bindings", "微信客户绑定", Link2],
            ["audit", "管理操作审计", ShieldCheck],
          ] as Array<[Tab, string, any]>
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
              tab === key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "support" && <SupportMessagesTab />}
      {tab === "conversations" && <ConversationsTab />}
      {tab === "bindings" && <BindingsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function SupportMessagesTab() {
  const fetchThreads = useServerFn(listAiSupportThreads);
  const fetchThread = useServerFn(getAiSupportThread);
  const [qIn, setQIn] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const threadsQ = useQuery({
    queryKey: ["ai-support-threads", q],
    queryFn: () => fetchThreads({ data: { q: q || undefined, limit: 100 } }),
    refetchInterval: 15_000,
  });
  const detailQ = useQuery({
    queryKey: ["ai-support-thread", openId],
    queryFn: () => fetchThread({ data: { id: openId! } }),
    enabled: Boolean(openId),
    refetchInterval: openId ? 10_000 : false,
  });
  const threads = (threadsQ.data ?? []) as any[];
  const unread = threads.reduce((sum, thread) => sum + Number(thread.unread_for_staff ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <input value={qIn} onChange={(e) => setQIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQ(qIn)} placeholder="搜索客户号" className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm" />
          <button onClick={() => setQ(qIn)} className="rounded-md border border-border px-3 py-1.5 text-sm">搜索</button>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${unread ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
          <Bell className="h-4 w-4" />{unread ? `${unread} 条新消息` : "暂无新消息"}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="max-h-[650px] overflow-y-auto rounded-lg border border-border">
          {threadsQ.isLoading && <Loader2 className="m-6 h-4 w-4 animate-spin" />}
          {threads.map((thread) => (
            <button key={thread.id} onClick={() => setOpenId(thread.id)} className={`block w-full border-b border-border p-3 text-left last:border-b-0 ${openId === thread.id ? "bg-primary/10" : "hover:bg-muted/50"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">客户 {thread.customer_code}</span>
                {thread.unread_for_staff > 0 && <span className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">{thread.unread_for_staff}</span>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">最近消息：{fmt(thread.last_message_at)}</div>
            </button>
          ))}
          {!threadsQ.isLoading && !threads.length && <div className="p-8 text-center text-sm text-muted-foreground">暂无 GPT / 站内留言</div>}
        </div>

        <div className="min-h-72 rounded-lg border border-border p-4">
          {!openId && <div className="grid h-64 place-items-center text-sm text-muted-foreground">选择一个客户查看留言</div>}
          {detailQ.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {detailQ.data && (
            <>
              <div className="mb-3 border-b border-border pb-3 font-semibold">客户 {detailQ.data.thread?.customer_code}</div>
              <div className="max-h-[560px] space-y-3 overflow-y-auto">
                {((detailQ.data.messages ?? []) as any[]).map((message) => (
                  <div key={message.id} className={message.sender_role === "customer" ? "pr-10" : "pl-10"}>
                    <div className="mb-1 text-xs text-muted-foreground">{message.sender_role === "customer" ? "客户" : "EPLUS 客服"} · {message.source} · {fmt(message.created_at)}</div>
                    <div className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm">{message.body}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">这里按 EPLUS OAuth 客户账号分组，只保存通过 EPLUS 工具或站内系统产生的留言，不会复制客户私人 ChatGPT 对话。</p>
    </div>
  );
}

function ConversationsTab() {
  const fetchList = useServerFn(listWechatConversations);
  const fetchDetail = useServerFn(getWechatConversation);
  const [page, setPage] = useState(1);
  const [qIn, setQIn] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const pageSize = 20;

  const listQ = useQuery({
    queryKey: ["wxai-convs", { page, q }],
    queryFn: () => fetchList({ data: { page, pageSize, q: q || undefined } }),
  });
  const detailQ = useQuery({
    queryKey: ["wxai-conv", openId],
    queryFn: () => fetchDetail({ data: { id: openId! } }),
    enabled: Boolean(openId),
  });

  const items = listQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={qIn}
          onChange={(e) => setQIn(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (setQ(qIn), setPage(1))}
          placeholder="客户号 / 微信身份 / 单号"
          className="w-72 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => {
            setQ(qIn);
            setPage(1);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          搜索
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-2">最近消息</th>
              <th className="p-2">客户号</th>
              <th className="p-2">微信身份</th>
              <th className="p-2">当前意图</th>
              <th className="p-2">待办</th>
              <th className="p-2">最近单号</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={7} className="p-6 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {items.map((c: any) => (
              <tr key={c.id} className="border-t border-border">
                <td className="p-2">{fmt(c.last_message_at)}</td>
                <td className="p-2">{c.customer_code ?? "未绑定"}</td>
                <td className="p-2 font-mono text-xs">{c.external_userid_masked}</td>
                <td className="p-2">{c.current_intent ?? "-"}</td>
                <td className="p-2">{c.awaiting_field ?? c.pending_action ?? "-"}</td>
                <td className="p-2 font-mono text-xs">{c.last_tracking_number ?? "-"}</td>
                <td className="p-2 text-right">
                  <button
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  >
                    {openId === c.id ? "收起" : "查看"}
                  </button>
                </td>
              </tr>
            ))}
            {!listQ.isLoading && !items.length && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={listQ.data?.total ?? 0} onChange={setPage} />

      {openId && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          {detailQ.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {detailQ.data && (
            <>
              <Section title="对话记录">
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {(detailQ.data.messages as any[]).map((m) => (
                    <div key={m.id} className={m.direction === "in" ? "" : "pl-8"}>
                      <div className="text-xs text-muted-foreground">
                        {m.direction === "in" ? "客户" : "AI"} · {fmt(m.created_at)} · {m.message_type}
                        {m.processing_status ? ` · ${m.processing_status}` : ""}
                      </div>
                      <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-2">
                        {m.text_content ?? (m.ocr_text ? `[图片识别] ${m.ocr_text}` : "[无文本]")}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="GPT 运行记录">
                <MiniTable
                  head={["时间", "意图", "工具", "OpenAI", "耗时", "结果"]}
                  rows={(detailQ.data.runs as any[]).map((r) => [
                    fmt(r.created_at),
                    r.intent ?? "-",
                    r.tool_requested ?? "-",
                    `${r.openai_status ?? "-"}${r.error_code ? ` / ${r.error_code}` : ""}`,
                    `${r.total_duration_ms ?? "-"}ms`,
                    r.result_status ?? "-",
                  ])}
                />
              </Section>

              <Section title="工具调用记录">
                <MiniTable
                  head={["时间", "工具", "成功", "结果码", "耗时", "入参摘要"]}
                  rows={(detailQ.data.tools as any[]).map((t) => [
                    fmt(t.created_at),
                    t.tool_name,
                    t.success ? "是" : "否",
                    t.result_code ?? "-",
                    `${t.duration_ms ?? "-"}ms`,
                    JSON.stringify(t.request_summary ?? {}),
                  ])}
                />
              </Section>

              <Section title="录单草稿">
                <MiniTable
                  head={["创建时间", "状态", "客户号", "运单号", "草稿内容"]}
                  rows={(detailQ.data.drafts as any[]).map((d) => [
                    fmt(d.created_at),
                    d.draft_status,
                    d.customer_code ?? "-",
                    d.created_fw_tracking_no ?? "-",
                    JSON.stringify(d.draft_data ?? {}),
                  ])}
                />
              </Section>

              <Section title="草稿字段变更历史">
                <MiniTable
                  head={["时间", "变更字段"]}
                  rows={(detailQ.data.draftEvents as any[]).map((e) => [
                    fmt(e.created_at),
                    JSON.stringify(e.changed_fields ?? {}),
                  ])}
                />
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BindingsTab() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listWechatBindings);
  const update = useServerFn(updateWechatBinding);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qIn, setQIn] = useState("");
  const pageSize = 20;

  const listQ = useQuery({
    queryKey: ["wxai-bindings", { page, q }],
    queryFn: () => fetchList({ data: { page, pageSize, q: q || undefined } }),
  });

  const mut = useMutation({
    mutationFn: (v: { id: string; action: "disable" | "enable" | "unbind" | "rebind"; customer_code?: string; reason: string }) =>
      update({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wxai-bindings"] }),
  });

  const act = (id: string, action: "disable" | "enable" | "unbind" | "rebind") => {
    const reason = window.prompt("请填写操作原因（会写入审计记录）");
    if (!reason?.trim()) return;
    let customer_code: string | undefined;
    if (action === "rebind") {
      customer_code = window.prompt("请输入新的客户号") ?? undefined;
      if (!customer_code?.trim()) return;
    }
    mut.mutate({ id, action, customer_code, reason });
  };

  const items = listQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={qIn}
          onChange={(e) => setQIn(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (setQ(qIn), setPage(1))}
          placeholder="客户号 / 微信身份 / 群ID"
          className="w-72 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button onClick={() => (setQ(qIn), setPage(1))} className="rounded-md border border-border px-3 py-1.5 text-sm">
          搜索
        </button>
      </div>

      {mut.isError && <p className="text-sm text-destructive">{(mut.error as Error).message}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-2">客户号</th>
              <th className="p-2">渠道</th>
              <th className="p-2">微信身份</th>
              <th className="p-2">状态</th>
              <th className="p-2">绑定时间</th>
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((b: any) => (
              <tr key={b.id} className="border-t border-border">
                <td className="p-2">{b.customer_code}</td>
                <td className="p-2">{b.channel_type}</td>
                <td className="p-2 font-mono text-xs">{b.external_userid_masked || b.chat_id || "-"}</td>
                <td className="p-2">{b.status ?? "active"}</td>
                <td className="p-2">{fmt(b.bound_at ?? b.created_at)}</td>
                <td className="space-x-1 p-2">
                  {(b.status ?? "active") === "active" ? (
                    <button onClick={() => act(b.id, "disable")} className="rounded border border-border px-2 py-1 text-xs">
                      停用
                    </button>
                  ) : (
                    <button onClick={() => act(b.id, "enable")} className="rounded border border-border px-2 py-1 text-xs">
                      启用
                    </button>
                  )}
                  <button onClick={() => act(b.id, "unbind")} className="rounded border border-border px-2 py-1 text-xs">
                    解绑
                  </button>
                  <button onClick={() => act(b.id, "rebind")} className="rounded border border-border px-2 py-1 text-xs">
                    更换客户
                  </button>
                </td>
              </tr>
            ))}
            {!listQ.isLoading && !items.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  暂无绑定
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={listQ.data?.total ?? 0} onChange={setPage} />
    </div>
  );
}

function AuditTab() {
  const fetchAudit = useServerFn(listWechatAiAudit);
  const auditQ = useQuery({ queryKey: ["wxai-audit"], queryFn: () => fetchAudit({ data: { limit: 100 } }) });
  return (
    <MiniTable
      head={["时间", "动作", "对象", "变更前", "变更后", "原因"]}
      rows={((auditQ.data ?? []) as any[]).map((a) => [
        fmt(a.created_at),
        a.action,
        a.target_type,
        JSON.stringify(a.before_data ?? {}),
        JSON.stringify(a.after_data ?? {}),
        a.reason ?? "-",
      ])}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="p-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className="max-w-xs truncate p-2" title={String(c)}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={head.length} className="p-4 text-center text-muted-foreground">
                暂无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
