import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/mark-overdue")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("mark_invoices_overdue");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, marked: data ?? 0, ts: new Date().toISOString() });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run" }),
    },
  },
});
