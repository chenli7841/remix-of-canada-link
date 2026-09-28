// Rendering uses saved invoice amounts. Metadata supplies weight/rate, never a new price calculation.
export function invoiceDisplay(inv: any, items: any[]) {
  const fx = Number(inv.fx_rate);
  const cad = (n: any) => +(Number(n ?? 0) * fx).toFixed(2);
  const numeric = (n: any): number | null => n == null || n === "" || !Number.isFinite(Number(n)) ? null : Number(n);
  const freight: any[] = [], other: any[] = [];
  let extraDetailTotal = 0;
  for (const [index, item] of items.entries()) {
    const m = item.meta ?? {};
    const f = cad(item.freight_cny), duty = cad(item.customs_cny), insurance = cad(item.insurance_cny), extra = cad(item.other_cny);
    if (m.freight || f !== 0) freight.push({
      id: item.id ?? `f${index}`, route: m.route_code ?? m.freight?.route_code ?? "—",
      weight: numeric(m.freight?.chargeable_weight_kg), rate: numeric(m.freight?.rate_cad_per_kg), amount: f,
    });
    const add = (label: string, amount: number) => { if (amount !== 0) other.push({id:`${index}-${label}`,label,description:item.description,meta:m,amount}); };
    add("关税及GST", duty);
    add("保险", insurance);
    add(m.fee_type ?? "其他费用", extra);
    extraDetailTotal += extra;
    if (f === 0 && duty === 0 && insurance === 0 && extra === 0) { add(m.fee_type ?? "其他费用", cad(item.amount_cny)); extraDetailTotal += cad(item.amount_cny); }
  }
  // Older invoices may only carry header categories. Show those instead of silently omitting them.
  for (const [field, label] of [["customs_cny","关税及GST"],["insurance_cny","保险"],["other_cny","其他费用"]]) {
    if (!items.some(it => Number(it[field] ?? 0) !== 0) && cad(inv[field]) !== 0 && !(field === "other_cny" && extraDetailTotal !== 0)) {
      other.push({id:field,label,description:"账单已保存金额",meta:{},amount:cad(inv[field])});
    }
  }
  if (!freight.length && cad(inv.freight_cny) !== 0) freight.push({id:"saved",route:"—",weight:null,rate:null,amount:cad(inv.freight_cny)});
  const freightTotal = cad(inv.freight_cny);
  const otherTotal = +((Number(inv.customs_cny ?? 0)+Number(inv.insurance_cny ?? 0)+Number(inv.other_cny ?? 0))*fx).toFixed(2);
  const total = cad(inv.total_cny);
  const mismatch = !Number.isFinite(fx) || fx <= 0 || Math.round((freightTotal+otherTotal)*100) !== Math.round(total*100)
    || Math.round(freight.reduce((s,r)=>s+r.amount,0)*100)!==Math.round(freightTotal*100)
    || Math.round(other.reduce((s,r)=>s+r.amount,0)*100)!==Math.round(otherTotal*100);
  const batchWeight = numeric(items.find(it => it.meta?.batch_chargeable_weight_kg != null)?.meta.batch_chargeable_weight_kg);
  return {freight,other,freightTotal,otherTotal,total,mismatch,batchWeight};
}
