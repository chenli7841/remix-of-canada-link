export type PartnerHsRates={mfn_rate?:number|null;gst_rate?:number|null;anti_dumping_rate?:number|null};
export function partnerDuty(value:number,hs?:PartnerHsRates|null){
 const rates=[hs?.mfn_rate,hs?.gst_rate,hs?.anti_dumping_rate];
 if(!hs||!Number.isFinite(value)||value<=0||!rates.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))return null;
 const rate=rates.reduce<number>((s,r)=>s+r!,0);
 const amount=Math.round(value*rate*100)/100;
 return Number.isFinite(amount)?{rate,amount}:null;
}
