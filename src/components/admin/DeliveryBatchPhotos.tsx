import {useQuery} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {listDeliveryProofs} from '@/lib/driver.functions';
import {DeliveryPhotoViewer} from './DeliveryPhotoViewer';
export function DeliveryBatchPhotos({batchId,customerCode,version=0}:{batchId:string;customerCode:string;version?:number}) {
  const read=useServerFn(listDeliveryProofs);
  const q=useQuery({queryKey:['delivery-proofs',batchId,customerCode,version],queryFn:()=>read({data:{batchId,customerCode}}),refetchInterval:480000});
  if(q.isLoading)return <p className="text-sm">正在加载派送照片…</p>;
  if(q.isError)return <p role="alert" className="text-sm text-red-500">照片读取失败 <button onClick={()=>void q.refetch()}>重试</button></p>;
  return <DeliveryPhotoViewer items={(q.data??[]).map(p=>({id:p.id,code:customerCode,delivery_photo_urls:[p.url]}))}/>;
}
