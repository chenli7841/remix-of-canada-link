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

  const load = async () => {
    const { data } = await sb.from("order_attachments").select("*")
      .eq("owner_kind", ownerKind).eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    setItems(data ?? []);
  };
  useEffect(() => { load(); }, [ownerId]);

  const onPick = () => inputRef.current?.click();

  const onUpload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) return toast.error(tr("文件超过 25MB", "File exceeds 25MB"));
    setUploading(true);
    try {
      const { data: u } = await sb.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error("not signed in");
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${uid}/${ownerId}/${Date.now()}_${safe}`;
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (up.error) throw up.error;
      const ins = await sb.from("order_attachments").insert({
        owner_kind: ownerKind, owner_id: ownerId, user_id: uid,
        file_name: file.name, file_path: path, file_size: file.size, content_type: file.type || null,
      });
      if (ins.error) throw ins.error;
      toast.success(tr("上传成功", "Uploaded"));
      load();
    } catch (e: any) {
      toast.error(e?.message ?? tr("上传失败", "Upload failed"));
    } finally {
      setUploading(false);
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
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-ink-soft">{tr("上传相关单据、商品照片或报关材料（下载后查看）", "Upload invoices, product photos or customs docs (download to view)")}</p>
        <button onClick={onPick} disabled={uploading}
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
                <div className="truncate text-sm font-medium">{a.file_name}</div>
                <div className="text-[11px] text-ink-soft">
                  {(a.file_size / 1024).toFixed(1)} KB · {new Date(a.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}
                </div>
              </div>
              <button onClick={() => onDownload(a)} disabled={busy === a.id}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] hover:border-brand hover:text-brand disabled:opacity-50">
                {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                {tr("下载", "Download")}
              </button>
              <button onClick={() => onDelete(a)} disabled={busy === a.id}
                className="rounded-full p-1.5 text-ink-soft hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
