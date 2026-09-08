export type VipLevel = "normal" | "silver" | "gold" | "diamond";

export const VIP_LEVELS: VipLevel[] = ["normal", "silver", "gold", "diamond"];

export const VIP_LABEL: Record<VipLevel, string> = {
  normal: "普通",
  silver: "银卡",
  gold: "金卡",
  diamond: "钻石 VIP",
};

export const VIP_COLOR: Record<VipLevel, string> = {
  normal: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  silver: "border-slate-300/40 bg-slate-300/10 text-slate-200",
  gold: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  diamond: "border-violet-400/40 bg-violet-400/15 text-violet-200",
};
