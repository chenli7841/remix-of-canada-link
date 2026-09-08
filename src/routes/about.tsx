import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/i18n";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "关于我们 / About — SinoCargo" },
      {
        name: "description",
        content:
          "SinoCargo started in freight forwarding and consolidation, then grew into Yiwu-sourced e-commerce, serving Canadian SMEs and individual buyers.",
      },
      { property: "og:title", content: "About SinoCargo" },
      {
        property: "og:description",
        content:
          "From freight forwarding to Yiwu-sourced e-commerce, built for Canadian businesses and individual buyers.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  const { t, lang } = useApp();
  const story =
    lang === "zh"
      ? [
          "SinoCargo 起源于中加跨境物流服务，凭借多年国际运输、海外仓储、集运及清关经验，为加拿大客户提供安全、高效、可靠的跨境物流解决方案。",
          "随着服务客户数量不断增长，我们在物流业务中深入了解加拿大市场的采购需求，并发现中国义乌小商品市场在产品丰富度、价格竞争力和供应链效率方面拥有显著优势。基于这一洞察，SinoCargo 在义乌、广州等核心采购城市建立采购与仓储中心，正式拓展中国商品采购业务，打造集采购、质检、仓储、集运、清关、国际运输及本地配送于一体的一站式供应链服务。",
          "如今，SinoCargo 已从一家跨境物流企业，发展成为连接中国制造与加拿大市场的综合供应链服务商。我们不仅支持个人消费者的小额采购和代发服务，也为加拿大中小企业提供稳定、高性价比的产品采购、批发及整柜进口解决方案。",
          "义乌小商品批发资源是 SinoCargo 的核心竞争优势。依托成熟的供应商网络和专业采购团队，我们帮助客户以更低的采购成本、更高的供应效率，轻松获取来自中国的优质商品。",
          "无论您是寻找长期稳定供应链的企业客户，还是希望购买中国优质商品的个人消费者，SinoCargo 都致力于成为您值得信赖的中国采购与跨境物流合作伙伴。",
        ]
      : [
          "SinoCargo began as a cross-border logistics service between China and Canada, drawing on years of experience in international freight, overseas warehousing, consolidation, and customs clearance to deliver safe, efficient, and reliable cross-border logistics solutions for Canadian customers.",
          "As our customer base grew, our logistics work gave us a close-up view of sourcing demand in the Canadian market — and we discovered that Yiwu's small-commodity market offered a clear edge in product variety, price competitiveness, and supply chain efficiency. Building on that insight, SinoCargo set up sourcing and warehousing centers in Yiwu, Guangzhou, and other core procurement cities, formally expanding into China sourcing and building a one-stop supply chain service spanning procurement, quality inspection, warehousing, consolidation, customs clearance, international freight, and local delivery.",
          "Today, SinoCargo has grown from a cross-border logistics company into a full-service supply chain partner connecting Chinese manufacturing with the Canadian market. We support small-order sourcing and dropshipping for individual consumers, as well as stable, cost-effective sourcing, wholesale, and full-container import solutions for Canadian small and medium businesses.",
          "Yiwu's small-commodity wholesale network is SinoCargo's core competitive advantage. Backed by a mature supplier network and a professional sourcing team, we help customers access quality goods from China at lower cost and higher supply efficiency.",
          "Whether you're a business looking for a long-term, stable supply chain or an individual shopper looking to buy quality goods from China, SinoCargo is committed to being your trusted partner for China sourcing and cross-border logistics.",
        ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 className="font-display text-4xl font-bold sm:text-5xl">{t("about.title")}</h1>
      <div className="mt-8 space-y-5 text-lg leading-relaxed text-ink-soft">
        {story.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { k: "50,000+", v: lang === "zh" ? "服务客户" : "Customers served" },
          { k: "3", v: lang === "zh" ? "中国集运仓" : "China hubs" },
          { k: "80+", v: lang === "zh" ? "覆盖加拿大城市" : "Cities reached" },
        ].map((s) => (
          <div key={s.v} className="rounded-2xl border border-border bg-surface p-6">
            <div className="font-display text-3xl font-bold text-brand-gradient">{s.k}</div>
            <div className="mt-1 text-sm text-ink-soft">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
