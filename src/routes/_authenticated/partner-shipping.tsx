import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPartnerShippingRoutes, searchPartnerHsCodes } from "@/lib/partner-shipping.functions";
import { useCallback } from "react";
import { PartnerShippingPage } from "@/components/partner/PartnerShippingPage";

export const Route = createFileRoute("/_authenticated/partner-shipping")({
  head: () => ({ meta: [{ title: "同行询价与下单 · EPLUS" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: Page,
});
function Page() {
  const load = useServerFn(getPartnerShippingRoutes);
  const search = useServerFn(searchPartnerHsCodes);
  const searchHs = useCallback((query: string) => search({ data: { query } }), [search]);
  const query = useQuery({ queryKey: ["partner-shipping-routes"], queryFn: () => load(), staleTime: 60000 });
  return <PartnerShippingPage routes={query.data ?? []} searchHs={searchHs} loading={query.isLoading} error={query.error ? "线路或规则读取失败，请刷新重试。" : undefined} />;
}
