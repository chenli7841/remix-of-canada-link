// Public website origin for account setup links; independent of the OAuth issuer.
export function mcpAccountSetupUrl(): string {
  const url = new URL(
    process.env.MCP_PUBLIC_SITE_URL || "https://china-to-canada-connect.lovable.app",
  );
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MCP_PUBLIC_SITE_URL must be an HTTPS origin");
  }
  return new URL("/auth", url).href;
}
