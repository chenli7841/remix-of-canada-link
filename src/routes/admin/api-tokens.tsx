import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  issuePartnerApiToken,
  listPartnerApiTokens,
  revokePartnerApiToken,
  getShipApiAdminConfig,
} from "@/lib/ship-api/partner-tokens.functions";
import { Page } from "@/lib/admin-shared";
import { KeyRound, Plus, Loader2, X, Copy, Ban, Info, AlertTriangle, Search } from "lucide-react";

export const Route = createFileRoute("/admin/api-tokens")({ component: ApiTokensPage });

// 权限选项：页面名称 / 实际 scope / 说明 —— 跟
// docs/ship-api/claude-api-token-admin-page.md 第 6 节的表一一对应。
const SCOPE_META: { scope: string; label: string; hint: string }[] = [
  { scope: "routes:read", label: "查询线路及录单规则", hint: "不包含我方结算价格" },
  { scope: "orders:read", label: "查询运单", hint: "现有按国内单号查询" },
  { scope: "orders:write", label: "创建及待入库修改删除运单", hint: "当前三种操作共用权限，不拆成假独立选项" },
  { scope: "customers:write", label: "更新客户资料", hint: "显式更新" },
  { scope: "orders:fees:read", label: "查看运输费用及费用明细", hint: "仅给管理端" },
];
const SCOPE_LABEL = new Map(SCOPE_META.map((m) => [m.scope, m.label]));

const PRESETS: { key: string; label: string; scopes: string[] }[] = [
  { key: "business", label: "业务对接", scopes: ["routes:read", "orders:read", "orders:write", "customers:write"] },
  { key: "fees", label: "管理端费用查询", scopes: ["orders:read", "orders:fees:read"] },
  { key: "custom", label: "自定义", scopes: [] },
];

type TokenRow = {
  id: string;
  partner_key: string;
  name: string | null;
  scopes: string[];
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string | null;
  last_used_at: string | null;
};

function fmtTime(v: string | null) {
  if (!v) return null;
  return new Date(v).toLocaleString("zh-CN", { hour12: false });
}

function statusOf(row: TokenRow): { text: string; cls: string } {
  if (row.revoked_at) return { text: "已撤销", cls: "bg-slate-500/10 text-slate-400" };
  if (row.is_active) return { text: "有效", cls: "bg-emerald-500/10 text-emerald-400" };
  return { text: "已停用", cls: "bg-amber-500/10 text-amber-400" };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ApiTokensPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listPartnerApiTokens);
  const fetchConfig = useServerFn(getShipApiAdminConfig);
  const revoke = useServerFn(revokePartnerApiToken);

  const listQ = useQuery({
    queryKey: ["ship-api-tokens"],
    queryFn: () => fetchList({ data: { partnerKey: "ship" } }),
  });
  const configQ = useQuery({ queryKey: ["ship-api-admin-config"], queryFn: () => fetchConfig() });
  const apiBaseUrl = (configQ.data as any)?.apiBaseUrl as string | null | undefined;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked" | "disabled">("all");
  const [showIssue, setShowIssue] = useState(false);
  const [issueResult, setIssueResult] = useState<{
    token: string;
    name: string;
    scopes: string[];
  } | null>(null);
  const [detailRow, setDetailRow] = useState<TokenRow | null>(null);
  const [revokeRow, setRevokeRow] = useState<TokenRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const rows = useMemo(() => ((listQ.data as any)?.items ?? []) as TokenRow[], [listQ.data]);
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search.trim() && !(r.name ?? "").toLowerCase().includes(search.trim().toLowerCase())) return false;
      const st = statusOf(r);
      if (statusFilter === "active" && st.text !== "有效") return false;
      if (statusFilter === "revoked" && st.text !== "已撤销") return false;
      if (statusFilter === "disabled" && st.text !== "已停用") return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const reload = () => qc.invalidateQueries({ queryKey: ["ship-api-tokens"] });

  const doRevoke = async () => {
    if (!revokeRow) return;
    setRevoking(true);
    try {
      const r: any = await revoke({ data: { id: revokeRow.id, partnerKey: "ship" } });
      toast.success(r.already_revoked ? "该凭证此前已撤销" : "已撤销");
      setRevokeRow(null);
      reload();
    } catch (e: any) {
      toast.error(e.message || "撤销失败");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Page
      title="API 凭证管理"
      subtitle="为合作方签发 API 访问凭证。密钥仅在生成时显示一次，后续只能撤销并重新签发。"
      action={
        <button
          onClick={() => setShowIssue(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          签发新凭证
        </button>
      }
    >
      {configQ.isSuccess && !apiBaseUrl && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            API 地址尚未配置（环境变量 SHIP_API_PUBLIC_ORIGIN 未设置）。仍可正常签发/撤销凭证，只是"复制对接信息"里的
            API 根地址会留空，需要手动补上。
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按名称搜索"
            className="rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
        >
          <option value="all">全部状态</option>
          <option value="active">有效</option>
          <option value="disabled">已停用</option>
          <option value="revoked">已撤销</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2.5">名称</th>
              <th>合作方</th>
              <th>权限</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>最近使用时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {listQ.isLoading && (
              <tr>
                <td colSpan={7} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {listQ.isError && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-rose-400">
                  加载失败：{(listQ.error as Error).message}
                  <button onClick={reload} className="ml-2 underline">
                    重试
                  </button>
                </td>
              </tr>
            )}
            {listQ.isSuccess && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                  {rows.length === 0 ? "尚未签发凭证" : "没有符合条件的凭证"}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const st = statusOf(r);
              return (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 font-medium text-slate-100">{r.name || "—"}</td>
                  <td className="text-xs text-slate-400">{r.partner_key}</td>
                  <td className="max-w-xs text-xs text-slate-400">
                    {r.scopes.map((s) => SCOPE_LABEL.get(s) ?? s).join("、")}
                  </td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.text}</span>
                  </td>
                  <td className="text-xs text-slate-400">{fmtTime(r.created_at)}</td>
                  <td className="text-xs text-slate-400">{fmtTime(r.last_used_at) ?? "尚未使用"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => setDetailRow(r)} className="mr-3 text-xs text-slate-400 hover:text-brand">
                      详情
                    </button>
                    {st.text === "有效" && (
                      <button onClick={() => setRevokeRow(r)} className="text-xs text-rose-400 hover:text-rose-300">
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showIssue && (
        <IssueModal
          apiBaseUrl={apiBaseUrl ?? null}
          onClose={() => setShowIssue(false)}
          onIssued={(result) => {
            setShowIssue(false);
            setIssueResult(result);
            reload();
          }}
        />
      )}

      {issueResult && (
        <ResultModal apiBaseUrl={apiBaseUrl ?? null} result={issueResult} onClose={() => setIssueResult(null)} />
      )}

      {detailRow && <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />}

      {revokeRow && (
        <RevokeModal row={revokeRow} busy={revoking} onCancel={() => setRevokeRow(null)} onConfirm={doRevoke} />
      )}
    </Page>
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

function IssueModal({
  apiBaseUrl,
  onClose,
  onIssued,
}: {
  apiBaseUrl: string | null;
  onClose: () => void;
  onIssued: (r: { token: string; name: string; scopes: string[] }) => void;
}) {
  const issue = useServerFn(issuePartnerApiToken);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<string>("business");
  const [scopes, setScopes] = useState<Set<string>>(new Set(PRESETS[0].scopes));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyPreset = (key: string) => {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (p && p.key !== "custom") setScopes(new Set(p.scopes));
  };

  const toggleScope = (s: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
        // 取消查询运单权限时，费用权限也一起取消——两者是组合关系，不留一个不自洽的状态。
        if (s === "orders:read") next.delete("orders:fees:read");
      } else {
        next.add(s);
        if (s === "orders:fees:read") next.add("orders:read");
      }
      return next;
    });
    setPreset("custom");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    const trimmedName = name.trim();
    if (!trimmedName) return setErr("凭证名称不能为空");
    if (scopes.size === 0) return setErr("至少勾选一项权限");
    setBusy(true);
    try {
      const r: any = await issue({
        data: { partnerKey: "ship", name: trimmedName, scopes: Array.from(scopes) },
      });
      onIssued({ token: r.token, name: trimmedName, scopes: Array.from(scopes) });
    } catch (e: any) {
      // 网络超时不代表一定失败——凭证可能已经生成成功，只是这次响应没回来。
      // 不自动重试、不连发第二个 Token，让管理员自己去列表核对。
      setErr(`${e.message || "签发失败"}（如果是超时，请关闭本窗口刷新列表核对是否已生成，不要重复提交）`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={busy ? undefined : onClose}>
      <form onSubmit={submit}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">签发新凭证</h2>
          <button type="button" onClick={onClose} disabled={busy}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">凭证名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 ship 联调业务凭证"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">合作方</label>
            <input
              value="ship"
              disabled
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm text-slate-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">权限预设</label>
            <select
              value={preset}
              onChange={(e) => applyPreset(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            >
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">权限（至少一项）</label>
            <div className="mt-1.5 space-y-1.5 rounded-md border border-white/10 bg-white/[0.02] p-3">
              {SCOPE_META.map((m) => (
                <label key={m.scope} className="flex items-start gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={scopes.has(m.scope)}
                    onChange={() => toggleScope(m.scope)}
                  />
                  <span>
                    <span className="text-slate-200">{m.label}</span>
                    <span className="ml-1 text-slate-500">（{m.hint}）</span>
                  </span>
                </label>
              ))}
            </div>
            {scopes.has("orders:fees:read") && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-300/90">
                <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
                费用信息仅供合作方管理端使用，合作方需要自行限制客户端展示。
              </div>
            )}
          </div>
          {err && <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}
          {!apiBaseUrl && (
            <div className="text-[11px] text-amber-400/80">
              提示：API 根地址尚未配置，签发不受影响，但稍后"复制对接信息"里的地址会是空的。
            </div>
          )}
          <button
            disabled={busy}
            className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "生成中…" : "生成凭证"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ResultModal({
  apiBaseUrl,
  result,
  onClose,
}: {
  apiBaseUrl: string | null;
  result: { token: string; name: string; scopes: string[] };
  onClose: () => void;
}) {
  const integrationText = [
    `合作方：ship`,
    `API 根地址：${apiBaseUrl ?? "（尚未配置，请手动补上）"}`,
    `Authorization: Bearer ${result.token}`,
    `权限：${result.scopes.map((s) => SCOPE_LABEL.get(s) ?? s).join("、")}`,
    `说明：仅在合作方服务器端保存和调用。`,
  ].join("\n");

  const doCopy = async (text: string, label: string) => {
    const ok = await copyText(text);
    if (ok) toast.success(`${label}已复制`);
    else toast.error("复制失败，请手动选中文本后自行复制");
  };

  return (
    <ModalShell>
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-brand" />
        <h2 className="font-display text-lg font-bold">凭证已生成</h2>
      </div>
      <div className="mb-3 rounded-md bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300">
        密钥仅显示这一次，请立即复制并安全保存。关闭后无法再次查看原密钥；丢失时请撤销该凭证并重新签发。
      </div>
      <div className="space-y-2 text-xs">
        <Row label="凭证名称" value={result.name} />
        <Row label="合作方" value="ship" />
        <Row label="权限" value={result.scopes.map((s) => SCOPE_LABEL.get(s) ?? s).join("、")} />
        <Row label="API 根地址" value={apiBaseUrl ?? "（尚未配置）"} />
        <div>
          <div className="mb-1 text-slate-400">完整 Token</div>
          <div className="select-all break-all rounded-md border border-white/10 bg-white/5 px-2 py-2 font-mono text-[11px] text-slate-100">
            {result.token}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => doCopy(result.token, "密钥")}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-brand"
        >
          <Copy className="h-3 w-3" />
          复制密钥
        </button>
        <button
          onClick={() => doCopy(integrationText, "对接信息")}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-brand"
        >
          <Copy className="h-3 w-3" />
          复制对接信息
        </button>
        <button
          onClick={onClose}
          className="ml-auto rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white"
        >
          我已保存，关闭
        </button>
      </div>
    </ModalShell>
  );
}

function DetailModal({ row, onClose }: { row: TokenRow; onClose: () => void }) {
  const st = statusOf(row);
  return (
    <ModalShell onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">凭证详情</h2>
        <button onClick={onClose}>
          <X className="h-4 w-4 text-slate-400" />
        </button>
      </div>
      <div className="space-y-2 text-xs">
        <Row label="ID" value={row.id} mono />
        <Row label="名称" value={row.name || "—"} />
        <Row label="合作方" value={row.partner_key} />
        <Row label="权限" value={row.scopes.map((s) => SCOPE_LABEL.get(s) ?? s).join("、")} />
        <Row label="状态" value={st.text} />
        <Row label="创建时间" value={fmtTime(row.created_at) ?? "—"} />
        <Row label="撤销时间" value={fmtTime(row.revoked_at) ?? "—"} />
        <Row label="最近使用时间" value={fmtTime(row.last_used_at) ?? "尚未使用"} />
      </div>
    </ModalShell>
  );
}

function RevokeModal({
  row,
  busy,
  onCancel,
  onConfirm,
}: {
  row: TokenRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onClose={busy ? undefined : onCancel}>
      <div className="mb-3 flex items-center gap-2">
        <Ban className="h-5 w-5 text-rose-400" />
        <h2 className="font-display text-lg font-bold">撤销凭证</h2>
      </div>
      <div className="mb-3 space-y-1.5 rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs">
        <Row label="名称" value={row.name || "—"} />
        <Row label="合作方" value={row.partner_key} />
        <Row label="权限" value={row.scopes.map((s) => SCOPE_LABEL.get(s) ?? s).join("、")} />
      </div>
      <p className="mb-4 text-xs text-slate-300">
        撤销后，使用此凭证的 API 请求将无法继续通过鉴权。已创建的客户和运单保留，不受影响。是否撤销？
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          确认撤销
        </button>
      </div>
    </ModalShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className={`text-right text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
