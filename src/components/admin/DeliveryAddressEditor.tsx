import {useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {AddressLocationPicker} from '@/components/AddressLocationPicker';
import {canadaLocations,provinceOptions,normalizeCanadaAddress} from '@/lib/canada-address';
import {saveDeliveryAddress} from '@/lib/delivery-queue.functions';

export function DeliveryAddressEditor({group,onClose,onSaved}:{group:any;onClose:()=>void;onSaved:()=>Promise<unknown>}) {
  const save=useServerFn(saveDeliveryAddress);
  const [draft,setDraft]=useState(()=>{
    const address=group.editable_address;
    const {country,province,city}=normalizeCanadaAddress(address);
    return {...address,country,province,city};
  });
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const ca=['CA','CANADA','加拿大'].includes(draft.country.trim().toUpperCase());
  const change=(key:string,value:string)=>setDraft((old:any)=>({...old,[key]:value}));
  const input='w-full rounded-md border border-border bg-background p-2 text-sm';
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogTitle>修改收货地址</DialogTitle><DialogDescription>客户 {group.customer_code}。保存后同步修改该客户的{draft.addressId?'收货地址':'注册地址'}，使用此地址的其他批次也会更新。</DialogDescription>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await save({data:draft});await onSaved();onClose();}catch(e:any){setError(e.message||'保存失败，请重试');}finally{setBusy(false);}}}>
      <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">国家<select className={input} value={draft.country} onChange={e=>setDraft((old:any)=>({...old,country:e.target.value,province:'',city:''}))}><option value="CA">加拿大</option><option value="US">美国</option>{!['CA','US'].includes(draft.country)&&<option value={draft.country}>{draft.country}</option>}</select></label>
      <div className="grid grid-cols-2 gap-3"><div className="text-sm">省份 / 州{ca?<AddressLocationPicker label="省份" value={draft.province} options={provinceOptions} onChange={province=>setDraft((old:any)=>({...old,province,city:''}))}/>:<input aria-label="省份 / 州" required className={input} value={draft.province} onChange={e=>change('province',e.target.value)}/>}</div>
      <div className="text-sm">城市{ca?<AddressLocationPicker label="城市" value={draft.city} disabled={!draft.province} options={(canadaLocations.find(p=>p.code===draft.province)?.cities||[]).map(city=>({value:city,label:city}))} onChange={city=>change('city',city)}/>:<input aria-label="城市" required className={input} value={draft.city} onChange={e=>change('city',e.target.value)}/>}</div></div>
      <label className="block text-sm">详细地址<input required maxLength={300} className={input} value={draft.line1} onChange={e=>change('line1',e.target.value)}/></label>
      {draft.addressId&&<label className="block text-sm">地址补充（可选）<input maxLength={300} className={input} value={draft.line2} onChange={e=>change('line2',e.target.value)}/></label>}
      <label className="block text-sm">邮编<input required maxLength={30} className={input} value={draft.postal_code} onChange={e=>change('postal_code',e.target.value)}/></label>
      </fieldset>
      {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-white disabled:opacity-50">{busy?'保存中…':'保存地址'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
