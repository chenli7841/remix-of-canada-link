import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchPartnerHsCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { query: string }) => {
    if (typeof data?.query !== "string" || data.query.length > 100) throw new Error("搜索词过长");
    return { query: data.query.trim() };
  })
  .handler(async ({ data }) => {
    if (!data.query) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const term = data.query.replace(/[\\%_]/g, c => "\\" + c);
    const numeric = /^[\d.\s]+$/.test(data.query);
    const digits = data.query.replace(/\D/g, "");
    const code = numeric ? [digits.slice(0,4), ...(digits.slice(4).match(/.{1,2}/g) ?? [])].filter(Boolean).join(".") : term;
    // Quote PostgREST filter values so punctuation cannot alter the expression.
    const quote = (v: string) => JSON.stringify(`%${v}%`);
    const result = await supabaseAdmin.from("hs_codes")
      .select("id,hs_code,name_zh,name_en,mfn_rate,gst_rate,anti_dumping_rate")
      .eq("is_active", true)
      .or(`hs_code.ilike.${quote(code)},name_zh.ilike.${quote(term)},name_en.ilike.${quote(term)}`)
      .order("hs_code").limit(30);
    if (result.error) throw new Error("HS 编码库读取失败，请重试");
    return result.data ?? [];
  });

// Internal page reference data only; never return cost tables to the browser.
export const getPartnerShippingRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const routes = await context.supabase.from("shipping_routes")
      .select("id,code,name_zh,cargo_type,shipping_method")
      .eq("is_active", true).in("usage_scope", ["forwarding", "both"]).order("sort_order");
    if (routes.error) throw new Error("线路读取失败，请重试");
    const rules = await context.supabase.from("freight_rules")
      .select("route_id,weight_mode,volumetric_divisor,created_at")
      .eq("is_active", true).order("created_at", { ascending: false });
    if (rules.error) throw new Error("计费规则读取失败，请重试");
    return (routes.data ?? []).map(route => {
      const rule = rules.data?.find(r => r.route_id === route.id);
      return { ...route, weight_mode: rule?.weight_mode ?? null, volumetric_divisor: rule?.volumetric_divisor ?? null };
    });
  });

