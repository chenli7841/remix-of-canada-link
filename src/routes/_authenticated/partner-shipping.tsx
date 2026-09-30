import {requestPartnerQuote} from '@/lib/partner-quote.functions';
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPartnerAmazonWarehouses, getPartnerShippingRoutes, searchPartnerHsCodes } from "@/lib/partner-shipping.functions";
import { useCallback } from "react";
import { PartnerShippingPage } from "@/components/partner/PartnerShippingPage";

export const Route = createFileRoute("/_authenticated/partner-shipping")({
  head: () => ({ meta: [{ title: "同行询价与下单 · EPLUS" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: Page,
});
function Page() {
  const loadWarehouses = useServerFn(getPartnerAmazonWarehouses);
  const warehouses = useQuery({queryKey:["partner-amazon-warehouses"],queryFn:()=>loadWarehouses(),staleTime:60000});
  const quote = useServerFn(requestPartnerQuote);
  const load = useServerFn(getPartnerShippingRoutes);
  const search = useServerFn(searchPartnerHsCodes);
  const searchHs = useCallback((query: string) => search({ data: { query } }), [search]);
  const query = useQuery({ queryKey: ["partner-shipping-routes"], queryFn: () => load(), staleTime: 60000 });
  return <PartnerShippingPage warehouses={warehouses.data??[]} requestQuote={data=>quote({data})} routes={query.data ?? []} searchHs={searchHs} loading={query.isLoading} error={warehouses.error?"亚马逊仓库地址读取失败，请刷新重试。":query.error ? "线路或规则读取失败，请刷新重试。" : undefined} />;
}
