import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/wecom-daily-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;
        try {
          const { sendDueDailyWecomDrafts } = await import("@/lib/wecom-daily-send.server");
          const result = await sendDueDailyWecomDrafts();
          return Response.json(result);
        } catch (error) {
          console.error("[wecom-daily-send] failed", error);
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "unknown_error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
