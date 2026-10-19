import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { expressDispatch } from "@/lib/express-dispatch.functions";
import {
  getExpressWorkspace,
  getExpressOverview,
  quoteExpress,
  buyExpress,
  labelExpress,
  refreshExpress,
} from "@/lib/express.functions";
import {
  defaultRule,
  sourceNames,
  statusNames,
  type ExpressAddress,
  type ExpressDraft,
  type ExpressRate,
} from "@/lib/express";
import { CameraScanButton } from "./CameraScanButton";
import { listWarehouses } from "@/lib/settings.functions";
import { warehouseExpressAddress } from "@/lib/express-warehouse";

const input = "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2 text-sm text-white";
const button = "rounded bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-40";
export type ExpressDispatchListHandle = { prepareRow: (key: string) => Promise<void> };
export const ExpressDispatchList = forwardRef<ExpressDispatchListHandle, { printOnly?: boolean }>(
  function ExpressDispatchList({ printOnly = false }, ref) {
    const call = useServerFn(expressDispatch),
      overview = useServerFn(getExpressOverview),
      label = useServerFn(labelExpress);
    const qc = useQueryClient();
    const [scan, setScan] = useState("");
    const [matches, setMatches] = useState<any[] | null>(null);
    const [active, setActive] = useState<any>(null);
    const [cards, setCards] = useState<any[]>([]);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const q = useQuery({
      queryKey: ["express-print-records"],
      queryFn: () => overview(),
      enabled: printOnly,
    });
    async function run(task: () => Promise<void>) {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setMessage("");
      try {
        await task();
      } catch (e: any) {
        setMessage(e.message);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    }
    async function openCards(key?: string, code?: string) {
      await run(async () => {
        const r = await call({
          data: code ? { action: "scan", code } : { action: "prepare", keys: [key!] },
        });
        const drafts = (r as any).drafts ?? [];
        setCards(drafts);
        setActive(drafts.length === 1 ? drafts[0] : null);
      });
    }
    useImperativeHandle(ref, () => ({ prepareRow: (key) => openCards(key) }));
    async function scanExisting(code: string) {
      await run(async () => {
        setMatches([]);
        const r = await call({ data: { action: "printScan", code } });
        setMatches((r as any).records ?? []);
        setScan("");
        setMessage("已找到生成的面单，请点击打印。");
      });
    }
    async function print(id: string) {
      if (lock.current) return;
      const popup = window.open("", "_blank");
      if (!popup) {
        setMessage("请允许弹出打印窗口后重试");
        return;
      }
      await run(async () => {
        try {
          const f = await label({ data: { id } });
          const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          popup.location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 300000);
        } catch (e) {
          popup.close();
          throw e;
        }
      });
    }
    const records = (matches ?? q.data?.records ?? []).filter((r: any) => r.status === "created");
    return (
      <>
        {!printOnly && message && (
          <p role="status" className="my-3 text-amber-300">
            {message}
          </p>
        )}
        {printOnly && (
          <section className="min-w-0 rounded-xl border border-slate-700 p-3 sm:p-5">
            <h2 className="text-lg font-bold">快递面单打印</h2>
            <p className="my-2 text-xs text-slate-400">
              仅查询和打印已生成的面单。生成新面单请返回“待派送列表”，点击行内的“生成快递单”。
            </p>
            <form
              className="my-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (scan.trim()) void scanExisting(scan.trim());
              }}
            >
              <input
                aria-label="扫描已有快递面单"
                className={`${input} flex-1 basis-56`}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="扫描箱号／订单号／运单号，查找已有面单"
              />
              <button className={button} disabled={busy || !scan.trim()}>
                查找面单
              </button>
              <CameraScanButton continuous onScan={scanExisting} />
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => {
                  setMatches(null);
                  void q.refetch();
                }}
              >
                显示最近面单
              </button>
            </form>
            {(message || q.error) && (
              <p role="status" className="my-3 text-amber-300">
                {message || (q.error as Error).message}
              </p>
            )}
            {q.isPending && <p>正在读取已生成面单…</p>}
            {records.map((r: any) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 py-3"
              >
                <div className="min-w-0 break-all">
                  <b>{r.tracking_numbers?.join(" / ") || r.reference}</b>
                  <p className="text-xs text-slate-400">
                    {r.reference} · {r.rate?.carrier} {r.rate?.service} ·{" "}
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <button disabled={busy} className={button} onClick={() => void print(r.id)}>
                  打印快递面单
                </button>
              </div>
            ))}
            {!q.isPending && !records.length && (
              <p className="py-4 text-slate-400">暂无已生成的快递面单。</p>
            )}
          </section>
        )}
        {!printOnly && cards.length > 1 && !active && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-3">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="派送资料卡片"
              className="mx-auto max-w-3xl rounded-xl bg-slate-900 p-5"
            >
              <div className="flex justify-between">
                <h2 className="font-bold">查看并修改派送资料</h2>
                <button onClick={() => setCards([])}>关闭</button>
              </div>
              <p className="my-3 text-slate-400">
                同一收发地址已合并为一票多件；不同地址或包装类型分别显示。请选择订单核对资料。
              </p>
              {cards.map((d) => (
                <div key={d.id} className="my-3 rounded border border-slate-700 p-3">
                  <b>
                    {d.number} · {d.customer_code}
                  </b>
                  <p className="break-words">
                    {d.draft.to.name} · {d.draft.to.address} {d.draft.to.city}
                  </p>
                  <p>
                    {d.draft.packages
                      .map(
                        (p: any) =>
                          `${p.lengthCm}×${p.widthCm}×${p.heightCm} cm / ${p.weightKg} kg`,
                      )
                      .join("；")}
                  </p>
                  <button className={button} onClick={() => setActive(d)}>
                    查看／修改基础信息
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {!printOnly && active && (
          <ExpressEditor
            key={active.id}
            record={active}
            onClose={() => {
              setActive(null);
            }}
            onSelectUnit={(code) => openCards(undefined, code)}
            onSaved={async (draft) => {
              setCards((previous) =>
                previous.map((card) => (card.id === active.id ? { ...card, draft } : card)),
              );
              await qc.invalidateQueries({ queryKey: ["express-print-records"] });
            }}
          />
        )}
      </>
    );
  },
);

function AddressFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: ExpressAddress;
  onChange: (a: ExpressAddress) => void;
}) {
  const fields: [keyof ExpressAddress, string][] = [
    ["name", "姓名"],
    ["mobile_phone", "电话"],
    ["company", "公司"],
    ["region_id", "国家代码"],
    ["province", "省份"],
    ["city", "城市"],
    ["postalcode", "邮编"],
    ["address", "详细地址"],
    ["address2", "单元／房间"],
    ["email", "邮箱"],
  ];
  return (
    <fieldset className="min-w-0 rounded border border-slate-700 p-3">
      <legend>{title}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <label key={key} className="min-w-0 text-xs text-slate-300">
            {label}
            <input
              className={input}
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="text-xs">
        地址类型
        <select
          className={input}
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as ExpressAddress["type"] })}
        >
          <option value="resident">住宅</option>
          <option value="commercial">商业</option>
        </select>
      </label>
    </fieldset>
  );
}
function ExpressEditor({
  record,
  onClose,
  onSaved,
  onSelectUnit,
}: {
  record: any;
  onClose: () => void;
  onSaved: (draft: ExpressDraft) => Promise<unknown>;
  onSelectUnit: (code: string) => Promise<void>;
}) {
  const fetchWarehouses = useServerFn(listWarehouses);
  const warehouseQuery = useQuery({
    queryKey: ["express-origin-warehouses"],
    queryFn: () => fetchWarehouses(),
  });
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const originWarehouses = (warehouseQuery.data?.warehouses ?? []).filter(
    (w) => w.is_active && w.can_origin,
  );
  const workspace = useServerFn(getExpressWorkspace),
    save = useServerFn(expressDispatch),
    quote = useServerFn(quoteExpress),
    buy = useServerFn(buyExpress),
    label = useServerFn(labelExpress),
    refresh = useServerFn(refreshExpress);
  const [draft, setDraft] = useState<ExpressDraft>(record.draft);
  const [quotes, setQuotes] = useState<{
    id: string;
    rates: ExpressRate[];
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const q = useQuery({
    queryKey: ["express-workspace", record.source_key],
    queryFn: () => workspace({ data: record.source }),
  });
  const change = (next: ExpressDraft) => {
    setDraft(next);
    setQuotes(null);
  };
  async function run(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function persist() {
    await save({ data: { action: "save", source: record.source, draft } });
    await onSaved(draft);
  }
  async function print(id: string) {
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("浏览器阻止了打印窗口，请允许弹窗后重试");
      return;
    }
    await run(async () => {
      try {
        const f = await label({ data: { id } });
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        popup.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 300000);
        setMessage("正式 PDF 面单已打开，请点击 PDF 中的打印按钮。");
      } catch (e) {
        popup.close();
        throw e;
      }
    });
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-2 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="编辑快递派送订单"
        className="mx-auto max-w-4xl rounded-xl bg-slate-900 p-4 text-white"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="break-all text-lg font-bold">{record.number} · 快递派送订单</h2>
          <button disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="my-2 text-xs text-slate-400">
          编辑仅用于本次快递出单。可增减物理包裹；更换派送单位前请先保存修改。
        </p>
        {q.data && q.data.units.length > 1 && (
          <label className="mb-3 block text-sm">
            选择派送单位
            <select
              className={input}
              disabled={busy}
              value={`${record.source.kind}:${record.source.id}`}
              onChange={(e) => {
                const unit = q.data.units.find(
                  (u) => `${u.source.kind}:${u.source.id}` === e.target.value,
                );
                if (unit) void onSelectUnit(unit.number);
              }}
            >
              {q.data.units.map((u) => (
                <option
                  key={`${u.source.kind}:${u.source.id}`}
                  value={`${u.source.kind}:${u.source.id}`}
                >
                  {sourceNames[u.source.kind]} · {u.number}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <label className="block text-sm">
                选择系统发货仓
                <select
                  className={input}
                  value={selectedWarehouse}
                  disabled={warehouseQuery.isPending}
                  onChange={(e) => {
                    setSelectedWarehouse(e.target.value);
                    const warehouse = originWarehouses.find((w) => w.id === e.target.value);
                    if (warehouse) change({ ...draft, from: warehouseExpressAddress(warehouse) });
                  }}
                >
                  <option value="">
                    {warehouseQuery.isPending ? "正在读取仓库…" : "保留当前地址／手动填写"}
                  </option>
                  {originWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name_zh} · {w.country}
                    </option>
                  ))}
                </select>
              </label>
              {warehouseQuery.error && (
                <p className="text-sm text-amber-300">
                  仓库读取失败：{warehouseQuery.error.message}
                </p>
              )}
              {warehouseQuery.isSuccess && !originWarehouses.length && (
                <p className="text-xs text-amber-300">
                  没有启用的发货仓，请在仓库管理中设置“起点”仓库。
                </p>
              )}
              {selectedWarehouse && (
                <p className="text-xs text-slate-400">
                  已带入仓库地址、联系人和电话。请核对省市、邮编；缺失的信息可在下方补充。
                </p>
              )}
              <AddressFields
                title="发货地址"
                value={draft.from}
                onChange={(from) => {
                  setSelectedWarehouse("");
                  change({ ...draft, from });
                }}
              />
            </div>
            <AddressFields
              title="收货地址"
              value={draft.to}
              onChange={(to) => change({ ...draft, to })}
            />
          </div>
          <h3 className="font-bold">
            一张快递订单 · 共 {draft.packages.length}{" "}
            {draft.packageType === "pallet" ? "个托盘" : "件包裹"}（尺寸 cm，重量 kg）
          </h3>
          {draft.packages.map((p, i) => (
            <div key={i} className="rounded border border-slate-700 p-3">
              <b>第 {i + 1} 件</b>
              {p.reference && (
                <p className="break-all text-sm text-sky-300">原单号：{p.reference}</p>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["lengthCm", "长 cm"],
                    ["widthCm", "宽 cm"],
                    ["heightCm", "高 cm"],
                    ["weightKg", "重量 kg"],
                  ] as const
                ).map(([key, name]) => (
                  <label key={key} className="text-xs">
                    {name}
                    <input
                      className={input}
                      type="number"
                      min="0.001"
                      step="any"
                      value={p[key] || ""}
                      onChange={(e) =>
                        change({
                          ...draft,
                          packages: draft.packages.map((v, j) =>
                            j === i ? { ...v, [key]: Number(e.target.value) } : v,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                className="mt-2 text-sm text-red-300 disabled:opacity-40"
                disabled={draft.packages.length === 1}
                onClick={() =>
                  change({ ...draft, packages: draft.packages.filter((_, j) => j !== i) })
                }
              >
                移除此件
              </button>
            </div>
          ))}
          <button
            className={button}
            disabled={draft.packages.length >= 100}
            onClick={() =>
              change({
                ...draft,
                packages: [
                  ...draft.packages,
                  { lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0 },
                ],
              })
            }
          >
            增加派送件
          </button>
          <label className="block text-sm">
            货物说明
            <input
              className={input}
              value={draft.description}
              onChange={(e) => change({ ...draft, description: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label>
              <input
                type="checkbox"
                checked={draft.signature}
                onChange={(e) => change({ ...draft, signature: e.target.checked })}
              />{" "}
              签收服务
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.liftgate}
                onChange={(e) => change({ ...draft, liftgate: e.target.checked })}
              />{" "}
              尾板服务
            </label>
            <select
              aria-label="面单纸张"
              className="rounded bg-slate-800"
              value={draft.printSize}
              onChange={(e) =>
                change({ ...draft, printSize: e.target.value as ExpressDraft["printSize"] })
              }
            >
              <option value="thermal">热敏面单</option>
              <option value="letter">Letter</option>
            </select>
          </div>
          {draft.packageType === "pallet" && (
            <div className="grid grid-cols-3 gap-2">
              {(["pickupDate", "pickupStart", "pickupEnd"] as const).map((k) => (
                <label key={k}>
                  {{ pickupDate: "取货日期", pickupStart: "开始时间", pickupEnd: "结束时间" }[k]}
                  <input
                    className={input}
                    type={k === "pickupDate" ? "date" : "time"}
                    step={1800}
                    value={draft[k]}
                    onChange={(e) => change({ ...draft, [k]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() =>
                void run(async () => {
                  await persist();
                  setMessage("已保存");
                })
              }
            >
              保存资料
            </button>
            <button
              className={button}
              disabled={!q.data?.connection.configured}
              onClick={() =>
                void run(async () => {
                  await persist();
                  setQuotes(await quote({ data: { draft, rule: defaultRule } }));
                })
              }
            >
              确认生成快递单（先查询报价）
            </button>
          </div>
        </fieldset>
        {(message || q.error) && (
          <p role="status" className="my-3 break-words text-amber-300">
            {message || (q.error as Error).message}
          </p>
        )}
        {q.data && !q.data.connection.configured && (
          <p className="text-amber-300">快递接口未配置，完成配置后可报价和打印正式面单。</p>
        )}
        {quotes && (
          <section className="my-4">
            <h3>选择快递服务 · 报价有效至 {new Date(quotes.expiresAt).toLocaleTimeString()}</h3>
            {!quotes.rates.length && <p>暂无可用报价，请检查地址及包裹信息。</p>}
            {quotes.rates.map((rate) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 py-3"
                key={rate.key}
              >
                <span>
                  {rate.carrier} · {rate.service} ·{" "}
                  <b>
                    {rate.currency} {rate.price.toFixed(2)}
                  </b>{" "}
                  · {rate.eta}
                </span>
                <button
                  className={button}
                  disabled={busy || !q.data?.connection.purchasing}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `确认购买 ${rate.carrier} ${rate.service} 面单，费用 ${rate.currency} ${rate.price.toFixed(2)}？`,
                      )
                    )
                      return;
                    void run(async () => {
                      const result = await buy({
                        data: { quoteId: quotes.id, rateKey: rate.key, confirmed: true },
                      });
                      setQuotes(null);
                      await q.refetch();
                      setMessage("请求已提交，请在下方核对结果后打印。");
                    });
                  }}
                >
                  确认费用并生成快递单
                </button>
              </div>
            ))}
            {!q.data?.connection.purchasing && (
              <p className="text-amber-300">面单购买尚未启用，请先完成平台配置。</p>
            )}
          </section>
        )}
        <h3 className="mt-5 font-bold">快递面单记录</h3>
        {q.data?.records.map((r: any) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-2 border-t border-slate-700 py-3"
          >
            <span className="min-w-0 break-all">
              {r.reference} · {statusNames[r.status] || r.status} ·{" "}
              {r.tracking_numbers?.join(" / ")}
            </span>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                void run(async () => {
                  await refresh({ data: { id: r.id } });
                  await q.refetch();
                })
              }
            >
              核对状态
            </button>
            <button
              disabled={busy || r.status !== "created"}
              className={button}
              onClick={() => void print(r.id)}
            >
              打印快递面单
            </button>
            {r.last_error && <p className="w-full text-amber-300">{r.last_error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
