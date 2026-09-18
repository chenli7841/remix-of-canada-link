// editToken / customerEditToken：不透明并发令牌，直接由现有 updated_at 时间戳聚合出
// 稳定哈希，不需要新增数据库字段。订单令牌和客户资料令牌分开算，不能混用——改了收件地址
// 不该让客户资料令牌跟着变，反过来也一样（system-change-guide-v3.md 第 6 节）。
import { sha256Hex } from "./auth.server";

export function computeOrderEditToken(
  forwarding: { updated_at: string },
  waybills: { id: string; updated_at: string }[],
): string {
  const parts = [
    forwarding.updated_at,
    ...waybills
      .map((w) => `${w.id}:${w.updated_at}`)
      .sort(), // 排序后再拼，箱子顺序不影响令牌本身
  ];
  return sha256Hex(parts.join("|"));
}

export function computeCustomerEditToken(profile: { id: string; updated_at: string }): string {
  return sha256Hex(`${profile.id}:${profile.updated_at}`);
}
