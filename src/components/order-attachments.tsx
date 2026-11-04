import { preparePhoto } from '@/lib/prepare-photo';
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Paperclip, Upload, Download, Trash2, FileText } from "lucide-react";

const sb = supabase as any;
const BUCKET = "order-attachments";

interface Att {
  id: string; file_name: string; file_path: string; file_size: number;
  content_type: string | null; created_at: string;
}

export function OrderAttachments({
  ownerKind, ownerId, lang,
}: { ownerKind: "order" | "forwarding"; ownerId: string; lang: "zh" | "en" }) {
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [items, setItems] = useState<Att[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{name: string; url: string} | null>(null);
  const onPreview = async (a: Att) => {
    setBusy(a.id);
    try {
      const {data,error} = await sb.storage.from(BUCKET).createSignedUrl(a.file_path, 600);
      if(error) throw error;
      setPreview({name:a.file_name,url:data.signedUrl});
    } catch(e:any) { toast.error(e.message); }
    finally {setBusy(null);}
  };

  const load = async () => {
    const { data, error } = await sb.from("order_attachments").select("*")
      .eq("owner_kind", ownerKind).eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if(error) { toast.error(error.message); return; }
    setItems(data ?? []);
  };
  useEffect(() => { load(); }, [ownerId, ownerKind]);

  const onPick = () => inputRef.current?.click();

  const onUpload = async (file: File) => {
    if (uploadLock.current) return;
    if (file.size > 25 * 1024 * 1024) return toast.error(tr("文件超过 25MB", "File exceeds 25MB"));
    uploadLock.current = true;
    setUploading(true);
    try {
      const { data: u } = await sb.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error("not signed in");
      let uploadFile = file;
      if (file.type.startsWith('image/')) {
        const image = await preparePhoto(file);
        const bytes = Uint8Array.from(atob(image.split(',')[1]), c => c.charCodeAt(0));
        uploadFile = new File([bytes], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
      const safe = uploadFile.name.replace(/[^\w.\-]+/g, "_");
      const path = `${uid}/${ownerId}/${crypto.randomUUID()}_${safe}`;
      const up = await sb.storage.from(BUCKET).upload(path, uploadFile, { contentType: uploadFile.type || undefined });
      if (up.error) throw up.error;
      const ins = await sb.from("order_attachments").insert({
        owner_kind: ownerKind, owner_id: ownerId, user_id: uid,
        file_name: uploadFile.name, file_path: path, file_size: uploadFile.size, content_type: uploadFile.type || null,
      });
      if (ins.error) { await sb.storage.from(BUCKET).remove([path]); throw ins.error; }
      toast.success(tr("上传成功", "Uploaded"));
      load();
    } catch (e: any) {
      toast.error(e?.message ?? tr("上传失败", "Upload failed"));
    } finally {
      uploadLock.current = false;
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDownload = async (a: Att) => {
    setBusy(a.id);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.file_path, 60, { download: a.file_name });
    setBusy(null);
    if (error) return toast.error(error.message);
    window.location.href = data.signedUrl;
  };

  const onDelete = async (a: Att) => {
    if (!confirm(tr(`删除 ${a.file_name}?`, `Delete ${a.file_name}?`))) return;
    setBusy(a.id);
    await sb.storage.from(BUCKET).remove([a.file_path]);
    await sb.from("order_attachments").delete().eq("id", a.id);
    setBusy(null);
    load();
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">{tr("上传相关单据、商品照片或报关材料（点击图片文件名预览）", "Upload invoices, product photos or customs docs (click image filename to preview)")}</p>
        <button type="button" onClick={()=>cameraRef.current?.click()} disabled={uploading} className="rounded-full border border-border px-3 py-1.5 text-xs">{tr("拍照上传", "Take photo")}</button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void onUpload(f);e.target.value='';}} />
        <button type="button" onClick={onPick} disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-elevated transition hover:brightness-110 disabled:opacity-60">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {tr("上传文件", "Upload")}
        </button>
        <input ref={inputRef} type="file" className="hidden"
          onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
      </div>

      {items === null ? (
        <div className="py-6 text-center text-ink-soft"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-ink-soft">
          <Paperclip className="mx-auto mb-1 h-4 w-4" />{tr("暂无附件", "No attachments yet")}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-3">
              <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
              <div className="min-w-0 flex-1">
                {(a.content_type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/i.test(a.file_name)) ? <button type="button" disabled={busy===a.id} onClick={()=>onPreview(a)} className="block max-w-full break-all text-left text-sm font-medium text-brand underline">{a.file_name}</button> : <div className="truncate text-sm font-medium">{a.file_name}</div>}
                <div className="text-[11px] text-ink-soft">
                  {(a.file_size / 1024).toFixed(1)} KB · {new Date(a.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}
                </div>
              </div>
              <button type="button" onClick={() => onDownload(a)} disabled={busy === a.id}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] hover:border-brand hover:text-brand disabled:opacity-50">
                {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                {tr("下载", "Download")}
              </button>
              <button type="button" onClick={() => onDelete(a)} disabled={busy === a.id}
                className="rounded-full p-1.5 text-ink-soft hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && <dialog ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={()=>setPreview(null)} aria-label={preview.name} className="m-auto w-[calc(100%_-_2rem)] max-w-4xl rounded-xl bg-surface p-4 backdrop:bg-black/80"><div className="mb-3 flex items-center justify-between gap-3"><span className="break-all text-sm">{preview.name}</span><button type="button" autoFocus onClick={()=>setPreview(null)} className="shrink-0 rounded border border-border px-3 py-2">{tr('关闭','Close')}</button></div><img src={preview.url} alt={preview.name} className="max-h-[75dvh] w-full object-contain" /></dialog>}
    </div>
  );
}
