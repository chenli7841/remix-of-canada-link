import { Link } from "@tanstack/react-router";
import { useApp, type Currency } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { useCompanyInfo } from "@/lib/company";
import { Menu, ShoppingCart, User, Globe, LogOut } from "lucide-react";
import { useState } from "react";

export function Header() {
  const { t, lang, setLang, currency, setCurrency } = useApp();
  const { user, signOut } = useAuth();
  const { count } = useCart();
  const company = useCompanyInfo();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = [
    { to: "/", label: t("nav.home") },
    { to: "/products", label: t("nav.products") },
    { to: "/shipping", label: t("nav.shipping") },
    { to: "/track", label: t("nav.track") },
    { to: "/about", label: t("nav.about") },
    { to: "/contact", label: t("nav.contact") },
  ] as const;

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.name} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient text-brand-foreground shadow-glow">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12h13l-3-3M16 12l-3 3M19 6l2 6-2 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          <span>{company.name}</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "bg-accent text-foreground" }}
              activeOptions={{ exact: n.to === "/" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <div className="hidden items-center gap-1 rounded-full border border-border bg-surface px-1 py-1 text-xs sm:flex">
            <button
              onClick={() => setLang("zh")}
              className={`rounded-full px-2 py-1 transition ${lang === "zh" ? "bg-foreground text-background" : "text-ink-soft hover:text-foreground"}`}
            >
              中
            </button>
            <button
              onClick={() => setLang("en")}
              className={`rounded-full px-2 py-1 transition ${lang === "en" ? "bg-foreground text-background" : "text-ink-soft hover:text-foreground"}`}
            >
              EN
            </button>
          </div>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="hidden h-8 rounded-md border border-border bg-surface px-2 text-xs font-medium sm:block"
            aria-label="Currency"
          >
            <option value="CNY">CNY ¥</option>
            <option value="CAD">CAD $</option>
          </select>

          <button
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            aria-label="Language"
            className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-[11px] font-bold text-ink-soft transition hover:text-foreground sm:hidden"
          >
            {lang === "zh" ? "EN" : "中"}
          </button>

          <Link
            to="/cart"
            aria-label={t("nav.cart")}
            className="relative grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-accent hover:text-foreground"
          >
            <ShoppingCart className="h-4 w-4" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-cta px-1 text-[10px] font-bold text-cta-foreground">
                {count}
              </span>
            )}
          </Link>

          {user ? (
            <>
              <Link
                to="/account"
                className="hidden h-9 items-center gap-1.5 rounded-md bg-cta px-3 text-sm font-medium text-cta-foreground shadow-glow-sm transition hover:opacity-90 sm:flex"
              >
                <User className="h-4 w-4" />
                {lang === "zh" ? "我的账户" : "My account"}
              </Link>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-ink-soft hover:bg-accent hover:text-foreground sm:flex"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-gradient text-[10px] font-bold text-brand-foreground">
                    {(user.email ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-[120px] truncate">{user.email}</span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-background shadow-elevated">
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          signOut();
                        }}
                        className="flex w-full items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5"
                      >
                        <LogOut className="h-4 w-4" />
                        {lang === "zh" ? "退出登录" : "Sign out"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <Link
              to="/auth"
              className="hidden h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-ink-soft hover:bg-accent hover:text-foreground sm:flex"
            >
              <User className="h-4 w-4" />
              {t("nav.signin")}
            </Link>
          )}

          {user && (
            <Link
              to="/account"
              aria-label={lang === "zh" ? "我的账户" : "My account"}
              className="grid h-9 w-9 place-items-center rounded-md bg-cta text-cta-foreground shadow-glow-sm transition hover:opacity-90 sm:hidden"
            >
              <User className="h-4 w-4" />
            </Link>
          )}

          <button
            aria-label="Menu"
            onClick={() => setOpen(!open)}
            className="grid h-9 w-9 place-items-center rounded-md text-ink-soft hover:bg-accent lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col px-4 py-2">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-accent hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
            {user ? (
              <Link
                to="/account"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-accent hover:text-foreground"
              >
                {lang === "zh" ? "我的账户" : "My account"}
              </Link>
            ) : (
              <Link
                to="/auth"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-accent hover:text-foreground"
              >
                {t("nav.signin")}
              </Link>
            )}
            <div className="mt-2 flex items-center gap-2 border-t border-border px-3 pt-3">
              <Globe className="h-4 w-4 text-ink-soft" />
              <button
                onClick={() => setLang("zh")}
                className={`text-sm ${lang === "zh" ? "font-bold" : "text-ink-soft"}`}
              >
                中文
              </button>
              <span className="text-ink-soft">/</span>
              <button
                onClick={() => setLang("en")}
                className={`text-sm ${lang === "en" ? "font-bold" : "text-ink-soft"}`}
              >
                EN
              </button>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="ml-auto h-8 rounded-md border border-border bg-surface px-2 text-xs font-medium"
              >
                <option value="CNY">CNY ¥</option>
                <option value="CAD">CAD $</option>
              </select>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
