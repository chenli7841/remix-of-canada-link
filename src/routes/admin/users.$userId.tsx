import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  getUserDetail,
  setUserRoles,
  setUserVipAndPoints,
  setUserBlacklist,
  setUserFeeScheme,
  getMyRoles,
  adjustUserWallet,
  type AppRole,
} from "@/lib/admin.functions";
import { ROLE_LABEL, ROLE_COLOR, ASSIGNABLE_ROLES } from "@/lib/admin-roles";
import { VIP_LEVELS, VIP_LABEL, VIP_COLOR, type VipLevel } from "@/lib/vip-levels";
import {
  ArrowLeft,
  Loader2,
  Save,
  ShieldCheck,
  Mail,
  Phone,
  Calendar,
  Wallet,
  Package,
  User as UserIcon,
  Hash,
  Lock,
  CheckCircle2,
  AlertCircle,
  Crown,
  Sparkles,
  Receipt,
  ExternalLink,
  Ban,
} from "lucide-react";

export const Route = createFileRoute("/admin/users/$userId")({
  component: UserDetailPage,
});

function UserDetailPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getUserDetail);
  const fetchMyRoles = useServerFn(getMyRoles);
  const saveRoles = useServerFn(setUserRoles);

  const detailQ = useQuery({
    queryKey: ["admin-user-detail", userId],
    queryFn: () => fetchDetail({ data: { userId } }),
  });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchMyRoles(), staleTime: 60_000 });

  const myRoles = meQ.data?.roles ?? [];
  const isOwner = myRoles.includes("owner");
  const isManager = myRoles.includes("manager");
  const canEdit = isOwner || isManager;

  const [selected, setSelected] = useState<Set<AppRole>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (detailQ.data) {
      setSelected(new Set(detailQ.data.roles.filter((r) => r !== "customer")));
      setErr(null);
      setOkMsg(null);
    }
  }, [detailQ.data]);

  const targetIsOwner = useMemo(() => (detailQ.data?.roles ?? []).includes("owner"), [detailQ.data]);

  if (detailQ.isLoading) {
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (detailQ.isError || !detailQ.data) {
    return <div className="p-6 text-rose-400">{(detailQ.error as Error)?.message ?? "未找到用户"}</div>;
  }

  const d = detailQ.data;

  // Per-role lock rules (mirrors server-side enforcement)
  const isRoleLocked = (r: AppRole): { locked: boolean; reason?: string } => {
    if (!canEdit) return { locked: true, reason: "无权限" };
    if (isOwner) return { locked: false };
    // manager rules:
    if (targetIsOwner) return { locked: true, reason: "无法修改总负责人" };
    if (r === "owner") return { locked: true, reason: "仅总负责人可分配" };
    if (r === "manager") return { locked: true, reason: "仅总负责人可分配" };
    return { locked: false };
  };

  const toggle = (r: AppRole) => {
    const { locked } = isRoleLocked(r);
    if (locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const initialSet = new Set<AppRole>((d.roles ?? []).filter((r) => r !== "customer"));
  const hasChanges = selected.size !== initialSet.size || Array.from(selected).some((r) => !initialSet.has(r));

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      await saveRoles({ data: { userId, roles: Array.from(selected) } });
      await qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setOkMsg("角色已更新");
    } catch (e: any) {
      setErr(e?.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const initials = (d.profile.full_name ?? d.profile.email ?? "?").trim().slice(0, 1).toUpperCase();

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Top bar */}
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={() => navigate({ to: "/admin/users" })}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          返回用户列表
        </button>
        <div className="text-xs text-slate-500">
          您的身份：
          {isOwner ? (
            <span className="text-rose-400 font-semibold">总负责人</span>
          ) : isManager ? (
            <span className="text-amber-400 font-semibold">主管</span>
          ) : (
            <span>员工</span>
          )}
        </div>
      </div>

      {/* Header card */}
      <section className="mb-5 rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-6">
        <div className="flex flex-wrap items-center gap-5">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand/15 text-2xl font-bold text-brand">
            {initials}
          </div>
          <div className="flex-1 min-w-[200px]">
            <h1 className="font-display text-2xl font-bold">{d.profile.full_name ?? "未命名用户"}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Hash className="h-3.5 w-3.5" />
                <span className="font-mono">{d.profile.customer_code ?? "—"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {d.profile.email ?? "—"}
              </span>
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                {d.profile.phone ?? "—"}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {d.profile.is_blacklisted && (
                <span
                  title={d.profile.blacklist_reason ?? "已拉黑"}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300"
                >
                  <Ban className="h-3 w-3" />
                  已加入黑名单
                </span>
              )}
              {d.roles.length === 0 && <span className="text-xs text-slate-500">无角色</span>}
              {d.roles.map((r) => (
                <span key={r} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ROLE_COLOR[r]}`}>
                  {ROLE_LABEL[r].zh}
                </span>
              ))}
            </div>
          </div>
          <Link
            to="/admin/invoices"
            search={{ userId }}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-500/20"
          >
            <Receipt className="h-4 w-4" />
            查看全部账单
          </Link>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        {/* Left: info & stats */}
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              icon={<Package className="h-4 w-4" />}
              label="历史订单"
              value={String(d.ordersCount)}
              accent="text-blue-400"
            />
            <StatCard
              icon={<Wallet className="h-4 w-4" />}
              label="钱包余额"
              value={`CA$${Number(d.wallet?.balance_cad ?? 0).toFixed(2)}`}
              accent="text-emerald-400"
            />
          </div>

          {/* Profile details */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
            <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-slate-400" />
              基本资料
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
              <Field label="客户号" value={<span className="font-mono">{d.profile.customer_code ?? "—"}</span>} />
              <Field label="姓名" value={d.profile.full_name ?? "—"} />
              <Field label="邮箱" value={d.profile.email ?? "—"} />
              <Field label="电话" value={d.profile.phone ?? "—"} />
              <Field
                label="注册时间"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" />
                    {d.profile.created_at ? new Date(d.profile.created_at).toLocaleString() : "—"}
                  </span>
                }
              />
              <Field label="用户 ID" value={<span className="font-mono text-xs text-slate-400">{d.profile.id}</span>} />
            </dl>
          </section>

          {/* VIP & Points editor */}
          <VipPointsCard
            userId={userId}
            currentVip={(d.profile.vip_level ?? "normal") as VipLevel}
            currentPoints={Number(d.profile.points ?? 0)}
            canEdit={canEdit}
          />

          {/* Fee scheme preference */}
          <FeeSchemeCard
            userId={userId}
            current={((d.profile as any).fee_scheme_preference ?? "split") as "merged" | "split"}
            canEdit={canEdit}
          />

          {/* Wallet balance editor */}
          <WalletCard userId={userId} currentCad={Number(d.wallet?.balance_cad ?? 0)} canEdit={canEdit} />

          {/* Blacklist */}
          <BlacklistCard
            userId={userId}
            currentBlacklisted={!!d.profile.is_blacklisted}
            currentReason={d.profile.blacklist_reason ?? ""}
            canEdit={canEdit}
            isSelf={d.profile.id === userId && false /* server enforces self-block */}
          />

          {/* Unpaid invoices / orders */}
          <UnpaidPanel
            invoices={d.unpaidInvoices ?? []}
            orders={d.unpaidOrders ?? []}
            forwardings={d.unpaidForwardings ?? []}
            unpaidAmountCad={Number(d.unpaidAmountCad ?? 0)}
          />

          {/* Customer HS library */}
          <CustomerHsCard userId={userId} canEdit={canEdit} />
        </div>

        {/* Right: role panel */}
        <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              角色分配
            </h2>
            {!canEdit && <span className="text-[10px] text-slate-500">无权限</span>}
            {canEdit && !isOwner && <span className="text-[10px] text-amber-400">主管模式（受限）</span>}
          </div>

          <p className="mt-1.5 text-xs text-slate-400">
            "客人" 角色对所有注册用户默认开启，不可移除。
            {isManager && !isOwner && (
              <span className="block mt-1 text-amber-400/80">
                主管不可分配 / 撤销 总负责人 与 主管 角色，也无法修改总负责人。
              </span>
            )}
          </p>

          <div className="mt-4 space-y-1">
            {ASSIGNABLE_ROLES.map((r) => {
              const checked = selected.has(r);
              const { locked, reason } = isRoleLocked(r);
              return (
                <label
                  key={r}
                  className={`flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-sm transition ${
                    locked
                      ? "cursor-not-allowed opacity-60"
                      : "cursor-pointer hover:border-white/10 hover:bg-white/[0.03]"
                  }`}
                  title={reason}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(r)}
                    disabled={locked}
                    className="h-4 w-4 accent-brand"
                  />
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ROLE_COLOR[r]}`}>
                    {ROLE_LABEL[r].zh}
                  </span>
                  <span className="text-xs text-slate-500 flex-1">{ROLE_LABEL[r].en}</span>
                  {locked && <Lock className="h-3 w-3 text-slate-600" />}
                </label>
              );
            })}
          </div>

          {err && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
            </div>
          )}
          {okMsg && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {okMsg}
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={onSave}
                disabled={saving || !hasChanges}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存角色
              </button>
              <button
                onClick={() => setSelected(new Set(initialSet))}
                disabled={saving || !hasChanges}
                className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                重置
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-100 break-all">{value}</dd>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
      <div className={`inline-flex items-center gap-1.5 text-xs ${accent}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1.5 font-display text-xl font-bold text-slate-100">{value}</div>
    </div>
  );
}

function VipPointsCard({
  userId,
  currentVip,
  currentPoints,
  canEdit,
}: {
  userId: string;
  currentVip: VipLevel;
  currentPoints: number;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(setUserVipAndPoints);
  const [vip, setVip] = useState<VipLevel>(currentVip);
  const [points, setPoints] = useState<number>(currentPoints);
  const [delta, setDelta] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setVip(currentVip);
    setPoints(currentPoints);
  }, [currentVip, currentPoints]);

  const dirty = vip !== currentVip || points !== currentPoints || delta !== 0;

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await save({
        data: {
          userId,
          vipLevel: vip !== currentVip ? vip : undefined,
          points: points !== currentPoints ? points : undefined,
          pointsDelta: delta !== 0 ? delta : undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setDelta(0);
      setMsg({ kind: "ok", text: "已更新" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
        <Crown className="h-4 w-4 text-amber-400" />
        客户等级 & 积分
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">VIP 等级</div>
          <div className="flex flex-wrap gap-1.5">
            {VIP_LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                disabled={!canEdit}
                onClick={() => setVip(lv)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${vip === lv ? VIP_COLOR[lv] + " ring-1 ring-white/40" : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {VIP_LABEL[lv]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">积分余额</div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-300" />
            <input
              type="number"
              value={points}
              disabled={!canEdit}
              onChange={(e) => setPoints(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="w-28 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm font-mono text-violet-200 focus:border-brand focus:outline-none"
            />
            <span className="text-xs text-slate-500">分</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">快速调整</span>
            <input
              type="number"
              value={delta}
              disabled={!canEdit}
              onChange={(e) => setDelta(Math.floor(Number(e.target.value) || 0))}
              placeholder="±0"
              className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-mono focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setDelta((d) => d + 100)}
              className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              +100
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setDelta((d) => d - 100)}
              className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/5 disabled:opacity-40"
            >
              -100
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">设置积分值会直接覆盖；快速调整以现有积分为基础叠加。</p>
        </div>
      </div>
      {msg && (
        <div
          className={`mt-3 rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}
      {canEdit && (
        <button
          onClick={onSave}
          disabled={busy || !dirty}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存等级 & 积分
        </button>
      )}
    </section>
  );
}

function FeeSchemeCard({
  userId,
  current,
  canEdit,
}: {
  userId: string;
  current: "merged" | "split";
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(setUserFeeScheme);
  const [scheme, setScheme] = useState<"merged" | "split">(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    setScheme(current);
  }, [current]);
  const dirty = scheme !== current;

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await save({ data: { userId, scheme } });
      await qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      setMsg({ kind: "ok", text: "费用方案已更新" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  const opt = (v: "merged" | "split", label: string, desc: string) => (
    <button
      key={v}
      type="button"
      disabled={!canEdit}
      onClick={() => setScheme(v)}
      className={`flex-1 rounded-lg border p-3 text-left transition ${scheme === v ? "border-brand/50 bg-brand/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className="text-sm font-semibold text-slate-100">{label}</div>
      <div className="mt-1 text-[11px] text-slate-400">{desc}</div>
    </button>
  );

  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
        <Receipt className="h-4 w-4 text-emerald-400" />
        费用方案偏好
      </h2>
      <p className="mt-1 text-xs text-slate-400">决定该客户的箱号 / 托盘在有客户号时采用哪种计费方案。</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {opt("merged", "A. 合并收费", "按整箱 / 整托计算自身运费 + 下属关税/保险/清关")}
        {opt("split", "B. 不合并", "按下属运单逐条汇总，不计箱子/托盘自身运费与清关")}
      </div>
      {msg && (
        <div
          className={`mt-3 rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}
      {canEdit && (
        <button
          onClick={onSave}
          disabled={busy || !dirty}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存偏好
        </button>
      )}
    </section>
  );
}

function UnpaidPanel({
  invoices,
  orders,
  forwardings,
  unpaidAmountCad,
}: {
  invoices: any[];
  orders: any[];
  forwardings: any[];
  unpaidAmountCad: number;
}) {
  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
          <Receipt className="h-4 w-4 text-rose-400" />
          未付款详情
        </h2>
        <div className="text-xs">
          <span className="text-slate-400">未付总额 </span>
          <span className="font-bold text-rose-300">CA${unpaidAmountCad.toFixed(2)}</span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">未付账单 ({invoices.length})</div>
          {invoices.length === 0 ? (
            <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
              无未付账单
            </div>
          ) : (
            <ul className="divide-y divide-white/5 rounded-md border border-white/5 bg-white/[0.02]">
              {invoices.map((inv: any) => {
                const fx = Number(inv.fx_rate ?? 0.19);
                const totalCad = Number(inv.total_cny ?? 0) * fx;
                const paidCad = Number(inv.paid_cad ?? 0) > 0 ? Number(inv.paid_cad) : Number(inv.paid_cny ?? 0) * fx;
                const due = Math.max(0, totalCad - paidCad);
                return (
                  <li key={inv.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <Link
                        to="/admin/invoices/$invoiceId"
                        params={{ invoiceId: inv.id }}
                        className="inline-flex items-center gap-1 font-mono text-brand hover:underline"
                      >
                        {inv.invoice_no} <ExternalLink className="h-3 w-3" />
                      </Link>
                      <div className="text-[10px] text-slate-500">
                        {inv.status === "overdue" ? <span className="text-rose-400">已逾期</span> : "未付"}
                        {inv.due_date && <> · 到期 {inv.due_date}</>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-rose-300">CA${due.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-500">/ CA${totalCad.toFixed(2)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">未付订单 ({orders.length})</div>
          {orders.length === 0 ? (
            <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-500">
              无未付订单
            </div>
          ) : (
            <ul className="divide-y divide-white/5 rounded-md border border-white/5 bg-white/[0.02]">
              {orders.slice(0, 10).map((o: any) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <Link
                    to="/admin/orders/$orderId"
                    params={{ orderId: o.id }}
                    className="inline-flex items-center gap-1 font-mono text-brand hover:underline"
                  >
                    {o.order_no} <ExternalLink className="h-3 w-3" />
                  </Link>
                  <div className="text-right">
                    <div className="text-rose-200">¥{Number(o.total_cny ?? 0).toFixed(2)}</div>
                    <div className="text-[10px] text-slate-500">
                      {o.status} · {o.payment_status ?? "—"}
                    </div>
                  </div>
                </li>
              ))}
              {orders.length > 10 && (
                <li className="px-3 py-2 text-[10px] text-slate-500">…还有 {orders.length - 10} 笔</li>
              )}
            </ul>
          )}
        </div>

        {forwardings.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">
              集运订单 ({forwardings.length})
            </div>
            <ul className="divide-y divide-white/5 rounded-md border border-white/5 bg-white/[0.02]">
              {forwardings.slice(0, 5).map((f: any) => (
                <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <Link
                    to="/admin/forwardings/$forwardingId"
                    params={{ forwardingId: f.id }}
                    className="inline-flex items-center gap-1 font-mono text-brand hover:underline"
                  >
                    {String(f.id).slice(0, 8)} <ExternalLink className="h-3 w-3" />
                  </Link>
                  <span className="text-[10px] text-slate-500">{f.status}</span>
                </li>
              ))}
              {forwardings.length > 5 && (
                <li className="px-3 py-2 text-[10px] text-slate-500">…还有 {forwardings.length - 5} 笔</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function BlacklistCard({
  userId,
  currentBlacklisted,
  currentReason,
  canEdit,
}: {
  userId: string;
  currentBlacklisted: boolean;
  currentReason: string;
  canEdit: boolean;
  isSelf?: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(setUserBlacklist);
  const [blacklisted, setBlacklisted] = useState(currentBlacklisted);
  const [reason, setReason] = useState(currentReason);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setBlacklisted(currentBlacklisted);
    setReason(currentReason);
  }, [currentBlacklisted, currentReason]);
  const dirty = blacklisted !== currentBlacklisted || (blacklisted && reason !== currentReason);

  const onSave = async () => {
    if (blacklisted && !currentBlacklisted && !confirm("确认将该客户加入黑名单？将禁止其下单和创建集运订单。")) return;
    setBusy(true);
    setMsg(null);
    try {
      await save({ data: { userId, blacklisted, reason: blacklisted ? reason : null } });
      await qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      setMsg({ kind: "ok", text: blacklisted ? "已加入黑名单" : "已移出黑名单" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={`rounded-2xl border p-5 ${currentBlacklisted ? "border-rose-500/30 bg-rose-500/[0.06]" : "border-white/5 bg-white/[0.03]"}`}
    >
      <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
        <Ban className={`h-4 w-4 ${currentBlacklisted ? "text-rose-400" : "text-slate-400"}`} />
        客户黑名单
      </h2>
      <p className="mt-1 text-xs text-slate-400">加入黑名单后，该客户将无法创建新的电商订单和集运订单。</p>
      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={blacklisted}
            onChange={(e) => setBlacklisted(e.target.checked)}
            className="h-4 w-4 accent-rose-500"
          />
          <span className={blacklisted ? "font-semibold text-rose-300" : "text-slate-200"}>
            加入黑名单（禁止下单 / 集运）
          </span>
        </label>
        {blacklisted && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canEdit}
            placeholder="拉黑原因（可选，将作为提示信息）"
            rows={2}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm focus:border-rose-400 focus:outline-none"
          />
        )}
      </div>
      {msg && (
        <div
          className={`mt-3 rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}
      {canEdit && (
        <button
          onClick={onSave}
          disabled={busy || !dirty}
          className={`mt-3 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${blacklisted ? "bg-rose-500 hover:bg-rose-500/90" : "bg-brand hover:bg-brand/90"}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {blacklisted ? (currentBlacklisted ? "更新黑名单" : "加入黑名单") : "移出黑名单"}
        </button>
      )}
    </section>
  );
}

function WalletCard({ userId, currentCad, canEdit }: { userId: string; currentCad: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const save = useServerFn(adjustUserWallet);
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const cur = currentCad;
  const parsed = Number(amount);
  const valid = amount !== "" && Number.isFinite(parsed);
  const preview = valid ? (mode === "set" ? parsed : cur + parsed) : cur;
  const delta = valid ? preview - cur : 0;
  const symbol = "CA$";

  const onSave = async () => {
    if (!valid) return;
    const confirmMsg =
      mode === "set"
        ? `确认将余额设置为 ${symbol}${parsed.toFixed(2)}？`
        : `确认${delta >= 0 ? "增加" : "扣除"} ${symbol}${Math.abs(delta).toFixed(2)}？`;
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    setMsg(null);
    try {
      await save({ data: { userId, mode, amount: parsed, note: note.trim() || null } });
      await qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
      setAmount("");
      setNote("");
      setMsg({ kind: "ok", text: "余额已更新" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
        <Wallet className="h-4 w-4 text-emerald-400" />
        钱包余额调整 (CAD)
      </h2>
      <p className="mt-1 text-xs text-slate-400">
        手动增加 / 扣除 或 直接设定客户钱包余额。每次操作会写入钱包流水与操作日志。
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">当前余额</div>
          <div className="mt-2 text-xs text-slate-400">
            <span className="font-mono font-bold text-slate-100">
              {symbol}
              {cur.toFixed(2)}
            </span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">操作方式</div>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setMode("delta")}
              className={`rounded-md border px-3 py-1 text-xs font-semibold ${mode === "delta" ? "border-brand/40 bg-brand/15 text-white" : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"} disabled:opacity-50`}
            >
              增减（±）
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setMode("set")}
              className={`rounded-md border px-3 py-1 text-xs font-semibold ${mode === "set" ? "border-brand/40 bg-brand/15 text-white" : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20"} disabled:opacity-50`}
            >
              直接设定
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            {mode === "delta" ? "正数为充值，负数为扣款。" : "会将余额直接覆盖为指定值。"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">
            金额 ({symbol}) {mode === "delta" ? "· 支持负数" : ""}
          </div>
          <input
            type="number"
            step="0.01"
            value={amount}
            disabled={!canEdit}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === "delta" ? "如 100 或 -50" : "如 1000.00"}
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div className="sm:pt-6">
          {valid && (
            <div className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs">
              <div className="text-slate-500">调整后余额</div>
              <div className="font-mono text-sm font-bold text-emerald-300">
                {symbol}
                {preview.toFixed(2)}
              </div>
              <div className={`text-[10px] ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">备注（记入流水与日志）</div>
        <input
          value={note}
          disabled={!canEdit}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如：客服补偿 / 退款 / 手动扣款"
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
      </div>

      {msg && (
        <div
          className={`mt-3 rounded-md border px-3 py-1.5 text-xs ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}
        >
          {msg.text}
        </div>
      )}

      {canEdit ? (
        <button
          onClick={onSave}
          disabled={busy || !valid || (mode === "delta" && parsed === 0)}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          确认{mode === "set" ? "设定余额" : parsed < 0 ? "扣款" : "充值"}
        </button>
      ) : (
        <p className="mt-3 text-[10px] text-slate-500">仅总负责人 / 主管可修改余额。</p>
      )}
    </section>
  );
}

// ============================================================
// 客户 HS 编码库
// ============================================================
import {
  listCustomerHsItems,
  upsertCustomerHsItem,
  deleteCustomerHsItem,
  bulkImportCustomerHsItems,
  type CustomerHsItem,
} from "@/lib/customer-hs.functions";
import { Plus, Trash2, Upload, Search, Package2 } from "lucide-react";

function CustomerHsCard({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listCustomerHsItems);
  const upsert = useServerFn(upsertCustomerHsItem);
  const del = useServerFn(deleteCustomerHsItem);
  const bulk = useServerFn(bulkImportCustomerHsItems);

  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["customer-hs-items", userId, search],
    queryFn: () => list({ data: { userId, search } }),
  });

  const [editRow, setEditRow] = useState<CustomerHsItem | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = q.data?.items ?? [];

  const onDelete = async (row: CustomerHsItem) => {
    if (!confirm(`删除 ${row.sku ?? ""} ${row.description}？`)) return;
    setBusyId(row.id);
    try {
      await del({ data: { id: row.id, user_id: userId } });
      await qc.invalidateQueries({ queryKey: ["customer-hs-items", userId] });
    } catch (e: any) {
      alert(e?.message ?? "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display text-base font-bold inline-flex items-center gap-2">
          <Package2 className="h-4 w-4 text-cyan-400" />
          客户 HS 编码库
          <span className="text-xs font-normal text-slate-500">（{rows.length}）</span>
        </h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5"
            >
              <Upload className="h-3.5 w-3.5" /> 批量导入
            </button>
            <button
              onClick={() =>
                setEditRow({
                  id: "",
                  user_id: userId,
                  sku: "",
                  description: "",
                  unit_price_cad: null,
                  items_per_carton: null,
                  ctns: null,
                  hs_code: "",
                  note: "",
                  created_at: "",
                  updated_at: "",
                })
              }
              className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
            >
              <Plus className="h-3.5 w-3.5" /> 新增
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 SKU / 品名 / HS 编码"
          className="w-full rounded-md border border-white/10 bg-white/5 pl-8 pr-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand outline-none"
        />
      </div>

      <div className="mt-3 overflow-x-auto -mx-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-2 py-1.5">SKU</th>
              <th className="px-2 py-1.5">品名</th>
              <th className="px-2 py-1.5 text-right">单价</th>
              <th className="px-2 py-1.5 text-right">内件数</th>
              <th className="px-2 py-1.5 text-right">箱数</th>
              <th className="px-2 py-1.5">HS 编码</th>
              {canEdit && <th className="px-2 py-1.5"></th>}
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-2 py-1.5 font-mono text-slate-300">{r.sku ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-100">{r.description}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">
                    {r.unit_price_cad != null ? `$${Number(r.unit_price_cad).toFixed(2)}` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.items_per_carton ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.ctns ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-cyan-300">{r.hs_code ?? "—"}</td>
                  {canEdit && (
                    <td className="px-2 py-1.5 whitespace-nowrap text-right">
                      <button
                        onClick={() => setEditRow(r)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
                      >
                        编辑
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => onDelete(r)}
                        className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editRow && (
        <HsEditDialog
          row={editRow}
          onClose={() => setEditRow(null)}
          onSave={async (v) => {
            await upsert({ data: { ...v, id: editRow.id || undefined, user_id: userId } });
            await qc.invalidateQueries({ queryKey: ["customer-hs-items", userId] });
            setEditRow(null);
          }}
        />
      )}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImport={async (rows, replace) => {
            const res = await bulk({ data: { user_id: userId, rows, replace } });
            await qc.invalidateQueries({ queryKey: ["customer-hs-items", userId] });
            setShowImport(false);
            alert(`已导入 ${res.inserted} 条`);
          }}
        />
      )}
    </section>
  );
}

function HsEditDialog({
  row,
  onClose,
  onSave,
}: {
  row: CustomerHsItem;
  onClose: () => void;
  onSave: (v: Omit<CustomerHsItem, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
}) {
  const [sku, setSku] = useState(row.sku ?? "");
  const [description, setDescription] = useState(row.description);
  const [unitPrice, setUnitPrice] = useState<string>(row.unit_price_cad != null ? String(row.unit_price_cad) : "");
  const [ipc, setIpc] = useState<string>(row.items_per_carton != null ? String(row.items_per_carton) : "");
  const [ctns, setCtns] = useState<string>(row.ctns != null ? String(row.ctns) : "");
  const [hs, setHs] = useState(row.hs_code ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!description.trim()) {
      setErr("品名不能为空");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        sku: sku.trim() || null,
        description: description.trim(),
        unit_price_cad: unitPrice ? Number(unitPrice) : null,
        items_per_carton: ipc ? Number(ipc) : null,
        ctns: ctns ? Number(ctns) : null,
        hs_code: hs.trim() || null,
        note: note.trim() || null,
      });
    } catch (e: any) {
      setErr(e?.message ?? "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg font-bold">{row.id ? "编辑" : "新增"} HS 物品</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-1">
            <div className="mb-1 text-[10px] uppercase text-slate-400">SKU</div>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5"
            />
          </label>
          <label className="col-span-1">
            <div className="mb-1 text-[10px] uppercase text-slate-400">HS 编码</div>
            <input
              value={hs}
              onChange={(e) => setHs(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono"
            />
          </label>
          <label className="col-span-2">
            <div className="mb-1 text-[10px] uppercase text-slate-400">品名 *</div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5"
            />
          </label>
          <label>
            <div className="mb-1 text-[10px] uppercase text-slate-400">单价 CAD</div>
            <input
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5"
            />
          </label>
          <label>
            <div className="mb-1 text-[10px] uppercase text-slate-400">内件数</div>
            <input
              value={ipc}
              onChange={(e) => setIpc(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5"
            />
          </label>
          <label>
            <div className="mb-1 text-[10px] uppercase text-slate-400">箱数</div>
            <input
              value={ctns}
              onChange={(e) => setCtns(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5"
            />
          </label>
          <label className="col-span-2">
            <div className="mb-1 text-[10px] uppercase text-slate-400">备注</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5"
            />
          </label>
        </div>
        {err && <div className="mt-3 text-xs text-rose-400">{err}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (
    rows: Array<{
      sku?: string | null;
      description: string;
      unit_price_cad?: number | null;
      items_per_carton?: number | null;
      ctns?: number | null;
      hs_code?: string | null;
    }>,
    replace: boolean,
  ) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parse = () => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const out: any[] = [];
    for (const line of lines) {
      const cells = line.split(/\t|,/).map((s) => s.trim());
      if (cells.length < 2) continue;
      // Skip header
      if (/^sku$/i.test(cells[0]) && /desc/i.test(cells[1] ?? "")) continue;
      const [sku, description, unit, ipc, ctns, hs] = cells;
      if (!description) continue;
      out.push({
        sku: sku || null,
        description,
        unit_price_cad: unit ? Number(unit) : null,
        items_per_carton: ipc ? Number(ipc) : null,
        ctns: ctns ? Number(ctns) : null,
        hs_code: hs || null,
      });
    }
    return out;
  };

  const submit = async () => {
    setErr(null);
    const rows = parse();
    if (rows.length === 0) {
      setErr("未解析到任何数据行");
      return;
    }
    setBusy(true);
    try {
      await onImport(rows, replace);
    } catch (e: any) {
      setErr(e?.message ?? "导入失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg font-bold">批量导入 HS 物品</h3>
        <p className="mt-1 text-xs text-slate-400">
          每行一条，字段用 <span className="text-slate-200">Tab</span> 或 <span className="text-slate-200">逗号</span>{" "}
          分隔：
          <span className="font-mono ml-1">SKU, 品名, 单价, 内件数, 箱数, HS编码</span>。可直接从 Excel 复制粘贴。
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={`BB-0008-033\tBABMOO CHOPSTICK\t0.86\t240\t1\t4419.12.00.00`}
          className="mt-3 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-mono text-slate-100 focus:border-brand outline-none"
        />
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          替换该客户现有全部数据
        </label>
        {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 导入
          </button>
        </div>
      </div>
    </div>
  );
}
