export function computePallets(input: {
  L?: number | null;
  W?: number | null;
  H?: number | null;
  kg?: number | null;
  rule: Record<string, any>;
}): { pallets: number; reason?: string } {
  const L = Number(input.L) || 0,
    W = Number(input.W) || 0,
    H = Number(input.H) || 0,
    kg = Number(input.kg) || 0;
  const maxL = Number(input.rule.pallet_max_length_cm) || 0;
  const maxW = Number(input.rule.pallet_max_width_cm) || 0;
  const maxH = Number(input.rule.pallet_max_height_cm) || 0;
  const maxKg = Number(input.rule.pallet_max_weight_kg) || 0;
  const factor = Number(input.rule.pallet_overflow_factor) || 2;
  if (!maxL || !maxW || (!L && !W && !H && !kg)) return { pallets: 1, reason: "missing_dims" };
  if ((maxL && L > factor * maxL) || (maxW && W > factor * maxW)) {
    throw new Error(`超规格：长/宽不能超过标准板尺寸的 ${factor} 倍`);
  }
  const lf = L > 0 ? Math.ceil(L / maxL) : 1;
  const wf = W > 0 ? Math.ceil(W / maxW) : 1;
  const hf = maxH > 0 && H > 0 ? Math.ceil(H / maxH) : 1;
  const kgf = maxKg > 0 && kg > 0 ? Math.ceil(kg / maxKg) : 1;
  const footprint = lf * wf;
  return { pallets: Math.max(footprint * hf, kgf) };
}

export function measuredFreight(rule: any, input: {weight: number; length: number; width: number; height: number}, fx: number) {
  const values = [input.weight,input.length,input.width,input.height,fx];
  if(values.some(v => !Number.isFinite(v) || v < 0) || fx === 0) throw new Error("重量、尺寸或汇率无效");
  const divisor = Number(rule.volumetric_divisor) || 6000;
  const volumetric = input.length*input.width*input.height/divisor;
  const chargeable = rule.weight_mode === "actual" ? input.weight : rule.weight_mode === "volumetric" ? volumetric : Math.max(input.weight,volumetric);
  const unit = Number(rule.unit_price_cad ?? 0) || Number(rule.unit_price_cny ?? 0)*fx;
  if (!Number.isFinite(unit) || unit < 0) throw new Error("运费单价无效");
  const pallets = rule.pricing_mode === "pallet" ? computePallets({L:input.length,W:input.width,H:input.height,kg:input.weight,rule}).pallets : 0;
  const amount = rule.pricing_mode === "pallet" ? pallets*Number(rule.pallet_unit_price_cad ?? 0) : chargeable*unit;
  if (!Number.isFinite(amount) || amount < 0) throw new Error("运费金额无效");
  return { freight_cad: Math.round((amount+Number.EPSILON)*100)/100, chargeable_weight: Math.round(chargeable*1000)/1000, volumetric_weight: Math.round(volumetric*1000)/1000, actual_weight: input.weight, unit_price_cad: unit, pricing_mode: rule.pricing_mode ?? "weight", pallets, minimum_charge_cad: 0 };
}
