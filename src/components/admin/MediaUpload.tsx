import { useRef, useState } from "react";
import { Upload, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "shop-media";
// 100 years in seconds — bucket is private (workspace blocks public buckets),
// so we issue long-lived signed URLs and store them on the product row.
const SIGNED_TTL = 60 * 60 * 24 * 365 * 100;

export async function uploadShopMedia(file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "bin";
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await (supabase as any).storage.from(BUCKET).upload(key, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  const { data, error: signErr } = await (supabase as any).storage.from(BUCKET).createSignedUrl(key, SIGNED_TTL);
  if (signErr) throw new Error(signErr.message);
  return data.signedUrl as string;
}

export function MediaUpload({
  value,
  onChange,
  accept = "image/*",
  label,
  variant = "dark",
}: {
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  label?: string;
  variant?: "dark" | "light";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handle = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadShopMedia(f));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const isImg = value && /\.(jpe?g|png|webp|gif|avif|svg)(\?|$)/i.test(value);
  const isVid = value && /\.(mp4|webm|mov)(\?|$)/i.test(value);
  const light = variant === "light";
  const btnCls = light
    ? "inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
    : "inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50";
  const urlCls = light
    ? "flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none"
    : "flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs focus:border-brand focus:outline-none";
  const previewCls = light
    ? "overflow-hidden rounded-md border border-border bg-muted"
    : "overflow-hidden rounded-md border border-white/10 bg-black/30";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {label ?? "上传"}
        </button>
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="或粘贴 URL"
          className={urlCls}
        />
        {value && (
          <button type="button" onClick={() => onChange("")} className="text-rose-400 hover:text-rose-300">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {err && <div className="text-[11px] text-rose-300">{err}</div>}
      {value && (
        <div className={previewCls}>
          {isImg ? (
            <img src={value} alt="" className="max-h-40 object-contain" />
          ) : isVid ? (
            <video src={value} controls className="max-h-40" />
          ) : (
            <div className={`p-2 text-[11px] break-all ${light ? "text-ink-soft" : "text-slate-400"}`}>{value}</div>
          )}
        </div>
      )}
    </div>
  );
}
