import { createFileRoute } from "@tanstack/react-router";

// 定时对账入口：由 pg_cron -> pg_net 每 2 分钟带共享密钥 POST 过来。
// 逐笔 OTT 待处理充值调 CMP 核验并原子入账/标记失败——用户关掉付款页也能补录。
// 密钥只存应用环境变量 OTT_RECONCILE_SECRET（与数据库参数 app.ott_reconcile_secret 一致）。
export const Route = createFileRoute("/api/public/hooks/reconcile-ott")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["OTT_RECONCILE_SECRET"];
        const got = request.headers.get("x-reconcile-secret");
        if (!expected || !got || got !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;
        const { verifyOttRecharge } = await import("@/lib/ottpay-reconcile.server");

        const { data: rows, error } = await supabaseAdmin
          .from("wallet_transactions")
          .select("id, type, status, channel, amount_cad, ref_no, provider_payment_id, note, verified_at")
          .eq("type", "recharge")
          .eq("status", "pending")
          .in("channel", ["wechat", "alipay", "card"])
          .gt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
          .lt("created_at", new Date(Date.now() - 45_000).toISOString())
          .order("created_at", { ascending: true })
          .limit(25);
        if (error) return json({ ok: false, error: error.message }, 500);

        // 90s 内已核验过的跳过，避免同一分钟内重复打 CMP
        const list = ((rows ?? []) as any[]).filter(
          (r) => !r.verified_at || Date.now() - new Date(r.verified_at).getTime() > 90_000,
        );

        const out = { checked: 0, settled: 0, failed: 0, pending: 0, mismatch: 0, refund: 0, error: 0 };

        for (const tx of list) {
          out.checked++;
          let v: Awaited<ReturnType<typeof verifyOttRecharge>>;
          try {
            v = await verifyOttRecharge(tx);
          } catch (e: any) {
            console.error("[reconcile-ott] verify failed", tx.id, e?.message);
            out.error++;
            continue;
          }
          if (v.decision === "error") {
            console.error("[reconcile-ott] CMP error", tx.id, v.error);
            out.error++;
            continue;
          }
          const apply = (op: "ott_settle" | "ott_mark_failed" | "ott_record") =>
            (supabaseAdmin as any).rpc("_wallet_recharge_settle_system", {
              _payload: {
                op,
                tx_id: tx.id,
                provider_payment_id: (v as any).providerPaymentId ?? null,
                provider_status: (v as any).providerStatus ?? null,
                provider_response: (v as any).providerResponse ?? null,
              },
            } as any);

          try {
            if (v.decision === "settle") {
              await apply("ott_settle");
              out.settled++;
            } else if (v.decision === "fail") {
              await apply("ott_mark_failed");
              out.failed++;
            } else if (v.decision === "refund") {
              await apply("ott_record");
              out.refund++;
            } else if (v.decision === "mismatch") {
              await apply("ott_record");
              out.mismatch++;
            } else {
              await apply("ott_record");
              out.pending++;
            }
          } catch (e: any) {
            console.error("[reconcile-ott] apply failed", tx.id, e?.message);
            out.error++;
          }
        }

        return json({ ok: true, ...out });
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
