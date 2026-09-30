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
    if (numeric && !digits) return [];
    const code = numeric ? [digits.slice(0,4), ...(digits.slice(4).match(/.{1,2}/g) ?? [])].filter(Boolean).join(".") : term;
    // Quote PostgREST filter values so punctuation cannot alter the expression.
    const quote = (v: string) => JSON.stringify(`%${v}%`);
    const search = supabaseAdmin.from("hs_codes")
      .select("id,hs_code,name_zh,name_en,mfn_rate,gst_rate,anti_dumping_rate")
      .eq("is_active", true);
    // Numeric input is a code prefix, never a substring or a product-name query.
    const result = await (numeric
      ? search.ilike("hs_code", `${code}%`)
      : search.or(`name_zh.ilike.${quote(term)},name_en.ilike.${quote(term)}`)
    ).order("hs_code").limit(30);
    if (result.error) throw new Error("HS 编码库读取失败，请重试");
    return result.data ?? [];
  });

export const getPartnerShippingRoutes = createServerFn({ method: "GET" })
.middleware([requireSupabaseAuth]).handler(async ({context}) => (await import('./partner-quote.server')).listRoutes(context));

export const getPartnerAmazonWarehouses = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async()=>(await import('./partner-quote.server')).listAmazonWarehouses());
