import { z } from 'zod';
/** Partner route code replaces exactly four leading characters; the generated suffix stays intact. */
export const partnerRouteCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{4}$/, '同行线路编号必须为四位英文字母，例如 SEAT');
export function partnerWaybillNumber(regularNumber: string, routeCode: string): string {
 const code = partnerRouteCodeSchema.parse(routeCode);
 if (!/^[A-Za-z]{4}[A-Za-z0-9]+$/.test(regularNumber)) throw new Error('原始运单号格式无效，不能替换前缀');
 return code + regularNumber.slice(4);
}
