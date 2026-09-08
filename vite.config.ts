// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const cloudflareWorkersDevShimPath = fileURLToPath(
  new URL("./src/lib/cloudflare-workers-dev.ts", import.meta.url),
);

const cloudflareWorkersDevShim: Plugin = {
  name: "cloudflare-workers-dev-shim",
  enforce: "pre",
  resolveId(id) {
    if (id !== "cloudflare:workers") return null;
    // Dev (Node) has no workerd runtime: use a local no-op shim.
    // Build: keep it external so the deployed Worker resolves it natively.
    return this.environment?.mode === "build"
      ? { id, external: true }
      : cloudflareWorkersDevShimPath;
  },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [cloudflareWorkersDevShim, mcpPlugin()],
  },
});
