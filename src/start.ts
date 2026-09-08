import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isAbortError } from "./lib/error-capture";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // h3 wraps a disconnected Node request in an HTTPError with statusCode=500,
    // while preserving the original ECONNRESET/"aborted" error as `cause`.
    // Detect that chain before rethrowing status errors, otherwise harmless
    // client disconnects reach Vite's error overlay and appear as a blank page.
    if (isAbortError(error)) return new Response(null, { status: 499 });
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
