import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getWecomNotifyStatus,
  testWecomNotifyConnection,
  listWecomGroups,
  syncWecomGroups,
  listWecomBindings,
  searchCustomersForBinding,
  bindCustomerGroup,
  unbindCustomerGroup,
  previewWecomMessage,
  createWecomMessageDraft,
  listWecomMessages,
  getWecomMessageDetail,
  sendWecomMessage,
  refreshWecomMessageStatus,
} from "@/lib/wecom-notify.functions";
import { Page, Card, fmtDate } from "@/lib/admin-shared";
import { AlertTriangle, RefreshCw, Loader2, Plus, X, Send, Eye, Link2, Unlink } from "lucide-react";

export const Route = createFileRoute("/admin/wecom-notify")({ component: WecomNotifyPage });

type Tab = "bindings" | "groups" | "compose" | "history";

function WecomNotifyPage() {
  const [tab, setTab] = useState<Tab>("bindings");
  const fetchStatus = useServerFn(getWecomNotifyStatus);
  const statusQ = useQuery({ queryKey: ["wecom-notify-status"], queryFn: () => fetchStatus() });
  const testConnection = useServerFn(testWecomNotifyConnection);
  const [testingConnection, setTestingConnection] = useState(false);
  const status = statusQ.data as
    { configured: boolean; enabled: boolean; usingGateway: boolean } | undefined;

  const doTestConnection = async () => {
    setTestingConnection(true);
    try {
      await testConnection();
      toast.success("企业微信连接成功");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "企业微信连接失败");
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <Page
      title="群发通知（企业微信客户群）"
      subtitle="EPLUS群发通知 · 独立应用 AgentId 1000005 · 仅测试域名，与微信 AI 客服完全独立"
    >
      {statusQ.isSuccess && (!status?.enabled || !status?.configured) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            {!status?.configured && <div>尚未配置 WECOM_NOTIFY_CORP_ID / AGENT_ID / SECRET。</div>}
            <div>
              WECOM_ENABLED = {status?.enabled ? "true" : "false"}
              {!status?.enabled && "（默认关闭）"}
              ——关闭状态下「同步群列表」和「真实发送」均不可用，只能做绑定管理、发送预览和管理员主动连接测试，不会产生真实推送。
            </div>
          </div>
        </div>
      )}

      {statusQ.isSuccess && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
          <span>出口方式：{status?.usingGateway ? "固定出口网关" : "Lovable/Cloudflare 直连"}</span>
          <button
            onClick={doTestConnection}
            disabled={!status?.configured || testingConnection}
            className="rounded-md border border-white/10 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {testingConnection ? "测试中…" : "测试企业微信连接"}
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-white/10">
        {(
          [
            ["bindings", "客户 · 专属群绑定"],
            ["groups", "群列表"],
            ["compose", "新建群发"],
            ["history", "历史任务"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-b-2 border-brand text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "bindings" && <BindingsTab enabled={!!status?.enabled} />}
      {tab === "groups" && <GroupsTab enabled={!!status?.enabled} />}
      {tab === "compose" && <ComposeTab />}
      {tab === "history" && <HistoryTab enabled={!!status?.enabled} />}
    </Page>
  );
}

// ============ 群列表 ============
function GroupsTab({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const fetchGroups = useServerFn(listWecomGroups);
  const sync = useServerFn(syncWecomGroups);
  const [syncing, setSyncing] = useState(false);
  const groupsQ = useQuery({ queryKey: ["wecom-notify-groups"], queryFn: () => fetchGroups() });
  const rows = ((groupsQ.data as any)?.items ?? []) as any[];

  const doSync = async () => {
    setSyncing(true);
    try {
      const r: any = await sync();
      toast.success(`已同步 ${r.count} 个群`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
    } catch (e: any) {
      toast.error(e.message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card
      title="企业微信客户群"
      action={
        <button
          onClick={doSync}
          disabled={!enabled || syncing}
          title={enabled ? undefined : "WECOM_ENABLED=false，未开启真实接口调用"}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          同步群列表
        </button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">群名称</th>
              <th>chat_id</th>
              <th>群主</th>
              <th>成员数</th>
              <th>同步时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {groupsQ.isLoading && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {groupsQ.isSuccess && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                  尚未同步任何群{!enabled && "（当前 WECOM_ENABLED=false，无法同步）"}
                </td>
              </tr>
            )}
            {rows.map((g) => (
              <tr key={g.chat_id}>
                <td className="px-3 py-2 font-medium text-slate-100">{g.name || "—"}</td>
                <td className="font-mono text-xs text-slate-400">{g.chat_id}</td>
                <td className="text-xs text-slate-400">{g.owner_userid || "—"}</td>
                <td className="text-xs text-slate-400">{g.member_count}</td>
                <td className="text-xs text-slate-400">{fmtDate(g.synced_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ============ 绑定管理 ============
function BindingsTab({ enabled: _enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const fetchBindings = useServerFn(listWecomBindings);
  const unbind = useServerFn(unbindCustomerGroup);
  const [showBind, setShowBind] = useState(false);
  const [unbindCode, setUnbindCode] = useState<string | null>(null);
  const bindingsQ = useQuery({
    queryKey: ["wecom-notify-bindings"],
    queryFn: () => fetchBindings(),
  });
  const rows = ((bindingsQ.data as any)?.items ?? []) as any[];

  const reload = () => qc.invalidateQueries({ queryKey: ["wecom-notify-bindings"] });

  const doUnbind = async () => {
    if (!unbindCode) return;
    try {
      await unbind({ data: { customerCode: unbindCode } });
      toast.success("已解绑");
      setUnbindCode(null);
      reload();
    } catch (e: any) {
      toast.error(e.message || "解绑失败");
    }
  };

  return (
    <Card
      title="客户 ↔ 专属群绑定（一客户一群）"
      action={
        <button
          onClick={() => setShowBind(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          新建绑定
        </button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">客户号</th>
              <th>专属群</th>
              <th>群成员数</th>
              <th>绑定时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {bindingsQ.isLoading && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {bindingsQ.isSuccess && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                  尚无绑定
                </td>
              </tr>
            )}
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium text-slate-100">{b.customer_code}</td>
                <td className="text-xs text-slate-300">
                  {b.wecom_notify_groups?.name || b.chat_id}
                </td>
                <td className="text-xs text-slate-400">
                  {b.wecom_notify_groups?.member_count ?? "—"}
                </td>
                <td className="text-xs text-slate-400">{fmtDate(b.bound_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setUnbindCode(b.customer_code)}
                    className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300"
                  >
                    <Unlink className="h-3 w-3" />
                    解绑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showBind && (
        <BindModal
          onClose={() => setShowBind(false)}
          onBound={() => {
            setShowBind(false);
            reload();
          }}
        />
      )}

      {unbindCode && (
        <ModalShell onClose={() => setUnbindCode(null)}>
          <div className="mb-3 flex items-center gap-2">
            <Unlink className="h-5 w-5 text-rose-400" />
            <h2 className="font-display text-lg font-bold">解绑客户专属群</h2>
          </div>
          <p className="mb-4 text-sm text-slate-300">
            确认解除客户号 <span className="font-mono text-slate-100">{unbindCode}</span>{" "}
            与其专属群的绑定？
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setUnbindCode(null)}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              取消
            </button>
            <button
              onClick={doUnbind}
              className="rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white"
            >
              确认解绑
            </button>
          </div>
        </ModalShell>
      )}
    </Card>
  );
}

function BindModal({ onClose, onBound }: { onClose: () => void; onBound: () => void }) {
  const search = useServerFn(searchCustomersForBinding);
  const fetchGroups = useServerFn(listWecomGroups);
  const bind = useServerFn(bindCustomerGroup);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groupsQ = useQuery({ queryKey: ["wecom-notify-groups"], queryFn: () => fetchGroups() });
  const groups = ((groupsQ.data as any)?.items ?? []) as any[];

  const doSearch = async () => {
    const r: any = await search({ data: { query } });
    setCandidates(r.items ?? []);
  };

  const submit = async () => {
    if (!customerCode) return setErr("请先选择客户");
    if (!chatId) return setErr("请选择要绑定的群");
    setBusy(true);
    setErr(null);
    try {
      await bind({ data: { customerCode, chatId } });
      toast.success("绑定成功");
      onBound();
    } catch (e: any) {
      setErr(e.message || "绑定失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">新建客户 · 专属群绑定</h2>
        <button onClick={onClose}>
          <X className="h-4 w-4 text-slate-400" />
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400">按客户号 / 姓名 / 登录名搜索</label>
          <div className="mt-1 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
              placeholder="例如 C00123 或客户姓名"
            />
            <button
              onClick={doSearch}
              className="rounded-md border border-white/10 px-3 text-sm text-slate-200"
            >
              搜索
            </button>
          </div>
          {candidates.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-white/10">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCustomerCode(c.customer_code)}
                  className={`block w-full px-2 py-1.5 text-left text-xs hover:bg-white/5 ${
                    customerCode === c.customer_code ? "bg-brand/20 text-brand" : "text-slate-300"
                  }`}
                >
                  {c.customer_code} · {c.full_name || c.username || "—"}
                </button>
              ))}
            </div>
          )}
          {customerCode && (
            <div className="mt-1 text-xs text-emerald-400">已选择：{customerCode}</div>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-400">目标群</label>
          <select
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">请选择</option>
            {groups.map((g) => (
              <option key={g.chat_id} value={g.chat_id}>
                {g.name || g.chat_id}
              </option>
            ))}
          </select>
          {groups.length === 0 && (
            <div className="mt-1 text-[11px] text-amber-400/80">
              尚无同步过的群，请先到「群列表」同步
            </div>
          )}
        </div>
        {err && (
          <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <Link2 className="h-3.5 w-3.5" />
          确认绑定
        </button>
      </div>
    </ModalShell>
  );
}

// ============ 新建群发 ============
function ComposeTab() {
  const preview = useServerFn(previewWecomMessage);
  const createDraft = useServerFn(createWecomMessageDraft);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<"all_bound" | "selected">("all_bound");
  const [codesText, setCodesText] = useState("");
  const [template, setTemplate] = useState("");
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const targetCustomerCodes = useMemo(
    () =>
      codesText
        .split(/[,\s，]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [codesText],
  );

  const doPreview = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r: any = await preview({
        data: { targetScope: scope, targetCustomerCodes, contentTemplate: template },
      });
      setPreviewRows(r.items ?? []);
      if (!r.items?.length) toast.info("没有匹配到任何已绑定专属群的客户");
    } catch (e: any) {
      setErr(e.message || "预览失败");
    } finally {
      setBusy(false);
    }
  };

  const doCreateDraft = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r: any = await createDraft({
        data: { title, targetScope: scope, targetCustomerCodes, contentTemplate: template },
      });
      toast.success(`已创建群发任务草稿，共 ${r.count} 个目标；请到「历史任务」查看并发送`);
      setTitle("");
      setTemplate("");
      setCodesText("");
      setPreviewRows(null);
    } catch (e: any) {
      setErr(e.message || "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="新建群发消息">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400">标题（仅后台标识，不会发给客户）</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            placeholder="例如 9 月促销通知"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">发送范围</label>
          <div className="mt-1 flex gap-4 text-sm text-slate-200">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={scope === "all_bound"}
                onChange={() => setScope("all_bound")}
              />
              全部已绑定专属群的客户
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={scope === "selected"}
                onChange={() => setScope("selected")}
              />
              指定客户号
            </label>
          </div>
          {scope === "selected" && (
            <textarea
              value={codesText}
              onChange={(e) => setCodesText(e.target.value)}
              placeholder="客户号，逗号或换行分隔"
              rows={2}
              className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            />
          )}
        </div>
        <div>
          <label className="text-xs text-slate-400">
            消息内容（支持变量 <code className="text-slate-300">{"{{customer_name}}"}</code> /{" "}
            <code className="text-slate-300">{"{{customer_code}}"}</code>）
          </label>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            placeholder={"您好 {{customer_name}}，..."}
          />
        </div>
        {err && (
          <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>
        )}
        <div className="flex gap-2">
          <button
            onClick={doPreview}
            disabled={busy || !template.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-40"
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button
            onClick={doCreateDraft}
            disabled={busy || !template.trim() || !previewRows?.length}
            title={!previewRows?.length ? "请先预览并确认目标不为空" : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建群发任务
          </button>
        </div>

        {previewRows && (
          <div className="mt-3 overflow-hidden rounded-xl border border-white/5">
            <div className="border-b border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
              预览：共 {previewRows.length} 位客户 · 仅本地渲染，未调用企业微信任何接口
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">客户号</th>
                  <th>目标群</th>
                  <th>渲染后内容</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {previewRows.map((r) => (
                  <tr key={r.customer_code}>
                    <td className="px-3 py-2 text-xs text-slate-300">{r.customer_code}</td>
                    <td className="text-xs text-slate-400">{r.group_name || r.chat_id}</td>
                    <td className="max-w-md whitespace-pre-wrap text-xs text-slate-300">
                      {r.rendered_content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============ 历史任务 ============
function HistoryTab({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(listWecomMessages);
  const fetchDetail = useServerFn(getWecomMessageDetail);
  const send = useServerFn(sendWecomMessage);
  const refreshStatus = useServerFn(refreshWecomMessageStatus);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const messagesQ = useQuery({
    queryKey: ["wecom-notify-messages"],
    queryFn: () => fetchMessages(),
  });
  const rows = ((messagesQ.data as any)?.items ?? []) as any[];
  const detailQ = useQuery({
    queryKey: ["wecom-notify-message-detail", detailId],
    queryFn: () => fetchDetail({ data: { messageId: detailId! } }),
    enabled: !!detailId,
  });

  const STATUS_LABEL: Record<string, string> = {
    draft: "草稿",
    previewed: "待发送",
    sending: "发送中",
    submitted: "已提交企业微信",
    waiting_employee_confirmation: "等待群主确认发送",
    sent: "已确认发送",
    partially_failed: "部分失败",
    preview_only: "仅预览（未真实发送）",
    failed: "发送失败",
  };

  const doRefreshStatus = async (messageId: string) => {
    try {
      const result = await refreshStatus({ data: { messageId } });
      toast.success(`状态已更新：${STATUS_LABEL[result.status] ?? result.status}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-messages"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-message-detail", messageId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新状态失败");
    }
  };

  const doSend = async () => {
    if (!confirmSendId) return;
    setSending(true);
    try {
      const r: any = await send({ data: { messageId: confirmSendId } });
      if (r.status === "preview_only") {
        toast.warning("WECOM_ENABLED=false，本次未真实发送，仅生成预览记录");
      } else if (r.sent) {
        toast.success(
          "群发任务已提交给企业微信——注意：这只代表任务已提交，是否真正送达仍取决于对应群主在企业微信客户端确认执行",
        );
      } else {
        toast.error("发送失败，请查看任务详情");
      }
      setConfirmSendId(null);
      qc.invalidateQueries({ queryKey: ["wecom-notify-messages"] });
    } catch (e: any) {
      toast.error(e.message || "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card title="历史群发任务">
      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">标题</th>
              <th>范围</th>
              <th>状态</th>
              <th>创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {messagesQ.isLoading && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {messagesQ.isSuccess && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                  尚无群发任务
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 font-medium text-slate-100">{m.title || "(未命名)"}</td>
                <td className="text-xs text-slate-400">
                  {m.target_scope === "all_bound" ? "全部已绑定" : "指定客户"}
                </td>
                <td className="text-xs text-slate-300">{STATUS_LABEL[m.status] ?? m.status}</td>
                <td className="text-xs text-slate-400">{fmtDate(m.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setDetailId(m.id)}
                    className="mr-3 text-xs text-slate-400 hover:text-brand"
                  >
                    详情
                  </button>
                  {["submitted", "waiting_employee_confirmation", "partially_failed"].includes(
                    m.status,
                  ) && (
                    <button
                      onClick={() => doRefreshStatus(m.id)}
                      disabled={!enabled}
                      className="mr-3 text-xs text-slate-400 hover:text-brand disabled:opacity-40"
                    >
                      刷新状态
                    </button>
                  )}
                  {(m.status === "previewed" || m.status === "failed") && (
                    <button
                      onClick={() => setConfirmSendId(m.id)}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand/80"
                    >
                      <Send className="h-3 w-3" />
                      发送
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmSendId && (
        <ModalShell onClose={() => setConfirmSendId(null)}>
          <div className="mb-3 flex items-center gap-2">
            <Send className="h-5 w-5 text-brand" />
            <h2 className="font-display text-lg font-bold">发送群发任务</h2>
          </div>
          {enabled ? (
            <p className="mb-4 text-sm text-amber-300">
              WECOM_ENABLED=true：将真实调用企业微信接口提交群发任务。这只代表任务已提交，是否真正送达仍取决于对应群主在企业微信客户端确认执行，不代表消息已经送达客户。
            </p>
          ) : (
            <p className="mb-4 text-sm text-slate-300">
              当前
              WECOM_ENABLED=false（测试环境默认），点击后不会真实发送，只会把该任务标记为"仅预览"。
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConfirmSendId(null)}
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              取消
            </button>
            <button
              onClick={doSend}
              disabled={sending}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              确认{enabled ? "发送" : "提交（仅预览）"}
            </button>
          </div>
        </ModalShell>
      )}

      {detailId && (
        <ModalShell onClose={() => setDetailId(null)}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">任务详情</h2>
            <button onClick={() => setDetailId(null)}>
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
          {detailQ.isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-500" />}
          {detailQ.isSuccess && (
            <div className="max-h-96 space-y-2 overflow-y-auto text-xs">
              {((detailQ.data as any)?.targets ?? []).map((t: any) => (
                <div key={t.customer_code} className="rounded-md border border-white/10 p-2">
                  <div className="flex justify-between text-slate-300">
                    <span>{t.customer_code}</span>
                    <span>{t.status}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-400">
                    {t.rendered_content}
                  </div>
                  {t.error && <div className="mt-1 text-rose-400">{t.error}</div>}
                </div>
              ))}
            </div>
          )}
        </ModalShell>
      )}
    </Card>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
      >
        {children}
      </div>
    </div>
  );
}
