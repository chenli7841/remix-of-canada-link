import { Link } from "@tanstack/react-router";
import { useApp } from "@/lib/i18n";
import { useCompanyInfo } from "@/lib/company";

export function Footer() {
  const { t } = useApp();
  const company = useCompanyInfo();
  return (
    <footer className="mt-24 border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 font-display text-lg font-bold">
            {company.logo_url ? (
              <img src={company.logo_url} alt={company.name} className="h-7 w-7 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-gradient text-brand-foreground text-xs">
                SC
              </span>
            )}
            {company.name}
          </div>
          <p className="mt-3 text-sm text-ink-soft">{t("footer.tagline")}</p>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold">{t("nav.products")}</h4>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li>
              <Link to="/products" className="hover:text-foreground">
                {t("nav.products")}
              </Link>
            </li>
            <li>
              <Link to="/shipping" className="hover:text-foreground">
                {t("nav.shipping")}
              </Link>
            </li>
            <li>
              <Link to="/track" className="hover:text-foreground">
                {t("nav.track")}
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold">{t("nav.about")}</h4>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li>
              <Link to="/about" className="hover:text-foreground">
                {t("nav.about")}
              </Link>
            </li>
            <li>
              <Link to="/contact" className="hover:text-foreground">
                {t("nav.contact")}
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold">Contact</h4>
          <ul className="space-y-2 text-sm text-ink-soft">
            {company.email && <li>{company.email}</li>}
            {company.phone && <li>{company.phone}</li>}
            {company.address && <li>{company.address}</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-ink-soft sm:px-6">
          © {new Date().getFullYear()} SinoCargo. {t("footer.rights")}
        </div>
      </div>
    </footer>
  );
}
