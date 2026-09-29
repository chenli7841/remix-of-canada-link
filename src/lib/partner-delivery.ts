import {z} from 'zod';
import {draftSchema,ruleSchema} from './express';
export const partnerDeliverySchema=z.object({
 draft:draftSchema.omit({source:true,leg:true}).extend({packageType:z.literal('parcel')}),
 rule:ruleSchema,
});
export type PartnerDeliveryRequest=z.input<typeof partnerDeliverySchema>;
