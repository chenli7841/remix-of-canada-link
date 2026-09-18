import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/lib/admin-shared";
import {
  saveBatchCustomerFeeDraft,
  setBatchPriceConfirmed,
  deductWalletForBatch,
  deductBatchOffline,
  refreshBatchCustomerSnapshot,
} from "@/lib/orders.functions";
import { X, Truck, Package, Layers, ChevronDown, ChevronRight, Wallet, Save, AlertTriangle } from "lucide-react";

type Props = {
  batchId: string;
  customerCode: string;
  customerData?: any;
  canEdit?: boolean;
  onClose: () => void;
};

const cad = (n: any) => `CA$${Number(n ?? 0).toFixed(2)}`;

export function CustomerDrawer({ batchId, customerCode, customerData, canEdit, onClose }: Props) {
  const qc = useQueryClient();
  const saveDraft = useServerFn(saveBatchCustomerFeeDraft);
  const setConfirmedFn = useServerFn(setBatchPriceConfirmed);
  const deduct = useServerFn(deductWalletForBatch);
  const deductOffline = useServerFn(deductBatchOffline);
  const refreshSnapshotFn = useServerFn(refreshBatchCustomerSnapshot);
  const [refreshingSnap, setRefreshingSnap] = useState(false);

  const c = customerData ?? {};
  const waybills = (c.waybills ?? []) as any[];
  const cartons = (c.cartons ?? []) as any[];
  const pallets = (c.pallets ?? []) as any[];
  const items = (c.items ?? []) as any[];
  const scheme: "merged" | "split" = c.fee_scheme ?? "split";

  // section sums
  const sumWb = useMemo(() => sumRows(waybills), [waybills]);
  const sumCt = useMemo(() => sumRows(cartons), [cartons]);
  const sumPl = useMemo(() => sumRows(pallets), [pallets]);

  const feeFreight = Number(c.fee_freight_cad ?? c.fee_freight_cny ?? 0);
  const feeCustoms = Number(c.fee_customs_cad ?? c.fee_customs_cny ?? 0);
  const feeInsurance = Number(c.fee_insurance_cad ?? c.fee_insurance_cny ?? 0);
  const feeClearance = Number(c.fee_clearance_cad ?? c.fee_clearance_cny ?? 0);
  const feeSurcharge = Number(c.fee_surcharge_cad ?? c.fee_surcharge_cny ?? 0);

  const deliverySuggested = Number(c.delivery_suggested_cad ?? 0);
  const warnings = (c.warnings ?? []) as { kind: string; ref: string; detail: string }[];

  const [inspection, setInspection] = useState(String(Number(c.fee_inspection_cad ?? 0)));
  const [delivery, setDelivery] = useState(
    String(Number(c.fee_delivery_cad ?? 0) || Number(c.delivery_suggested_cad ?? 0)),
  );
  const [discount, setDiscount] = useState(String(Number(c.fee_discount_cad ?? 0)));
  const [method, setMethod] = useState<"wallet" | "emt" | "cash">("wallet");
  const [refNo, setRefNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<boolean>(!!c.price_confirmed);

  useEffect(() => {
    setInspection(String(Number(c.fee_inspection_cad ?? 0)));
    setDelivery(String(Number(c.fee_delivery_cad ?? 0) || Number(c.delivery_suggested_cad ?? 0)));
    setDiscount(String(Number(c.fee_discount_cad ?? 0)));
    setConfirmed(!!c.price_confirmed);
  }, [c.fee_inspection_cad, c.fee_delivery_cad, c.delivery_suggested_cad, c.fee_discount_cad, c.price_confirmed]);

  const inspAmt = Math.max(0, Number(inspection || 0));
  const deliveryAmt = Math.max(0, Number(delivery || 0));
  const discAmt = Math.max(0, Number(discount || 0));
  const subtotal = +(
    feeFreight +
    feeCustoms +
    feeInsurance +
    feeClearance +
    feeSurcharge +
    deliveryAmt +
    inspAmt
  ).toFixed(2);
  const finalDeduct = Math.max(0, +(subtotal - discAmt).toFixed(2));

  const onSave = async () => {
    setBusy(true);
    try {
      await saveDraft({ data: { batchId, customerCode, deliveryCad: deliveryAmt, inspectionCad: inspAmt, discountCad: discAmt } });
      await qc.refetchQueries({ queryKey: ["admin-batch", batchId] });
      await qc.invalidateQueries({ queryKey: ["admin-batches"] });
      alert("费用已保存并重新计算；价格确认状态未改变");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  const onToggleConfirm = async () => {
    const next = !confirmed;
    if (next && warnings.length > 0 && !window.confirm("存在超长/超重/偏远预警，确认价格已核对无误？")) return;
    setBusy(true);
    try {
      // 只在"确认"方向（未确认→确认）先落草稿——saveDraft 会拒绝已确认客户的改动，
      // 取消确认（确认→未确认）此刻客户仍是已确认状态，调它必然报错、且从没必要：
      // 取消确认不改费用，只是解冻；要改费用请取消确认后单独走「保存」。
      if (next) {
        await saveDraft({ data: { batchId, customerCode, deliveryCad: deliveryAmt, inspectionCad: inspAmt, discountCad: discAmt } });
      }
      const r: any = await setConfirmedFn({ data: { batchId, customerCode, confirmed: next } });
      setConfirmed(next);
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
      await qc.invalidateQueries({ queryKey: ["admin-batches"] });
      if (next && r?.snapshot_ok === false) {
        alert(`价格已确认，但客户端快照刷新失败：${r.snapshot_error ?? "未知错误"}。\n客户可能暂时看到"数据准备中"，可点「刷新此客户快照」重试。`);
      }
      if (next && r?.invoice_ok === false) {
        alert(
          `价格已确认，但账单生成失败：${r.invoice_error ?? "未知错误"}。\n请检查该客户的运单 / 客户号绑定后，取消确认再重新确认。`,
        );
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  const onRefreshSnapshot = async () => {
    setRefreshingSnap(true);
    try {
      await refreshSnapshotFn({ data: { batchId, customerCode } });
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
      alert("已刷新该客户的快照");
    } catch (e: any) {
      alert(`刷新失败：${e.message}`);
    } finally {
      setRefreshingSnap(false);
    }
  };
  const onDeduct = async () => {
    if (!c.user_id) {
      alert("客户未绑定账号，无法扣款");
      return;
    }
    if (!(subtotal > 0)) {
      alert("金额需大于 0");
      return;
    }
    if (!confirmed) {
      alert("请先点击「确认价格」，确认后才能扣款并向客户显示金额");
      return;
    }
    const methodLabel = method === "wallet" ? "钱包扣款" : method === "emt" ? "EMT 收款" : "现金收款";
    if (
      !confirm(
        `确认${methodLabel} ${cad(finalDeduct)}（含派送费 ${cad(deliveryAmt)}，检查费 ${cad(inspAmt)}，折扣 ${cad(discAmt)}）？`,
      )
    )
      return;
    setBusy(true);
    try {
      // 扣款只在 confirmed===true 时才能到这一步（上面已 return 拦截），而 saveDraft 会拒绝
      // 已确认客户的改动——这里不需要也不能再 saveDraft，settleBatchForCustomer 走的是确认时
      // 冻结的账单金额，不是这里的实时草稿值。
      if (method === "wallet") {
        const r: any = await deduct({
          data: {
            batchId,
            userId: c.user_id,
            amountCad: subtotal,
            discountCad: discAmt,
            note: `批次扣款 · ${customerCode}`,
          },
        });
        if (r?.ok === false && r.reason === "already_paid") {
          alert("该客户在本批次已结清");
          return;
        }
      } else {
        const r: any = await deductOffline({
          data: {
            batchId,
            userId: c.user_id,
            method,
            discountCad: discAmt,
            refNo: refNo || undefined,
            note: `批次${methodLabel} · ${customerCode}`,
          },
        });
        if (r?.ok === false && r.reason === "already_paid") {
          alert("该客户在本批次已结清");
          return;
        }
      }
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
      await qc.invalidateQueries({ queryKey: ["admin-batches"] });
      onClose();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-5xl overflow-y-auto border-l border-white/10 bg-[#0A0F1A] p-5"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">
              客户号 <span className="font-mono text-brand">{customerCode}</span>
              {c.customer_name && <span className="ml-2 text-sm text-slate-400">· {c.customer_name}</span>}
              {c.route_code && (
                <span className="ml-2 inline-flex rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-mono text-brand align-middle">
                  线路 {c.route_code}
                </span>
              )}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 ${c.is_paid ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
              >
                {c.is_paid ? "已付款" : "未付款"}
              </span>
              <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-brand">
                费用方案：{scheme === "merged" ? "合并收费 (A)" : "不合并 (B)"}
              </span>
              <span className="text-slate-400">
                总重量 <span className="font-mono text-slate-200">{Number(c.weight_kg ?? 0).toFixed(2)} kg</span>
              </span>
              <span className="text-slate-400">
                体积 <span className="font-mono text-slate-200">{Number(c.volume_m3 ?? 0).toFixed(4)} m³</span>
              </span>
              <span className="text-slate-400">
                余额 <span className="font-mono text-emerald-300">{cad(c.balance_cad)}</span>
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* Left: three entity sections + customs items */}
          <div className="space-y-3">
            <Section
              icon={<Truck className="h-4 w-4" />}
              title="① 运单 · 直挂 / 非客户号箱内 / 非客户号托盘内"
              count={waybills.length}
              sumWeight={sumWb.w}
              sumVolume={sumWb.v}
              sumFee={sumWb.fee}
            >
              <WaybillTable rows={waybills} />
            </Section>
            <Section
              icon={<Package className="h-4 w-4" />}
              title="② 箱号 · 客户号箱 / 非客户号托盘内的客户号箱"
              count={cartons.length}
              sumWeight={sumCt.w}
              sumVolume={sumCt.v}
              sumFee={sumCt.fee}
            >
              <ContainerTable kind="carton" rows={cartons} />
            </Section>
            <Section
              icon={<Layers className="h-4 w-4" />}
              title="③ 托盘 · 直挂客户号托盘"
              count={pallets.length}
              sumWeight={sumPl.w}
              sumVolume={sumPl.v}
              sumFee={sumPl.fee}
            >
              <ContainerTable kind="pallet" rows={pallets} />
            </Section>

            {warnings.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                <div className="mb-1 inline-flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  该客户存在 {warnings.length} 条派送风险提示 · 请客服核对并修改合适的末端派送费
                </div>
                <ul className="ml-4 list-disc space-y-0.5">
                  {warnings.map((w, i) => (
                    <li key={i}>
                      <span className="rounded bg-white/10 px-1 py-0.5 font-mono text-[10px]">
                        {w.kind === "oversize" ? "超长" : w.kind === "overweight" ? "超重" : "偏远"}
                      </span>{" "}
                      <span className="font-mono">{w.ref}</span> · {w.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}


            <Card
              title={`关税明细 (${items.length}) · Σ 申报价值 ${cad(items.reduce((s, i) => s + Number(i.declared_value_cad || 0), 0))} · Σ 关税 ${cad(items.reduce((s, i) => s + Number(i.duty_cad || 0), 0))}`}
            >
              {(c.unmatched_hs_names?.length ?? 0) > 0 && (
                <div className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">
                  ⚠ 以下品名未匹配 HS 编码，关税按 0 计（去{" "}
                  <a href="/admin/hs-codes" target="_blank" rel="noreferrer" className="underline">
                    HS 编码库
                  </a>{" "}
                  添加或绑定别名）：
                  <div className="mt-1 font-mono text-[11px]">{(c.unmatched_hs_names ?? []).join("、")}</div>
                </div>
              )}
              {items.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-500">该客户在本批次无关税物品</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="py-1">品名</th>
                        <th>HS Code</th>
                        <th className="text-right">MFN</th>
                        <th className="text-right">GST</th>
                        <th className="text-right">反倾销</th>
                        <th className="text-right">合计税率</th>
                        <th className="text-right">单价</th>
                        <th className="text-right">数量</th>
                        <th className="text-right">箱数</th>
                        <th className="text-right">内件</th>
                        <th className="text-right">申报价值</th>
                        <th className="text-right">关税</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {items.map((it: any, i: number) => (
                        <tr key={i} className={!it.hs_code ? "bg-amber-500/5" : ""}>
                          <td className="py-1 text-slate-200">{it.name}</td>
                          <td className="font-mono text-slate-300">
                            {it.hs_code ?? (
                              <span className="inline-flex items-center gap-1 text-amber-300">
                                <AlertTriangle className="h-3 w-3" />缺
                              </span>
                            )}
                          </td>
                          <td className="text-right font-mono text-slate-400">
                            {(Number(it.mfn_rate) * 100).toFixed(2)}%
                          </td>
                          <td className="text-right font-mono text-slate-400">
                            {(Number(it.gst_rate) * 100).toFixed(2)}%
                          </td>
                          <td className="text-right font-mono text-slate-400">
                            {(Number(it.anti_dumping_rate) * 100).toFixed(2)}%
                          </td>
                          <td className="text-right font-mono text-slate-200">
                            {(Number(it.tax_rate) * 100).toFixed(2)}%
                          </td>
                          <td className="text-right font-mono">{cad(it.unit_price_cad)}</td>
                          <td className="text-right font-mono">{it.quantity}</td>
                          <td className="text-right font-mono text-slate-400">{it.cartons_qty}</td>
                          <td className="text-right font-mono text-slate-400">{it.items_per_carton}</td>
                          <td className="text-right font-mono text-slate-200">{cad(it.declared_value_cad)}</td>
                          <td className="text-right font-mono text-emerald-300">{cad(it.duty_cad)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Right: CAD fee panel + actions */}
          <div className="space-y-3">
            <Card title="费用明细 (CAD)">
              <FeeRow
                label={`运费${scheme === "merged" ? " · 合并计算" : " · 逐项汇总"}`}
                value={feeFreight}
                sub={
                  scheme === "merged"
                    ? `按线路 ${c.route_code ?? "—"} 汇总重量 ${Number(c.weight_kg ?? 0).toFixed(2)}kg · 体积 ${Number(c.volume_m3 ?? 0).toFixed(4)}m³ × 线路费率`
                    : `= Σ 运单运费 + Σ 客户号箱运费 + Σ 客户号托盘运费`
                }
              />
              <FeeRow
                label="保险"
                value={feeInsurance}
                sub={`公式：Σ 各运单申报保险额　·　来源 ${Number(c.insurance_source_count ?? 0)} 条`}
                details={
                  (c.insurance_details ?? []).length > 0 ? (
                    <SourceTable
                      columns={["运单号", "金额 CA$"]}
                      rows={(c.insurance_details as any[]).map((d) => [d.ref, cad(d.amount_cad)])}
                      total={cad(feeInsurance)}
                    />
                  ) : (
                    <EmptyHint text="无保险来源" />
                  )
                }
              />
              <FeeRow
                label="关税"
                value={feeCustoms}
                sub={
                  items.length > 0
                    ? `公式：Σ (单价 × 数量) × (MFN + GST + 反倾销)　·　${items.length} 项物品`
                    : `无物品明细　关税 = 0`
                }
                details={
                  items.length > 0 ? (
                    <SourceTable
                      columns={["品名", "HS", "税率", "申报价值", "关税"]}
                      rows={items.map((it: any) => [
                        it.name,
                        it.hs_code ?? "—",
                        `${(Number(it.tax_rate) * 100).toFixed(2)}%`,
                        cad(it.declared_value_cad),
                        cad(it.duty_cad),
                      ])}
                      total={cad(feeCustoms)}
                    />
                  ) : (
                    <EmptyHint text="该客户在本批次无关税物品明细" />
                  )
                }
              />
              <FeeRow
                label="清关费"
                value={feeClearance}
                sub={
                  (c.clearance_note ?? []).length > 0
                    ? `公式：Σ 各线路清关费（批次一次性 / 逐单累计）`
                    : `本线路未启用独立清关费`
                }
                details={
                  (c.clearance_note ?? []).length > 0 ? (
                    <SourceTable
                      columns={["线路", "计费方式", "单价 CA$", "次数", "小计 CA$"]}
                      rows={(c.clearance_note as any[]).map((x: any) => [
                        x.route_code,
                        x.level === "batch" ? "批次一次性" : "逐单",
                        cad(x.fee),
                        String(x.count ?? 1),
                        cad(Number(x.fee) * (x.level === "batch" ? 1 : Number(x.count ?? 1))),
                      ])}
                      total={cad(feeClearance)}
                    />
                  ) : null
                }
              />
              <FeeRow
                label="附加费"
                value={feeSurcharge}
                sub={`公式：Σ 运单/箱/托盘/批次附加费　·　来源 ${Number(c.surcharge_source_count ?? 0)} 条`}
                details={
                  (c.surcharge_details ?? []).length > 0 ? (
                    <SourceTable
                      columns={["范围", "对象", "金额 CA$"]}
                      rows={(c.surcharge_details as any[]).map((d) => [
                        d.scope === "waybill"
                          ? "运单"
                          : d.scope === "carton"
                            ? "箱号"
                            : d.scope === "pallet"
                              ? "托盘"
                              : "批次",
                        d.ref,
                        cad(d.amount_cad),
                      ])}
                      total={cad(feeSurcharge)}
                    />
                  ) : (
                    <EmptyHint text="无附加费" />
                  )
                }
              />

              {confirmed && (
                <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-200">
                  价格已确认，账单已冻结。要改运费/派送费/折扣，请先在下方「取消确认」。
                </div>
              )}
              <div className="mt-2 border-t border-white/5 pt-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">
                  末端派送费 (CAD) · 可输入
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={delivery}
                  disabled={!canEdit || confirmed}
                  onChange={(e) => setDelivery(e.target.value)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                  <span>
                    建议 <span className="font-mono text-slate-300">{cad(deliverySuggested)}</span>
                    {c.delivery_note ? ` · ${c.delivery_note}` : " · 未匹配派送费规则（可在线路设置中配置）"}
                  </span>
                  {canEdit && !confirmed && deliverySuggested > 0 && (
                    <button
                      type="button"
                      onClick={() => setDelivery(String(deliverySuggested))}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10"
                    >
                      采用
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 border-t border-white/5 pt-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">
                  检查费 (CAD) · 可输入
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={inspection}
                  disabled={!canEdit || confirmed}
                  onChange={(e) => setInspection(e.target.value)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div className="mt-2 flex justify-between border-t border-white/5 pt-2">
                <span className="text-xs text-slate-300">小计</span>
                <span className="font-mono text-sm text-slate-100">{cad(subtotal)}</span>
              </div>
              <div className="mt-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">折扣 (CAD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={subtotal}
                  value={discount}
                  disabled={!canEdit || confirmed}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div className="mt-2 flex justify-between border-t border-white/5 pt-2">
                <span className="text-xs font-semibold text-slate-200">实际扣款</span>
                <span className="font-mono text-lg font-bold text-emerald-300">{cad(finalDeduct)}</span>
              </div>
              <div className="mt-2 border-t border-white/5 pt-2">
                <label className="block text-[10px] uppercase tracking-wider text-slate-500">收款方式</label>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(["wallet", "emt", "cash"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setMethod(m)}
                      className={`rounded-md border px-2 py-1.5 text-xs font-semibold ${method === m ? "border-brand bg-brand/10 text-brand" : "border-white/10 bg-white/5 text-slate-300"}`}
                    >
                      {m === "wallet" ? "钱包" : m === "emt" ? "EMT" : "现金"}
                    </button>
                  ))}
                </div>
                {method !== "wallet" && (
                  <input
                    value={refNo}
                    disabled={!canEdit}
                    onChange={(e) => setRefNo(e.target.value)}
                    placeholder="凭证号 / 参考号（可选）"
                    className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                )}
                <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                  {method === "wallet"
                    ? "生成账单并结清 · 记录钱包流水 · 调整钱包余额 · 该客户批次未付运单标记为已付款。"
                    : "生成账单并结清 · 记录一条流水（不影响钱包余额）· 该客户批次未付运单标记为已付款。"}
                </p>
              </div>
            </Card>

            <div
              className={`rounded-xl border p-3 text-xs ${confirmed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}
            >
              <div className="font-semibold">{confirmed ? "价格已确认 · 客户端可见并可付款" : "价格未确认 · 客户端不显示金额、不可付款"}</div>
              {canEdit && (
                <button
                  onClick={onToggleConfirm}
                  disabled={busy}
                  className={`mt-2 w-full rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50 ${confirmed ? "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
                >
                  {confirmed ? "取消确认" : "确认价格并对客户显示"}
                </button>
              )}
              {canEdit && confirmed && (
                <button
                  onClick={onRefreshSnapshot}
                  disabled={refreshingSnap}
                  title="客户端「我的批次」只读这份快照；后台改了费用但客户金额没变时，点这个手动重算"
                  className="mt-1.5 w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {refreshingSnap ? "刷新中…" : "刷新此客户快照"}
                </button>
              )}
            </div>

            {canEdit && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onSave}
                  disabled={busy || confirmed}
                  title={confirmed ? "价格已确认，账单冻结；请先取消确认" : undefined}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  保存
                </button>
                <button
                  onClick={onDeduct}
                  disabled={busy || !c.user_id}
                  className="inline-flex items-center justify-center gap-1 rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  扣款
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function sumRows(rows: any[]) {
  return rows.reduce(
    (s, r) => ({
      w: s.w + Number(r.weight_kg || 0),
      v: s.v + Number(r.volume_m3 || 0),
      fee: s.fee + Number(r.fee_cad || 0),
    }),
    { w: 0, v: 0, fee: 0 },
  );
}

function Section({
  icon,
  title,
  count,
  sumWeight,
  sumVolume,
  sumFee,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  sumWeight: number;
  sumVolume: number;
  sumFee: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        )}
        <span className="text-brand">{icon}</span>
        <span className="flex-1 text-sm text-slate-200">{title}</span>
        <span className="text-[10px] text-slate-400">
          共 <span className="font-mono text-slate-100">{count}</span>
        </span>
        <span className="text-[10px] text-slate-400">
          Σ体积 <span className="font-mono text-slate-100">{sumVolume.toFixed(4)}</span>
        </span>
        <span className="text-[10px] text-slate-400">
          Σ重量 <span className="font-mono text-slate-100">{sumWeight.toFixed(2)}</span>
        </span>
        <span className="text-[10px] text-slate-400">
          Σ费用 <span className="font-mono text-emerald-300">{cad(sumFee)}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-white/5 p-3">
          {count === 0 ? <div className="py-2 text-center text-xs text-slate-500">无</div> : children}
        </div>
      )}
    </div>
  );
}

function WaybillTable({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[10px] uppercase text-slate-500">
        <tr>
          <th className="py-1">运单号</th>
          <th>来源</th>
          <th>状态</th>
          <th>付款</th>
          <th className="text-right">体积 (m³)</th>
          <th className="text-right">重量 (kg)</th>
          <th className="text-right">费用 CA$</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {rows.map((w: any) => (
          <tr key={w.id}>
            <td className="py-1 font-mono">
              <Link to="/admin/waybills/$waybillId" params={{ waybillId: w.id }} className="text-brand hover:underline">
                {w.waybill_no}
              </Link>
            </td>
            <td className="text-[10px] text-slate-500">
              {w.source === "direct" ? "直挂" : w.source === "carton" ? "箱内" : "托盘"}
            </td>
            <td className="text-slate-300">{w.status}</td>
            <td className="text-slate-300">{w.payment_status}</td>
            <td className="text-right font-mono text-slate-400">{Number(w.volume_m3).toFixed(4)}</td>
            <td className="text-right font-mono text-slate-400">{Number(w.weight_kg).toFixed(2)}</td>
            <td className="text-right font-mono text-emerald-300">{cad(w.fee_cad)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContainerTable({ kind, rows }: { kind: "carton" | "pallet"; rows: any[] }) {
  const link = kind === "carton" ? "/admin/cartons/$cartonId" : "/admin/pallets/$palletId";
  const paramKey = kind === "carton" ? "cartonId" : "palletId";
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[10px] uppercase text-slate-500">
        <tr>
          <th className="py-1">{kind === "carton" ? "箱号" : "托盘号"}</th>
          <th className="text-center">方案</th>
          <th className="text-right">体积 (m³)</th>
          <th className="text-right">重量 (kg)</th>
          <th className="text-right">方案 A</th>
          <th className="text-right">方案 B</th>
          <th className="text-right">采用</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {rows.map((r: any) => (
          <tr key={r.id}>
            <td className="py-1 font-mono">
              <Link to={link as any} params={{ [paramKey]: r.id } as any} className="text-brand hover:underline">
                {kind === "carton" ? r.carton_no : r.pallet_no}
              </Link>
            </td>
            <td className="text-center">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${r.scheme === "A" ? "border-brand/30 bg-brand/10 text-brand" : "border-slate-500/30 bg-slate-500/10 text-slate-300"}`}
              >
                {r.scheme}
              </span>
            </td>
            <td className="text-right font-mono text-slate-400">{Number(r.volume_m3).toFixed(4)}</td>
            <td className="text-right font-mono text-slate-400">{Number(r.weight_kg).toFixed(2)}</td>
            <td
              className={`text-right font-mono ${r.scheme === "A" ? "text-emerald-300" : "text-slate-500 line-through"}`}
            >
              {cad(r.a_cad)}
            </td>
            <td
              className={`text-right font-mono ${r.scheme === "B" ? "text-emerald-300" : "text-slate-500 line-through"}`}
            >
              {cad(r.b_cad)}
            </td>
            <td className="text-right font-mono font-semibold text-emerald-300">{cad(r.fee_cad)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FeeRow({
  label,
  value,
  sub,
  details,
}: {
  label: string;
  value: number;
  sub?: string;
  details?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = details != null;
  return (
    <div className="border-b border-white/5 py-1 last:border-b-0">
      <div className="flex items-center justify-between text-slate-200">
        <button
          type="button"
          disabled={!hasDetails}
          onClick={() => setOpen(!open)}
          className={`flex flex-1 items-center gap-1 text-left text-xs ${hasDetails ? "hover:text-brand" : "cursor-default"}`}
        >
          {hasDetails &&
            (open ? (
              <ChevronDown className="h-3 w-3 text-slate-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-slate-400" />
            ))}
          <span>{label}</span>
        </button>
        <span className="text-xs font-mono">{cad(value)}</span>
      </div>
      {sub && <div className="mt-0.5 pl-4 text-[10px] leading-snug text-slate-500">{sub}</div>}
      {open && hasDetails && <div className="mt-1 pl-4">{details}</div>}
    </div>
  );
}

function SourceTable({ columns, rows, total }: { columns: string[]; rows: (string | number)[][]; total?: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-white/5 bg-black/20">
      <table className="w-full text-[11px]">
        <thead className="text-left text-[9px] uppercase text-slate-500">
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={`px-2 py-1 ${i === columns.length - 1 ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-2 py-1 ${j === r.length - 1 ? "text-right font-mono text-emerald-300" : "font-mono text-slate-300"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {total != null && (
            <tr className="bg-white/[0.03]">
              <td colSpan={columns.length - 1} className="px-2 py-1 text-right text-[10px] text-slate-400">
                合计
              </td>
              <td className="px-2 py-1 text-right font-mono text-sm font-semibold text-emerald-300">{total}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-white/10 py-2 text-center text-[10px] text-slate-500">
      {text}
    </div>
  );
}
