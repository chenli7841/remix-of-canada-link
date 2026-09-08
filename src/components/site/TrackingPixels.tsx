import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface TrackingPixelsCfg {
  meta_pixel_id?: string;
  tiktok_pixel_id?: string;
  xhs_pixel_id?: string;
  google_analytics_id?: string;
}

/** Fetches tracking pixel IDs from app_settings.tracking_pixels and injects them once on mount. */
export function TrackingPixels() {
  const { data } = useQuery({
    queryKey: ["app-settings", "tracking_pixels"],
    queryFn: async () => {
      const { data } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", "tracking_pixels")
        .maybeSingle();
      return (data?.value ?? {}) as TrackingPixelsCfg;
    },
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    if (data.meta_pixel_id) injectMetaPixel(data.meta_pixel_id);
    if (data.tiktok_pixel_id) injectTikTokPixel(data.tiktok_pixel_id);
    if (data.google_analytics_id) injectGA(data.google_analytics_id);
    if (data.xhs_pixel_id) injectXhs(data.xhs_pixel_id);
  }, [data?.meta_pixel_id, data?.tiktok_pixel_id, data?.google_analytics_id, data?.xhs_pixel_id]);

  return null;
}

function once(id: string, fn: () => void) {
  if (document.getElementById(id)) return;
  fn();
}

function injectMetaPixel(pixelId: string) {
  once("lv-meta-pixel", () => {
    const s = document.createElement("script");
    s.id = "lv-meta-pixel";
    s.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`;
    document.head.appendChild(s);
  });
}

function injectTikTokPixel(pixelId: string) {
  once("lv-tt-pixel", () => {
    const s = document.createElement("script");
    s.id = "lv-tt-pixel";
    s.innerHTML = `!function (w, d, t) {w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${pixelId}');ttq.page();}(window, document, 'ttq');`;
    document.head.appendChild(s);
  });
}

function injectGA(gaId: string) {
  once("lv-ga-src", () => {
    const s = document.createElement("script");
    s.id = "lv-ga-src";
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    document.head.appendChild(s);
    const c = document.createElement("script");
    c.id = "lv-ga-init";
    c.innerHTML = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${gaId}');`;
    document.head.appendChild(c);
  });
}

function injectXhs(pixelId: string) {
  // Xiaohongshu (小红书聚光) tracks via their conversion SDK; placeholder for their loader.
  once("lv-xhs-pixel", () => {
    const s = document.createElement("script");
    s.id = "lv-xhs-pixel";
    s.async = true;
    s.src = `https://s0.xhscdn.com/a/xhs-pixel/latest/xhs-pixel.js?id=${pixelId}`;
    document.head.appendChild(s);
  });
}
