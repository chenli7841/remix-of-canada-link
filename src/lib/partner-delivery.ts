import {z} from 'zod';
import {draftSchema,ruleSchema,quoteRecipientSchema} from './express';
export const partnerDeliverySchema=z.object({
 draft:draftSchema.omit({source:true,leg:true}).extend({to:quoteRecipientSchema,packageType:z.literal('parcel')}),
 rule:ruleSchema,
});
export type PartnerDeliveryRequest=z.input<typeof partnerDeliverySchema>;
