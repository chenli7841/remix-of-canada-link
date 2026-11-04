import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { signInWithGoogle } from "@/lib/google-auth";
import {
  driverAccess,
  searchDriverDeliveries,
} from "@/lib/driver.functions";
import { DriverWorkspace } from "@/components/DriverWorkspace";
import {
  DriverLanguageProvider,
  DriverLanguageSwitch,
  useDriverLanguage,
} from "@/lib/driver-language";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "司机派送 / Driver delivery — EPLUS" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DriverRoute,
});
function DriverRoute() {
  return (
    <DriverLanguageProvider>
      <DriverPage />
    </DriverLanguageProvider>
  );
}
const button =
  "min-h-11 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-40";
const input =
  "min-h-12 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-slate-100 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30";

function DriverPage() {
  const { t: tr, language } = useDriverLanguage();
  const { user, loading, signOut } = useAuth();
  const access = useServerFn(driverAccess),
    search = useServerFn(searchDriverDeliveries);
  const check = useQuery({
    queryKey: ["driver-access", user?.id],
    queryFn: () => access(),
    enabled: !!user,
    retry: false,
  });
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [rows, setRows] = useState<Group[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [searchVersion, setSearchVersion] = useState(0);
  const loginWithGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await signInWithGoogle("/driver");
    } catch {
      setError(tr("Google 登录未完成，请检查网络后重试"));
    } finally {
      setBusy(false);
    }
  };
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let email = identifier.trim();
      if (!email.includes("@")) {
        const r = await supabase.rpc("resolve_login_email", { p_identifier: email });
        if (r.error || !r.data) throw new Error(tr("账号或密码不正确"));
        email = r.data;
      }
      const r = await supabase.auth.signInWithPassword({ email, password });
      if (r.error) throw new Error(tr("登录失败，请核对账号和密码"));
      setPassword("");
    } catch (e: any) {
      setError(e.message || tr("登录失败，请检查网络"));
    } finally {
      setBusy(false);
    }
  };
  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setRows(null);
    try {
      if (!/^\d{1,5}$/.test(code.trim())) throw new Error(tr("请输入1至5位客户号"));
      const data = await search({ data: { customerCode: code.trim() } });
      setRows(data);
      setSearchVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message || tr("查询失败"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      lang={language === "en" ? "en" : "zh-CN"}
      className="min-h-screen bg-[#0B1220] px-4 py-6 text-slate-100 [color-scheme:dark]"
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex justify-end">
          <DriverLanguageSwitch />
        </div>
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-blue-400">EPLUS</p>
            <h1 className="text-2xl font-bold">{tr("司机派送")}</h1>
          </div>
          {user && (
            <button
              className="min-h-11 rounded-lg border border-white/10 px-3 text-sm hover:bg-white/5"
              onClick={() => void signOut("/driver")}
            >
              {tr("退出登录")}
            </button>
          )}
        </header>
        {loading || (user && check.isLoading) ? (
          <p role="status">{tr("正在验证登录权限…")}</p>
        ) : !user ? (
          <form
            onSubmit={login}
            className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-sm"
          >
            <h2 className="text-lg font-semibold">{tr("司机登录")}</h2>
            <p className="text-sm text-slate-400">
              {tr("与后台使用同一账号，登录后进入司机派送页面。账号需已分配“派送司机”角色。")}
            </p>
            <button
              type="button"
              onClick={() => void loginWithGoogle()}
              disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10 font-medium disabled:opacity-40"
            >
              <span aria-hidden="true" className="text-xl font-bold text-blue-400">
                G
              </span>
              {tr("使用 Google 继续")}
            </button>
            <p className="text-center text-sm text-slate-400">
              {tr("或使用邮箱 / 登录名 / 手机号登录")}
            </p>
            <label className="block">
              {tr("账号")}
              <input
                required
                autoComplete="username"
                className={input}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </label>
            <label className="block">
              {tr("密码")}
              <input
                required
                type="password"
                autoComplete="current-password"
                className={input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className={button + " w-full"} disabled={busy}>
              {busy ? tr("登录中…") : tr("登录")}
            </button>
          </form>
        ) : check.isError ? (
          <div role="alert" className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <p>{tr(check.error.message)}</p>
            <button className={button + " mt-4"} onClick={() => void check.refetch()}>
              {tr("重新验证")}
            </button>
          </div>
        ) : check.isSuccess ? (
          <>
            <DriverWorkspace key={user?.id} />
          </>
        ) : null}
        {error && (
          <p
            role="alert"
            className="my-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300"
          >
            {tr(error)}
          </p>
        )}
      </div>
    </main>
  );
}
