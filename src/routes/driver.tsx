import {createFileRoute} from '@tanstack/react-router';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {useAuth} from '@/lib/auth';
import {supabase} from '@/integrations/supabase/client';
import {signInWithGoogle} from '@/lib/google-auth';
import {driverAccess,searchDriverDeliveries,actOnDriverDelivery,uploadDeliveryProof} from '@/lib/driver.functions';
import {DeliveryBatchPhotos} from '@/components/admin/DeliveryBatchPhotos';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {DriverWorkspace} from '@/components/DriverWorkspace';

export const Route=createFileRoute('/driver')({head:()=>({meta:[{title:'司机派送 — EPLUS'},{name:'robots',content:'noindex,nofollow'}]}),component:DriverPage});
const button='min-h-11 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-40';
const input='min-h-12 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-slate-100 placeholder:text-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30';
type Group=Awaited<ReturnType<typeof searchDriverDeliveries>>[number];
const money=(v:unknown)=>v==null?'待确认':`CA$${Number(v).toFixed(2)}`;

function DriverPage(){
  const {user,loading,signOut}=useAuth();
  const access=useServerFn(driverAccess),search=useServerFn(searchDriverDeliveries);
  const check=useQuery({queryKey:['driver-access',user?.id],queryFn:()=>access(),enabled:!!user,retry:false});
  const [identifier,setIdentifier]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
  const [rows,setRows]=useState<Group[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [searchVersion,setSearchVersion]=useState(0);
  const loginWithGoogle=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{await signInWithGoogle('/driver');}
    catch{setError('Google 登录未完成，请检查网络后重试');}
    finally{setBusy(false);}
  };
  const login=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{
    let email=identifier.trim();
    if(!email.includes('@')){const r=await supabase.rpc('resolve_login_email',{p_identifier:email});if(r.error||!r.data)throw new Error('账号或密码不正确');email=r.data;}
    const r=await supabase.auth.signInWithPassword({email,password});if(r.error)throw new Error('登录失败，请核对账号和密码');setPassword('');
  }catch(e:any){setError(e.message||'登录失败，请检查网络');}finally{setBusy(false);}};
  const find=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');setRows(null);try{
    if(!/^\d{1,5}$/.test(code.trim()))throw new Error('请输入1至5位客户号');
    const data=await search({data:{customerCode:code.trim()}});setRows(data);setSearchVersion(v=>v+1);
  }catch(e:any){setError(e.message||'查询失败');}finally{setBusy(false);}};
  return <main className="min-h-screen bg-[#0B1220] px-4 py-6 text-slate-100 [color-scheme:dark]"><div className="mx-auto max-w-2xl">
    <header className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold tracking-widest text-blue-400">EPLUS</p><h1 className="text-2xl font-bold">司机派送</h1></div>{user&&<button className="min-h-11 rounded-lg border border-white/10 px-3 text-sm hover:bg-white/5" onClick={()=>void signOut('/driver')}>退出登录</button>}</header>
    {loading||user&&check.isLoading?<p role="status">正在验证登录权限…</p>:!user?<form onSubmit={login} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-sm"><h2 className="text-lg font-semibold">司机登录</h2><p className="text-sm text-slate-400">与后台使用同一账号，登录后进入司机派送页面。账号需已分配“派送司机”角色。</p>
      <button type="button" onClick={()=>void loginWithGoogle()} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10 font-medium disabled:opacity-40">
        <span aria-hidden="true" className="text-xl font-bold text-blue-400">G</span>使用 Google 继续
      </button><p className="text-center text-sm text-slate-400">或使用邮箱 / 登录名 / 手机号登录</p><label className="block">账号<input required autoComplete="username" className={input} value={identifier} onChange={e=>setIdentifier(e.target.value)}/></label><label className="block">密码<input required type="password" autoComplete="current-password" className={input} value={password} onChange={e=>setPassword(e.target.value)}/></label><button className={button+' w-full'} disabled={busy}>{busy?'登录中…':'登录'}</button></form>:check.isError?<div role="alert" className="rounded-xl border border-white/10 bg-white/[0.03] p-5"><p>{check.error.message}</p><button className={button+' mt-4'} onClick={()=>void check.refetch()}>重新验证</button></div>:check.isSuccess?<>
      <DriverWorkspace key={user?.id}/>
    </>:null}
    {error&&<p role="alert" className="my-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">{error}</p>}
  </div></main>;
}

async function cameraImage(file:File):Promise<string>{
  if(!file.type.startsWith('image/')||file.size>25*1024*1024)throw new Error('请选择25MB以内的照片');
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,1800/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法处理照片');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.85);
  }catch{throw new Error('无法读取照片，请选择JPEG/PNG照片或重新拍摄');}finally{URL.revokeObjectURL(url);}
}
function DriverBatch({group}:{group:Group}){
  const [g,setG]=useState(group),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[dispatched,setDispatched]=useState(false);
  const [modal,setModal]=useState<'deduct'|'dispatch'|'note'|null>(null),[note,setNote]=useState(g.settlement_note),[photoVersion,setPhotoVersion]=useState(0);
  const act=useServerFn(actOnDriverDelivery),upload=useServerFn(uploadDeliveryProof),search=useServerFn(searchDriverDeliveries);
  const scope={batchId:g.batch_id!,customerCode:g.customer_code!};
  const perform=async()=>{if(!modal||busy)return;const action=modal;setBusy(action);setError('');setMessage('');try{
    const r=await act({data:{...scope,action,note,expectedCad:g.extra_fee_cad}});
    if(action==='dispatch'){setDispatched(true);setMessage('已确认派送，运单已完成，司机、时间和物流轨迹已记录。仍可补传照片。');}
    else{setG(prev=>action==='note'?{...prev,settlement_note:note.trim()}:{...prev,extra_fee_paid:true});setMessage(r.alreadyPaid?'已付款，未重复扣款':'保存成功');}
    setModal(null);
    if(action==='deduct'){try{const latest=await search({data:{customerCode:g.customer_code!}});const row=latest.find(v=>v.batch_id===g.batch_id);if(row)setG(row);}catch{setMessage('扣款已完成，请重新搜索更新余额');}}
  }catch(e:any){setError(e.message||'操作失败');}finally{setBusy('');}};
  const sendPhoto=async(file?:File)=>{if(!file||busy)return;setBusy('photo');setError('');setMessage('');try{const image=await cameraImage(file);await upload({data:{...scope,photoId:crypto.randomUUID(),image}});setPhotoVersion(v=>v+1);setMessage('照片上传成功，后台派送详情可查看');}catch(e:any){setError(e.message||'照片上传失败');}finally{setBusy('');}};
  return <article className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-sm">
    <div className="mb-4"><h2 className="text-lg font-bold">{g.customer_code} · {g.full_name||'客户'}</h2><p className="break-all font-medium">{g.batch_name}</p><p className="text-xs text-slate-400">{g.batch_no||'未关联批次'} · {dispatched?'已派送':'待派送'}</p></div>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
      <dt>批次运费合计</dt><dd className="text-right font-semibold">{money(g.total_cad)}</dd>
      <dt>运费付款状态</dt><dd className={'text-right font-semibold '+(g.payment_label==='已付款'?'text-emerald-400':'text-amber-300')}>{g.payment_label}</dd>
      <dt>额外费用</dt><dd className="text-right">¥{Number(g.extra_fee_cny).toFixed(2)} / {money(g.extra_fee_cad)}<span className="block text-xs">{g.extra_fee_paid?'已付款':'未扣款'}</span></dd>
      <dt>计费重量</dt><dd className="text-right">{g.chargeable_weight_kg==null?'待确认':`${Number(g.chargeable_weight_kg).toFixed(3)} kg`}</dd>
      <dt>派送单位</dt><dd className="text-right font-semibold">{g.count}<span className="block text-xs font-normal">运单 {g.waybill_count} · 客户箱 {g.carton_count} · 客户托盘 {g.pallet_count}</span></dd>
      <dt>客户余额</dt><dd className="text-right text-lg font-bold text-emerald-400">{money(g.wallet_balance_cad)}</dd>
    </dl>
    <p className="mt-4 break-words text-sm">{g.address||'未填写地址'}</p>{g.phone&&<a className="my-2 inline-block min-h-10 text-blue-400 underline" href={'tel:'+g.phone.replace(/[^+\d]/g,'')}>{g.phone}</a>}
    <button className="my-3 block w-full rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 text-left text-sm" disabled={!!busy||dispatched||!g.batch_id} onClick={()=>{setNote(g.settlement_note);setModal('note');}}>结算备注：<span className="whitespace-pre-wrap">{g.settlement_note||'点击填写（例如现金结算）'}</span></button>
    <div className="flex flex-wrap gap-3"><button className={button} disabled={!!busy||dispatched||g.extra_fee_paid||g.extra_fee_cad<=0||!g.batch_id} onClick={()=>setModal('deduct')}>{g.extra_fee_paid?'额外费用已付款':'扣取额外费用'}</button><button className={button+' bg-emerald-700'} disabled={!!busy||dispatched||!g.batch_id} onClick={()=>setModal('dispatch')}>{dispatched?'已确认派送':'确认派送'}</button></div>
    {g.batch_id&&<><div className="my-4 flex flex-wrap gap-3"><label className={button+' cursor-pointer bg-slate-700'}>拍照上传<input aria-label="拍照上传" className="sr-only" type="file" accept="image/*" capture="environment" disabled={!!busy} onChange={e=>{void sendPhoto(e.target.files?.[0]);e.target.value='';}}/></label><label className="cursor-pointer rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10">从相册选择<input aria-label="从相册选择" className="sr-only" type="file" accept="image/*" disabled={!!busy} onChange={e=>{void sendPhoto(e.target.files?.[0]);e.target.value='';}}/></label></div><DeliveryBatchPhotos {...scope} version={photoVersion}/></>}
    {busy&&<p role="status" className="my-3 animate-pulse text-blue-400">{busy==='photo'?'正在压缩并上传照片…':'正在保存，请勿重复操作…'}</p>}{message&&<p role="status" className="my-3 text-emerald-400">{message}</p>}{error&&<p role="alert" className="my-3 text-rose-300">{error}</p>}
    <Dialog open={!!modal} onOpenChange={open=>{if(!open&&!busy)setModal(null);}}><DialogContent className="border-white/10 bg-[#0B1220] text-slate-100 [color-scheme:dark]"><DialogTitle>{modal==='note'?'编辑结算备注':modal==='deduct'?'确认额外费用扣款':'确认派送'}</DialogTitle><DialogDescription className="text-slate-400">客户 {g.customer_code} · 批次 {g.batch_no}</DialogDescription>
      {modal==='note'?<textarea aria-label="结算备注" className={input} rows={4} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/>:modal==='deduct'?<p>从客户钱包扣取额外费用 {money(g.extra_fee_cad)}。批次运费不在此重复扣取。</p>:<p>确认此批次的 {g.count} 个派送单位派送完成？运单将标记已完成，记录你的账号、派送时间及晚 30 秒的已完成轨迹。{g.payment_label!=='已付款'?'此批次运费尚未付款，请先核实结算方式。':''}</p>}
      <button className={button} disabled={!!busy} onClick={()=>void perform()}>{busy?'处理中…':'确认'}</button><button disabled={!!busy} onClick={()=>setModal(null)}>取消</button>{error&&<p role="alert" className="text-rose-300">{error}</p>}
    </DialogContent></Dialog>
  </article>;
}
