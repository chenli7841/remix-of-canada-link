// ship / owner 是 ship API 对接新增的两个独立分级选项（supabase/migrations/
// 20260911120000_vip_level_ship_owner.sql）——纯粹的枚举值增加，不附加任何新的业务分支。
// ship：ship 合作方客户首单建档成功时由服务端自动设置，并被 shipping_routes 现有的
//   visible_vip_levels / blacklist_vip_levels 机制用来做线路可见性判断（有意复用，
//   不是新建一套线路授权配置——见 docs/ship-api/system-change-guide-v3.md 第 4 节）。
// owner：纯选项，不驱动任何现有逻辑。
export type VipLevel = "normal" | "silver" | "gold" | "diamond" | "ship" | "owner";

export const VIP_LEVELS: VipLevel[] = ["normal", "silver", "gold", "diamond", "ship", "owner"];

export const VIP_LABEL: Record<VipLevel, string> = {
  normal: "普通",
  silver: "银卡",
  gold: "金卡",
  diamond: "钻石 VIP",
  ship: "ship客户",
  owner: "owner",
};

export const VIP_COLOR: Record<VipLevel, string> = {
  normal: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  silver: "border-slate-300/40 bg-slate-300/10 text-slate-200",
  gold: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  diamond: "border-violet-400/40 bg-violet-400/15 text-violet-200",
  ship: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  owner: "border-rose-400/40 bg-rose-400/10 text-rose-300",
};
