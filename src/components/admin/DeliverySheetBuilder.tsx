import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {deliveryMapsReady,planDeliveryRoute,listDriverOrigins} from '@/lib/delivery-route.functions';
import {deliveryStops,splitDeliveryStops,deliverySheetHtml,googlePlace,stopLabel,type DeliverySheetRow,type DeliveryStop} from '@/lib/delivery-sheet';

export function DeliverySheetBuilder({rows,onClose}:{rows:DeliverySheetRow[];onClose:()=>void}) {
  const [stops,setStops] = useState(()=>deliveryStops(rows));
  const [originId,setOriginId] = useState(''), [roundTrip,setRoundTrip] = useState(false);
  const [plans,setPlans] = useState<{stops:DeliveryStop[];map:string|null;optimized:boolean;warning:string}[]>([]);
  const [planMode,setPlanMode] = useState<boolean|null>(null),[progress,setProgress]=useState('');
  const [busy,setBusy] = useState(false),[error,setError] = useState('');
  const ready = useServerFn(deliveryMapsReady), plan = useServerFn(planDeliveryRoute);
  const config = useQuery({queryKey:['delivery-maps-ready'],queryFn:()=>ready()});
  const readOrigins=useServerFn(listDriverOrigins);
  const origins=useQuery({queryKey:['driver-origins'],queryFn:()=>readOrigins()});
  const origin=origins.data?.find(p=>p.id===originId&&p.active)?.address || '';
  useEffect(()=>{setPlans([]);setPlanMode(null);},[origin]);
  const reset = ()=>{setPlans([]);setPlanMode(null);setError('');};
  const chunks=splitDeliveryStops(stops);
  const sheets=chunks.map((chunk,i)=>plans[i]?.stops || chunk);
  const move = (index:number,delta:number)=>{const next=[...stops];[next[index],next[index+delta]]=[next[index+delta],next[index]];setStops(next);reset();};
  const generate = async (optimize:boolean)=>{
    if(busy)return;setBusy(true);setError('');
    const completed = planMode===optimize ? [...plans] : [];
    setPlans(completed);setPlanMode(optimize);
    try {
      for(let i=completed.length;i<chunks.length;i++) {
        setProgress(`正在生成第 ${i+1} / ${chunks.length} 张路线与地图…`);
        const departure=i?completed[i-1].stops.at(-1)!.address:origin;
        const result=await plan({data:{origin:departure,roundTrip:roundTrip&&i===chunks.length-1,returnAddress:origin,optimize,keepFirst:i>0,addresses:chunks[i].map(s=>s.address)}});
        completed.push({stops:result.order.map(index=>chunks[i][index]),map:result.map,optimized:result.optimized,warning:result.warning});
        setPlans([...completed]);
      }
      setError(completed.map(p=>p.warning).filter(Boolean).join('；'));
    }catch(e:any){setError(e.message || '生成路线失败');}finally{setBusy(false);setProgress('');void config.refetch();}
  };
  const openPrint = (index:number)=>{
    try {
      const departure=index?sheets[index-1].at(-1)!.address:origin;
      const html = deliverySheetHtml(sheets[index],departure,roundTrip&&index===sheets.length-1,plans[index]?.map || null,plans[index]?.optimized || false,{sheetNo:index+1,totalSheets:sheets.length,returnAddress:origin});
      const win = window.open('','_blank');
      if(!win)throw new Error('浏览器拦截了打印窗口，请允许弹出窗口后重试');
      win.opener=null;win.document.open();win.document.write(html);win.document.close();
    }catch(e:any){setError(e.message);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
    <DialogTitle>生成派送单</DialogTitle><DialogDescription>{rows.length} 个客户批次，{stops.length} 个派送地点，自动分为 {sheets.length} 张派送单。每张最多 21 个地点，包含地图页和明细页。</DialogDescription>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">司机起始点<select className="mt-1 w-full rounded border bg-background p-2" value={originId} onChange={e=>{setOriginId(e.target.value);reset();}}><option value="">请选择仓库管理中设置的起始点</option>{origins.data?.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name} — {p.address}</option>)}</select></label>
      {origins.isError&&<p role="alert">司机起始点读取失败，请关闭后重试。</p>}
      {origins.isSuccess&&!origins.data.some(p=>p.active)&&<p className="text-sm text-amber-500">请先到仓库管理新增并启用司机起始点。</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roundTrip} disabled={!origin.trim()} onChange={e=>{setRoundTrip(e.target.checked);reset();}}/>派送后返回出发仓库</label>
      <p className="text-xs text-muted-foreground">按当前地址顺序分单，每单最后一站固定；下一单从上一单最后一站出发，并先送下一单首个收件点。Google 只优化单内顺序，不进行跨单整体优化；返回仓库只安排在最后一单。</p>
      {config.data&&<p className="rounded border p-3 text-sm">本月路线调用：{config.data.used} / {config.data.limit} 次（UTC 月初重置）。达到上限即停止查询，仍可手动排序和打印。失败重试也计数；已有结果直接打印不再调用。{!config.data.quotaReady&&<strong className="block text-amber-500">限量保护尚未就绪，请先执行数据库迁移；Google 调用已禁用。</strong>}</p>}
      {config.isLoading?<p>检查地图配置…</p>:config.isError?<p role="alert">无法读取地图配置，请关闭后重试。</p>:!config.data?.configured?<p className="rounded border p-3 text-sm">尚未配置 Google 地图服务。现在可手动调整顺序、打开各地点和分段导航；打印稿暂以导航入口代替地图图片。</p>:<div className="flex gap-3"><button disabled={!origin.trim()||!config.data.quotaReady||config.data.used>=config.data.limit} className="rounded bg-brand p-2 text-white disabled:opacity-50" onClick={()=>void generate(true)}>分单规划并生成地图</button><button disabled={!origin.trim()||!config.data.quotaReady||config.data.used>=config.data.limit} className="rounded border p-2 disabled:opacity-50" onClick={()=>void generate(false)}>按当前顺序生成地图</button></div>}
      {sheets.map((sheet,sheetIndex)=><section key={sheetIndex} className="space-y-2 rounded border p-3"><h3 className="font-semibold">第 {sheetIndex+1} 张 · {sheet.length} 个地点</h3><p className="text-xs text-muted-foreground">起点：{sheetIndex?sheets[sheetIndex-1].at(-1)!.address:origin||'请选择司机起始点'}</p><ol className="space-y-2">{sheet.map((stop,i)=>{const originalIndex=stops.indexOf(stop);return <li key={stop.address} className="flex items-center gap-3 rounded border p-2 text-sm"><b>{stopLabel(i)}</b><div className="flex-1"><a href={googlePlace(stop.address)} target="_blank" rel="noopener noreferrer" className="text-sky-500 underline">{stop.address}</a><p className="text-xs text-muted-foreground">{stop.rows.map(r=>`${r.customer_code || '未知客户'} / ${r.batch_no || r.batch_name || '无批次'}`).join('；')}</p></div><button aria-label={`上移第 ${originalIndex+1} 个地址`} disabled={!originalIndex||plans.length>0} onClick={()=>move(originalIndex,-1)} className="disabled:opacity-30">↑</button><button aria-label={`下移第 ${originalIndex+1} 个地址`} disabled={originalIndex===stops.length-1||plans.length>0} onClick={()=>move(originalIndex,1)} className="disabled:opacity-30">↓</button></li>;})}</ol>{plans[sheetIndex]?.map&&<img src={plans[sheetIndex].map!} alt={`第 ${sheetIndex+1} 张 Google 派送路线地图`} className="mx-auto max-h-80 max-w-full object-contain"/>}<button disabled={!origin} className="rounded bg-brand px-3 py-2 text-white disabled:opacity-50" onClick={()=>openPrint(sheetIndex)}>预览第 {sheetIndex+1} 张 / 打印</button></section>)}
      {plans.length>0&&<button className="text-sm underline" onClick={reset}>清除本次路线结果，重新调整地址顺序</button>}
    </fieldset>
    {busy&&<p role="status" className="animate-pulse text-sky-500">{progress}</p>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
    <p className="text-xs text-muted-foreground">同地址合并站点，各客户批次分别列明；备注或批次过多超过两页时，会提示减少勾选，保留完整内容。生成派送单不会扣款或确认派送。</p>
    <div className="flex justify-end gap-3"><button disabled={busy} onClick={onClose}>关闭</button></div>
  </DialogContent></Dialog>;
}
