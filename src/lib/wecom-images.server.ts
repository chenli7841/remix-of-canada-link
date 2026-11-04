import { wecomImagesSchema } from './wecom-images';
export async function loadWecomImages(admin: any, images: unknown) {
  const rows = wecomImagesSchema.parse(images ?? []);
  const out: {name:string; base64:string}[] = [];
  for (const row of rows) {
    const {data,error} = await admin.storage.from('delivery-proofs').download(row.path);
    if(error || !data) throw new Error(`图片读取失败：${row.name}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    if(bytes.length > 2*1024*1024 || bytes.length < 4 || bytes[0]!==255 || bytes[1]!==216 || bytes.at(-2)!==255 || bytes.at(-1)!==217) throw new Error('图片不是有效的2MB以内JPEG');
    out.push({name:row.name,base64:Buffer.from(bytes).toString('base64')});
  }
  return out;
}
