import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PartnerRouteSettings } from "@/components/partner/PartnerRouteSettings";
import {
  getPartnerDeliveryConnection,
  testPartnerDeliveryQuote,
} from "@/lib/partner-delivery.functions";
import {
  listPartnerRouteConfigs,
  savePartnerRouteConfig,
  getPartnerSettings,
  savePartnerSettings,
} from "@/lib/partner-quote.functions";
import { useMemo } from "react";
export const Route = createFileRoute("/admin/routes_/partner-settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "同行专属线路设置 · 管理后台" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Page,
});
function Page() {
  const connection = useServerFn(getPartnerDeliveryConnection),
    quote = useServerFn(testPartnerDeliveryQuote),
    list = useServerFn(listPartnerRouteConfigs),
    save = useServerFn(savePartnerRouteConfig),
    settings = useServerFn(getPartnerSettings),
    saveSettings = useServerFn(savePartnerSettings);
  const storage = useMemo(
    () => ({
      settings: () => settings(),
      saveSettings: (data: any) => saveSettings({ data }),
      list: () => list(),
      save: (data: any) => save({ data }),
    }),
    [list, save, settings, saveSettings],
  );
  return (
    <PartnerRouteSettings
      embedded
      storage={storage}
      deliveryApi={{
        connection: (probe) => connection({ data: { probe } }),
        quote: (data) => quote({ data }),
      }}
    />
  );
}
