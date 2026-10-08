import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

/** Decode into the existing input only. Existing submit/reminder flows retain control. */
export function CameraScanButton({ onScan, disabled = false, continuous = false }: {
  onScan: (code: string) => void | Promise<void>;
  disabled?: boolean;
  continuous?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const callback = useRef(onScan);
  const last = useRef({ code: '', time: 0 });
  callback.current = onScan;

  useEffect(() => {
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const hide = () => { if (document.hidden) { stop(); setOpen(false); } };
    document.addEventListener('visibilitychange', hide);
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('请通过 HTTPS 正式网站打开相机扫码，或继续手动输入。');
        }
        setMessage('正在开启后置摄像头…');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        const video = videoRef.current;
        if (!video) { stop(); return; }
        video.srcObject = stream;
        await video.play();
        const { decodeCameraFrame } = await import('@/lib/camera-barcode');
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('当前浏览器无法识别条码，请使用手机 Safari 或 Chrome。');
        setMessage('将一个条形码或二维码放入画面，保持清晰、光线充足。');
        const tick = async () => {
          if (cancelled) return;
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              const scale = Math.min(1, 1280 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const codes = await decodeCameraFrame(ctx.getImageData(0, 0, canvas.width, canvas.height));
              if (cancelled) return;
              if (codes.length > 1) setMessage('发现多个条码，请只对准需要录入的一个。');
              if (codes.length === 1) {
                const code = codes[0];
                if (last.current.code === code && Date.now() - last.current.time < 3000) {
                  setMessage('刚刚已识别此单号，请移开条码。');
                } else {
                  last.current = { code, time: Date.now() };
                  if (continuous) {
                    try { await callback.current(code); setMessage(`已识别：${code}，继续扫描下一件。`); }
                    catch (e) { setMessage(e instanceof Error ? e.message : '扫码处理失败，请重试'); }
                    if (!cancelled) timer = setTimeout(tick, 250);
                    return;
                  }
                  stop(); setOpen(false);
                  void callback.current(code);
                  setMessage(`已识别：${code}。请核对后点击原页面的确认按钮；完成后可继续扫码。`);
                  return;
                }
              }
            }
            if (!cancelled) timer = setTimeout(tick, 250);
          } catch { stop(); setOpen(false); setMessage('条码识别失败，请重新开启相机或手动输入。'); }
        };
        void tick();
      } catch (error) {
        if (cancelled) return;
        stop(); setOpen(false);
        const name = error instanceof Error ? error.name : '';
        setMessage(name === 'NotAllowedError' ? '摄像头未获授权，请在浏览器的网站权限中允许使用摄像头。'
          : name === 'NotFoundError' ? '未找到摄像头，可继续手动输入或使用扫描枪。'
          : name === 'NotReadableError' ? '摄像头被占用，请关闭其他使用相机的应用后重试。'
          : '相机或扫码组件未能启动，请检查网络和摄像头权限，使用 HTTPS 网站重试。');
      }
    }
    void start();
    return () => { stop(); document.removeEventListener('visibilitychange', hide); };
  }, [open, disabled, continuous]);

  return <div className="mt-3 text-slate-100">
    <button type="button" disabled={disabled} onClick={() => { setMessage(''); setOpen(v => !v); }}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-300 disabled:opacity-40">
      {open ? <X className="h-4 w-4" /> : <Camera className="h-4 w-4" />}{open ? '关闭相机' : '相机扫码'}
    </button>
    {open && !disabled && <video ref={videoRef} autoPlay muted playsInline aria-label="扫码摄像头画面"
      className="mt-3 max-h-64 w-full rounded-xl border border-white/10 bg-black object-contain" />}
    {message && <p role="status" className="mt-2 break-all text-xs text-slate-300">{message}</p>}
  </div>;
}
