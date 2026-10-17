import { ResponsiveTable } from "@/components/admin/ResponsiveTable";
import { Pagination } from "@/components/admin/Pagination";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getWecomNotifyStatus,
  testWecomNotifyConnection,
  listWecomGroups,
  enrichWecomGroups,
  syncWecomGroups,
  listWecomBindings,
  autoBindWecomGroupsByName,
  listWecomProblemGroups,
  setWecomGroupBlocked,
  refreshSingleWecomGroup,
  refreshWecomGroupsBatch,
  autoMatchSingleWecomGroup,
  sendSelectedWecomGroups,
  searchCustomersForBinding,
  bindCustomerGroup,
  unbindCustomerGroup,
  listWecomMessages,
  getWecomMessageDetail,
  sendWecomMessage,
  refreshWecomMessageStatus,
  listDailyWecomDraftDates,
  listDailyWecomDrafts,
  updateDailyWecomDraft,
  sendDailyWecomDraftsNow,
} from "@/lib/wecom-notify.functions";
import { Page, Card, fmtDate } from "@/lib/admin-shared";
import { AlertTriangle, RefreshCw, Loader2, Plus, X, Send, Link2, Unlink, Search, Ban } from "lucide-react";

export const Route = createFileRoute("/admin/wecom-notify")({ component: WecomNotifyPage });

type Tab = "bindings" | "groups" | "problems" | "blocked" | "compose" | "history";

function SelectedGroupsSendPanel({
  pageRows,
  selectedChatIds,
  setSelectedChatIds,
}: {
  pageRows: any[];
  selectedChatIds: string[];
  setSelectedChatIds: (ids: string[]) => void;
}) {
  const sendSelected = useServerFn(sendSelectedWecomGroups);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const pageIds = pageRows.map((row) => row.chat_id);
  const allPageSelected = Boolean(pageIds.length) && pageIds.every((id) => selectedChatIds.includes(id));

  const togglePage = () => {
    if (allPageSelected) setSelectedChatIds(selectedChatIds.filter((id) => !pageIds.includes(id)));
    else setSelectedChatIds([...new Set([...selectedChatIds, ...pageIds])]);
  };

  const submit = async () => {
    if (!selectedChatIds.length) return toast.error("请先勾选群");
    if (!content.trim()) return toast.error("请填写群发文案");
    if (!window.confirm(`将向 ${selectedChatIds.length} 个群提交真实消息。\n\n消息内容：\n${content}\n\n确认继续吗？`)) return;
    setSending(true);
    try {
      const result: any = await sendSelected({ data: { chatIds: selectedChatIds, content } });
      toast.success(`已向企业微信提交 ${result.groupCount} 个群，等待群主确认发送`);
      setSelectedChatIds([]);
      setContent("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "群发提交失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-brand/25 bg-brand/5 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={togglePage} disabled={!pageIds.length} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40">
          {allPageSelected ? "取消本页全选" : `本页全选（${pageIds.length}）`}
        </button>
        <button type="button" onClick={() => setSelectedChatIds([])} disabled={!selectedChatIds.length} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40">
          清空选择
        </button>
        <span className="text-xs text-slate-400">已选择 {selectedChatIds.length} 个群</span>
      </div>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={3} maxLength={2000} placeholder="填写要发送的群发文案……" className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand" />
      <button type="button" onClick={submit} disabled={sending || !selectedChatIds.length || !content.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
        <Send className="h-4 w-4" />{sending ? "提交中…" : "发送到已选群"}
      </button>
      <p className="mt-2 text-xs text-slate-500">发送前会再次确认。企业微信提交后仍需群主在企业微信中确认发送。</p>
    </div>
  );
}

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
              ——关闭状态下禁止真实发送；连接测试、只读同步群列表、绑定管理和发送预览仍可使用，不会产生真实推送。
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
            ["problems", "问题群"],
            ["blocked", "已屏蔽群"],
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
      {tab === "groups" && <GroupsTab enabled={!!status?.configured} />}
      {tab === "problems" && <ProblemGroupsTab />}
      {tab === "blocked" && <BlockedGroupsTab />}
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
  const enrich = useServerFn(enrichWecomGroups);
  const setBlocked = useServerFn(setWecomGroupBlocked);
  const refreshOne = useServerFn(refreshSingleWecomGroup);
  const refreshBatch = useServerFn(refreshWecomGroupsBatch);
  const autoMatchOne = useServerFn(autoMatchSingleWecomGroup);
  const [syncing, setSyncing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [search, setSearch] = useState("");
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [bindingGroup, setBindingGroup] = useState<any | null>(null);
  const [blockingChatId, setBlockingChatId] = useState<string | null>(null);
  const [refreshingChatId, setRefreshingChatId] = useState<string | null>(null);
  const [refreshingPage, setRefreshingPage] = useState(false);
  const [matchingChatId, setMatchingChatId] = useState<string | null>(null);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const groupsQ = useQuery({ queryKey: ["wecom-notify-groups"], queryFn: () => fetchGroups() });
  const rows = ((groupsQ.data as any)?.items ?? []) as any[];
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    const unblockedRows = rows.filter((group) => !group.is_blocked);
    const visibleRows = showAllGroups
      ? [...unblockedRows].sort((a, b) => Number(Boolean(a.matched_customer_code)) - Number(Boolean(b.matched_customer_code)))
      : unblockedRows.filter((group) => !group.matched_customer_code);
    if (!keyword) return visibleRows;
    return visibleRows.filter((group) => {
      const members = (group.wecom_notify_group_members ?? [])
        .flatMap((member: any) => [member.display_name, member.external_userid])
        .join(" ");
      return [group.name, group.chat_id, members]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [rows, search, showAllGroups]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, showAllGroups]);

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

  const doEnrich = async () => {
    setEnriching(true);
    try {
      const r: any = await enrich();
      toast.success(
        r.count ? `已补全 ${r.count} 个群，还剩 ${r.remaining} 个` : "所有群资料均已补全",
      );
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
    } catch (e: any) {
      toast.error(e.message || "补全失败");
    } finally {
      setEnriching(false);
    }
  };

  const toggleBlocked = async (group: any) => {
    setBlockingChatId(group.chat_id);
    try {
      await setBlocked({ data: { chatId: group.chat_id, blocked: !group.is_blocked } });
      toast.success(group.is_blocked ? "已取消屏蔽" : "已屏蔽，该群以后不会收到群发消息");
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新屏蔽状态失败");
    } finally {
      setBlockingChatId(null);
    }
  };

  const refreshGroup = async (group: any) => {
    setRefreshingChatId(group.chat_id);
    try {
      const result: any = await refreshOne({ data: { chatId: group.chat_id } });
      toast.success(`群名已刷新：${result.name}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新群名失败");
    } finally {
      setRefreshingChatId(null);
    }
  };

  const refreshCurrentPage = async () => {
    if (!pageRows.length) return toast.error("本页没有可刷新的群");
    setRefreshingPage(true);
    try {
      const result: any = await refreshBatch({ data: { chatIds: pageRows.map((group) => group.chat_id) } });
      toast.success(`已刷新 ${result.refreshed} 个群名${result.missing ? `，${result.missing} 个未返回资料` : ""}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量刷新失败");
    } finally {
      setRefreshingPage(false);
    }
  };

  const autoMatchGroup = async (group: any) => {
    setMatchingChatId(group.chat_id);
    try {
      const result: any = await autoMatchOne({ data: { chatId: group.chat_id } });
      toast.success(`已匹配客户号 ${result.customerCode}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-bindings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "自动匹配失败");
    } finally {
      setMatchingChatId(null);
    }
  };

  return (
    <Card
      title="企业微信客户群"
      action={
        <div className="flex gap-2">
          <button
            onClick={refreshCurrentPage}
            disabled={!enabled || refreshingPage || !pageRows.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand disabled:opacity-40"
          >
            {refreshingPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            批量刷新本页群名（{pageRows.length}）
          </button>
          <button
            onClick={doEnrich}
            disabled={!enabled || enriching}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {enriching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            补全下一批群资料（50）
          </button>
          <button
            onClick={doSync}
            disabled={!enabled || syncing}
            title={enabled ? undefined : "网关或企业微信凭证尚未配置"}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-brand disabled:cursor-not-allowed disabled:opacity-40"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            刷新群 ID 列表
          </button>
        </div>
      }
    >
      <SelectedGroupsSendPanel pageRows={pageRows} selectedChatIds={selectedChatIds} setSelectedChatIds={setSelectedChatIds} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索群名称、chat_id、微信名或 external_userid"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-9 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="清空搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={showAllGroups}
              onChange={(event) => setShowAllGroups(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/5 accent-blue-500"
            />
            显示全部群名
          </label>
          <span className="text-xs text-slate-500">
            {search
              ? `找到 ${filteredRows.length} 个群`
              : showAllGroups
                ? `全部 ${rows.filter((group) => !group.is_blocked).length} 个未屏蔽群（未匹配优先）`
                : `未匹配 ${filteredRows.length} 个群`}
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/5">
        <ResponsiveTable className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">选择</th>
              <th className="px-3 py-2">群名称</th>
              <th>群主（企业微信账号）</th>
              <th>匹配客户号</th>
              <th>chat_id</th>
              <th>外部联系人（微信名 / external_userid）</th>
              <th>群成员数</th>
              <th>同步时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {groupsQ.isLoading && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {groupsQ.isSuccess && filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-xs text-slate-500">
                  {rows.length
                    ? "没有找到符合条件的群"
                    : `尚未同步任何群${!enabled ? "（网关或企业微信凭证尚未配置）" : ""}`}
                </td>
              </tr>
            )}
            {pageRows.map((g) => (
              <tr key={g.chat_id}>
                <td className="px-3 py-2"><input type="checkbox" checked={selectedChatIds.includes(g.chat_id)} onChange={(event) => setSelectedChatIds(event.target.checked ? [...new Set([...selectedChatIds, g.chat_id])] : selectedChatIds.filter((id) => id !== g.chat_id))} aria-label={`选择群 ${g.name || g.chat_id}`} /></td>
                <td className="px-3 py-2 font-medium text-slate-100">
                  {g.name || "—"}
                  {g.is_blocked && <span className="ml-2 text-xs text-rose-400">已屏蔽</span>}
                </td>
                <td className="font-mono text-xs text-slate-300">{g.owner_userid || "—"}</td>
                <td className="font-mono text-xs text-slate-300">
                  {g.matched_customer_code || <span className="text-amber-400">未匹配</span>}
                </td>
                <td className="font-mono text-xs text-slate-400">{g.chat_id}</td>
                <td className="max-w-md py-2 text-xs text-slate-400">
                  {g.member_count > 15 ? (
                    <span className="font-medium text-amber-300">大群，暂不处理</span>
                  ) : g.wecom_notify_group_members?.length ? (
                    <div className="space-y-1">
                      {g.wecom_notify_group_members.map((member: any) => (
                        <div key={member.external_userid}>
                          <span className="text-slate-200">{member.display_name || "未提供名称"}</span>
                          <span className="ml-2 font-mono text-[11px] text-slate-500">
                            {member.external_userid}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-xs text-slate-400">{g.member_count}</td>
                <td className="text-xs text-slate-400">{fmtDate(g.synced_at)}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {g.matched_customer_code ? (
                      <span className="self-center text-xs text-emerald-400">已匹配</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={matchingChatId === g.chat_id}
                          onClick={() => autoMatchGroup(g)}
                          className="whitespace-nowrap rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50"
                        >
                          {matchingChatId === g.chat_id ? "匹配中…" : "自动匹配"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setBindingGroup(g)}
                          className="whitespace-nowrap rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
                        >
                          手动匹配
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={refreshingChatId === g.chat_id}
                      onClick={() => refreshGroup(g)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshingChatId === g.chat_id ? "animate-spin" : ""}`} />
                      刷新群名
                    </button>
                    <button
                      type="button"
                      disabled={blockingChatId === g.chat_id}
                      onClick={() => toggleBlocked(g)}
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        g.is_blocked
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                      }`}
                    >
                      {blockingChatId === g.chat_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                      {g.is_blocked ? "取消屏蔽" : "屏蔽"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <Pagination
        page={currentPage}
        pageSize={pageSize}
        total={filteredRows.length}
        onChange={setPage}
      />
      {bindingGroup && (
        <BindModal
          initialChatId={bindingGroup.chat_id}
          initialGroupName={bindingGroup.name || bindingGroup.chat_id}
          onClose={() => setBindingGroup(null)}
          onBound={() => {
            setBindingGroup(null);
            qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
            qc.invalidateQueries({ queryKey: ["wecom-notify-bindings"] });
          }}
        />
      )}
    </Card>
  );
}

// ============ 问题群：未能自动建立唯一绑定的群 ============
function ProblemGroupsTab() {
  const qc = useQueryClient();
  const fetchProblems = useServerFn(listWecomProblemGroups);
  const setBlocked = useServerFn(setWecomGroupBlocked);
  const refreshOne = useServerFn(refreshSingleWecomGroup);
  const refreshBatch = useServerFn(refreshWecomGroupsBatch);
  const autoMatchOne = useServerFn(autoMatchSingleWecomGroup);
  const [search, setSearch] = useState("");
  const [problemType, setProblemType] = useState("all");
  const [page, setPage] = useState(1);
  const [bindingGroup, setBindingGroup] = useState<any | null>(null);
  const [blockingChatId, setBlockingChatId] = useState<string | null>(null);
  const [refreshingChatId, setRefreshingChatId] = useState<string | null>(null);
  const [refreshingPage, setRefreshingPage] = useState(false);
  const [matchingChatId, setMatchingChatId] = useState<string | null>(null);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const pageSize = 25;
  const problemsQ = useQuery({
    queryKey: ["wecom-notify-problem-groups"],
    queryFn: () => fetchProblems(),
  });
  const rows = ((problemsQ.data as any)?.items ?? []) as any[];
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (problemType !== "all" && row.problem_type !== problemType) return false;
      if (!keyword) return true;
      return [row.name, row.chat_id, row.candidate_customer_code, row.problem_label]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [rows, search, problemType]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [search, problemType]);

  const toggleBlocked = async (group: any) => {
    setBlockingChatId(group.chat_id);
    try {
      await setBlocked({ data: { chatId: group.chat_id, blocked: !group.is_blocked } });
      toast.success(group.is_blocked ? "已取消屏蔽" : "已屏蔽，该群以后不会收到群发消息");
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新屏蔽状态失败");
    } finally {
      setBlockingChatId(null);
    }
  };

  const refreshGroup = async (group: any) => {
    setRefreshingChatId(group.chat_id);
    try {
      const result: any = await refreshOne({ data: { chatId: group.chat_id } });
      toast.success(`群名已刷新：${result.name}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新群名失败");
    } finally {
      setRefreshingChatId(null);
    }
  };

  const refreshCurrentPage = async () => {
    if (!pageRows.length) return toast.error("本页没有可刷新的群");
    setRefreshingPage(true);
    try {
      const result: any = await refreshBatch({ data: { chatIds: pageRows.map((group) => group.chat_id) } });
      toast.success(`已刷新 ${result.refreshed} 个群名${result.missing ? `，${result.missing} 个未返回资料` : ""}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量刷新失败");
    } finally {
      setRefreshingPage(false);
    }
  };

  const autoMatchGroup = async (group: any) => {
    setMatchingChatId(group.chat_id);
    try {
      const result: any = await autoMatchOne({ data: { chatId: group.chat_id } });
      toast.success(`已匹配客户号 ${result.customerCode}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-bindings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "自动匹配失败");
    } finally {
      setMatchingChatId(null);
    }
  };

  return (
    <Card title="问题群 · 手动分配">
      <SelectedGroupsSendPanel pageRows={pageRows} selectedChatIds={selectedChatIds} setSelectedChatIds={setSelectedChatIds} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative block min-w-72 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索群名称、候选客户号或 chat_id"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        </label>
        <select
          value={problemType}
          onChange={(event) => setProblemType(event.target.value)}
          className="rounded-lg border border-white/10 bg-[#0B1220] px-3 py-2 text-sm text-slate-200"
        >
          <option value="all">全部问题</option>
          <option value="duplicate_customer_code">多个群对应同一客户号</option>
          <option value="customer_already_bound">客户号已绑定其它群</option>
          <option value="customer_not_found">号码找不到客户</option>
          <option value="multiple_numbers">群名包含多个客户号</option>
          <option value="no_number">群名没有 4/5 位客户号</option>
        </select>
        <span className="text-xs text-slate-500">共 {filteredRows.length} 个问题群</span>
        <button
          type="button"
          onClick={refreshCurrentPage}
          disabled={refreshingPage || !pageRows.length}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-semibold text-brand disabled:opacity-40"
        >
          {refreshingPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          批量刷新本页群名（{pageRows.length}）
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/5">
        <ResponsiveTable className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">选择</th>
              <th className="px-3 py-2">群名称</th>
              <th>群主（企业微信账号）</th>
              <th>候选客户号</th>
              <th>问题</th>
              <th>群成员数</th>
              <th>chat_id</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {problemsQ.isLoading && (
              <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            )}
            {problemsQ.isSuccess && filteredRows.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-xs text-slate-500">没有符合条件的问题群</td></tr>
            )}
            {pageRows.map((group) => (
              <tr key={group.chat_id}>
                <td className="px-3 py-2"><input type="checkbox" checked={selectedChatIds.includes(group.chat_id)} onChange={(event) => setSelectedChatIds(event.target.checked ? [...new Set([...selectedChatIds, group.chat_id])] : selectedChatIds.filter((id) => id !== group.chat_id))} aria-label={`选择群 ${group.name || group.chat_id}`} /></td>
                <td className="px-3 py-2 font-medium text-slate-100">
                  {group.name || "—"}
                  {group.is_blocked && <span className="ml-2 text-xs text-rose-400">已屏蔽</span>}
                </td>
                <td className="font-mono text-xs text-slate-300">{group.owner_userid || "—"}</td>
                <td className="font-mono text-xs text-slate-300">{group.candidate_customer_code || "—"}</td>
                <td className="text-xs text-amber-300">{group.problem_label}</td>
                <td className="text-xs text-slate-400">{group.member_count}</td>
                <td className="font-mono text-xs text-slate-500">{group.chat_id}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={matchingChatId === group.chat_id}
                      onClick={() => autoMatchGroup(group)}
                      className="whitespace-nowrap rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50"
                    >
                      {matchingChatId === group.chat_id ? "匹配中…" : "自动匹配"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBindingGroup(group)}
                      className="whitespace-nowrap rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
                    >
                      手动分配
                    </button>
                    <button
                      type="button"
                      disabled={refreshingChatId === group.chat_id}
                      onClick={() => refreshGroup(group)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshingChatId === group.chat_id ? "animate-spin" : ""}`} />
                      刷新群名
                    </button>
                    <button
                      type="button"
                      disabled={blockingChatId === group.chat_id}
                      onClick={() => toggleBlocked(group)}
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        group.is_blocked
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                      }`}
                    >
                      {blockingChatId === group.chat_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                      {group.is_blocked ? "取消屏蔽" : "屏蔽"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <Pagination page={currentPage} pageSize={pageSize} total={filteredRows.length} onChange={setPage} />
      {bindingGroup && (
        <BindModal
          initialChatId={bindingGroup.chat_id}
          initialGroupName={bindingGroup.name || bindingGroup.chat_id}
          onClose={() => setBindingGroup(null)}
          onBound={() => {
            setBindingGroup(null);
            qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
            qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
            qc.invalidateQueries({ queryKey: ["wecom-notify-bindings"] });
          }}
        />
      )}
    </Card>
  );
}

// ============ 已屏蔽群 ============
function BlockedGroupsTab() {
  const qc = useQueryClient();
  const fetchGroups = useServerFn(listWecomGroups);
  const setBlocked = useServerFn(setWecomGroupBlocked);
  const refreshOne = useServerFn(refreshSingleWecomGroup);
  const refreshBatch = useServerFn(refreshWecomGroupsBatch);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busyChatId, setBusyChatId] = useState<string | null>(null);
  const [refreshingChatId, setRefreshingChatId] = useState<string | null>(null);
  const [refreshingPage, setRefreshingPage] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const pageSize = 25;
  const groupsQ = useQuery({ queryKey: ["wecom-notify-groups"], queryFn: () => fetchGroups() });
  const blockedRows = (((groupsQ.data as any)?.items ?? []) as any[]).filter((group) => group.is_blocked);
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return blockedRows;
    return blockedRows.filter((group) =>
      [group.name, group.chat_id, group.matched_customer_code]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword),
    );
  }, [blockedRows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [search]);

  const unblock = async (group: any) => {
    setBusyChatId(group.chat_id);
    try {
      await setBlocked({ data: { chatId: group.chat_id, blocked: false } });
      toast.success("已取消屏蔽");
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消屏蔽失败");
    } finally {
      setBusyChatId(null);
    }
  };

  const refreshGroup = async (group: any) => {
    setRefreshingChatId(group.chat_id);
    try {
      const result: any = await refreshOne({ data: { chatId: group.chat_id } });
      toast.success(`群名已刷新：${result.name}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新群名失败");
    } finally {
      setRefreshingChatId(null);
    }
  };

  const refreshCurrentPage = async () => {
    if (!pageRows.length) return toast.error("本页没有可刷新的群");
    setRefreshingPage(true);
    try {
      const result: any = await refreshBatch({ data: { chatIds: pageRows.map((group) => group.chat_id) } });
      toast.success(`已刷新 ${result.refreshed} 个群名${result.missing ? `，${result.missing} 个未返回资料` : ""}`);
      qc.invalidateQueries({ queryKey: ["wecom-notify-groups"] });
      qc.invalidateQueries({ queryKey: ["wecom-notify-problem-groups"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量刷新失败");
    } finally {
      setRefreshingPage(false);
    }
  };

  return (
    <Card title="已屏蔽群 · 不参与任何群发">
      <SelectedGroupsSendPanel pageRows={pageRows} selectedChatIds={selectedChatIds} setSelectedChatIds={setSelectedChatIds} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索群名称、客户号或 chat_id"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">共 {filteredRows.length} 个已屏蔽群</span>
          <button
            type="button"
            onClick={refreshCurrentPage}
            disabled={refreshingPage || !pageRows.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-semibold text-brand disabled:opacity-40"
          >
            {refreshingPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            批量刷新本页群名（{pageRows.length}）
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/5">
        <ResponsiveTable className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">测试</th>
              <th className="px-3 py-2">群名称</th>
              <th>群主（企业微信账号）</th>
              <th>匹配客户号</th>
              <th>群成员数</th>
              <th>chat_id</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {groupsQ.isLoading && (
              <tr><td colSpan={7} className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            )}
            {groupsQ.isSuccess && filteredRows.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-xs text-slate-500">尚无已屏蔽群</td></tr>
            )}
            {pageRows.map((group) => (
              <tr key={group.chat_id}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedChatIds.includes(group.chat_id)}
                    onChange={(event) => setSelectedChatIds((current) => event.target.checked
                      ? [...new Set([...current, group.chat_id])]
                      : current.filter((id) => id !== group.chat_id))}
                    aria-label={`选择测试群 ${group.name || group.chat_id}`}
                  />
                </td>
                <td className="px-3 py-2 font-medium text-slate-100">{group.name || "—"}</td>
                <td className="font-mono text-xs text-slate-300">{group.owner_userid || "—"}</td>
                <td className="font-mono text-xs text-slate-300">{group.matched_customer_code || "—"}</td>
                <td className="text-xs text-slate-400">{group.member_count}</td>
                <td className="font-mono text-xs text-slate-500">{group.chat_id}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={refreshingChatId === group.chat_id}
                      onClick={() => refreshGroup(group)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${refreshingChatId === group.chat_id ? "animate-spin" : ""}`} />
                      刷新群名
                    </button>
                    <button
                      type="button"
                      disabled={busyChatId === group.chat_id}
                      onClick={() => unblock(group)}
                      className="whitespace-nowrap rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50"
                    >
                      {busyChatId === group.chat_id ? "处理中…" : "取消屏蔽"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <Pagination page={currentPage} pageSize={pageSize} total={filteredRows.length} onChange={setPage} />
    </Card>
  );
}

// ============ 绑定管理 ============
function BindingsTab({ enabled: _enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const fetchBindings = useServerFn(listWecomBindings);
  const unbind = useServerFn(unbindCustomerGroup);
  const autoBind = useServerFn(autoBindWecomGroupsByName);
  const [showBind, setShowBind] = useState(false);
  const [unbindCode, setUnbindCode] = useState<string | null>(null);
  const [autoBinding, setAutoBinding] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const pageSize = 25;
  const bindingsQ = useQuery({
    queryKey: ["wecom-notify-bindings"],
    queryFn: () => fetchBindings(),
  });
  const rows = ((bindingsQ.data as any)?.items ?? []) as any[];
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.customer_code, row.chat_id, row.wecom_notify_groups?.name]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword),
    );
  }, [rows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [search]);

  const reload = () => qc.invalidateQueries({ queryKey: ["wecom-notify-bindings"] });

  const doAutoBind = async () => {
    setAutoBinding(true);
    try {
      const result: any = await autoBind();
      toast.success(
        `自动匹配完成：新增 ${result.matched} 个绑定${
          result.ambiguous ? `，${result.ambiguous} 个客户号存在多个群已跳过` : ""
        }`,
        { duration: 8000 },
      );
      reload();
    } catch (e: any) {
      toast.error(e.message || "自动匹配失败");
    } finally {
      setAutoBinding(false);
    }
  };

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
        <div className="flex gap-2">
          <button
            onClick={doAutoBind}
            disabled={autoBinding}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand disabled:opacity-50"
          >
            {autoBinding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            按群名自动匹配
          </button>
          <button
            onClick={() => setShowBind(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            新建绑定
          </button>
        </div>
      }
    >
      <SelectedGroupsSendPanel pageRows={pageRows} selectedChatIds={selectedChatIds} setSelectedChatIds={setSelectedChatIds} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索客户号、客户群名称或 chat_id"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        </label>
        <span className="text-xs text-slate-500">共 {filteredRows.length} 个已匹配群</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/5">
        <ResponsiveTable className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">选择</th>
              <th className="px-3 py-2">匹配客户号</th>
              <th>客户群名称</th>
              <th>群主（企业微信账号）</th>
              <th>群成员数</th>
              <th>绑定时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {bindingsQ.isLoading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {bindingsQ.isSuccess && filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                  {rows.length ? "没有找到符合条件的绑定" : "尚无绑定"}
                </td>
              </tr>
            )}
            {pageRows.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2"><input type="checkbox" checked={selectedChatIds.includes(b.chat_id)} onChange={(event) => setSelectedChatIds(event.target.checked ? [...new Set([...selectedChatIds, b.chat_id])] : selectedChatIds.filter((id) => id !== b.chat_id))} aria-label={`选择群 ${b.wecom_notify_groups?.name || b.chat_id}`} /></td>
                <td className="px-3 py-2 font-medium text-slate-100">{b.customer_code}</td>
                <td className="text-xs text-slate-300">
                  {b.wecom_notify_groups?.name || b.chat_id}
                </td>
                <td className="font-mono text-xs text-slate-300">
                  {b.wecom_notify_groups?.owner_userid || "—"}
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
        </ResponsiveTable>
      </div>
      <Pagination page={currentPage} pageSize={pageSize} total={filteredRows.length} onChange={setPage} />

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

function BindModal({
  onClose,
  onBound,
  initialChatId = "",
  initialGroupName = "",
}: {
  onClose: () => void;
  onBound: () => void;
  initialChatId?: string;
  initialGroupName?: string;
}) {
  const search = useServerFn(searchCustomersForBinding);
  const fetchGroups = useServerFn(listWecomGroups);
  const bind = useServerFn(bindCustomerGroup);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<any[]>([]);
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string>(initialChatId);
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
          {initialChatId ? (
            <div className="mt-1 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-sm text-slate-100">
              {initialGroupName}
            </div>
          ) : (
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
          )}
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
  const qc = useQueryClient();
  const fetchDates = useServerFn(listDailyWecomDraftDates);
  const fetchDrafts = useServerFn(listDailyWecomDrafts);
  const saveDraft = useServerFn(updateDailyWecomDraft);
  const sendNow = useServerFn(sendDailyWecomDraftsNow);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingDate, setSendingDate] = useState<string | null>(null);
  const pageSize = 20;
  const datesQ = useQuery({
    queryKey: ["wecom-daily-draft-dates"],
    queryFn: () => fetchDates(),
  });
  const draftsQ = useQuery({
    queryKey: ["wecom-daily-drafts", selectedDate],
    queryFn: () => fetchDrafts({ data: { serviceDate: selectedDate! } }),
    enabled: !!selectedDate,
  });
  const dateRows = ((datesQ.data as any)?.items ?? []) as any[];
  const draftRows = ((draftsQ.data as any)?.items ?? []) as any[];
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return draftRows;
    return draftRows.filter((row) =>
      [row.customer_code, row.group_name, row.chat_id, row.content]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword),
    );
  }, [draftRows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [search, selectedDate]);

  const statusLabel: Record<string, string> = {
    draft: "待发送（可修改）",
    submitted: "已提交（只读）",
    sent: "已发送（只读）",
    partially_failed: "部分失败（只读）",
    failed: "发送失败（只读）",
  };
  const save = async () => {
    if (!editingId || !editingContent.trim()) return;
    setSaving(true);
    try {
      await saveDraft({ data: { draftId: editingId, content: editingContent } });
      toast.success("预发送信息已保存");
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: ["wecom-daily-drafts", selectedDate] });
      await qc.invalidateQueries({ queryKey: ["wecom-daily-draft-dates"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  const submitDateNow = async (serviceDate: string) => {
    if (!window.confirm(`确认立即提交 ${serviceDate} 的全部待发送信息？提交后内容不能再修改。`)) return;
    setSendingDate(serviceDate);
    try {
      const result: any = await sendNow({ data: { serviceDate } });
      if (result.failed) toast.warning(`成功提交 ${result.submitted} 条，失败 ${result.failed} 条`);
      else toast.success(`已提交 ${result.submitted} 条客户信息`);
      await qc.invalidateQueries({ queryKey: ["wecom-daily-draft-dates"] });
      await qc.invalidateQueries({ queryKey: ["wecom-daily-drafts", serviceDate] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSendingDate(null);
    }
  };

  if (!selectedDate) {
    return (
      <Card title="每日预发送信息（加拿大时间 10:00 自动发送）">
        <p className="mb-4 text-xs text-slate-400">
          入库、量尺称重、价格确认、付款通知和派送操作会自动汇总到对应日期。点击日期查看每个客户的实际发送内容。
        </p>
        {datesQ.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />读取中…</div>
        ) : dateRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">目前没有预发送信息</div>
        ) : (
          <div className="space-y-2">
            {dateRows.map((row) => (
              <div key={row.service_date} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <div>
                  <button type="button" onClick={() => setSelectedDate(row.service_date)} className="font-semibold text-slate-100 hover:text-brand">{row.service_date}</button>
                  <div className="mt-1 text-xs text-slate-500">发送时间：加拿大多伦多时间上午 10:00</div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-brand/15 px-2.5 py-1 text-brand">{row.customer_count} 个客户</span>
                  {row.editable_count > 0 && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-300">{row.editable_count} 条待发送</span>}
                  {row.sent_count > 0 && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">{row.sent_count} 条已提交/发送</span>}
                  {row.failed_count > 0 && <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-rose-300">{row.failed_count} 条异常</span>}
                  {row.editable_count > 0 && <button type="button" onClick={() => submitDateNow(row.service_date)} disabled={sendingDate === row.service_date} className="rounded-md border border-brand/40 px-2.5 py-1 text-brand disabled:opacity-40">{sendingDate === row.service_date ? "提交中…" : "立即补发"}</button>}
                  <button type="button" onClick={() => setSelectedDate(row.service_date)} className="rounded-md border border-white/10 px-2.5 py-1 text-slate-300">查看详情</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card title={`${selectedDate} · 客户预发送信息`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setSelectedDate(null); setEditingId(null); }} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-200">← 返回日期列表</button>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索客户号、群名或消息内容" className="min-w-64 flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand" />
        <span className="text-xs text-slate-400">共 {filteredRows.length} 个客户</span>
      </div>
      {draftsQ.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />读取中…</div>
      ) : (
        <div className="space-y-3">
          {pageRows.map((row) => {
            const editable = row.status === "draft";
            const editing = editingId === row.id;
            return (
              <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-100">客户号：{row.customer_code}</div>
                    <div className="mt-1 text-xs text-slate-400">目标群：{row.group_name || row.chat_id || "尚未绑定专属群"}{row.group_blocked ? "（已屏蔽）" : ""}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${editable ? "bg-amber-500/15 text-amber-300" : "bg-slate-500/15 text-slate-300"}`}>{statusLabel[row.status] ?? row.status}</span>
                </div>
                {editing ? (
                  <textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} rows={12} maxLength={4000} className="w-full rounded-lg border border-brand/50 bg-slate-950/40 px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none" />
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-950/40 px-3 py-3 text-xs leading-5 text-slate-200">{row.content}</pre>
                )}
                {editable && (
                  <div className="mt-3 flex gap-2">
                    {editing ? <>
                      <button type="button" onClick={save} disabled={saving || !editingContent.trim()} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{saving ? "保存中…" : "保存修改"}</button>
                      <button type="button" onClick={() => setEditingId(null)} disabled={saving} className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300">取消</button>
                    </> : (
                      <button type="button" onClick={() => { setEditingId(row.id); setEditingContent(row.content); }} className="rounded-md border border-brand/40 px-3 py-1.5 text-xs text-brand">修改发送内容</button>
                    )}
                    {row.is_edited && <span className="self-center text-xs text-amber-300">已人工修改</span>}
                  </div>
                )}
              </div>
            );
          })}
          {!pageRows.length && <div className="py-10 text-center text-sm text-slate-500">没有匹配的客户信息</div>}
          <Pagination page={currentPage} pageSize={pageSize} total={filteredRows.length} onChange={setPage} />
        </div>
      )}
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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const messagesQ = useQuery({
    queryKey: ["wecom-notify-messages"],
    queryFn: () => fetchMessages(),
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
  const rows = ((messagesQ.data as any)?.items ?? []) as any[];
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) =>
      [row.title, row.status, STATUS_LABEL[row.status], row.target_scope]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword),
    );
  }, [rows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [search]);
  const detailQ = useQuery({
    queryKey: ["wecom-notify-message-detail", detailId],
    queryFn: () => fetchDetail({ data: { messageId: detailId! } }),
    enabled: !!detailId,
  });

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索任务标题、状态或范围"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        </label>
        <span className="text-xs text-slate-500">共 {filteredRows.length} 个任务</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-white/5">
        <ResponsiveTable className="w-full text-sm">
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
            {messagesQ.isSuccess && filteredRows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                  {rows.length ? "没有找到符合条件的任务" : "尚无群发任务"}
                </td>
              </tr>
            )}
            {pageRows.map((m) => (
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
                  {["previewed", "failed", "partially_failed"].includes(m.status) && (
                    <button
                      onClick={() => setConfirmSendId(m.id)}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand/80"
                    >
                      <Send className="h-3 w-3" />
                      {m.status === "partially_failed" ? "重试失败客户" : "发送"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      <Pagination page={currentPage} pageSize={pageSize} total={filteredRows.length} onChange={setPage} />

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
