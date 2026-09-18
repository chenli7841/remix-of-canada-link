import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getShopCart, adjustShopCart } from "@/lib/shop.functions";
import { Page, fmtDate, fmtCNY } from "@/lib/admin-shared";
import { Loader2, ArrowLeft, Save, Trash2, Pencil, X } from "lucide-react";

export const Route = createFileRoute("/admin/shop/carts/$cartId")({ component: CartDetail });

function CartDetail() {
  const { cartId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchOne = useServerFn(getShopCart);
  const adjust = useServerFn(adjustShopCart);

  const q = useQuery({ queryKey: ["shop-cart", cartId], queryFn: () => fetchOne({ data: { id: cartId } }) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [priceEditor, setPriceEditor] = useState<string | null>(null); // item id or "__total__"
  const [pv, setPv] = useState(""); // price value
  const [pr, setPr] = useState(""); // reason

  const run = async (payload: any) => {
    setBusy(true);
    setMsg(null);
    try {
      await adjust({ data: { cart_id: cartId, ...payload } });
      await qc.invalidateQueries({ queryKey: ["shop-cart", cartId] });
      setPriceEditor(null);
      setPv("");
      setPr("");
    } catch (e: any) {
      setMsg("✗ " + e.message);
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;

  const { cart, items, user, logs } = q.data as any;
  const editable = cart.status === "active";

  const openPriceEditor = (id: string, current: number | null) => {
    setPriceEditor(id);
    setPv(current != null ? String(current) : "");
    setPr("");
  };

  return (
    <Page
      title="购物车详情"
      subtitle={`${user?.full_name ?? user?.email ?? "—"} · ${user?.customer_code ?? ""} · ${
        cart.status === "active" ? "进行中" : cart.status === "ordered" ? "已下单" : "已放弃"
      }`}
      action={
        <button
          onClick={() => navigate({ to: "/admin/shop/carts" })}
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
        >
          <ArrowLeft className="h-3 w-3" /> 返回列表
        </button>
      }
    >
      {msg && <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">{msg}</div>}
      {!editable && (
        <div className="mb-4 rounded-md border border-white/10 bg-white/5 p-2 text-xs text-slate-300">
          该购物车状态为「{cart.status}」，不可再调整。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* lines */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">商品 / 规格</th>
                  <th className="px-3 py-2.5">数量</th>
                  <th className="px-3 py-2.5">单价（基础）</th>
                  <th className="px-3 py-2.5">成交小计</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((it: any) => {
                  const overridden = it.override_unit_price_cny != null;
                  const effUnit = overridden ? it.override_unit_price_cny : it.unit_price_cny;
                  const effSub = overridden ? it.override_unit_price_cny * it.quantity : it.line_subtotal_cny;
                  return (
                    <tr key={it.id} className="align-top">
                      <td className="px-3 py-2.5 text-xs">
                        <div className="font-mono">{it.product_slug}</div>
                        <div className="text-slate-500">{it.variant_id ? `variant ${String(it.variant_id).slice(0, 8)}` : "无规格"} · {it.mode}</div>
                        {overridden && (
                          <div className="mt-0.5 text-[10px] text-amber-300">
                            人工价 {fmtCNY(it.override_unit_price_cny)} · {it.override_reason ?? ""}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {editable ? (
                          <QtyEdit
                            value={it.quantity}
                            onSave={(qv, reason) => run({ op: "set_line_qty", item_id: it.id, quantity: qv, reason })}
                            busy={busy}
                          />
                        ) : (
                          it.quantity
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <div className={overridden ? "text-slate-500 line-through" : ""}>{fmtCNY(it.unit_price_cny)}</div>
                        {overridden && <div className="text-amber-300">{fmtCNY(effUnit)}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold">{fmtCNY(effSub)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {editable && (
                          <div className="flex flex-col items-end gap-1">
                            <button
                              onClick={() => openPriceEditor(it.id, it.override_unit_price_cny)}
                              className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                            >
                              <Pencil className="h-3 w-3" /> 改价
                            </button>
                            {overridden && (
                              <button
                                onClick={() => {
                                  const reason = window.prompt("清除改价的原因？");
                                  if (reason) run({ op: "clear_line_price", item_id: it.id, reason });
                                }}
                                className="text-[11px] text-slate-400 hover:underline"
                              >
                                清除改价
                              </button>
                            )}
                            <button
                              onClick={() => {
                                const reason = window.prompt("删除该行的原因？");
                                if (reason) run({ op: "remove_line", item_id: it.id, reason });
                              }}
                              className="inline-flex items-center gap-1 text-[11px] text-rose-300 hover:underline"
                            >
                              <Trash2 className="h-3 w-3" /> 删除
                            </button>
                          </div>
                        )}
                        {priceEditor === it.id && (
                          <PricePanel
                            value={pv}
                            reason={pr}
                            setValue={setPv}
                            setReason={setPr}
                            busy={busy}
                            onCancel={() => setPriceEditor(null)}
                            onConfirm={() =>
                              run({
                                op: "set_line_price",
                                item_id: it.id,
                                override_unit_price_cny: Number(pv),
                                reason: pr,
                              })
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      购物车为空
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* audit log */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">操作记录</div>
            {logs.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">暂无</div>
            ) : (
              <ul className="space-y-1.5 text-[11px]">
                {logs.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-baseline gap-x-2 text-slate-400">
                    <span className="text-slate-500">{fmtDate(l.created_at)}</span>
                    <span className="font-mono text-slate-300">{l.action}</span>
                    <span>{l.operator_name ?? l.operator_id?.slice(0, 8)}</span>
                    {l.note && <span className="text-amber-300">「{l.note}」</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* right: totals + overrides + meta */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-sm">
            <Row label="商品小计（基础）" value={fmtCNY(cart.subtotal_cny)} />
            <Row label="商品小计（成交）" value={fmtCNY(cart.effective_subtotal_cny)} />
            <Row label="运费" value={fmtCNY(cart.freight_cny)} />
            <Row label="关税" value={fmtCNY(cart.customs_cny)} />
            <Row label="保险" value={fmtCNY(cart.insurance_cny)} />
            <Row label="优惠" value={`-${fmtCNY(cart.discount_cny)}`} />
            <div className="my-2 h-px bg-white/10" />
            <Row label="成交合计" value={fmtCNY(cart.effective_total_cny)} strong />
            {cart.override_total_cny != null && (
              <div className="mt-1 text-[11px] text-amber-300">
                整车人工总价 {fmtCNY(cart.override_total_cny)} · {cart.override_reason ?? ""}
              </div>
            )}
          </div>

          {editable && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-2 text-xs font-semibold text-slate-300">整车总收费改价</div>
              {priceEditor === "__total__" ? (
                <PricePanel
                  value={pv}
                  reason={pr}
                  setValue={setPv}
                  setReason={setPr}
                  busy={busy}
                  onCancel={() => setPriceEditor(null)}
                  onConfirm={() =>
                    run({ op: "set_total_override", override_total_cny: Number(pv), reason: pr })
                  }
                />
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => openPriceEditor("__total__", cart.override_total_cny)}
                    className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
                  >
                    设置总价
                  </button>
                  {cart.override_total_cny != null && (
                    <button
                      onClick={() => {
                        const reason = window.prompt("清除整车总价的原因？");
                        if (reason) run({ op: "clear_total_override", reason });
                      }}
                      className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                    >
                      清除
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {editable && (
            <MetaEditor
              cart={cart}
              busy={busy}
              onSave={(patch) => run({ op: "set_meta", ...patch })}
            />
          )}
        </aside>
      </div>
    </Page>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${strong ? "font-bold text-white" : "text-slate-300"}`}>
      <span className="text-slate-400">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function QtyEdit({ value, onSave, busy }: { value: number; onSave: (v: number, reason: string) => void; busy: boolean }) {
  const [v, setV] = useState(String(value));
  const dirty = Number(v) !== value && Number(v) > 0;
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs"
      />
      {dirty && (
        <button
          disabled={busy}
          onClick={() => {
            const reason = window.prompt("改数量的原因？");
            if (reason) onSave(Number(v), reason);
          }}
          className="rounded bg-brand/20 px-1.5 py-1 text-[10px] font-semibold text-brand hover:bg-brand/30 disabled:opacity-50"
        >
          保存
        </button>
      )}
    </div>
  );
}

function PricePanel({
  value,
  reason,
  setValue,
  setReason,
  busy,
  onCancel,
  onConfirm,
}: {
  value: string;
  reason: string;
  setValue: (v: string) => void;
  setReason: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const valid = value !== "" && Number(value) >= 0 && reason.trim().length > 0;
  return (
    <div className="mt-2 w-56 rounded-lg border border-brand/30 bg-[#0E1626] p-2 text-left">
      <label className="text-[10px] uppercase tracking-wider text-slate-400">金额 CNY</label>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mb-1.5 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
      />
      <label className="text-[10px] uppercase tracking-wider text-slate-400">原因（必填）</label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mb-2 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"
      />
      <div className="flex gap-1.5">
        <button
          disabled={!valid || busy}
          onClick={onConfirm}
          className="flex-1 rounded bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand/90 disabled:opacity-40"
        >
          确认
        </button>
        <button onClick={onCancel} className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function MetaEditor({
  cart,
  busy,
  onSave,
}: {
  cart: any;
  busy: boolean;
  onSave: (patch: any) => void;
}) {
  const [route, setRoute] = useState(cart.route_code ?? "");
  const [coupon, setCoupon] = useState(cart.coupon_code ?? "");
  const [note, setNote] = useState(cart.note ?? "");
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      <div className="mb-2 text-xs font-semibold text-slate-300">线路 / 优惠码 / 备注</div>
      <div className="space-y-2 text-xs">
        <input
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          placeholder="线路代码"
          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1"
        />
        <input
          value={coupon}
          onChange={(e) => setCoupon(e.target.value)}
          placeholder="优惠码"
          className="w-full rounded border border-white/10 bg-white/5 px-2 py-1"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注"
          rows={2}
          className="w-full resize-none rounded border border-white/10 bg-white/5 px-2 py-1"
        />
        <button
          disabled={busy}
          onClick={() => onSave({ route_code: route, coupon_code: coupon, note })}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
        >
          <Save className="h-3 w-3" /> 保存
        </button>
      </div>
    </div>
  );
}
