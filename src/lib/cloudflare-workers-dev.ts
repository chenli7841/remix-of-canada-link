/** Local Vite-only compatibility shim. Production resolves cloudflare:workers natively. */
export function waitUntil(promise: Promise<unknown>): void {
  void promise;
}