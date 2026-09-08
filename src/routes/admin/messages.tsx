import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Page, Card, fmtDate } from "@/lib/admin-shared";
import { Mail, Phone, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/admin/messages")({ component: MessagesPage });

const sb = supabase as any;

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: "new" | "read";
  created_at: string;
}

function MessagesPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["contact-messages"],
    queryFn: async () => {
      const { data, error } = await sb.from("contact_messages").select("*").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ContactMessage[];
    },
  });

  const markRead = async (id: string) => {
    await sb.from("contact_messages").update({ status: "read" }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["contact-messages"] });
  };

  const list = q.data ?? [];
  const newCount = list.filter((m) => m.status === "new").length;

  return (
    <Page title="留言信息" subtitle={`来自官网 /contact 页面的在线留言 · ${newCount} 条未读`}>
      {q.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <div className="py-8 text-center text-sm text-slate-500">暂无留言</div>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((m) => (
            <Card key={m.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-100">{m.name}</span>
                    {m.status === "new" ? (
                      <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                        未读
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        已读
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {m.email}
                    </span>
                    {m.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {m.phone}
                      </span>
                    )}
                    <span>{fmtDate(m.created_at)}</span>
                  </div>
                </div>
                {m.status === "new" && (
                  <button
                    onClick={() => markRead(m.id)}
                    className="shrink-0 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                  >
                    标为已读
                  </button>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{m.message}</p>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
