import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { ROLE_LABEL, ADMIN_CONSOLE_ROLES } from "@/lib/admin-roles";
import { Loader2, Mail, Lock, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({ redirect: z.string().optional() });

async function getStaffRoles(userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.role).filter((role) => ADMIN_CONSOLE_ROLES.includes(role));
}

export const Route = createFileRoute("/admin-login")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "后台登录 — SinoCargo Admin" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: AdminLoginPage,
});

// Standalone login for the staff console (/admin/*). Deliberately not nested
// under src/routes/admin/ — that directory's route.tsx already gates on auth
// and would redirect back to a login page placed inside it, looping forever.
// Sign-in itself is role-agnostic (same auth.users pool as customers); which
// nav sections/content a role sees is decided inside /admin after login.
function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);



  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active || error || !data.user) return;
      try {
        const staffRoles = await getStaffRoles(data.user.id);
        if (!active) return;
        if (staffRoles.length > 0) {
          await navigate({ to: "/admin", replace: true });
          return;
        }
        await supabase.auth.signOut();
        if (active) setDenied("该账号没有管理后台权限，无法登录。如需访问请联系总负责人分配角色。");
      } catch (error) {
        if (active) setDenied(error instanceof Error ? error.message : "权限校验失败");
      } finally {
        if (active) setBusy(false);
      }
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setDenied(null);
    try {
      const identifier = email.trim();
      let loginEmail = identifier;
      if (!identifier.includes("@")) {
        const { data: resolvedEmail, error: resolveError } = await supabase.rpc(
          "resolve_login_email",
          { p_identifier: identifier },
        );
        if (resolveError) throw resolveError;
        if (!resolvedEmail) throw new Error("账号不存在");
        loginEmail = resolvedEmail;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) throw error;


      const staffRoles = await getStaffRoles(data.user.id);
      if (staffRoles.length === 0) {
        await supabase.auth.signOut();
        setDenied("该账号没有管理后台权限，无法登录。如需访问请联系总负责人分配角色。");
        toast.error("该账号没有管理后台权限");
        return;
      }

      const levelLabel = staffRoles.map((r) => ROLE_LABEL[r]?.zh ?? r).join(" · ");
      toast.success(`登录成功（${levelLabel}）`);
      // 登录后直接进入运营概览，具体可见内容由 /admin 布局按角色过滤
      await navigate({ to: "/admin", replace: true });

    } catch (err: any) {
      setDenied(err.message ?? "登录失败");
      toast.error(err.message ?? "登录失败");
    } finally {
      setBusy(false);
    }
  };


  const handleGoogle = async () => {
    setBusy(true);
    try {
      const returnTo = "/admin";
      // /auth 是公开路由，OAuth 回跳后由它在 session 就绪时再跳转到后台。
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth?redirect=${encodeURIComponent(returnTo)}`,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw new Error(result.error.message || "Google 登录失败");
      if (result.redirected) return;
    } catch (err: any) {
      toast.error(err.message ?? "Google 登录失败");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[#0B1220] px-4 text-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand to-cta font-display text-sm font-bold text-white shadow-glow">
            SC
          </span>
          <div className="font-display text-lg font-bold">SinoCargo Admin</div>
          <div className="text-xs uppercase tracking-wider text-slate-500">管理后台登录</div>
        </div>

        {denied && (
          <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs leading-relaxed text-rose-200">
            {denied}
          </div>
        )}

        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">

          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 48 48">
              <path
                fill="#FFC107"
                d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"
              />
              <path
                fill="#FF3D00"
                d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
              />
              <path
                fill="#4CAF50"
                d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.6 39.6 16.3 44 24 44z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.1 5.5l6.2 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.3-.1-2.4-.4-3.5z"
              />
            </svg>
            使用 Google 继续
          </button>

          <button
            type="button"
            onClick={() => toast.info("微信登录即将开放：管理员需在微信开放平台申请网页应用并填入 AppID/AppSecret")}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/5 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#07C160">
              <path d="M8.5 4C4.36 4 1 6.91 1 10.5c0 2.08 1.13 3.92 2.88 5.12L3 18l2.5-1.32c.79.21 1.63.32 2.5.32.2 0 .4-.01.6-.02-.06-.32-.1-.65-.1-.98 0-3.31 3.13-6 7-6 .27 0 .53.01.79.04C15.92 6.97 12.55 4 8.5 4zM6 8.5a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2zM16 10c-3.31 0-6 2.24-6 5s2.69 5 6 5c.74 0 1.45-.11 2.1-.32L20 21l-.5-1.8C21.07 18.27 22 16.74 22 15c0-2.76-2.69-5-6-5zm-2 4a.75.75 0 110 1.5.75.75 0 010-1.5zm4 0a.75.75 0 110 1.5.75.75 0 010-1.5z" />
            </svg>
            使用微信登录
          </button>

          <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-600">
            <div className="h-px flex-1 bg-white/10" />
            或
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                required
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱 / 登录名 / 手机号"
                className="h-11 w-full rounded-lg border border-white/10 bg-white/5 pl-10 pr-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                className="h-11 w-full rounded-lg border border-white/10 bg-white/5 pl-10 pr-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-brand to-cta text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              登录
            </button>
          </form>
        </div>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ArrowRight className="h-3 w-3 rotate-180" />
          <Link to="/" className="hover:text-slate-300">
            返回官网首页
          </Link>
        </div>
      </div>
    </div>
  );
}
