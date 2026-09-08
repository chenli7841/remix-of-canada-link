import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/i18n";
import { useCompanyInfo } from "@/lib/company";
import { Loader2, User, Mail, Lock, Phone, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  redirect: z.string().optional(),
  wechat: z.enum(["notbound", "failed"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "登录 / Sign In — SinoCargo" },
      {
        name: "description",
        content: "Sign in or create your SinoCargo account to manage orders and track shipments.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const { lang } = useApp();
  const { user } = useAuth();
  const company = useCompanyInfo();
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<Mode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate({ to: search.redirect || "/account" });
  }, [user, navigate, search.redirect]);

  useEffect(() => {
    if (search.wechat === "notbound")
      toast.error(
        lang === "zh"
          ? "该微信尚未绑定账号，请先用邮箱登录后在「账号安全」绑定微信"
          : "This WeChat account isn't linked yet — sign in and link it under Account Security.",
      );
    else if (search.wechat === "failed")
      toast.error(lang === "zh" ? "微信登录失败，请重试" : "WeChat sign-in failed, please try again");
  }, [search.wechat, lang]);


  const isZh = lang === "zh";
  const tr = (zh: string, en: string) => (isZh ? zh : en);
  const stripSpaces = (v: string) => v.replace(/\s+/g, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data: usernameAvailable, error: usernameError } = await supabase.rpc("check_username_available", {
          p_username: username,
        });
        if (usernameError) throw usernameError;
        if (!usernameAvailable) throw new Error(tr("登录名已被占用", "Login name is already taken"));

        const { data: emailAvailable, error: emailError } = await supabase.rpc("check_email_available", {
          p_email: email,
        });
        if (emailError) throw emailError;
        if (!emailAvailable) throw new Error(tr("邮箱已被注册", "Email is already registered"));

        const { data: phoneAvailable, error: phoneError } = await supabase.rpc("check_phone_available", {
          p_phone: phone,
        });
        if (phoneError) throw phoneError;
        if (!phoneAvailable) throw new Error(tr("手机号已被注册", "Phone number is already registered"));

        const returnTo =
          search.redirect && search.redirect.startsWith("/") ? search.redirect : "/";
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + returnTo,
            data: { full_name: fullName, username, phone },
          },
        });
        if (error) throw error;
        toast.success(tr("注册成功！请查收验证邮件", "Account created — check your email to verify"));
      } else {
        const { data: resolvedEmail, error: resolveError } = await supabase.rpc("resolve_login_email", {
          p_identifier: identifier.trim(),
        });
        if (resolveError) throw resolveError;
        if (!resolvedEmail) throw new Error(tr("账号不存在", "No account found"));

        const { error } = await supabase.auth.signInWithPassword({ email: resolvedEmail, password });
        if (error) throw error;
        toast.success(tr("登录成功", "Signed in"));
      }
    } catch (err: any) {
      toast.error(err.message ?? tr("操作失败", "Failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    try {
      const returnTo =
        search.redirect && search.redirect.startsWith("/") ? search.redirect : "/account";
      // Must be a PUBLIC same-origin URL: /account & friends are behind the auth
      // gate, and the gate can run before the OAuth session is hydrated.
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth?redirect=${encodeURIComponent(returnTo)}`,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw new Error(result.error.message || "Google sign-in failed");
      if (result.redirected) return;
    } catch (err: any) {
      toast.error(err.message ?? "Google sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[80vh] bg-gradient-to-br from-background via-accent/30 to-background px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-display text-xl font-bold">
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-gradient text-brand-foreground shadow-glow">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12h13l-3-3M16 12l-3 3M19 6l2 6-2 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          {company.name}
        </Link>

        <div className="mb-4 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4 text-sm">
          <p className="mb-1 font-bold text-foreground">{tr("老客户通知", "Notice for existing customers")}</p>
          <p className="text-ink-soft">
            {tr(
              "老客户请使用原有的登录名 + 密码 123456 登录。登录后请到「个人资料 → 账号安全」修改密码。",
              "Existing customers: sign in with your original login name and the password 123456, then change it under Profile → Account Security.",
            )}
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-surface p-6 shadow-elevated sm:p-8">
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-accent p-1 text-sm font-medium">
            <button
              onClick={() => setMode("signin")}
              className={`rounded-full py-2 transition ${mode === "signin" ? "bg-background text-foreground shadow-sm" : "text-ink-soft"}`}
            >
              {tr("登录", "Sign in")}
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`rounded-full py-2 transition ${mode === "signup" ? "bg-background text-foreground shadow-sm" : "text-ink-soft"}`}
            >
              {tr("注册", "Sign up")}
            </button>
          </div>

          <button
            onClick={handleGoogle}
            disabled={busy}
            className="mb-3 flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
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
            {tr("使用 Google 继续", "Continue with Google")}
          </button>

          {/* WeChat sign-in hidden until the WeChat Open Platform app is approved. */}


          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" ? (
              <>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={tr("姓名", "Full name")}
                  className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                  <input
                    required
                    value={username}
                    onChange={(e) => setUsername(stripSpaces(e.target.value))}
                    placeholder={tr("登录名（不含空格，不区分大小写）", "Login name (no spaces, case-insensitive)")}
                    className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(stripSpaces(e.target.value))}
                    placeholder={tr("邮箱", "Email")}
                    className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                  <input
                    required
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(stripSpaces(e.target.value))}
                    placeholder={tr(
                      "手机号（如 6478917666 或 +1-647-891-7666）",
                      "Phone, e.g. 6478917666 or +1-647-891-7666",
                    )}
                    className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </>
            ) : (
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                <input
                  required
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(stripSpaces(e.target.value))}
                  placeholder={tr("登录名 / 邮箱 / 手机号", "Login name / Email / Phone")}
                  className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </div>
            )}
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <input
                required
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tr("密码（至少6位）", "Password (min 6)")}
                className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cta-gradient text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {mode === "signin" ? tr("登录", "Sign in") : tr("创建账户", "Create account")}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-soft">
            {tr("继续即表示同意我们的", "By continuing you agree to our")}{" "}
            <Link to="/about" className="underline">
              {tr("服务条款", "Terms")}
            </Link>
            {" · "}
            <Link to="/contact" className="underline">
              {tr("帮助", "Help")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
