import React from "react";
// WeChat login/binding is hidden until the WeChat Open Platform app is approved.
const WECHAT_BIND_ENABLED = false;
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { startOttTopup, startOttHostedCardTopup, syncOttTopup } from "@/lib/ottpay.functions";
import { submitEmtTopup } from "@/lib/wallet.functions";

import { listMyBatches, payMyBatch } from "@/lib/orders.functions";
import { startWechatBind, unbindWechat } from "@/lib/wechat.functions";
import { generateWechatAiBindCode } from "@/lib/wechat-ai-bind.functions";
import { toast } from "sonner";
import { TrackingTimeline } from "@/components/tracking-timeline";
import { HsCodeInput } from "@/components/HsCodeInput";
import { normalizeHsCodeForStorage } from "@/lib/hs-code-format";
import {
  User,
  MapPin,
  Package,
  Truck,
  Wallet,
  LogOut,
  Plus,
  Trash2,
  Loader2,
  ArrowRight,
  ArrowDownCircle,
  ArrowUpCircle,
  LayoutDashboard,
  ShoppingBag,
  Layers,
  Plane,
  Ship,
  Calendar,
  CreditCard,
  CheckCircle2,
  ShoppingCart,
  Warehouse,
  Send,
  Tags,
  Mail,
  KeyRound,
  Eye,
  EyeOff,
  MessageCircle,
  Link2Off,
  ChevronDown,
  Copy,
} from "lucide-react";

// 总览页和"我的批次"页都要读 listMyBatches——共用同一个 query key，切 tab 不用重新拉一遍，
// 付款成功后 invalidate 一次两边都会刷新。
const MY_BATCHES_QK = ["my-batches"] as const;

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "我的账户 / My Account — SinoCargo" }] }),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab; wechat?: "bound" | "taken" | "failed" } => {
    const raw = typeof s.tab === "string" ? s.tab : "";
    const allowed = [
      "overview",
      "profile",
      "addresses",
      "batches",
      "myOrders",
      "wallet",
      "inventory",
      "myItems",
    ] as const;
    const tab = (allowed as readonly string[]).includes(raw) ? (raw as (typeof allowed)[number]) : undefined;
    const rawWechat = typeof s.wechat === "string" ? s.wechat : "";
    const wechat = (["bound", "taken", "failed"] as const).includes(rawWechat as any)
      ? (rawWechat as "bound" | "taken" | "failed")
      : undefined;
    return { tab, wechat };
  },
  component: AccountPage,
});

type Tab = "overview" | "profile" | "addresses" | "batches" | "myOrders" | "wallet" | "inventory" | "myItems";

const sb = supabase as any;

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  username: string | null;
  preferred_lang: string;
  preferred_currency: string;
  wechat_openid: string | null;
  wechat_nickname: string | null;
  invoice_title: string | null;
  invoice_phone: string | null;
  invoice_email: string | null;
  invoice_address: string | null;
}
interface Address {
  id: string;
  recipient: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  destination_code: string | null;
}
interface Destination {
  code: string;
  name_zh: string;
  name_en: string | null;
  country: string;
}
interface WalletRow {
  user_id: string;
  balance_cad: number;
}
interface WalletTx {
  id: string;
  type: string;
  amount_cad: number;
  amount_cny: number | null;
  status: string;
  channel: string | null;
  note: string | null;
  created_at: string;
}

function AccountPage() {
  const { user, signOut } = useAuth();
  const { lang } = useApp();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>(search.tab ?? "overview");
  useEffect(() => {
    if (search.tab) setTab(search.tab as Tab);
  }, [search.tab]);
  const [ordersFilter, setOrdersFilter] = useState<"all" | "order" | "forwarding" | "unwarehoused">("all");
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  // Land here after the WeChat OAuth redirect (see wechat.callback.ts).
  useEffect(() => {
    if (!search.wechat) return;
    if (search.wechat === "bound") toast.success(tr("微信绑定成功", "WeChat account linked"));
    else if (search.wechat === "taken")
      toast.error(tr("该微信号已绑定其他账号", "This WeChat account is already linked to another user"));
    else toast.error(tr("微信绑定失败，请重试", "WeChat binding failed — please try again"));
    navigate({ to: "/account", search: { tab: "profile" }, replace: true });
  }, [search.wechat]);

  const nav: { k: Tab; l: string; i: React.ReactNode }[] = [
    { k: "overview", l: tr("概览", "Overview"), i: <LayoutDashboard className="h-4 w-4" /> },
    {
      k: "myOrders",
      l: tr("我的订单/运单", "My orders/waybills"),
      i: <Package className="h-4 w-4" />,
    },
    { k: "inventory", l: tr("我的库存", "My inventory"), i: <Warehouse className="h-4 w-4" /> },
    { k: "myItems", l: tr("我的物品", "My items"), i: <Tags className="h-4 w-4" /> },
    { k: "batches", l: tr("我的批次", "My batches"), i: <Layers className="h-4 w-4" /> },
    { k: "wallet", l: tr("我的钱包", "Wallet"), i: <Wallet className="h-4 w-4" /> },
    { k: "addresses", l: tr("收货地址", "Addresses"), i: <MapPin className="h-4 w-4" /> },
    { k: "profile", l: tr("个人资料", "Profile"), i: <User className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{tr("我的账户", "My Account")}</h1>
          <p className="mt-1 text-sm text-ink-soft">{user?.email}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-surface px-4 py-2 text-sm hover:border-destructive hover:text-destructive sm:self-end"
        >
          <LogOut className="h-4 w-4" />
          {tr("退出登录", "Sign out")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <AccountNavDropdown nav={nav} tab={tab} onSelect={setTab} />

        <nav className="hidden gap-2 lg:flex lg:flex-col">
          {nav.map((it) => (
            <button
              key={it.k}
              onClick={() => setTab(it.k)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${tab === it.k ? "border-brand bg-brand/5 text-brand" : "border-border bg-surface text-ink-soft hover:border-brand/40"}`}
            >
              {it.i}
              {it.l}
            </button>
          ))}
        </nav>

        <section>
          {tab === "overview" && <OverviewTab onJump={setTab} setOrdersFilter={setOrdersFilter} />}
          {tab === "profile" && <ProfileTab />}
          {tab === "addresses" && <AddressTab />}
          {tab === "batches" && <BatchesTab onJump={setTab} />}
          {tab === "myOrders" && <MyOrdersTab initialFilter={ordersFilter} />}
          {tab === "inventory" && <InventoryTab />}
          {tab === "myItems" && <MyItemsTab />}
          {tab === "wallet" && <WalletTab />}
        </section>
      </div>
    </div>
  );
}

// Mobile-only replacement for the horizontal-scrolling tab strip: a tap target
// that opens a full-width list of sections. Hidden at lg: the desktop sidebar
// nav takes over there.
function AccountNavDropdown({
  nav,
  tab,
  onSelect,
}: {
  nav: { k: Tab; l: string; i: React.ReactNode }[];
  tab: Tab;
  onSelect: (t: Tab) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = nav.find((it) => it.k === tab) ?? nav[0];

  return (
    <div className="relative lg:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-brand"
      >
        {current.i}
        <span className="flex-1 text-left">{current.l}</span>
        <ChevronDown className={`h-4 w-4 text-ink-soft transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
            {nav.map((it) => (
              <button
                key={it.k}
                onClick={() => {
                  onSelect(it.k);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium transition ${tab === it.k ? "bg-brand/5 text-brand" : "text-ink-soft hover:bg-accent"}`}
              >
                {it.i}
                {it.l}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="break-words text-foreground">{value}</div>
      </div>
      <button
        onClick={handleCopy}
        className="shrink-0 rounded-full border border-border p-2 text-ink-soft hover:border-brand/40 hover:text-brand"
        aria-label={label}
      >
        {copied ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ===================== Overview =====================
interface UnpaidBatch {
  batch_no: string;
  total_cad: number | null;
  shipping_method: string | null;
}

function OverviewTab({
  onJump,
  setOrdersFilter,
}: {
  onJump: (t: Tab) => void;
  setOrdersFilter: (f: OrderFilter) => void;
}) {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const fetchMyBatches = useServerFn(listMyBatches);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [customerCode, setCustomerCode] = useState<string | null>(null);
  const [totalOrders, setTotalOrders] = useState<number | null>(null);
  const [inTransit, setInTransit] = useState<number>(0);
  const [unwarehoused, setUnwarehoused] = useState<number>(0);

  const { data: batchesData } = useQuery({
    queryKey: MY_BATCHES_QK,
    queryFn: () => fetchMyBatches(),
  });
  const allBatches = ((batchesData as any)?.batches ?? []) as any[];
  const batchCount = allBatches.length;
  const unpaidBatches: UnpaidBatch[] = allBatches
    .filter((b) => !b.is_paid)
    .map((b) => ({
      batch_no: b.batch_no,
      total_cad: b.subtotal_cad,
      shipping_method: b.shipping_method,
    }));

  useEffect(() => {
    sb.from("wallets")
      .select("*")
      .maybeSingle()
      .then(({ data }: any) => setWallet(data ?? { balance_cad: 0 }));
    sb.from("profiles")
      .select("customer_code")
      .maybeSingle()
      .then(({ data }: any) => setCustomerCode(data?.customer_code ?? null));
    Promise.all([
      sb.from("orders").select("id,status,batch_no"),
      sb.from("forwarding_orders").select("id,status,batch_no"),
    ]).then(([o, f]: any) => {
      const oRows = o.data ?? [];
      const fRows = f.data ?? [];
      setTotalOrders(oRows.length + fRows.length);
      const transit =
        oRows.filter((r: any) => r.status === "shipped").length +
        fRows.filter((r: any) => ["shipped", "in_transit"].includes(r.status)).length;
      setInTransit(transit);
      setUnwarehoused(fRows.filter((r: any) => r.status === "pending").length);
    });
  }, []);

  // total_cad 为 null 表示未确认/快照还没就绪——不计入"待付合计"，避免把 null 当 0 误导
  const unpaidTotalCad = unpaidBatches.reduce((s, b) => s + (b.total_cad ?? 0), 0);

  return (
    <div className="space-y-6">
      {customerCode && (
        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white">
                <User className="h-5 w-5" />
              </span>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-soft">
                  {tr("个人账户编号", "Personal account number")}
                </div>
                <div className="font-display text-xl font-bold tracking-widest text-brand">{customerCode}</div>
              </div>
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(customerCode);
                toast.success(tr("已复制", "Copied"));
              }}
              className="rounded-full border border-brand/40 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand hover:text-white"
            >
              {tr("复制编号", "Copy")}
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-surface/60 p-3 sm:p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
              <Warehouse className="h-4 w-4 text-brand" />
              {tr("义乌仓库地址", "Yiwu Warehouse Address")}
            </div>
            <div className="space-y-3">
              <CopyRow
                label={tr("地址", "Address")}
                value={`浙江省金华市义乌市，福田街道通福五区2幢1单元1层壹嘉（${customerCode}）`}
              />
              <CopyRow label={tr("收件人", "Recipient")} value={`壹嘉${customerCode}`} />
              <CopyRow label={tr("电话", "Phone")} value="17280907818" />
            </div>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={tr("钱包余额", "Wallet balance")}
          value={wallet ? `CA$${Number(wallet.balance_cad ?? 0).toFixed(2)}` : "—"}
          sub={
            unpaidTotalCad > 0
              ? tr(
                  `未付款 CA$${unpaidTotalCad.toFixed(2)} · ${unpaidBatches.length} 个批次`,
                  `Unpaid CA$${unpaidTotalCad.toFixed(2)} · ${unpaidBatches.length} batch(es)`,
                )
              : tr("无未付款", "Nothing due")
          }
          icon={<Wallet className="h-5 w-5" />}
          tone="brand"
          action={
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => onJump("wallet")} className="text-xs font-medium text-brand hover:underline">
                {tr("充值 →", "Top up →")}
              </button>
              {unpaidTotalCad > 0 && (
                <button onClick={() => onJump("batches")} className="text-xs font-medium text-cta hover:underline">
                  {tr("去付款 →", "Pay now →")}
                </button>
              )}
            </div>
          }
        />
        <StatCard
          label={tr("我的订单/运单", "My orders/waybills")}
          value={totalOrders === null ? "—" : String(totalOrders)}
          sub={inTransit > 0 ? tr(`${inTransit} 件运输中`, `${inTransit} in transit`) : ""}
          icon={<Package className="h-5 w-5" />}
          action={
            <button onClick={() => onJump("myOrders")} className="text-xs font-medium text-brand hover:underline">
              {tr("查看 →", "View →")}
            </button>
          }
        />
        <StatCard
          label={tr("未入库订单", "Awaiting arrival")}
          value={String(unwarehoused)}
          sub={tr("集运待入库", "Forwarding pending")}
          icon={<Truck className="h-5 w-5" />}
          action={
            <button
              onClick={() => {
                setOrdersFilter("unwarehoused");
                onJump("myOrders");
              }}
              className="text-xs font-medium text-brand hover:underline"
            >
              {tr("处理 →", "Manage →")}
            </button>
          }
        />
        <StatCard
          label={tr("我的批次", "My batches")}
          value={String(batchCount)}
          sub={tr("发货批次数量", "Shipping batches")}
          icon={<Layers className="h-5 w-5" />}
          action={
            <button onClick={() => onJump("batches")} className="text-xs font-medium text-brand hover:underline">
              {tr("查看批次 →", "View batches →")}
            </button>
          }
        />
      </div>

      {unpaidBatches.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-display text-sm font-bold">
              <CreditCard className="h-4 w-4 text-warning" />
              {tr("待付批次明细", "Unpaid batches")}
            </div>
            <button onClick={() => onJump("batches")} className="text-xs font-medium text-brand hover:underline">
              {tr("前往结算 →", "Settle →")}
            </button>
          </div>
          <ul className="space-y-2">
            {unpaidBatches.map((b) => (
              <li
                key={b.batch_no}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-brand/10 text-brand">
                  {b.shipping_method === "air" ? <Plane className="h-3 w-3" /> : <Ship className="h-3 w-3" />}
                </span>
                <span className="font-mono text-xs font-semibold">{b.batch_no}</span>
                <span className="ml-auto text-right font-display text-base font-bold text-foreground">
                  {b.total_cad == null
                    ? <span className="text-xs font-medium text-amber-600">{tr("等待客服确认费用", "Awaiting fee confirmation")}</span>
                    : `CA$${b.total_cad.toFixed(2)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          to="/forwarding"
          className="group flex items-center justify-between rounded-2xl border border-border bg-surface p-5 transition hover:border-brand"
        >
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <Plus className="h-4 w-4 text-brand" />
              {tr("发起新集运", "New forwarding request")}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {tr("提交国内快递单号，到仓后短信通知", "Submit domestic tracking numbers, get SMS updates")}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-soft transition group-hover:translate-x-1 group-hover:text-brand" />
        </Link>
        <Link
          to="/invoices"
          className="group flex items-center justify-between rounded-2xl border border-border bg-surface p-5 transition hover:border-brand"
        >
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <Package className="h-4 w-4 text-brand" />
              {tr("我的账单", "My invoices")}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {tr("查看待付/已付账单并在线支付", "View and pay invoices online")}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-soft transition group-hover:translate-x-1 group-hover:text-brand" />
        </Link>
        <Link
          to="/products"
          className="group flex items-center justify-between rounded-2xl border border-border bg-surface p-5 transition hover:border-brand"
        >
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <ShoppingBag className="h-4 w-4 text-brand" />
              {tr("继续购物", "Continue shopping")}
            </div>
            <p className="mt-1 text-xs text-ink-soft">{tr("浏览自营商城精选商品", "Browse curated products")}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-soft transition group-hover:translate-x-1 group-hover:text-brand" />
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  action,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  tone?: "brand";
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${tone === "brand" ? "border-brand/30 bg-brand/5" : "border-border bg-surface"}`}
    >
      <div className="flex items-center justify-between text-ink-soft">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className={tone === "brand" ? "text-brand" : ""}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-soft">{sub}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ===================== Profile =====================
function ProfileTab() {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const initialUsername = useRef<string | null>(null);

  useEffect(() => {
    sb.from("profiles")
      .select("*")
      .maybeSingle()
      .then(({ data }: any) => {
        setProfile(data);
        initialUsername.current = data?.username ?? null;
      });
  }, []);
  if (!profile) return <Spinner />;

  const save = async () => {
    const p: any = profile;
    const username = (p.username ?? "").trim();
    if (!username) return toast.error(tr("登录名不能为空", "Login name is required"));

    setBusy(true);
    if (username.toLowerCase() !== (initialUsername.current ?? "").toLowerCase()) {
      const { data: available, error: checkErr } = await sb.rpc("check_username_available", {
        p_username: username,
      });
      if (checkErr) {
        toast.error(checkErr.message);
        setBusy(false);
        return;
      }
      if (!available) {
        toast.error(tr("登录名已被占用", "Login name is already taken"));
        setBusy(false);
        return;
      }
    }

    const { error } = await sb
      .from("profiles")
      .update({
        full_name: p.full_name,
        phone: p.phone,
        username,
        preferred_lang: p.preferred_lang,
        reg_country: p.reg_country ?? null,
        reg_province: p.reg_province ?? null,
        reg_city: p.reg_city ?? null,
        reg_address: p.reg_address ?? null,
        reg_postal_code: p.reg_postal_code ?? null,
        reg_phone: p.reg_phone ?? null,
        invoice_title: p.invoice_title ?? null,
        invoice_phone: p.invoice_phone ?? null,
        invoice_email: p.invoice_email ?? null,
        invoice_address: p.invoice_address ?? null,
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    initialUsername.current = username;
    toast.success(tr("已保存", "Saved"));
  };

  const p: any = profile;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 font-display text-xl font-bold">{tr("个人资料", "Profile")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("邮箱", "Email")}>
            <input disabled value={profile.email ?? ""} className={inputCls + " opacity-60"} />
          </Field>
          <Field label={tr("登录名", "Login name")}>
            <input
              value={profile.username ?? ""}
              onChange={(e) => setProfile({ ...profile, username: e.target.value.replace(/\s+/g, "") })}
              className={inputCls}
            />
          </Field>
          <Field label={tr("姓名", "Full name")}>
            <input
              value={profile.full_name ?? ""}
              onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={tr("手机号", "Phone")}>
            <input
              value={profile.phone ?? ""}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={tr("偏好语言", "Preferred language")}>
            <select
              value={profile.preferred_lang}
              onChange={(e) => setProfile({ ...profile, preferred_lang: e.target.value })}
              className={inputCls}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
      </div>

      <AccountSecurityCard profile={profile} setProfile={setProfile} />

      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-1 font-display text-xl font-bold">{tr("注册地址", "Registered address")}</h2>
        <p className="mb-4 text-xs text-ink-soft">
          {tr(
            "用于集运单详情展示，可与收件地址不同。",
            "Shown on forwarding details — can differ from shipping address.",
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("国家", "Country")}>
            <input
              value={p.reg_country ?? ""}
              onChange={(e) => setProfile({ ...profile, reg_country: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("省 / 州", "Province / State")}>
            <input
              value={p.reg_province ?? ""}
              onChange={(e) => setProfile({ ...profile, reg_province: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("城市", "City")}>
            <input
              value={p.reg_city ?? ""}
              onChange={(e) => setProfile({ ...profile, reg_city: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("邮编", "Postal code")}>
            <input
              value={p.reg_postal_code ?? ""}
              onChange={(e) => setProfile({ ...profile, reg_postal_code: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("详细地址", "Address")} full>
            <input
              value={p.reg_address ?? ""}
              onChange={(e) => setProfile({ ...profile, reg_address: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("联系电话", "Contact phone")}>
            <input
              value={p.reg_phone ?? ""}
              onChange={(e) => setProfile({ ...profile, reg_phone: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-1 font-display text-xl font-bold">{tr("发票信息", "Invoice info")}</h2>
        <p className="mb-4 text-xs text-ink-soft">
          {tr(
            "填写后会显示在账单「付款方」区块——留空则账单沿用姓名/电话/邮箱。",
            "Shown in the invoice's bill-to block once filled in — leave blank to keep using your name/phone/email.",
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("发票抬头", "Invoice title")} full>
            <input
              value={p.invoice_title ?? ""}
              onChange={(e) => setProfile({ ...profile, invoice_title: e.target.value } as any)}
              placeholder={tr("公司名称 / 个人姓名", "Company or personal name")}
              className={inputCls}
            />
          </Field>
          <Field label={tr("发票电话", "Invoice phone")}>
            <input
              value={p.invoice_phone ?? ""}
              onChange={(e) => setProfile({ ...profile, invoice_phone: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("发票邮箱", "Invoice email")}>
            <input
              value={p.invoice_email ?? ""}
              onChange={(e) => setProfile({ ...profile, invoice_email: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
          <Field label={tr("发票地址", "Invoice address")} full>
            <input
              value={p.invoice_address ?? ""}
              onChange={(e) => setProfile({ ...profile, invoice_address: e.target.value } as any)}
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      <button
        onClick={save}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full bg-cta-gradient px-6 py-2.5 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {tr("保存修改", "Save changes")}
      </button>
    </div>
  );
}

// Supabase throws "Auth session missing!"/session_not_found when the stored
// session was revoked elsewhere (logout in another tab, password change, expiry).
// Revalidate + refresh before any auth mutation, and bounce to sign-in if gone.
async function ensureFreshSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return true;
  const { data: r } = await supabase.auth.refreshSession();
  if (r?.session) return true;
  await supabase.auth.signOut().catch(() => {});
  return false;
}

// ===================== Account security (password / email / WeChat) =====================

function AccountSecurityCard({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const p: any = profile;

  // Keep profiles.email in sync with the real login email (auth user). The email
  // change only lands after the user clicks the confirmation link, at which point
  // Supabase emits USER_UPDATED — mirror it so the UI shows the address they can
  // actually sign in with.
  useEffect(() => {
    const sync = async () => {
      const { data } = await supabase.auth.getUser();
      const authEmail = data.user?.email;
      if (!authEmail || authEmail === p.email) return;
      await supabase.from("profiles").update({ email: authEmail }).eq("id", p.id);
      setProfile({ ...(profile as any), email: authEmail });
    };
    sync();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "USER_UPDATED") sync();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, p.email]);

  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const refreshIdentities = async () => {
    const { data } = await supabase.auth.getUserIdentities();
    const g = data?.identities?.find((i: any) => i.provider === "google");
    setGoogleEmail(g ? ((g.identity_data as any)?.email ?? "google") : null);
  };
  useEffect(() => {
    refreshIdentities();
  }, []);
  const linkGoogle = async () => {
    setGoogleBusy(true);
    const { googleReturnUrl } = await import("@/lib/google-auth");
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: googleReturnUrl(window.location.origin, "/account") },
    });
    setGoogleBusy(false);
    if (error)
      toast.error(
        tr(
          `绑定失败：${error.message}。也可直接把登录邮箱改成你的 Google 邮箱后使用 Google 登录`,
          `Link failed: ${error.message}`,
        ),
      );
  };
  const unlinkGoogle = async () => {
    const { data } = await supabase.auth.getUserIdentities();
    const g = data?.identities?.find((i: any) => i.provider === "google");
    if (!g) return;
    if (!confirm(tr("确定解绑 Google 登录吗？", "Unlink Google sign-in?"))) return;
    setGoogleBusy(true);
    const { error } = await supabase.auth.unlinkIdentity(g);
    setGoogleBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tr("已解绑 Google", "Google unlinked"));
    refreshIdentities();
  };

  const [newEmail, setNewEmail] = useState("");

  const [emailBusy, setEmailBusy] = useState(false);

  const sessionGone = () => {
    toast.error(tr("登录状态已失效，请重新登录", "Your session expired — please sign in again"));
    window.location.href = "/auth?redirect=/account";
  };

  const changeEmail = async () => {
    const email = newEmail.trim();
    if (!email) return;
    setEmailBusy(true);
    if (!(await ensureFreshSession())) {
      setEmailBusy(false);
      return sessionGone();
    }
    const { error } = await supabase.auth.updateUser({ email });
    setEmailBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      tr(
        "验证邮件已发送到新邮箱，请查收并点击确认链接完成更换",
        "A confirmation link was sent to the new address — click it to finish the change",
      ),
    );
    setNewEmail("");
  };

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const changePassword = async () => {
    if (pw1.length < 6) return toast.error(tr("密码至少需要6位", "Password must be at least 6 characters"));
    if (pw1 !== pw2) return toast.error(tr("两次输入的密码不一致", "Passwords do not match"));
    setPwBusy(true);
    if (!(await ensureFreshSession())) {
      setPwBusy(false);
      return sessionGone();
    }
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tr("密码已更新", "Password updated"));
    setPw1("");
    setPw2("");
  };


  const startBind = useServerFn(startWechatBind);
  const doUnbind = useServerFn(unbindWechat);
  const [wechatBusy, setWechatBusy] = useState(false);
  const bindWechat = async () => {
    setWechatBusy(true);
    const r: any = await startBind({ data: { origin: window.location.origin } }).catch(() => null);
    setWechatBusy(false);
    if (!r?.configured) {
      toast.info(
        tr(
          "微信绑定即将开放：管理员需在微信开放平台申请网页应用并填入 AppID/AppSecret",
          "WeChat binding coming soon — admin must register a WeChat Open Platform web app and add AppID/AppSecret",
        ),
      );
      return;
    }
    window.location.href = r.url;
  };
  const unbindWx = async () => {
    if (!confirm(tr("确定要解绑微信吗？", "Unbind your WeChat account?"))) return;
    setWechatBusy(true);
    try {
      await doUnbind();
      setProfile({ ...profile, wechat_openid: null, wechat_nickname: null });
      toast.success(tr("已解绑微信", "WeChat unbound"));
    } catch (e: any) {
      toast.error(e.message ?? tr("解绑失败", "Failed to unbind"));
    } finally {
      setWechatBusy(false);
    }
  };

  const genAiBindCode = useServerFn(generateWechatAiBindCode);
  const [aiCode, setAiCode] = useState<string | null>(null);
  const [aiCodeBusy, setAiCodeBusy] = useState(false);
  const makeAiBindCode = async () => {
    setAiCodeBusy(true);
    try {
      const r: any = await genAiBindCode();
      setAiCode(r.code);
      toast.success(tr("绑定码已生成，10 分钟内有效", "Bind code generated — valid for 10 minutes"));
    } catch (e: any) {
      toast.error(e.message ?? tr("生成失败", "Failed to generate"));
    } finally {
      setAiCodeBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="mb-4 font-display text-xl font-bold">{tr("账号安全", "Account security")}</h2>
      <div className="space-y-6">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-ink-soft" />
            {tr("登录邮箱", "Login email")}
          </div>
          <p className="mb-2 text-xs text-ink-soft">
            {tr("当前", "Current")}: {p.email ?? "—"}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value.trim())}
              placeholder={tr("新邮箱地址", "New email address")}
              className={inputCls + " max-w-xs"}
            />
            <button
              onClick={changeEmail}
              disabled={emailBusy || !newEmail}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {emailBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {tr("更换邮箱", "Update email")}
            </button>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-ink-soft" />
            {tr("设置密码", "Set password")}
          </div>
          <p className="mb-2 text-xs text-ink-soft">
            {tr(
              "密码要求：至少 6 位，建议包含字母和数字，区分大小写，勿使用 123456 等简单密码。",
              "Password rules: at least 6 characters, letters + numbers recommended, case-sensitive; avoid simple ones like 123456.",
            )}
          </p>
          <div className="grid max-w-md gap-2 sm:grid-cols-2">
            <div className="relative">
              <input
                type={showPw1 ? "text" : "password"}
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                placeholder={tr("新密码（至少6位）", "New password (min 6)")}
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPw1((v) => !v)}
                aria-label={tr("显示/隐藏密码", "Show/hide password")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-foreground"
              >
                {showPw1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="relative">
              <input
                type={showPw2 ? "text" : "password"}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder={tr("确认新密码", "Confirm new password")}
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPw2((v) => !v)}
                aria-label={tr("显示/隐藏密码", "Show/hide password")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-foreground"
              >
                {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <button
            onClick={changePassword}
            disabled={pwBusy || !pw1 || !pw2}
            className="mt-2 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {pwBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {tr("更新密码", "Update password")}
          </button>
        </div>


        <div className="border-t border-border pt-6">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-ink-soft" />
            {tr("Google 登录", "Google sign-in")}
          </div>
          <p className="mb-2 text-xs text-ink-soft">
            {tr(
              "绑定后可在登录页点「使用 Google 继续」直接登录，无需密码。",
              "Once linked you can sign in with “Continue with Google” — no password needed.",
            )}
          </p>
          {googleEmail ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {tr(`已绑定：${googleEmail}`, `Linked: ${googleEmail}`)}
              </span>
              <button
                onClick={unlinkGoogle}
                disabled={googleBusy}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-destructive hover:text-destructive disabled:opacity-50"
              >
                {googleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                {tr("解绑", "Unlink")}
              </button>
            </div>
          ) : (
            <button
              onClick={linkGoogle}
              disabled={googleBusy}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {googleBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {tr("绑定 Google 账号", "Link Google account")}
            </button>
          )}
        </div>

        {WECHAT_BIND_ENABLED && (
        <div className="border-t border-border pt-6">

          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="h-4 w-4 text-ink-soft" />
            {tr("绑定微信", "Bind WeChat")}
          </div>
          {p.wechat_openid ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {tr(`已绑定：${p.wechat_nickname ?? "微信用户"}`, `Linked: ${p.wechat_nickname ?? "WeChat user"}`)}
              </span>
              <button
                onClick={unbindWx}
                disabled={wechatBusy}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-destructive hover:text-destructive disabled:opacity-50"
              >
                {wechatBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                {tr("解绑", "Unbind")}
              </button>
            </div>
          ) : (
            <button
              onClick={bindWechat}
              disabled={wechatBusy}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {wechatBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {tr("绑定微信", "Bind WeChat")}
            </button>
          )}
        </div>
        )}

        <div className="border-t border-border pt-6">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="h-4 w-4 text-ink-soft" />
            {tr("微信 AI 客服绑定码", "WeChat AI assistant bind code")}
          </div>
          <p className="mb-3 text-xs text-ink-soft">
            {tr(
              "生成一次性绑定码（10 分钟有效），在微信 AI 客服中回复该码，即可让客服代您查询和录入集运订单。",
              "Generate a one-time code (valid 10 minutes) and send it to our WeChat AI assistant so it can look up and create forwarding orders for you.",
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={makeAiBindCode}
              disabled={aiCodeBusy}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {aiCodeBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {tr("生成绑定码", "Generate code")}
            </button>
            {aiCode && (
              <span className="rounded-full bg-brand/10 px-3 py-1.5 font-mono text-sm font-bold tracking-widest text-brand">
                {aiCode}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================== Addresses =====================
function AddressTab() {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [list, setList] = useState<Address[]>([]);
  const [editing, setEditing] = useState<Partial<Address> | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const isNew = editing && !editing.id;

  const load = () =>
    sb
      .from("addresses")
      .select("*")
      .order("is_default", { ascending: false })
      .then(({ data }: any) => setList(data ?? []));
  useEffect(() => {
    load();
    sb.from("destinations")
      .select("code,name_zh,name_en,country")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }: any) => setDestinations(data ?? []));
  }, []);

  const save = async () => {
    if (!editing) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    if (editing.is_default) await sb.from("addresses").update({ is_default: false }).eq("user_id", user.id);
    const payload = { ...editing, user_id: user.id };
    const { error } = editing.id
      ? await sb.from("addresses").update(payload).eq("id", editing.id)
      : await sb.from("addresses").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(tr("地址已保存", "Address saved"));
    setEditing(null);
    load();
  };
  const del = async (id: string) => {
    if (!confirm(tr("确定删除？", "Delete this address?"))) return;
    await sb.from("addresses").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold">{tr("收货地址", "Shipping addresses")}</h2>
        <button
          onClick={() => setEditing({ country: "CA" })}
          className="inline-flex items-center gap-1 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr("新增地址", "Add address")}
        </button>
      </div>

      {editing && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-3 text-sm font-semibold">
            {isNew ? tr("新增地址", "New address") : tr("编辑地址", "Edit address")}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr("收件人", "Recipient")}>
              <input
                className={inputCls}
                value={editing.recipient ?? ""}
                onChange={(e) => setEditing({ ...editing, recipient: e.target.value })}
              />
            </Field>
            <Field label={tr("电话", "Phone")}>
              <input
                className={inputCls}
                value={editing.phone ?? ""}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </Field>
            <Field label={tr("地址行1", "Address line 1")} full>
              <input
                className={inputCls}
                value={editing.line1 ?? ""}
                onChange={(e) => setEditing({ ...editing, line1: e.target.value })}
              />
            </Field>
            <Field label={tr("地址行2 (可选)", "Address line 2")} full>
              <input
                className={inputCls}
                value={editing.line2 ?? ""}
                onChange={(e) => setEditing({ ...editing, line2: e.target.value })}
              />
            </Field>
            <Field label={tr("城市", "City")}>
              <input
                className={inputCls}
                value={editing.city ?? ""}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
              />
            </Field>
            <Field label={tr("省份", "Province")}>
              <input
                className={inputCls}
                value={editing.province ?? ""}
                onChange={(e) => setEditing({ ...editing, province: e.target.value })}
                placeholder="ON / BC / AB"
              />
            </Field>
            <Field label={tr("邮编", "Postal code")}>
              <input
                className={inputCls}
                value={editing.postal_code ?? ""}
                onChange={(e) => setEditing({ ...editing, postal_code: e.target.value })}
                placeholder="M5V 3L9"
              />
            </Field>
            <Field label={tr("目的地", "Destination")}>
              <select
                className={inputCls}
                value={editing.destination_code ?? ""}
                onChange={(e) => setEditing({ ...editing, destination_code: e.target.value || null })}
              >
                <option value="">{tr("— 选择目的地 —", "— Select destination —")}</option>
                {destinations.map((d) => (
                  <option key={d.code} value={d.code}>
                    {lang === "zh" ? d.name_zh : (d.name_en ?? d.name_zh)} ({d.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr("默认地址", "Default")}>
              <label className="flex h-11 items-center gap-2 px-1 text-sm">
                <input
                  type="checkbox"
                  checked={!!editing.is_default}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })}
                />
                {tr("设为默认", "Set as default")}
              </label>
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={save}
              className="rounded-full bg-cta-gradient px-5 py-2 text-sm font-semibold text-cta-foreground"
            >
              {tr("保存", "Save")}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-full border border-border px-5 py-2 text-sm">
              {tr("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && !editing ? (
        <Empty
          icon={<MapPin />}
          text={tr("还没有地址，点击右上角添加一个", "No addresses yet — add one to get started")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <div key={a.id} className="relative rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center gap-2 font-semibold">
                {a.recipient}
                {a.is_default && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                    {tr("默认", "Default")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink-soft">{a.phone}</p>
              <p className="mt-2 text-sm">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ""}
              </p>
              <p className="text-sm text-ink-soft">
                {a.city}, {a.province} {a.postal_code} · {a.country}
              </p>
              {a.destination_code &&
                (() => {
                  const d = destinations.find((x) => x.code === a.destination_code);
                  return (
                    <p className="mt-2 text-sm">
                      <span className="text-ink-soft">{tr("目的地", "Destination")}: </span>
                      <span className="font-bold">
                        {d ? `${lang === "zh" ? d.name_zh : (d.name_en ?? d.name_zh)} (${d.code})` : a.destination_code}
                      </span>
                    </p>
                  );
                })()}
              <div className="absolute right-3 top-3 flex gap-1">
                <button
                  onClick={() => setEditing(a)}
                  className="rounded-full px-2 py-1 text-xs text-ink-soft hover:bg-accent"
                >
                  {tr("编辑", "Edit")}
                </button>
                <button
                  onClick={() => del(a.id)}
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-soft hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== Batches (merged: orders + forwarding) =====================
// Batch visibility + amounts come from listMyBatches() (src/lib/orders.functions.ts):
// it reads the per-(batch × customer) snapshot in batch_settlements (written when
// staff lock / confirm the batch) — the same figures the admin "扣款" screens show —
// and only falls back to a full computeBatchFeeSummary when that snapshot is missing
// or stale, re-writing it afterwards. A batch appears once it's shipped/arrived/closed.
interface BatchItem {
  kind: "order" | "forwarding";
  id: string;
  no: string;
  status: string;
  tracking_no: string | null;
  payment_status: string;
}
interface BatchFeeLines {
  freight_cad: number;
  insurance_cad: number;
  customs_cad: number;
  clearance_cad: number;
  surcharge_cad: number;
  delivery_cad: number;
  inspection_cad: number;
  discount_cad: number;
}
interface BatchDutyItem {
  name: string;
  hs_code: string | null;
  tax_rate: number;
  mfn_rate: number;
  gst_rate: number;
  anti_dumping_rate: number;
  unit_price_cad: number;
  quantity: number;
  declared_value_cad: number;
  duty_cad: number;
}
interface Batch {
  batch_id: string;
  batch_no: string;
  shipping_method: string | null;
  eta: string | null;
  status: "shipped" | "arrived" | "closed";
  items: BatchItem[];
  subtotal_cad: number | null;
  fee_lines?: BatchFeeLines | null;
  duty_items?: BatchDutyItem[] | null;
  duty_unmatched_hs?: string[] | null;
  price_confirmed?: boolean;
  // 已确认但快照还没就绪（异常情况，比如后台改动没来得及回写）——不是"未确认"也不是"算好了"
  snapshot_pending?: boolean;
  is_paid: boolean;
  intl_tracking_nos: string[];
}

const BATCH_STATUS_LABELS: Record<Batch["status"], [string, string, string]> = {
  shipped: ["已发出", "Shipped", "bg-brand/10 text-brand"],
  arrived: ["已到件", "Arrived", "bg-cta/10 text-cta"],
  closed: ["已关闭", "Closed", "bg-success/10 text-success"],
};

function BatchesTab({ onJump }: { onJump: (t: Tab) => void }) {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const navigate = useNavigate();
  const fetchMyBatches = useServerFn(listMyBatches);
  const doPay = useServerFn(payMyBatch);
  const qc = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);

  const { data: batchesData } = useQuery({
    queryKey: MY_BATCHES_QK,
    queryFn: () => fetchMyBatches(),
  });
  const batches = batchesData ? ((batchesData as any).batches as Batch[]) : null;
  const load = () => qc.invalidateQueries({ queryKey: MY_BATCHES_QK });

  const pay = async (batchId: string, batchNo: string, amountCad: number) => {
    if (
      !confirm(
        tr(
          `确认从钱包支付 CA$${amountCad.toFixed(2)} 给批次 ${batchNo}?`,
          `Pay CA$${amountCad.toFixed(2)} from wallet for batch ${batchNo}?`,
        ),
      )
    )
      return;
    setPaying(batchId);
    const data: any = await doPay({ data: { batchId } }).catch((e: any) => ({
      ok: false,
      reason: e.message,
    }));
    setPaying(null);
    if (!data?.ok) {
      if (data?.reason === "insufficient") {
        toast.error(
          tr(
            `余额不足，需要 CA$${data.need_cad}，当前 CA$${data.balance_cad}，请先充值`,
            `Insufficient balance: need CA$${data.need_cad}, have CA$${data.balance_cad} — please top up`,
          ),
          { action: { label: tr("去充值", "Top up"), onClick: () => onJump("wallet") } },
        );
        return;
      }
      if (data?.reason === "already_paid") {
        toast.info(tr("该批次已结清", "This batch is already settled"));
        load();
        return;
      }
      // 除了上面两种，payMyBatch 链路还会返回好几种别的失败原因（customer_not_found /
      // no_frozen_invoice / nothing_to_pay / freeze_failed / settle_failed），外加"批次
      // 尚未发出"/"费用尚未确认"这两种直接 throw 出来的、本身已经是完整中文句子的错误——
      // 这里不能再统一收成一句"付款失败"，那样客户和客服都不知道到底卡在哪一步，
      // 只会反馈"无法扣款"却查不出原因。已知原因给出对应提示，其余（多半是上面那两种
      // 已经写好中文的 throw）直接把原始文案显示出来，总比什么都不说强。
      const REASON_MSG: Record<string, [string, string]> = {
        customer_not_found: ["客户信息异常，请联系客服", "Account issue — please contact support"],
        no_frozen_invoice: [
          "账单生成异常，请稍后重试或联系客服",
          "Invoice not ready — please retry shortly or contact support",
        ],
        nothing_to_pay: ["该批次无需付款", "Nothing to pay for this batch"],
        // no_orders_for_customer / no_matching_waybills_in_batch：按你的客户信息查不到订单，
        // 或订单跟这一批次的运单对不上，多半是客户信息有误或对不上，不是"已经付过"——不能跟
        // already_paid 用同一句"已结清"，那样反而让人以为不用付钱，看不出这其实是个需要联系
        // 客服核实的数据问题。
        no_orders_for_customer: [
          "查不到属于你的订单记录，请联系客服核实",
          "Couldn't find your orders — please contact support",
        ],
        no_matching_waybills_in_batch: [
          "查不到该批次下属于你的运单记录，请联系客服核实",
          "Couldn't find your waybills under this batch — please contact support",
        ],
        nothing_to_bill: ["该批次费用计算为 0，无需付款", "This batch totals CA$0 — nothing to pay"],
        freeze_failed: ["账单生成失败，请联系客服", "Failed to generate invoice — please contact support"],
        settle_failed: ["结算失败，请稍后重试", "Settlement failed — please try again"],
      };
      const known = data?.reason ? REASON_MSG[data.reason as string] : undefined;
      if (known) return toast.error(tr(known[0], known[1]));
      return toast.error(
        (typeof data?.reason === "string" && data.reason) ||
          tr("付款失败，请稍后重试或联系客服", "Payment failed — please try again or contact support"),
      );
    }
    const pointsMsg =
      data.points_earned > 0 ? tr(`，获得 ${data.points_earned} 积分`, `, earned ${data.points_earned} points`) : "";
    toast.success(
      tr(
        `付款成功 CA$${data.paid_cad}，账单 ${data.invoice_no}${pointsMsg}`,
        `Paid CA$${data.paid_cad} — invoice ${data.invoice_no}${pointsMsg}`,
      ),
      {
        action: {
          label: tr("查看账单", "View invoice"),
          onClick: () => navigate({ to: "/invoices" }),
        },
      },
    );
    load();
  };

  const [showHistory, setShowHistory] = useState(false);

  if (batches === null) return <Spinner />;
  if (batches.length === 0)
    return (
      <Empty
        icon={<Layers />}
        text={tr("还没有可显示的批次（批次发出后会出现在这里）", "No batches yet — they appear here once shipped")}
      />
    );

  const historyCount = batches.filter((b) => b.status === "closed").length;
  const visible = showHistory ? batches : batches.filter((b) => b.status !== "closed");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">{tr("我的批次", "My batches")}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {tr(
              "批次发出后显示在这里，可一次性结算（加币计费）",
              "Batches appear here once shipped — settle in one click (CAD)",
            )}
          </p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          {tr(`显示已关闭批次 (${historyCount})`, `Show closed (${historyCount})`)}
        </label>
      </div>

      {visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          {tr("没有进行中的批次", "No active batches")}
        </div>
      )}
      {visible.map((b) => (
        <BatchCard key={b.batch_id} b={b} lang={lang} tr={tr} paying={paying} onPay={pay} />
      ))}
    </div>
  );
}

function BatchCard({
  b,
  lang,
  tr,
  paying,
  onPay,
}: {
  b: Batch;
  lang: "zh" | "en";
  tr: (zh: string, en: string) => string;
  paying: string | null;
  onPay: (batchId: string, batchNo: string, amountCad: number) => void;
}) {
  const isAir = b.shipping_method === "air";
  const [trackOpen, setTrackOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dutyOpen, setDutyOpen] = useState(false);
  const [events, setEvents] = useState<any[] | null | "err">(null);

  const toggleTrack = async () => {
    const next = !trackOpen;
    setTrackOpen(next);
    if (next && events === null) {
      if (b.intl_tracking_nos.length === 0) return setEvents("err");
      const results = await Promise.all(b.intl_tracking_nos.map((t) => sb.rpc("lookup_shipment", { _tracking_no: t })));
      const all: any[] = [];
      results.forEach((r: any, i: number) => {
        const evs = r?.data?.events ?? [];
        const ref = b.intl_tracking_nos[i];
        evs.forEach((e: any) => all.push({ ...e, source_ref: e.source_ref ?? ref }));
      });
      if (all.length === 0) return setEvents("err");
      all.sort((a, b) => +new Date(a.event_time) - +new Date(b.event_time));
      setEvents(all);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <header
        className={`flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 ${b.is_paid ? "bg-success/5" : "bg-accent/40"}`}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-brand">
          {isAir ? <Plane className="h-4 w-4" /> : <Ship className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold">{b.batch_no}</span>
            {(() => {
              const [zh, en, cls] = BATCH_STATUS_LABELS[b.status];
              return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{tr(zh, en)}</span>;
            })()}
            {b.is_paid ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                <CheckCircle2 className="h-3 w-3" />
                {tr("已结清", "Settled")}
              </span>
            ) : (
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                {tr("待付款", "Unpaid")}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-ink-soft">
            <span>{isAir ? tr("空运批次", "Air batch") : tr("海运批次", "Sea batch")}</span>
            {b.eta && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {tr("预计到达", "ETA")} {new Date(b.eta).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA")}
              </span>
            )}
            <span>
              · {b.items.length} {tr("项", "items")}
            </span>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wider text-ink-soft">
            {b.is_paid ? tr("批次合计", "Batch total") : tr("批次待付", "Batch unpaid")}
          </div>
          {b.subtotal_cad === null ? (
            <div className="text-xs font-medium text-amber-600">
              {b.snapshot_pending
                ? tr("数据准备中，请稍后刷新", "Preparing data — please refresh shortly")
                : tr("等待客服确认费用", "Awaiting fee confirmation")}
            </div>
          ) : (
            <>
              <div className="font-display text-lg font-bold text-brand-gradient">CA${b.subtotal_cad.toFixed(2)}</div>
              {b.fee_lines && (
                <button
                  onClick={() => setDetailOpen((v) => !v)}
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-ink-soft hover:text-brand"
                >
                  {tr("费用明细", "Fee details")}
                  <span>{detailOpen ? "▲" : "▼"}</span>
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {detailOpen && b.fee_lines && (
        <div className="border-b border-border bg-background/40 px-5 py-3 text-xs">
          {(() => {
            const fl = b.fee_lines!;
            const rows: Array<[string, string, number]> = [
              [tr("运费", "Freight"), "freight", fl.freight_cad],
              [tr("保险", "Insurance"), "insurance", fl.insurance_cad],
              [tr("关税", "Customs duty"), "customs", fl.customs_cad],
              [tr("清关费", "Clearance"), "clearance", fl.clearance_cad],
              [tr("附加费", "Surcharge"), "surcharge", fl.surcharge_cad],
              [tr("末端派送费", "Last-mile delivery"), "delivery", fl.delivery_cad],
              [tr("检查费", "Inspection"), "inspection", fl.inspection_cad],
            ];
            return (
              <div className="space-y-1.5">
                {rows.map(([label, key, val]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-ink-soft">
                        {label}
                        {key === "customs" && (b.duty_items?.length ?? 0) > 0 && (
                          <button
                            onClick={() => setDutyOpen((v) => !v)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-brand hover:underline"
                          >
                            {tr("明细", "breakdown")} <span>{dutyOpen ? "▲" : "▼"}</span>
                          </button>
                        )}
                      </span>
                      <span className="font-mono tabular-nums">CA${val.toFixed(2)}</span>
                    </div>
                    {key === "customs" && dutyOpen && (
                      <div className="mt-1.5 overflow-x-auto rounded-lg border border-border bg-surface p-2">
                        {(b.duty_unmatched_hs?.length ?? 0) > 0 && (
                          <div className="mb-1.5 rounded bg-warning/10 px-2 py-1 text-[10px] text-warning">
                            ⚠{" "}
                            {tr(
                              `以下品名未匹配 HS 编码，关税暂按 0 计：${(b.duty_unmatched_hs ?? []).join("、")}`,
                              `No HS code matched (duty counted as 0): ${(b.duty_unmatched_hs ?? []).join(", ")}`,
                            )}
                          </div>
                        )}
                        <table className="w-full text-[10px]">
                          <thead className="text-left text-ink-soft">
                            <tr>
                              <th className="py-1 pr-2">{tr("品名", "Item")}</th>
                              <th className="pr-2">HS</th>
                              <th className="pr-2 text-right">{tr("税率", "Rate")}</th>
                              <th className="pr-2 text-right">{tr("数量", "Qty")}</th>
                              <th className="pr-2 text-right">{tr("申报价值", "Declared")}</th>
                              <th className="text-right">{tr("关税", "Duty")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(b.duty_items ?? []).map((d, i) => (
                              <tr key={`${d.name}-${i}`} className="border-t border-border/60">
                                <td className="py-1 pr-2">{d.name}</td>
                                <td className="pr-2 font-mono">{d.hs_code ?? tr("缺", "—")}</td>
                                <td className="pr-2 text-right">{(d.tax_rate * 100).toFixed(2)}%</td>
                                <td className="pr-2 text-right">{d.quantity}</td>
                                <td className="pr-2 text-right font-mono">CA${d.declared_value_cad.toFixed(2)}</td>
                                <td className="text-right font-mono">CA${d.duty_cad.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
                {fl.discount_cad > 0 && (
                  <div className="flex items-center justify-between text-success">
                    <span>{tr("折扣", "Discount")}</span>
                    <span className="font-mono tabular-nums">−CA${fl.discount_cad.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-1.5 font-semibold">
                  <span>{tr("小计", "Subtotal")}</span>
                  <span className="font-mono tabular-nums">CA${(b.subtotal_cad ?? 0).toFixed(2)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="px-5 py-3">
        <button
          onClick={() => setItemsOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
        >
          <Truck className="h-3 w-3" />
          {tr("集运订单", "Forwarding orders")} ({b.items.length})
          <span className="text-ink-soft">{itemsOpen ? "▲" : "▼"}</span>
        </button>
      </div>
      {itemsOpen && (
        <ul className="divide-y divide-border border-t border-border">
          {b.items.map((it) => (
            <li key={`${it.kind}-${it.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.kind === "order" ? "bg-brand/10 text-brand" : "bg-cta/10 text-cta"}`}
              >
                {it.kind === "order" ? (
                  <>
                    <ShoppingCart className="h-3 w-3" />
                    {tr("商城", "Shop")}
                  </>
                ) : (
                  <>
                    <Truck className="h-3 w-3" />
                    {tr("集运", "Forwarding")}
                  </>
                )}
              </span>
              <span className="font-mono text-xs font-semibold">{it.no}</span>
              {it.tracking_no && (
                <span className="text-[11px] text-ink-soft">
                  · <span className="font-mono">{it.tracking_no}</span>
                </span>
              )}
              <span
                className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
              >
                {it.payment_status === "paid" ? tr("已付款", "Paid") : tr("待付款", "Unpaid")}
              </span>
              {it.kind === "order" ? (
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: it.id }}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:border-brand hover:text-brand"
                >
                  {tr("详情", "Detail")} <ArrowRight className="h-3 w-3" />
                </Link>
              ) : (
                <Link
                  to="/forwarding/$forwardingId"
                  params={{ forwardingId: it.id }}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:border-brand hover:text-brand"
                >
                  {tr("详情", "Detail")} <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Batch tracking timeline */}
      <div className="border-t border-border bg-background/40 px-5 py-3">
        <button
          onClick={toggleTrack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium hover:border-brand hover:text-brand"
        >
          <MapPin className="h-3 w-3" />
          {tr("批次物流轨迹", "Batch tracking")}
          {b.intl_tracking_nos.length > 0 && <span className="text-ink-soft">({b.intl_tracking_nos.length})</span>}
          <span className="text-ink-soft">{trackOpen ? "▲" : "▼"}</span>
        </button>
        {trackOpen && (
          <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">
            {events === null && (
              <div className="grid place-items-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />
              </div>
            )}
            {events === "err" && (
              <div className="py-4 text-center text-xs text-ink-soft">{tr("暂无轨迹数据", "No tracking data yet")}</div>
            )}
            {Array.isArray(events) && <TrackingTimeline events={events as any} lang={lang} />}
          </div>
        )}
      </div>

      {!b.is_paid && b.subtotal_cad === null && (
        <div className="border-t border-border bg-background px-5 py-3 text-xs text-amber-600">
          {b.snapshot_pending
            ? tr("数据准备中，请稍后刷新页面重试", "Preparing data — please refresh the page shortly")
            : tr(
                "等待客服确认费用，确认后即可查看金额并付款",
                "Awaiting fee confirmation — amount and payment unlock once confirmed",
              )}
        </div>
      )}
      {!b.is_paid && (b.subtotal_cad ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-background px-5 py-3">
          <div className="text-xs text-ink-soft">
            {tr("待付", "Unpaid")}:{" "}
            <span className="font-display text-base font-bold text-foreground">
              CA${(b.subtotal_cad ?? 0).toFixed(2)}
            </span>
          </div>
          <button
            disabled={paying === b.batch_id}
            onClick={() => onPay(b.batch_id, b.batch_no, b.subtotal_cad ?? 0)}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-cta-gradient px-5 py-2 text-xs font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
          >
            {paying === b.batch_id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CreditCard className="h-3.5 w-3.5" />
            )}
            {tr("钱包付款", "Pay from wallet")}
          </button>
        </div>
      )}
    </div>
  );
}

// ===================== My Inventory (waybills in storage, grouped by SKU + warehouse) =====================
interface InventoryBox {
  id: string;
  waybillNo: string;
  storedAt: string;
}
interface InventoryWarehouse {
  id: string;
  code: string;
  name: string;
}
interface InventoryGroup {
  key: string;
  productName: string;
  sku: string;
  qtyPerBox: number;
  warehouse: InventoryWarehouse | null;
  boxes: InventoryBox[];
}

const DAY_MS = 86_400_000;
const storageDays = (isoDate: string) => Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / DAY_MS));

// Shared with src/routes/_authenticated/forwarding.index.tsx — key for handing off
// locked item drafts (and the warehouse they must ship from) when shipping straight from My Inventory.
const FORWARDING_PREFILL_KEY = "sc_forwarding_prefill";

function buildInventoryGroups(rows: any[]): InventoryGroup[] {
  const map = new Map<string, InventoryGroup>();
  for (const wb of rows) {
    const summary = Array.isArray(wb.items_summary) ? wb.items_summary : [];
    const entries = summary.length > 0 ? summary : [{ name: null, sku: null, quantity: null }];
    const warehouse: InventoryWarehouse | null = wb.warehouse ?? null;
    for (const it of entries) {
      const productName = it?.name || it?.name_zh || it?.name_en || "—";
      const sku = it?.sku || "—";
      const qtyPerBox = Number(it?.quantity ?? 0);
      const k = `${productName}__${sku}__${qtyPerBox}__${warehouse?.id ?? "unknown"}`;
      if (!map.has(k)) map.set(k, { key: k, productName, sku, qtyPerBox, warehouse, boxes: [] });
      map.get(k)!.boxes.push({ id: wb.id, waybillNo: wb.waybill_no, storedAt: wb.updated_at });
    }
  }
  return Array.from(map.values());
}

function InventoryTab() {
  const { lang } = useApp();
  const navigate = useNavigate();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [groups, setGroups] = useState<InventoryGroup[] | null>(null);
  const [shipBoxes, setShipBoxes] = useState<Record<string, number>>({});
  const [storageFee, setStorageFee] = useState<{ total_cad: number } | null>(null);
  const [payingStorage, setPayingStorage] = useState(false);

  const loadStorageFee = async () => {
    const { data, error } = await sb.rpc("preview_storage_fees");
    if (error) {
      // Surface it instead of silently showing "$0 due" — that looked
      // identical to "nothing owed" and hid real failures (e.g. the RPC
      // missing because its migration hasn't been applied yet).
      toast.error(tr(`仓储费查询失败：${error.message}`, `Failed to load storage fee: ${error.message}`));
      setStorageFee({ total_cad: 0 });
      return;
    }
    setStorageFee(data ?? { total_cad: 0 });
  };

  const payStorageFee = async () => {
    if (!storageFee || storageFee.total_cad <= 0) return;
    if (
      !confirm(
        tr(
          `确认从钱包支付仓储费 CA$${storageFee.total_cad.toFixed(2)}?`,
          `Pay CA$${storageFee.total_cad.toFixed(2)} storage fee from wallet?`,
        ),
      )
    )
      return;
    setPayingStorage(true);
    const { data, error } = await sb.rpc("pay_storage_fees");
    setPayingStorage(false);
    if (error) return toast.error(error.message);
    if (!data?.ok) {
      if (data?.reason === "insufficient") {
        toast.error(
          tr(
            `余额不足，需要 CA$${data.need_cad}，当前 CA$${data.balance_cad}，请先充值`,
            `Insufficient balance: need CA$${data.need_cad}, have CA$${data.balance_cad} — please top up`,
          ),
          {
            action: {
              label: tr("去充值", "Top up"),
              onClick: () => navigate({ to: "/account", search: { tab: "wallet" } }),
            },
          },
        );
        return;
      }
      return toast.error(tr("付款失败", "Payment failed"));
    }
    const pointsMsg =
      data.points_earned > 0 ? tr(`，获得 ${data.points_earned} 积分`, `, earned ${data.points_earned} points`) : "";
    toast.success(
      tr(
        `仓储费付款成功 CA$${data.paid_cad}，账单 ${data.invoice_no}${pointsMsg}`,
        `Storage fee paid CA$${data.paid_cad} — invoice ${data.invoice_no}${pointsMsg}`,
      ),
      {
        action: {
          label: tr("查看账单", "View invoice"),
          onClick: () => navigate({ to: "/invoices" }),
        },
      },
    );
    loadStorageFee();
  };

  useEffect(() => {
    loadStorageFee();
    (async () => {
      const [{ data: wbRows }, { data: whRows }] = await Promise.all([
        sb
          .from("waybills")
          .select("id,waybill_no,items_summary,updated_at,forwarding_id")
          .eq("status", "storage")
          .order("updated_at", { ascending: false }),
        sb.from("warehouses").select("id,code,name_zh,name_en").eq("is_active", true),
      ]);
      const fwdIds = Array.from(new Set((wbRows ?? []).map((w: any) => w.forwarding_id).filter(Boolean)));
      const { data: fwdRows } = fwdIds.length
        ? await sb.from("forwarding_orders").select("id,warehouse").in("id", fwdIds)
        : { data: [] as any[] };
      const realWarehouses: InventoryWarehouse[] = (whRows ?? []).map((w: any) => ({
        id: w.id,
        code: w.code,
        name: lang === "zh" ? w.name_zh : (w.name_en ?? w.name_zh),
      }));
      const whByCode = new Map(realWarehouses.map((w) => [w.code, w]));
      const warehouseByFwdId = new Map((fwdRows ?? []).map((f: any) => [f.id, whByCode.get(f.warehouse) ?? null]));
      const withWarehouse = (wbRows ?? []).map((w: any) => ({
        ...w,
        warehouse: warehouseByFwdId.get(w.forwarding_id) ?? null,
      }));

      setGroups(buildInventoryGroups(withWarehouse));
    })();
  }, [lang]);

  if (groups === null) return <Spinner />;

  const totalBoxes = groups.reduce((s, g) => s + g.boxes.length, 0);
  const toShip = groups.filter((g) => (shipBoxes[g.key] ?? 0) > 0);
  const totalBoxesToShip = toShip.reduce((s, g) => s + (shipBoxes[g.key] ?? 0), 0);
  const shipWarehouseIds = new Set(toShip.map((g) => g.warehouse?.id ?? "unknown"));

  const setBoxesFor = (g: InventoryGroup, raw: number) => {
    const n = Math.max(0, Math.min(g.boxes.length, Math.floor(raw) || 0));
    setShipBoxes((s) => ({ ...s, [g.key]: n }));
  };

  const shipSelected = () => {
    if (toShip.length === 0) return;
    if (shipWarehouseIds.size > 1 || shipWarehouseIds.has("unknown")) {
      toast.error(tr("请选择同一仓库的货物一起发货", "Please ship items from a single warehouse at a time"));
      return;
    }
    const items = toShip.map((g) => {
      const boxCount = shipBoxes[g.key] ?? 0;
      return {
        name: g.productName,
        sku: g.sku !== "—" ? g.sku : null,
        quantity: boxCount * g.qtyPerBox,
        unit_price_cad: 0,
        box_count: boxCount,
        inner_qty: g.qtyPerBox,
        locked: true,
      };
    });
    sessionStorage.setItem(FORWARDING_PREFILL_KEY, JSON.stringify({ warehouseId: toShip[0].warehouse!.id, items }));
    navigate({ to: "/forwarding" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">{tr("我的库存", "My inventory")}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {tr(
              "按货物名称 + SKU + 内件数分组，当前在仓库中的箱数",
              "Grouped by product, SKU and units/box — box counts currently in the warehouse",
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label={tr("库存总箱数", "Total boxes in storage")}
          value={String(totalBoxes)}
          sub={tr(`${groups.length} 种货物`, `${groups.length} product(s)`)}
          icon={<Warehouse className="h-5 w-5" />}
        />
        <StatCard
          label={tr("待付仓储费", "Storage fee due")}
          value={`CA$${(storageFee?.total_cad ?? 0).toFixed(2)}`}
          sub={tr("按仓库体积与天数计算，付款后重新计时", "By volume × days — payment resets the billing clock")}
          icon={<Wallet className="h-5 w-5" />}
          tone={storageFee && storageFee.total_cad > 0 ? "brand" : undefined}
          action={
            storageFee && storageFee.total_cad > 0 ? (
              <button
                onClick={payStorageFee}
                disabled={payingStorage}
                className="inline-flex items-center gap-2 rounded-full bg-cta-gradient px-4 py-1.5 text-xs font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
              >
                {payingStorage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {tr(
                  `支付仓储费 CA$${storageFee.total_cad.toFixed(2)}`,
                  `Pay storage fee CA$${storageFee.total_cad.toFixed(2)}`,
                )}
              </button>
            ) : undefined
          }
        />
      </div>

      {groups.length === 0 ? (
        <Empty icon={<Warehouse />} text={tr("目前没有仓储中的运单", "No waybills in storage right now")} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <ul className="divide-y divide-border">
            {groups.map((g) => {
              const maxDays = Math.max(0, ...g.boxes.map((b) => storageDays(b.storedAt)));
              return (
                <li key={g.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-warning/10 text-warning">
                    <Warehouse className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">{g.productName}</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-ink-soft">
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 font-semibold text-brand">
                        {g.warehouse?.name ?? tr("未知仓库", "Unknown warehouse")}
                      </span>
                      <span className="font-mono">SKU: {g.sku}</span>
                      <span>
                        · {tr("内件数", "Units/box")}: {g.qtyPerBox}
                      </span>
                      <span className={maxDays >= 30 ? "font-semibold text-warning" : ""}>
                        · {tr("最长存储", "Longest stored")}: {maxDays} {tr("天", "d")}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold text-foreground">{g.boxes.length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-soft">{tr("箱", "box(es)")}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <label className="text-[11px] text-ink-soft">{tr("发货箱数", "Ship boxes")}</label>
                    <input
                      type="number"
                      min={0}
                      max={g.boxes.length}
                      step={1}
                      value={shipBoxes[g.key] ?? ""}
                      onChange={(e) => setBoxesFor(g, Number(e.target.value))}
                      placeholder="0"
                      className="h-9 w-20 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {totalBoxesToShip > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand/30 bg-surface p-4 shadow-elevated">
          <div>
            <div className="text-sm">
              {tr(`已填 ${totalBoxesToShip} 箱待发货`, `${totalBoxesToShip} box(es) ready to ship`)}
            </div>
            {shipWarehouseIds.size > 1 && (
              <div className="text-[11px] text-destructive">
                {tr(
                  "所选货物分属不同仓库，请分开发货",
                  "Selected items span multiple warehouses — ship them separately",
                )}
              </div>
            )}
          </div>
          <button
            onClick={shipSelected}
            disabled={shipWarehouseIds.size > 1}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-cta-gradient px-5 py-2 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
            {tr("发货，去申请集运单", "Ship — go to forwarding request")}
          </button>
        </div>
      )}
    </div>
  );
}

// ===================== My Items (personal catalog, synced into the HS code library) =====================
interface MyItem {
  id: string;
  name: string;
  hs_code: string;
  sku: string | null;
  declared_value_cad: number;
  inner_qty: number | null;
  mfn_rate: number;
  gst_rate: number;
  sima_involved: boolean;
  unit: string | null;
  material: string | null;
  origin: string | null;
  brand: string | null;
  weight_kg: number | null;
}

function newMyItem(): Partial<MyItem> {
  return {
    name: "",
    hs_code: "",
    sku: "",
    declared_value_cad: 0,
    inner_qty: undefined,
    mfn_rate: 0,
    gst_rate: 0.05,
    sima_involved: false,
    unit: "",
    material: "",
    origin: "China",
    brand: "",
    weight_kg: undefined,
  };
}

function MyItemsTab() {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [list, setList] = useState<MyItem[] | null>(null);
  const [editing, setEditing] = useState<Partial<MyItem> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    sb
      .from("my_items")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }: any) => setList(data ?? []));
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) return toast.error(tr("请填写物品名称", "Enter an item name"));
    let hsCode: string | null;
    try {
      hsCode = normalizeHsCodeForStorage(editing.hs_code);
    } catch (e: any) {
      return toast.error(e.message ?? tr("HS 编码格式不正确", "Invalid HS code format"));
    }
    if (!hsCode) return toast.error(tr("请填写完整的 HS 编码", "Enter a complete HS code"));
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    // Postgres cancels statements after 8s; a cold/busy DB can trip this on the
    // very first write. Retry transparently instead of showing a scary error.
    const withRetry = async <T,>(run: () => Promise<{ data?: T; error: any }>) => {
      let last: any = null;
      for (let i = 0; i < 3; i++) {
        const r = await run();
        if (!r.error) return r;
        last = r;
        const isTimeout = r.error?.code === "57014" || /statement timeout/i.test(r.error?.message ?? "");
        if (!isTimeout) return r;
        await new Promise((res) => setTimeout(res, 600 * (i + 1)));
      }
      return last;
    };

    // If this HS code already exists in the shared library, its (staff-curated) rates win
    // over whatever the customer typed. Brand-new codes get inserted using their input.
    const { data: resolved, error: resolveError } = await withRetry<any>(() =>
      sb.rpc("resolve_hs_code_rates", {
        p_hs_code: hsCode,
        p_name_zh: editing.name!.trim(),
        p_unit: editing.unit?.trim() || null,
        p_mfn_rate: editing.mfn_rate ?? 0,
        p_gst_rate: editing.gst_rate ?? 0.05,
        p_sima_involved: editing.sima_involved ?? false,
      }),
    );
    if (resolveError) {
      setBusy(false);
      return toast.error(resolveError.message);
    }

    const payload = {
      user_id: user.id,
      name: editing.name.trim(),
      hs_code: hsCode,
      sku: editing.sku?.trim() || null,
      declared_value_cad: editing.declared_value_cad ?? 0,
      inner_qty: editing.inner_qty ?? null,
      unit: resolved?.unit ?? (editing.unit?.trim() || null),
      mfn_rate: resolved?.mfn_rate ?? editing.mfn_rate ?? 0,
      gst_rate: resolved?.gst_rate ?? editing.gst_rate ?? 0.05,
      sima_involved: resolved?.sima_involved ?? editing.sima_involved ?? false,
      // 材质优先跟随 HS 编码库；产地默认 China
      material: resolved?.material ?? (editing.material?.trim() || null),
      origin: editing.origin?.trim() || "China",
      brand: editing.brand?.trim() || null,
      weight_kg: editing.weight_kg ?? null,
    };
    const { error } = await withRetry<any>(() =>
      editing.id
        ? sb.from("my_items").update(payload).eq("id", editing.id)
        : sb.from("my_items").insert(payload),
    );
    setBusy(false);
    if (error) return toast.error(error.message);

    toast.success(tr("已保存", "Saved"));
    setEditing(null);
    load();
  };

  const del = async (id: string) => {
    if (!confirm(tr("确定删除这个物品？", "Delete this item?"))) return;
    const { error } = await sb.from("my_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  if (list === null) return <Spinner />;
  const isNew = editing && !editing.id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">{tr("我的物品", "My items")}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {tr(
              "保存常用物品信息，申请集运时可直接复用；新增的 HS 编码会同步进入报关编码库",
              "Save reusable item details for forwarding requests — new HS codes are synced into the customs code library",
            )}
          </p>
        </div>
        <button
          onClick={() => setEditing(newMyItem())}
          className="inline-flex items-center gap-1 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr("新增物品", "Add item")}
        </button>
      </div>

      {editing && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-3 text-sm font-semibold">
            {isNew ? tr("新增物品", "New item") : tr("编辑物品", "Edit item")}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={tr("物品名称", "Item name")} full>
              <input
                className={inputCls}
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="HS Code">
              <HsCodeInput value={editing.hs_code} onChange={(digits) => setEditing({ ...editing, hs_code: digits })} />
            </Field>
            <Field label="SKU">
              <input
                className={inputCls}
                value={editing.sku ?? ""}
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
              />
            </Field>
            <Field label={tr("计量单位", "Unit")}>
              <input
                className={inputCls}
                placeholder={tr("如：件、个、套", "e.g. pc, set")}
                value={editing.unit ?? ""}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              />
            </Field>
            <Field label={tr("申报价值 (CAD)", "Declared value (CAD)")}>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={editing.declared_value_cad ?? 0}
                onChange={(e) => setEditing({ ...editing, declared_value_cad: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label={tr("内件数", "Units/box")}>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={editing.inner_qty ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    inner_qty: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label={tr("材质", "Material")}>
              <input
                className={inputCls}
                placeholder={tr("留空则自动跟随 HS 编码库", "Leave blank to follow the HS library")}
                value={editing.material ?? ""}
                onChange={(e) => setEditing({ ...editing, material: e.target.value })}
              />
            </Field>
            <Field label={tr("产地", "Origin")}>
              <input
                className={inputCls}
                value={editing.origin ?? "China"}
                onChange={(e) => setEditing({ ...editing, origin: e.target.value })}
              />
            </Field>
            <Field label={tr("品牌", "Brand")}>
              <input
                className={inputCls}
                placeholder={tr("无牌请填 NO BRAND", "NO BRAND if unbranded")}
                value={editing.brand ?? ""}
                onChange={(e) => setEditing({ ...editing, brand: e.target.value })}
              />
            </Field>
            <Field label={tr("单件重量 (KG)", "Weight (KG)")}>
              <input
                type="number"
                min={0}
                step="0.001"
                className={inputCls}
                value={editing.weight_kg ?? ""}
                onChange={(e) =>
                  setEditing({ ...editing, weight_kg: e.target.value === "" ? undefined : Number(e.target.value) })
                }
              />
            </Field>
            <Field label={tr("MFN 税率", "MFN rate")}>
              <input
                type="number"
                min={0}
                step="0.0001"
                className={inputCls}
                value={editing.mfn_rate ?? 0}
                onChange={(e) => setEditing({ ...editing, mfn_rate: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label={tr("GST 税率", "GST rate")}>
              <input
                type="number"
                min={0}
                step="0.0001"
                className={inputCls}
                value={editing.gst_rate ?? 0.05}
                onChange={(e) => setEditing({ ...editing, gst_rate: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="SIMA">
              <label className="flex h-11 items-center gap-2 px-1 text-sm">
                <input
                  type="checkbox"
                  checked={!!editing.sima_involved}
                  onChange={(e) => setEditing({ ...editing, sima_involved: e.target.checked })}
                />
                {tr("涉及反倾销/反补贴措施", "Subject to anti-dumping/SIMA")}
              </label>
            </Field>
          </div>
          <p className="mt-3 text-[11px] text-ink-soft">
            {tr(
              "提示：如果这个 HS 编码在报关库里已经存在，MFN/GST/SIMA/计量单位会以库里已有数据为准，自动覆盖你在这里填的值。",
              "Note: if this HS code already exists in the customs library, its MFN/GST/SIMA/unit values take precedence and will overwrite what you enter here.",
            )}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-cta-gradient px-5 py-2 text-sm font-semibold text-cta-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {tr("保存", "Save")}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-full border border-border px-5 py-2 text-sm">
              {tr("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && !editing ? (
        <Empty
          icon={<Tags />}
          text={tr("还没有保存物品，点击右上角添加一个", "No saved items yet — add one to get started")}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <ul className="divide-y divide-border">
            {list.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-brand">
                  <Tags className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold">{it.name}</div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-ink-soft">
                    <span className="font-mono">HS: {it.hs_code}</span>
                    {it.sku && <span className="font-mono">· SKU: {it.sku}</span>}
                    {it.unit && (
                      <span>
                        · {tr("单位", "Unit")}: {it.unit}
                      </span>
                    )}
                    {it.inner_qty != null && (
                      <span>
                        · {tr("内件数", "Units/box")}: {it.inner_qty}
                      </span>
                    )}
                    <span>
                      · {tr("申报价值", "Declared")}: CA${Number(it.declared_value_cad).toFixed(2)}
                    </span>
                    {it.material && (
                      <span>
                        · {tr("材质", "Material")}: {it.material}
                      </span>
                    )}
                    <span>
                      · {tr("产地", "Origin")}: {it.origin ?? "China"}
                    </span>
                    {it.brand && (
                      <span>
                        · {tr("品牌", "Brand")}: {it.brand}
                      </span>
                    )}
                    {it.weight_kg != null && <span>· {Number(it.weight_kg)}KG</span>}
                    <span>· MFN {(Number(it.mfn_rate) * 100).toFixed(2)}%</span>
                    <span>· GST {(Number(it.gst_rate) * 100).toFixed(2)}%</span>
                    {it.sima_involved && <span className="font-semibold text-warning">· SIMA</span>}
                  </div>
                </div>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => setEditing(it)}
                    className="rounded-full px-2 py-1 text-xs text-ink-soft hover:bg-accent"
                  >
                    {tr("编辑", "Edit")}
                  </button>
                  <button
                    onClick={() => del(it.id)}
                    className="grid h-7 w-7 place-items-center rounded-full text-ink-soft hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ===================== My Orders / Waybills (merged) =====================
type OrderFilter = "all" | "order" | "forwarding" | "unwarehoused";

interface MyWaybill {
  waybill_no: string;
  status: string;
}
interface MyLineItem {
  name: string;
  qty: number;
}
interface MyOrderItem {
  kind: "order" | "forwarding";
  id: string;
  no: string;
  status: string;
  created_at: string;
  fee_cny: number;
  payment_status: string;
  tracking_no: string | null;
  shipping_method?: string;
  warehouse?: string;
  weight_kg?: number | null;
  domestic_tracking_no?: string | null;
  note?: string | null;
  waybills?: MyWaybill[];
  lineItems?: MyLineItem[];
  total_weight_kg?: number;
  total_volume_m3?: number;
  total_volumetric_weight_kg?: number;
  total_cad?: number | null;
}

const HISTORY_STATUSES = new Set(["delivered", "cancelled"]);

// Sort priority for the merged order/waybill list: un-warehoused (awaiting
// arrival) first, then the rest roughly in shipping-progress order. Within
// each rank items are ordered by time (see `filtered` below).
const STATUS_RANK: Record<string, number> = {
  pending: 0, // 未入库 / 已发货等待入库
  paid: 1,
  procurement: 2,
  received: 3,
  processing: 4,
  packed: 4,
  shipped: 5,
  in_transit: 6,
  ready_pickup: 7,
  delivered: 8,
  cancelled: 9,
};

function MyOrdersTab({ initialFilter = "all" }: { initialFilter?: OrderFilter } = {}) {
  const { lang, cnyToCad } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [items, setItems] = useState<MyOrderItem[] | null>(null);
  const [filter, setFilter] = useState<OrderFilter>(initialFilter);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [busyDel, setBusyDel] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      sb
        .from("orders")
        .select(
          "id,order_no,status,total_cny,payment_status,created_at,shipping_method,tracking_no,domestic_tracking_no",
        )
        .order("created_at", { ascending: false }),
      sb
        .from("forwarding_orders")
        .select(
          "id,request_no,status,fee_cny,payment_status,weight_kg,warehouse,shipping_method,tracking_no,domestic_tracking_no,note,created_at,freight_snapshot",
        )
        .order("created_at", { ascending: false }),
      sb
        .from("waybills")
        .select("order_id,forwarding_id,waybill_no,status,weight_kg,length_cm,width_cm,height_cm,weight_snapshot,created_at")
        .order("created_at"),
      sb.from("order_items").select("order_id,name_zh,name_en,quantity").order("created_at"),
      sb.from("forwarding_items").select("forwarding_id,name,quantity").order("created_at"),
    ]).then(([o, f, w, oi, fi]: any) => {
      const byOrder = new Map<string, MyWaybill[]>();
      const byFwd = new Map<string, MyWaybill[]>();
      // 内件明细（品名 / 数量）
      const itemsByOrder = new Map<string, MyLineItem[]>();
      const itemsByFwd = new Map<string, MyLineItem[]>();
      (oi.data ?? []).forEach((r: any) => {
        if (!r.order_id) return;
        if (!itemsByOrder.has(r.order_id)) itemsByOrder.set(r.order_id, []);
        itemsByOrder.get(r.order_id)!.push({ name: r.name_zh || r.name_en || "—", qty: Number(r.quantity ?? 0) });
      });
      (fi.data ?? []).forEach((r: any) => {
        if (!r.forwarding_id) return;
        if (!itemsByFwd.has(r.forwarding_id)) itemsByFwd.set(r.forwarding_id, []);
        itemsByFwd.get(r.forwarding_id)!.push({ name: r.name || "—", qty: Number(r.quantity ?? 0) });
      });
      const sumOrder = new Map<string, { w: number; v: number; vw: number }>();
      const sumFwd = new Map<string, { w: number; v: number; vw: number }>();
      (w.data ?? []).forEach((wb: any) => {
        const m = wb.order_id ? byOrder : byFwd;
        const s = wb.order_id ? sumOrder : sumFwd;
        const key = wb.order_id ?? wb.forwarding_id;
        if (!key) return;
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push({ waybill_no: wb.waybill_no, status: wb.status });
        const cur = s.get(key) ?? { w: 0, v: 0, vw: 0 };
        cur.w += Number(wb.weight_kg ?? 0);
        const l = Number(wb.length_cm ?? 0),
          wd = Number(wb.width_cm ?? 0),
          h = Number(wb.height_cm ?? 0);
        if (l && wd && h) {
          cur.v += (l * wd * h) / 1_000_000;
          cur.vw += Number(wb.weight_snapshot?.volumetric_weight ?? 0) || (l * wd * h) / 6000;
        }
        s.set(key, cur);
      });
      const combined: MyOrderItem[] = [
        ...(o.data ?? []).map((r: any) => ({
          kind: "order" as const,
          id: r.id,
          no: r.order_no,
          status: r.status,
          created_at: r.created_at,
          fee_cny: Number(r.total_cny ?? 0),
          payment_status: r.payment_status ?? "unpaid",
          tracking_no: r.tracking_no,
          shipping_method: r.shipping_method,
          domestic_tracking_no: r.domestic_tracking_no ?? null,
          waybills: byOrder.get(r.id) ?? [],
          lineItems: itemsByOrder.get(r.id) ?? [],
          total_weight_kg: sumOrder.get(r.id)?.w ?? 0,
          total_volume_m3: sumOrder.get(r.id)?.v ?? 0,
          total_volumetric_weight_kg: sumOrder.get(r.id)?.vw ?? 0,
        })),
        ...(f.data ?? []).map((r: any) => {
          const snap: any = r.freight_snapshot ?? null;
          const totalCad = Number(snap?.total_cad ?? 0);
          return {
            kind: "forwarding" as const,
            id: r.id,
            no: r.request_no,
            status: r.status,
            created_at: r.created_at,
            fee_cny: Number(r.fee_cny ?? 0),
            total_cad: totalCad > 0 ? totalCad : null,
            payment_status: r.payment_status ?? "unpaid",
            tracking_no: r.tracking_no,
            shipping_method: r.shipping_method,
            warehouse: r.warehouse,
            weight_kg: r.weight_kg,
            domestic_tracking_no: r.domestic_tracking_no ?? null,
            note: r.note,
            waybills: byFwd.get(r.id) ?? [],
            lineItems: itemsByFwd.get(r.id) ?? [],
            total_weight_kg: sumFwd.get(r.id)?.w ?? Number(r.weight_kg ?? 0),
            total_volume_m3: sumFwd.get(r.id)?.v ?? 0,
            total_volumetric_weight_kg: sumFwd.get(r.id)?.vw ?? 0,
          };
        }),
      ];
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setItems(combined);
    });
  }, []);

  // A forwarding request can be deleted by the customer only while it is still
  // "未入库" (status === "pending"); the DB policy fo_delete_own enforces the
  // same rule, so this is just the matching UI affordance.
  const onDeleteForwarding = async (id: string, no: string) => {
    if (
      !window.confirm(
        tr(`确定删除集运订单 ${no}？删除后无法恢复。`, `Delete forwarding request ${no}? This cannot be undone.`),
      )
    )
      return;
    setBusyDel(id);
    try {
      const { data, error } = await sb
        .from("forwarding_orders")
        .delete()
        .eq("id", id)
        .eq("status", "pending")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error(
          tr("无法删除：该集运订单已入库或状态已变更", "Cannot delete: this request is already in the warehouse"),
        );
        return;
      }
      setItems((prev) => (prev ?? []).filter((it) => !(it.kind === "forwarding" && it.id === id)));
      toast.success(tr("集运订单已删除", "Forwarding request deleted"));
    } catch (e: any) {
      toast.error(e?.message ?? tr("删除失败", "Delete failed"));
    } finally {
      setBusyDel(null);
    }
  };

  if (items === null) return <Spinner />;

  // 电商订单 = 集运状态 + 前置「代采购 procurement」；`pending` 在电商语义下表示「已发货等待入库」
  const orderStatus = (s: string) =>
    (
      ({
        paid: tr("已支付", "Paid"),
        procurement: tr("代采购", "Procurement"),
        pending: tr("已发货等待入库", "Shipped — awaiting intake"),
        received: tr("已到达集运仓", "Arrived at warehouse"),
        processing: tr("封箱打包", "Packed"),
        packed: tr("封箱打包", "Packed"),
        shipped: tr("运输中", "In transit"),
        in_transit: tr("正在派送", "Out for delivery"),
        ready_pickup: tr("待取货", "Ready for pickup"),
        delivered: tr("已完成", "Completed"),
        cancelled: tr("已取消", "Cancelled"),
      }) as Record<string, string>
    )[s] ?? s;

  const fwdStatus = (s: string) =>
    (
      ({
        pending: tr("未入库", "Pending arrival"),
        received: tr("已到达集运仓", "Arrived at warehouse"),
        packed: tr("封箱打包", "Packed"),
        shipped: tr("运输中", "In transit"),
        in_transit: tr("正在派送", "Out for delivery"),
        ready_pickup: tr("待取货", "Ready for pickup"),
        delivered: tr("已完成", "Completed"),
        cancelled: tr("已取消", "Cancelled"),
      }) as Record<string, string>
    )[s] ?? s;

  const statusLabel = (it: MyOrderItem) => (it.kind === "order" ? orderStatus(it.status) : fwdStatus(it.status));

  const byFilter = items.filter((it) => {
    if (filter === "all") return true;
    if (filter === "order") return it.kind === "order";
    if (filter === "forwarding") return it.kind === "forwarding";
    if (filter === "unwarehoused") return it.kind === "forwarding" && it.status === "pending";
    return true;
  });
  const byHistory = showHistory ? byFilter : byFilter.filter((it) => !HISTORY_STATUSES.has(it.status));
  const q = query.trim().toLowerCase();
  const searched = !q
    ? byHistory
    : byHistory.filter((it) => {
        const dateStr = new Date(it.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA").toLowerCase();
        return (
          it.no.toLowerCase().includes(q) ||
          (it.tracking_no ?? "").toLowerCase().includes(q) ||
          (it.domestic_tracking_no ?? "").toLowerCase().includes(q) ||
          statusLabel(it).toLowerCase().includes(q) ||
          it.status.toLowerCase().includes(q) ||
          dateStr.includes(q)
        );
      });

  // 先按状态排列（未入库优先），同状态内再按时间新旧排列
  const filtered = [...searched].sort((a, b) => {
    const rankA = STATUS_RANK[a.status] ?? 99;
    const rankB = STATUS_RANK[b.status] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const counts = {
    all: items.length,
    order: items.filter((it) => it.kind === "order").length,
    forwarding: items.filter((it) => it.kind === "forwarding").length,
    unwarehoused: items.filter((it) => it.kind === "forwarding" && it.status === "pending").length,
  };
  const historyCount = items.filter((it) => HISTORY_STATUSES.has(it.status)).length;

  const filterBtn = (k: OrderFilter, zh: string, en: string) => (
    <button
      key={k}
      onClick={() => setFilter(k)}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === k ? "bg-brand text-white" : "border border-border bg-surface text-ink-soft hover:border-brand/40"}`}
    >
      {tr(zh, en)} ({counts[k]})
    </button>
  );

  if (items.length === 0)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{tr("我的订单/运单", "My orders / waybills")}</h2>
        </div>
        <Empty
          icon={<Package />}
          text={tr("还没有订单或运单", "No orders or waybills yet")}
          cta={
            <div className="mt-4 flex justify-center gap-4">
              <Link to="/products" className="text-sm font-medium text-brand hover:underline">
                {tr("去逛逛 →", "Start shopping →")}
              </Link>
              <Link to="/forwarding" className="text-sm font-medium text-brand hover:underline">
                {tr("发起集运 →", "New forwarding →")}
              </Link>
            </div>
          }
        />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold">{tr("我的订单/运单", "My orders / waybills")}</h2>
        <Link
          to="/forwarding"
          className="inline-flex items-center gap-1 self-start rounded-full bg-cta-gradient px-4 py-2 text-xs font-semibold text-cta-foreground shadow-elevated"
        >
          <Plus className="h-3.5 w-3.5" />
          {tr("发起新集运", "New request")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {filterBtn("all", "全部", "All")}
        {filterBtn("order", "商城", "Shop")}
        {filterBtn("forwarding", "集运", "Forwarding")}
        {filterBtn("unwarehoused", "未入库", "Awaiting arrival")}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("搜索单号 / 国内单号 / 日期 / 包裹状态", "Search no. / domestic no. / date / status")}
          className={inputCls + " sm:max-w-md"}
        />
        <label className="inline-flex shrink-0 items-center gap-2 px-1 text-xs text-ink-soft">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          {tr(`显示历史订单 (${historyCount})`, `Show history (${historyCount})`)}
        </label>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-ink-soft">
            {tr("没有符合条件的订单", "No matching orders")}
          </div>
        )}
        {filtered.map((o) => (
          <div key={`${o.kind}-${o.id}`} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${o.kind === "order" ? "bg-brand/10 text-brand" : "bg-cta/10 text-cta"}`}
              >
                {o.kind === "order" ? (
                  <>
                    <ShoppingCart className="h-3 w-3" />
                    {tr("商城", "Shop")}
                  </>
                ) : (
                  <>
                    <Truck className="h-3 w-3" />
                    {tr("集运", "Forwarding")}
                  </>
                )}
              </span>
              <span className="font-mono text-sm font-semibold">{o.no}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${HISTORY_STATUSES.has(o.status) ? "bg-accent text-ink-soft" : "bg-brand/10 text-brand"}`}
              >
                {statusLabel(o)}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${o.payment_status === "paid" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
              >
                {o.payment_status === "paid" ? tr("已付款", "Paid") : tr("待付款", "Unpaid")}
              </span>
              {o.kind === "forwarding" && o.warehouse && (
                <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-ink-soft">
                  {o.warehouse === "guangzhou" ? tr("广州仓", "Guangzhou") : tr("义乌仓", "Yiwu")} ·{" "}
                  {o.shipping_method === "air" ? tr("空运", "Air") : tr("海运", "Sea")}
                </span>
              )}
              <span className="text-xs text-ink-soft">
                {new Date(o.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}
              </span>
              {(() => {
                const amountCad =
                  o.kind === "forwarding" && (o.total_cad ?? 0) > 0 ? Number(o.total_cad) : cnyToCad(o.fee_cny);
                return amountCad > 0 ? (
                  <div className="ml-auto text-right">
                    <div className="font-display text-base font-bold text-brand-gradient">
                      CA${amountCad.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-ink-soft">
                      {(o.total_weight_kg ?? 0) > 0 && <span>{(o.total_weight_kg ?? 0).toFixed(2)} kg</span>}
                      {(o.total_weight_kg ?? 0) > 0 && (o.total_volume_m3 ?? 0) > 0 && <span> · </span>}
                      {(o.total_volume_m3 ?? 0) > 0 && (
                        <span>
                          {(o.total_volume_m3 ?? 0).toFixed(3)} m³ / {(o.total_volumetric_weight_kg ?? 0).toFixed(2)} kg {tr("体积重", "vol. wt.")}
                        </span>
                      )}
                    </div>
                  </div>
                ) : null;
              })()}
            </div>

            {o.domestic_tracking_no && (
              <div className="mt-2 text-xs text-ink-soft">
                {tr("国内单号", "Domestic")}: <span className="font-mono">{o.domestic_tracking_no}</span>
              </div>
            )}
            {(o.lineItems?.length ?? 0) > 0 && (
              <div className="mt-1 text-xs text-ink-soft">
                {tr("内件", "Contents")}:{" "}
                {o.lineItems!.map((it, i) => (
                  <span key={it.name + i}>
                    {i > 0 && "、"}
                    <span className="text-foreground">{it.name}</span>
                    <span>×{it.qty}</span>
                  </span>
                ))}
              </div>
            )}
            {o.kind === "forwarding" && o.note && (
              <div className="mt-1 text-xs text-ink-soft">
                {tr("备注", "Note")}: {o.note}
              </div>
            )}

            {(o.waybills?.length ?? 0) > 0 && <WaybillsDropdown waybills={o.waybills!} lang={lang} />}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {o.tracking_no && (o.waybills?.length ?? 0) === 0 && (
                <button
                  onClick={() => setOpenId(openId === `${o.kind}-${o.id}` ? null : `${o.kind}-${o.id}`)}
                  className="inline-flex items-center gap-2 text-xs text-brand hover:underline"
                >
                  {o.kind === "order" ? <Package className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                  {tr("追踪", "Track")}: {o.tracking_no}
                  <span className="text-ink-soft">{openId === `${o.kind}-${o.id}` ? "▲" : "▼"}</span>
                </button>
              )}
              {o.kind === "order" ? (
                <Link
                  to="/orders/$orderId"
                  params={{ orderId: o.id }}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
                >
                  {tr("查看详情", "View detail")} <ArrowRight className="h-3 w-3" />
                </Link>
              ) : (
                <>
                  {o.status === "pending" && (
                    <button
                      onClick={() => onDeleteForwarding(o.id, o.no)}
                      disabled={busyDel === o.id}
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {busyDel === o.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {tr("删除", "Delete")}
                    </button>
                  )}
                  <Link
                    to="/forwarding/$forwardingId"
                    params={{ forwardingId: o.id }}
                    className={`${o.status === "pending" ? "" : "ml-auto"} inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand`}
                  >
                    {tr("查看详情", "View detail")} <ArrowRight className="h-3 w-3" />
                  </Link>
                </>
              )}
            </div>
            {openId === `${o.kind}-${o.id}` && o.tracking_no && <InlineTrack trackingNo={o.tracking_no} />}
          </div>
        ))}
      </div>
    </div>
  );
}

const WAYBILL_STATUS_LABELS: Record<string, [string, string]> = {
  pending: ["未入库", "Pending arrival"],
  received: ["已入库", "Received"],
  packed: ["封箱打包", "Packed"],
  shipped: ["运输中", "In transit"],
  in_transit: ["正在派送", "Out for delivery"],
  ready_pickup: ["待取货", "Ready for pickup"],
  delivered: ["已完成", "Completed"],
  cancelled: ["已取消", "Cancelled"],
};
function WaybillsDropdown({ waybills, lang }: { waybills: MyWaybill[]; lang: "zh" | "en" }) {
  const [open, setOpen] = useState(false);
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
      >
        <Package className="h-3 w-3" />
        {tr("运单", "Waybills")} ({waybills.length})<span className="text-ink-soft">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 rounded-xl border border-border bg-background/40 p-3">
          {waybills.map((w, i) => {
            const label = WAYBILL_STATUS_LABELS[w.status] ?? [w.status, w.status];
            return (
              <li key={w.waybill_no + i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono">{w.waybill_no}</span>
                <span className="ml-auto rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                  {lang === "zh" ? label[0] : label[1]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ===================== Wallet =====================
function WalletTab() {
  const { lang, cadToCny } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const startOtt = useServerFn(startOttTopup);
  const startHosted = useServerFn(startOttHostedCardTopup);
  const syncOtt = useServerFn(syncOttTopup);
  const submitEmt = useServerFn(submitEmtTopup);
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [txs, setTxs] = useState<WalletTx[] | null>(null);
  const [amount, setAmount] = useState<number>(20);
  const [channel, setChannel] = useState<"alipay" | "wechat" | "card" | "emt">("card");
  const [emtFile, setEmtFile] = useState<File | null>(null);
  const [emtNote, setEmtNote] = useState("");
  const EMT_EMAIL = "epluscanada@gmail.com";

  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false); // 硬锁：覆盖 setBusy 生效前的极短窗口
  // 同一「金额 × 渠道」的重复点击 / 失败重试 → 同一 idempotency_key → 服务端复用原充值单。
  // 一次充值成功发起后 topupNonce+1，让「再充一笔相同金额」拿到全新 key，不撞已用过的键。
  const [topupNonce, setTopupNonce] = useState(0);
  const topupKey = useMemo(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `k_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    [amount, channel, topupNonce],
  );
  const [qr, setQr] = useState<{ src: string; reference: string; notice?: string; openUrl?: string } | null>(null);
  const QR_TTL_SEC = 20;
  const [qrLeft, setQrLeft] = useState<number>(QR_TTL_SEC);


  const load = async () => {
    const [{ data: w }, { data: t }] = await Promise.all([
      sb.from("wallets").select("*").maybeSingle(),
      // 只显示已成功入账的流水（充值未支付/失败的不计入）
      sb
        .from("wallet_transactions")
        .select("*")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setWallet(w ?? { balance_cad: 0, user_id: "" });
    setTxs(t ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const presets = [10, 20, 40, 100, 200, 500];

  const submitEmtTopupFlow = async () => {
    if (!amount || amount < 2) return toast.error(tr("最低充值 CA$2", "Min top-up CA$2"));
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      let proofPath: string | null = null;
      if (emtFile) {
        if (emtFile.size > 10 * 1024 * 1024) throw new Error(tr("图片超过 10MB", "Image exceeds 10MB"));
        const { data: u } = await sb.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) throw new Error(tr("请先登录", "Please sign in"));
        const safe = emtFile.name.replace(/[^\w.\-]+/g, "_");
        proofPath = `${uid}/${Date.now()}_${safe}`;
        const up = await sb.storage
          .from("payment-proofs")
          .upload(proofPath, emtFile, { contentType: emtFile.type || undefined });
        if (up.error) throw up.error;
      }
      const r = await submitEmt({
        data: { amountCad: amount, proofPath, note: emtNote || null, idempotencyKey: topupKey },
      });
      toast.success(
        tr(
          `已提交（${r.reference}），客服会在 24 小时内为您处理入账`,
          `Submitted (${r.reference}). Support will credit your balance within 24 hours.`,
        ),
      );
      setTopupNonce((n) => n + 1); // 本次已发起 → 下一笔用新 key
      setEmtFile(null);
      setEmtNote("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? tr("提交失败", "Submission failed"));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const recharge = async () => {
    if (!amount || amount < 2) return toast.error(tr("最低充值 CA$2", "Min top-up CA$2"));
    if (channel === "card") return payByCard();
    if (channel === "emt") return submitEmtTopupFlow();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
      const r = await startOtt({ data: { amountCad: amount, channel, device, idempotencyKey: topupKey } });

      setTopupNonce((n) => n + 1); // 本次已发起 → 下一笔用新 key（QR 场景尤其需要）
      if (r.mode === "qr") {
        localStorage.setItem("ott_pending_ref", r.reference);
        setQr({ src: r.qrDataUrl, reference: r.reference, notice: r.notice, openUrl: r.openUrl });
      } else {
        localStorage.setItem("ott_pending_ref", r.reference);
        window.location.href = r.url;
      }
    } catch (e: any) {
      toast.error(e.message ?? tr("发起支付失败", "Failed to start payment"));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  // Poll a pending OTT Pay top-up (QR flow, or after returning from WeChat/Alipay)
  const pollRef = async (reference: string, isActive?: () => boolean) => {
    for (let i = 0; i < 40; i++) {
      if (isActive && !isActive()) return false;
      try {
        const r = await syncOtt({ data: { reference } });
        if (r.status === "completed") {
          toast.success(tr("充值成功，余额已更新", "Top-up successful, balance updated"));
          setQr(null);
          await load();
          return true;
        }
        if (r.status === "failed") {
          toast.error(tr("支付未完成", "Payment not completed"));
          setQr(null);
          return false;
        }
      } catch {
        /* keep polling */
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
    return false;
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ott") ?? localStorage.getItem("ott_pending_ref");
    if (!ref) return;
    localStorage.removeItem("ott_pending_ref");
    pollRef(ref).then(() => load());
  }, []);

  // QR is valid for 20s; auto-close if nothing happens
  useEffect(() => {
    if (!qr) return;
    const ref = qr.reference;
    let alive = true;
    setQrLeft(QR_TTL_SEC);
    pollRef(ref, () => alive);
    const tick = setInterval(() => setQrLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    const timer = setTimeout(() => {
      alive = false;
      setQr(null);
      toast.info(tr("二维码已过期，请重新发起支付", "QR code expired, please start the payment again"));
    }, QR_TTL_SEC * 1000);
    return () => {
      alive = false;
      clearInterval(tick);
      clearTimeout(timer);
    };
  }, [qr?.reference]);


  // Credit card: OTT Pay + Elavon Converge hosted payment page (card data never touches us)
  const payByCard = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const r = await startHosted({ data: { amountCad: amount, idempotencyKey: topupKey } });
      setTopupNonce((n) => n + 1);
      localStorage.setItem("ott_pending_ref", r.reference);
      window.location.href = r.url;
    } catch (e: any) {
      toast.error(e.message ?? tr("支付失败", "Payment failed"));
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };


  if (!wallet || !txs) return <Spinner />;

  const typeLabel = (t: WalletTx) => {
    if (t.type === "spend" && t.channel === "shop") return tr("电商扣款", "Shop deduction");
    if (t.type === "spend" && t.channel === "batch") return tr("集运扣款", "Forwarding deduction");
    if (t.type === "spend" && t.channel === "storage") return tr("仓库扣费", "Storage fee deduction");
    return (
      (
        {
          recharge: tr("充值", "Top-up"),
          spend: tr("消费", "Spend"),
          refund: tr("退款", "Refund"),
          adjust: tr("调整", "Adjust"),
        } as Record<string, string>
      )[t.type] ?? t.type
    );
  };
  const channelLabel = (c: string) =>
    (
      ({
        card: tr("信用卡", "Card"),
        wechat: tr("微信支付", "WeChat Pay"),
        alipay: tr("支付宝", "Alipay"),
        paypal: "PayPal",
        admin: tr("管理员", "Admin"),
        wallet: tr("钱包", "Wallet"),
        shop: tr("电商", "Shop"),
        batch: tr("集运", "Forwarding"),
        storage: tr("仓库", "Storage"),
        emt: tr("Email Transfer 邮件转账", "Email Transfer"),
        cash: tr("现金", "Cash"),
      }) as Record<string, string>
    )[c] ?? c;
  const isOfflineChannel = (c: string | null) => c === "emt" || c === "cash";
  const statusLabel = (s: string) =>
    (
      ({
        pending: tr("待支付", "Pending"),
        completed: tr("已完成", "Completed"),
        failed: tr("失败", "Failed"),
        cancelled: tr("已取消", "Cancelled"),
      }) as Record<string, string>
    )[s] ?? s;

  const balanceCad = Number(wallet.balance_cad ?? 0);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-brand/30 bg-brand-gradient p-6 text-white shadow-elevated">
        <div className="text-xs uppercase tracking-wide opacity-80">{tr("当前余额", "Current balance")}</div>
        <div className="mt-2 font-display text-4xl font-bold">CA${balanceCad.toFixed(2)}</div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="mb-4">
          <h3 className="font-display text-lg font-bold">{tr("充值 (加币结算)", "Top up (CAD settlement)")}</h3>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {presets.map((v) => (
            <button
              key={v}
              onClick={() => setAmount(v)}
              className={`rounded-xl border px-4 py-2 text-sm transition ${amount === v ? "border-brand bg-brand/5 text-brand font-semibold" : "border-border text-ink-soft"}`}
            >
              CA${v}
            </button>
          ))}
        </div>
        <Field label={tr("自定义金额 (CAD)", "Custom amount (CAD)")}>
          <input
            type="number"
            min={2}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
        <p className="mt-2 text-xs text-ink-soft">{tr("账户以加币记账", "Account is kept in CAD")}</p>
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-ink-soft">{tr("支付方式", "Payment method")}</div>
          <div className="grid grid-cols-4 gap-2 rounded-full bg-accent p-1">
            {(["card", "wechat", "alipay", "emt"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`rounded-full py-2 text-xs font-medium transition sm:text-sm ${channel === c ? "bg-background text-foreground shadow-sm" : "text-ink-soft"}`}
              >
                {c === "alipay"
                  ? tr("支付宝", "Alipay")
                  : c === "wechat"
                    ? tr("微信支付", "WeChat Pay")
                    : c === "emt"
                      ? tr("邮件转账", "Email Transfer")
                      : tr("信用卡", "Card")}
              </button>
            ))}
          </div>
        </div>

        {channel === "emt" && (
          <div className="mt-4 space-y-3 rounded-2xl border border-brand/30 bg-brand/5 p-4">
            <div>
              <div className="text-xs font-medium text-ink-soft">
                {tr("Email Transfer 收款邮箱", "Email Transfer recipient email")}
              </div>
              <div className="mt-1 select-all font-mono text-sm font-bold text-brand">{EMT_EMAIL}</div>
            </div>
            <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
              {tr(
                "Email Transfer 付款后请将付款凭证发送给客服／上传到系统，客服会在 24 小时内帮您处理余额。",
                "After sending the Email Transfer, please send the receipt to support or upload it here. Support will credit your balance within 24 hours.",
              )}
            </p>
            <Field label={tr("上传 Email Transfer 凭证截图", "Upload Email Transfer receipt")}>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setEmtFile(e.target.files?.[0] ?? null)}
                className="w-full text-xs file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-xs file:font-semibold file:text-brand-foreground"
              />
            </Field>
            {emtFile && <p className="text-[11px] text-ink-soft">{emtFile.name}</p>}
            <Field label={tr("备注（选填）", "Note (optional)")}>
              <input
                value={emtNote}
                onChange={(e) => setEmtNote(e.target.value)}
                placeholder={tr("如发送邮箱 / 参考号", "e.g. sender email / reference no.")}
                className={inputCls}
              />
            </Field>
          </div>
        )}

        <p className="mt-5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-center text-xs font-bold text-warning">
          {tr(
            "注意：充值钱款如需退回，需缴纳 5% 手续费",
            "Note: refunds of topped-up funds are subject to a 5% processing fee",
          )}
        </p>
        <button

          onClick={recharge}
          disabled={busy}
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-cta-gradient text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {channel === "emt"
            ? tr(`提交 Email Transfer 凭证 CA$${amount}`, `Submit Email Transfer receipt CA$${amount}`)
            : tr(`充值 CA$${amount}`, `Top up CA$${amount}`)}
        </button>

        <p className="mt-2 text-center text-[11px] text-ink-soft">
          {tr("由 OTT Pay 安全处理支付（微信 / 支付宝 / 信用卡）", "Payments securely processed by OTT Pay (WeChat / Alipay / Card)")}
        </p>
      </div>

      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-surface p-6 text-center">
            <h4 className="font-display text-base font-bold">
              {channel === "alipay" ? tr("请使用支付宝扫码支付", "Scan with Alipay to pay") : tr("请使用微信扫码支付", "Scan with WeChat to pay")}
            </h4>

            {qr.notice && (
              <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
                {tr(
                  qr.notice,
                  channel === "alipay"
                    ? "WeChat browser does not support Alipay. Please open the Alipay app to pay."
                    : "Alipay browser does not support WeChat Pay. Please open the WeChat app to pay.",
                )}
              </p>
            )}

            <img src={qr.src} alt={channel === "alipay" ? "Alipay QR" : "WeChat Pay QR"} className="mx-auto my-4 h-56 w-56 rounded-lg bg-white p-2" />

            <p className="text-xs text-ink-soft">{tr(`金额 CA$${amount.toFixed(2)}，支付后自动到账`, `CA$${amount.toFixed(2)} — credited automatically after payment`)}</p>
            <p className="mt-1 text-xs font-semibold text-brand">{tr(`二维码 ${qrLeft} 秒后失效`, `QR expires in ${qrLeft}s`)}</p>

            {qr.openUrl && (
              <a
                href={qr.openUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block w-full rounded-full bg-brand py-2 text-sm font-semibold text-brand-foreground"
              >
                {channel === "alipay"
                  ? tr("跳转到支付宝 App 付款", "Open Alipay app to pay")
                  : tr("跳转到微信 App 付款", "Open WeChat app to pay")}
              </a>
            )}


            <button onClick={() => setQr(null)} className="mt-2 w-full rounded-full border border-border py-2 text-sm">
              {tr("关闭", "Close")}
            </button>
          </div>
        </div>
      )}



      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="mb-4 font-display text-lg font-bold">{tr("账单流水", "Transactions")}</h3>
        {txs.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">{tr("暂无流水", "No transactions yet")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {txs.map((t) => {
              const positive = ["recharge", "refund", "adjust"].includes(t.type);
              const cad = Number(t.amount_cad ?? 0);
              const cny = t.amount_cny != null ? Number(t.amount_cny) : cadToCny(cad);
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span
                    className={`grid h-9 w-9 place-items-center rounded-full ${positive ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
                  >
                    {positive ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{typeLabel(t)}</span>
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-ink-soft">
                        {statusLabel(t.status)}
                      </span>
                      {t.channel && !["shop", "wallet", "batch", "storage"].includes(t.channel) && (
                        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-ink-soft">
                          {channelLabel(t.channel)}
                        </span>
                      )}
                      {isOfflineChannel(t.channel) && (
                        <span
                          className="rounded-full bg-cta/10 px-2 py-0.5 text-[10px] font-medium text-cta"
                          title={tr("线下收款，不影响钱包余额", "Offline payment — doesn't affect wallet balance")}
                        >
                          {tr("线下 · 不影响余额", "Offline · balance unaffected")}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-soft">
                      {new Date(t.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}
                    </div>
                    {t.note && <div className="mt-0.5 truncate text-[11px] text-ink-soft">{t.note}</div>}
                  </div>
                  <div
                    className={`text-right font-display text-sm font-bold ${positive ? "text-success" : "text-foreground"}`}
                  >
                    <div>
                      {positive ? "+" : "-"}CA${cad.toFixed(2)}
                    </div>
                    <div className="text-[11px] font-normal text-ink-soft">≈¥{cny.toFixed(2)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ===================== Helpers =====================
function InlineTrack({ trackingNo }: { trackingNo: string }) {
  const { lang } = useApp();
  const [data, setData] = useState<any | null | "err">(null);
  useEffect(() => {
    sb.rpc("lookup_shipment", { _tracking_no: trackingNo }).then(({ data, error }: any) => {
      if (error || !data) return setData("err");
      setData(data);
    });
  }, [trackingNo]);
  if (data === null)
    return (
      <div className="mt-3 grid h-20 place-items-center">
        <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />
      </div>
    );
  if (data === "err")
    return <div className="mt-3 text-xs text-ink-soft">{lang === "zh" ? "暂无轨迹数据" : "No tracking data yet"}</div>;
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-background">
      <TrackingTimeline events={(data as any).events ?? []} lang={lang} />
    </div>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
function Spinner() {
  return (
    <div className="grid h-40 place-items-center">
      <Loader2 className="h-5 w-5 animate-spin text-ink-soft" />
    </div>
  );
}
function Empty({ icon, text, cta }: { icon: React.ReactNode; text: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface py-16 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent text-ink-soft">{icon}</div>
      <p className="mt-3 text-ink-soft">{text}</p>
      {cta}
    </div>
  );
}
