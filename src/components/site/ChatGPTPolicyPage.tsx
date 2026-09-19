import { Link } from "@tanstack/react-router";
import { policyStatus, type PolicySection } from "@/lib/chatgpt-policies";

export function ChatGPTPolicyPage({
  title,
  sections,
}: {
  title: string;
  sections: PolicySection[];
}) {
  return (
    <main lang="zh-CN" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold text-ink-soft">EPLUS · ChatGPT 客服</p>
      <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{title}</h1>
      <p className="mt-4 text-sm text-ink-soft">
        版本：{policyStatus.version} · {policyStatus.company}
      </p>
      {!policyStatus.draft && (
        <p className="mt-2 text-sm text-ink-soft">生效日期：{policyStatus.effectiveDate}</p>
      )}
      {policyStatus.draft && (
        <aside
          role="note"
          className="mt-6 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm leading-7 text-amber-950"
        >
          <strong>待生效稿 / Draft — not yet effective</strong>
          <p>
            主数据库地区和每日备份范围已核实，运营方已确认落实隐私申请及人工清理流程；业务审计日志及其他服务商的处理安排仍待确认。本页暂不能作为已生效政策用于公开上架审核。
          </p>
        </aside>
      )}
      <nav
        aria-label="客服政策"
        className="mt-6 flex flex-wrap gap-4 text-sm underline underline-offset-4"
      >
        <Link to="/privacy">客服隐私政策</Link>
        <Link to="/terms">客服服务条款</Link>
        <a href={`mailto:${policyStatus.email}`}>联系 EPLUS</a>
      </nav>
      <div className="mt-10 space-y-9">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <div className="mt-3 space-y-3 text-base leading-8 text-ink-soft">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.links && (
                <ul className="list-disc space-y-2 pl-5">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} className="underline underline-offset-4">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-10 border-t border-border pt-6 text-sm break-words">
        联系邮箱：
        <a className="underline" href={`mailto:${policyStatus.email}`}>
          {policyStatus.email}
        </a>
      </p>
    </main>
  );
}
