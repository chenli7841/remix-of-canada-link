import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface CompanyInfo {
  name: string;
  logo_url: string;
  phone: string;
  email: string;
  address: string;
  wechat: string;
  wechat_qr_url: string;
  whatsapp: string;
  whatsapp_qr_url: string;
}

export const COMPANY_INFO_DEFAULT: CompanyInfo = {
  name: "SinoCargo",
  logo_url: "",
  phone: "",
  email: "",
  address: "",
  wechat: "",
  wechat_qr_url: "",
  whatsapp: "",
  whatsapp_qr_url: "",
};

export function useCompanyInfo(): CompanyInfo {
  const q = useQuery({
    queryKey: ["app-settings", "company_info"],
    queryFn: async () => {
      const { data } = await sb.from("app_settings").select("value").eq("key", "company_info").maybeSingle();
      return (data?.value ?? {}) as Partial<CompanyInfo>;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { ...COMPANY_INFO_DEFAULT, ...(q.data ?? {}) };
}


export interface PrintTemplate {
  logo_url: string;
  header: string;
  footer: string;
}

export const PRINT_TEMPLATE_DEFAULT: PrintTemplate = { logo_url: "", header: "", footer: "" };

export function usePrintTemplate(): PrintTemplate {
  const q = useQuery({
    queryKey: ["app-settings", "print_template"],
    queryFn: async () => {
      const { data } = await sb.from("app_settings").select("value").eq("key", "print_template").maybeSingle();
      return (data?.value ?? {}) as Partial<PrintTemplate>;
    },
    staleTime: 5 * 60 * 1000,
  });
  return { ...PRINT_TEMPLATE_DEFAULT, ...(q.data ?? {}) };
}
