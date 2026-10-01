import { useServerFn } from '@tanstack/react-start';
import { createRoot } from 'react-dom/client';

function confirmReturn(reminders: { id: string; number: string; note: string }[]): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const finish = (ok: boolean) => { root.unmount(); host.remove(); resolve(ok); };
    root.render(<dialog ref={el => { if (el && !el.open) el.showModal(); }} onCancel={e => { e.preventDefault(); finish(false); }} className="m-auto w-full max-w-xl rounded-2xl border border-amber-500/40 bg-slate-900 p-6 text-slate-100 backdrop:bg-black/70" aria-labelledby="return-reminder-title">
      <h2 id="return-reminder-title" className="text-lg font-bold text-amber-300">退运提醒</h2>
      <p className="my-3 text-sm">本次操作包含已标记退运的包裹，请先查看备注并核实是否继续。</p>
      <div className="max-h-80 space-y-3 overflow-auto">{reminders.map(r => <section key={r.id} className="rounded-lg bg-white/5 p-3"><strong>{r.number}</strong><p className="mt-2 whitespace-pre-wrap text-sm">{r.note}</p></section>)}</div>
      <p className="mt-3 text-xs text-slate-400">继续操作不会关闭退运提醒，后续流转仍会提示。</p>
      <div className="mt-5 flex gap-3"><button autoFocus className="rounded bg-slate-700 px-4 py-2" onClick={() => finish(false)}>取消本次操作</button><button className="rounded bg-amber-700 px-4 py-2" onClick={() => finish(true)}>已核实，继续操作</button></div>
    </dialog>);
  });
}

export function useReturnReminder<T extends Parameters<typeof useServerFn>[0]>(fn: T): T {
  const invoke = useServerFn(fn);
  return (async (options: any) => {
    let request = options;
    for (;;) {
      try { return await invoke(...([request] as Parameters<T>)); }
      catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.startsWith('RETURN_REMINDER:')) throw error;
        const warning = JSON.parse(message.slice('RETURN_REMINDER:'.length));
        if (!await confirmReturn(warning.reminders)) throw new Error('已取消本次操作，包裹未继续流转');
        request = { ...options, data: { ...options.data, __returnReminderAck: warning.token } };
      }
    }
  }) as T;
}
