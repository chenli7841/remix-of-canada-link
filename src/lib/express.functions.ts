import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ExpressDraft, ExpressRule, ExpressSource } from "./express";

export const getExpressWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ExpressSource) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).getExpressWorkspace(data, context),
  );
export const quoteExpress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { draft: ExpressDraft; rule: ExpressRule }) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).quoteExpress(data, context),
  );
export const buyExpress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { quoteId: string; rateKey: string; confirmed: true }) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).buyExpress(data, context),
  );
export const refreshExpress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; providerId?: string }) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).refreshExpress(data, context),
  );
export const voidExpress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason: string; confirmed: true }) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).voidExpress(data, context),
  );
export const labelExpress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).labelExpress(data, context),
  );
export const saveExpressSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { origin: ExpressDraft["from"]; rule: ExpressRule }) => d)
  .handler(async ({ data, context }) =>
    (await import("./express-service.server")).saveExpressSettings(data, context),
  );
export const getExpressOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    (await import("./express-service.server")).expressOverview(context),
  );
