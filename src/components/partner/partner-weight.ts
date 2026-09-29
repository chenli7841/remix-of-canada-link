/** Partner quote rule: cm and kg, charged separately for each package. */
export function partnerPackageWeight(length:number,width:number,height:number,actual:number) {
 if (![length,width,height,actual].every(n=>Number.isFinite(n)&&n>0)) return null;
 const volumetric=length*width*height/6000;
 if (!Number.isFinite(volumetric)) return null;
 const chargeable=Math.max(10,Math.ceil(Math.max(volumetric,actual)*2)/2);
 return {actual,volumetric,chargeable};
}
export type VolumeFeeRule = {ratePerM3:number;kgPerM3:number;currency:'USD'|'CAD'};
export type DestinationFeeRule = {ratePerM3:number;currency:'USD'|'CAD'};
export type PartnerRoutePricing = {domestic?:VolumeFeeRule|null;sea?:VolumeFeeRule|null;destination?:DestinationFeeRule|null};
/** Domestic and sea rates are independent route settings. Missing settings are not zero. */
export function partnerVolumeFee(volumeM3:number,actualKg:number,rule?:VolumeFeeRule|null) {
 if (!rule || !['USD','CAD'].includes(rule.currency) || !Number.isFinite(rule.ratePerM3) || rule.ratePerM3<0 || !Number.isFinite(rule.kgPerM3) || rule.kgPerM3<=0) return null;
 if (![volumeM3,actualKg].every(n=>Number.isFinite(n)&&n>0)) return null;
 const weightM3=actualKg/rule.kgPerM3;
 const billableM3=Math.max(volumeM3,weightM3);
 const amount=Math.round(billableM3*rule.ratePerM3*100)/100;
 if (!Number.isFinite(amount)) return null;
 return {volumeM3,actualKg,weightM3,billableM3,amount,currency:rule.currency};
}

export function partnerDestinationFee(volumeM3:number,rule?:DestinationFeeRule|null){
 if(!rule||!Number.isFinite(volumeM3)||volumeM3<=0||!Number.isFinite(rule.ratePerM3)||rule.ratePerM3<0||!['USD','CAD'].includes(rule.currency))return null;
 const amount=Math.round(volumeM3*rule.ratePerM3*100)/100;
 return Number.isFinite(amount)?{volumeM3,ratePerM3:rule.ratePerM3,amount,currency:rule.currency}:null;
}
