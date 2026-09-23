import { supabase } from "@/integrations/supabase/client";

export function safeAuthReturnTo(value?: string): string {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/account";
  return value;
}

export function googleReturnUrl(origin: string, returnTo?: string): string {
  return `${origin}/auth?redirect=${encodeURIComponent(safeAuthReturnTo(returnTo))}`;
}

/** Use the project's Supabase Google provider, independently of Lovable's broker. */
export async function signInWithGoogle(returnTo?: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleReturnUrl(window.location.origin, returnTo),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}
