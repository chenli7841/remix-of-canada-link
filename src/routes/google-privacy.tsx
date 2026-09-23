import { createFileRoute, Link } from "@tanstack/react-router";
import { policyStatus } from "@/lib/chatgpt-policies";

export const Route = createFileRoute("/google-privacy")({
  head: () => ({ meta: [
    { title: "Google 登录隐私说明 / Google Sign-in Privacy — EPLUS" },
    { name: "description", content: "How EPLUS uses Google account information for website sign-in, account linking and session management." },
  ] }),
  component: GooglePrivacyPage,
});

const sections = [
  {
    title: "适用范围 / Scope",
    zh: "本说明适用于 EPLUS 网站使用 Google 账号登录及绑定账号的功能。其他商城、运输、支付及 ChatGPT 客服功能的数据处理不属于本说明的范围。",
    en: "This notice covers Google sign-in and account linking on the EPLUS website. It does not cover the separate processing associated with shopping, shipping, payments or the ChatGPT service.",
  },
  {
    title: "接收的信息与用途 / Information and use",
    zh: "经您授权，Google 向认证服务提供账号标识、邮箱及验证状态，以及可用的姓名和头像。EPLUS 使用 Supabase 核验身份、创建或关联网站账号、保存账号资料并维持登录会话。网站使用浏览器存储保存会话凭证，以便刷新页面后保持登录。",
    en: "With your authorization, Google provides an account identifier, email and verification status, and your name and profile image when available. EPLUS uses Supabase to authenticate you, create or link a website account, store profile information and maintain your session. Session credentials are stored in your browser so you can remain signed in across page refreshes.",
  },
  {
    title: "授权范围 / Permissions",
    zh: "此登录功能只请求基本身份及邮箱信息，不请求读取 Google 邮件、云端硬盘文件、联系人或日历的权限。您的 Google 密码由 Google 处理，请勿将密码发送给 EPLUS。",
    en: "This sign-in feature requests only basic identity and email information. It does not request access to Gmail messages, Drive files, contacts or calendars. Google handles your Google password; do not send it to EPLUS.",
  },
  {
    title: "处理服务与访问 / Services and access",
    zh: "Google 提供身份认证，Supabase 提供网站认证和账号数据存储，Lovable 提供网站构建及托管相关服务。账号资料按网站权限提供给本人和获授权处理账号事务的员工。服务商及其基础设施的处理可能涉及您所在国家以外的地区；有关 Google 自身的数据处理，请查阅 Google 隐私政策。",
    en: "Google provides identity authentication, Supabase provides website authentication and account storage, and Lovable provides website development and hosting services. Account information is available to you and staff authorized to handle account matters under website access controls. Service providers and infrastructure may process data outside your country. Google's own processing is described in its privacy policy.",
  },
  {
    title: "保留、撤销与删除 / Retention, revocation and deletion",
    zh: "Google 登录身份与网站账号关联保存，用于后续登录和账号管理。退出登录或撤销 Google 授权不会自动删除网站账号及订单、钱包等业务记录。您可通过下方邮箱申请查阅、更正、解除关联或删除账号资料；我们需要核验身份，并根据账号状态、未完成业务及适用的记录保留要求处理。备份或依法需要保留的记录可能不能立即清除。撤销授权前，请确认仍有可用的网站登录方式。",
    en: "Your Google sign-in identity is associated with your website account for future sign-in and account management. Signing out or revoking Google access does not automatically delete your website account, orders or wallet records. Contact us below to request access, correction, unlinking or deletion. We need to verify your identity and consider account status, outstanding business and applicable record-retention requirements. Backups or records that must be retained may not be immediately removable. Ensure you have another working sign-in method before revoking access.",
  },
];

function GooglePrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold text-ink-soft">EPLUS · {policyStatus.company}</p>
      <h1 className="mt-3 text-3xl font-bold">Google 登录隐私说明</h1>
      <p className="mt-2 text-lg text-ink-soft" lang="en">Google Sign-in Privacy Notice</p>
      <p className="mt-3 text-sm text-ink-soft">版本 / Version: 2026-09-22</p>
      <div className="mt-9 space-y-8">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-xl font-semibold">{section.title}</h2>
            <p lang="zh-CN" className="mt-3 leading-8 text-ink-soft">{section.zh}</p>
            <p lang="en" className="mt-3 leading-7 text-ink-soft">{section.en}</p>
          </section>
        ))}
      </div>
      <section className="mt-9 space-y-3 border-t border-border pt-6">
        <h2 className="text-xl font-semibold">联系与相关链接 / Contact and links</h2>
        <p><a className="underline" href={`mailto:${policyStatus.email}`}>{policyStatus.email}</a></p>
        <p><a className="underline" href="https://myaccount.google.com/connections">管理 Google 授权 / Manage Google connections</a></p>
        <p><a className="underline" href="https://policies.google.com/privacy">Google 隐私政策 / Google Privacy Policy</a></p>
        <p><Link className="underline" to="/auth">返回登录 / Back to sign-in</Link></p>
      </section>
    </main>
  );
}
