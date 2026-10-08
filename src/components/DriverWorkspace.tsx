import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listDriverTrips,
  deleteEmptyDriverTrip,
  createDriverTrip,
  getDriverTrip,
  scanDriverTrip,
  dispatchDriverUnits,
  generateDriverRoute,
  loadDriverRouteMaps,
  saveDriverTripNote,
} from "@/lib/driver-trips.functions";
import { listDriverOrigins } from "@/lib/delivery-route.functions";
import {
  actOnDriverDelivery,
  uploadDeliveryProof,
  searchDriverDeliveries,
} from "@/lib/driver.functions";
import { CameraScanButton } from "@/components/admin/CameraScanButton";
import { DeliveryBatchPhotos } from "@/components/admin/DeliveryBatchPhotos";
import { googlePlace, navigationLinks } from "@/lib/delivery-sheet";
import { useAuth } from "@/lib/auth";
const btn = "min-h-11 rounded-xl border border-white/15 bg-slate-800 px-4 py-2 disabled:opacity-40";
const input =
  "min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-slate-900 p-3 text-white";
const date = (s: string) => new Date(s).toLocaleString("zh-CN", { timeZone: "America/Toronto" });
const money = (n: any) => (n == null ? "待确认" : `CA$${Number(n).toFixed(2)}`);
export function DriverWorkspace() {
  const { user } = useAuth();
  const driverId = user?.id;
  const removeEmpty = useServerFn(deleteEmptyDriverTrip);
  const list = useServerFn(listDriverTrips),
    create = useServerFn(createDriverTrip),
    read = useServerFn(getDriverTrip),
    scan = useServerFn(scanDriverTrip),
    dispatch = useServerFn(dispatchDriverUnits),
    generate = useServerFn(generateDriverRoute),
    readMaps = useServerFn(loadDriverRouteMaps),
    originsFn = useServerFn(listDriverOrigins);
  const trips = useQuery({ queryKey: ["driver-trips", driverId], queryFn: () => list() });
  const origins = useQuery({ queryKey: ["driver-origins"], queryFn: () => originsFn() });
  const [page, setPage] = useState<"home" | "loading" | "routes" | "customer">("home"),
    [tripId, setTripId] = useState(""),
    [code, setCode] = useState(""),
    [filter, setFilter] = useState(""),
    [originId, setOriginId] = useState(""),
    [showDone, setShowDone] = useState(false),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [customer, setCustomer] = useState<any>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [maps, setMaps] = useState<Record<string, (string | null)[]>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [collect, setCollect] = useState(false);
  const lock = useRef(false),
    newId = useRef<string | null>(null);
  const detail = useQuery({
    queryKey: ["driver-trip", driverId, tripId],
    queryFn: () => read({ data: { tripId } }),
    enabled: !!tripId,
  });
  const readCustomer = useServerFn(searchDriverDeliveries);
  const liveCustomer = useQuery({
    queryKey: ["driver-customer-live", driverId, customer?.customer_code],
    queryFn: () =>
      readCustomer({ data: { customerCode: customer.customer_code, includeCompleted: true } }),
    enabled: page === "customer" && !!customer?.customer_code,
  });
  const groupFor = (batchId: string) =>
    liveCustomer.data?.find((g) => g.batch_id === batchId) ||
    customer?.groups.find((g: any) => g.batch_id === batchId);
  const refresh = async () => {
    await Promise.all([trips.refetch(), detail.refetch()]);
  };
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "操作失败");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const add = async (value: string) => {
    if (!tripId) throw new Error("请先新建或选择上车趟次");
    if (lock.current) throw new Error("正在保存上一件，请稍后重扫");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await scan({ data: { tripId, code: value.trim() } });
      setMessage(`${r.duplicate ? "已上车，原序号" : "上车成功，序号"} ${r.sequence}`);
      setCode("");
      await refresh();
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const make = () =>
    run(async () => {
      if (!newId.current) newId.current = crypto.randomUUID();
      const t = await create({ data: { id: newId.current } });
      newId.current = null;
      setTripId(t.id);
      setPage("loading");
      setExpanded((s) => new Set([...s, t.id]));
      setMessage("新一趟从 1 开始编号");
      await trips.refetch();
    });
  const deleteEmpty = async (t: any) => {
    if (lock.current || !window.confirm("确认删除这趟空派送清单？删除后无法恢复。")) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await removeEmpty({data: {tripId: t.id}});
      if (tripId === t.id) {setTripId(""); setSelected(new Set()); setCustomer(null);}
      setExpanded(old => {const next = new Set(old); next.delete(t.id); return next;});
      setMaps(old => {const next = {...old}; delete next[t.id]; return next;});
      setMessage("空派送趟已删除");
      await trips.refetch();
    } catch (e: any) {setError(e.message || "删除失败"); await trips.refetch();}
    finally {lock.current = false; setBusy(false);}
  };
  const complete = (t: any) => t.total > 0 && t.completed === t.total;
  const candidates = (trips.data || [])
    .filter((t) => page !== "routes" || t.generated_at || t.total === 0)
    .filter((t) => page !== "loading" || t.source !== "admin")
    .filter(
      (t) =>
        !filter ||
        JSON.stringify([
          t.driver_name,
          date(t.created_at),
          t.route?.plans?.flatMap((p: any) => p.stops),
        ])
          .toLowerCase()
          .includes(filter.toLowerCase()),
    );
  const shown = candidates.filter((t) => showDone || !complete(t));
  const units: any[] = detail.data?.items || [];
  const customerUnits = units
    .filter(
      (x) =>
        x.unit?.customer_code === customer?.customer_code && customer?.ids.includes(x.queue_id),
    )
    .sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER));
  const toggle = (id: string) =>
    setExpanded((old) => {
      const n = new Set(old);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const openTrip = async (t: any) => {
    setTripId(t.id);
    toggle(t.id);
    if (page === "routes" && !maps[t.id] && !expanded.has(t.id) && t.route_revision === t.revision)
      await run(async () => {
        const m = await readMaps({ data: { tripId: t.id } });
        setMaps((old) => ({ ...old, [t.id]: m }));
      });
  };
  const openCustomer = (t: any, c: any) => {
    setTripId(t.id);
    setCustomer(c);
    setSelected(new Set());
    setFilter(c.customer_code);
    setPage("customer");
  };
  return (
    <section className="pb-28">
      {page !== "home" && (
        <button
          className={btn + " mb-4"}
          onClick={() => {
            setPage(page === "customer" ? "routes" : "home");
            setFilter("");
            setError("");
          }}
        >
          ‹ {page === "customer" ? "返回派送线路" : "返回主页面"}
        </button>
      )}
      {page === "home" ? (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">司机工作台</h2>
          <button
            className={btn + " w-full p-6 text-left"}
            onClick={() => {
              setPage("loading");
              setShowDone(false);
            }}
          >
            ▣ <strong className="text-xl">货物上车</strong>
            <p className="mt-2 text-slate-400">连续扫码 · 按上车顺序编号 · 生成线路</p>
          </button>
          <button
            className={btn + " w-full p-6 text-left"}
            onClick={() => {
              setPage("routes");
              setShowDone(false);
            }}
          >
            ➜ <strong className="text-xl">司机派送</strong>
            <p className="mt-2 text-slate-400">查看已生成清单 · 找货派送 · 拍照</p>
          </button>
        </div>
      ) : (
        <h2 className="mb-4 text-xl font-bold">{page === "loading" ? "货物上车" : "司机派送"}</h2>
      )}
      {page === "loading" && (
        <>
          <button
            disabled={busy}
            className={btn + " mb-4 w-full bg-blue-600"}
            onClick={() => void make()}
          >
            新建上车趟次
          </button>
          {tripId && (
            <div className="mb-5 rounded-xl border border-white/10 p-4">
              <p className="font-semibold">
                当前趟次：
                {detail.data
                  ? `${date(detail.data.created_at)} · ${detail.data.driver_name}`
                  : "读取中…"}
              </p>
              <p className="my-3 text-amber-300">
                已上车 {units.length} 件 · 下一件 {units.length + 1} 号
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(code).catch(() => {});
                }}
              >
                <input
                  aria-label="上车条码"
                  className={input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="扫描或输入箱号 / 运单号"
                />
                <button disabled={busy || !code.trim()} className={btn}>
                  加入
                </button>
              </form>
              <CameraScanButton continuous onScan={add} />
              {message && (
                <p role="status" className="my-3 text-emerald-300">
                  {message}
                </p>
              )}
              <ol className="mt-3 divide-y divide-white/10">
                {units.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 py-3">
                    <strong className="rounded-lg bg-amber-300 px-3 py-2 text-2xl text-slate-950">
                      {x.sequence}
                    </strong>
                    <div className="min-w-0 flex-1">
                      <p className="break-all">{x.unit.code}</p>
                      <p className="text-xs text-slate-400">
                        客户 {x.unit.customer_code} · {x.unit.batch?.batch_no}
                      </p>
                    </div>
                    <span className="text-xs">
                      {x.unit.status === "dispatched" ? "已派送" : "待派送"}
                    </span>
                  </li>
                ))}
              </ol>
              <select
                aria-label="司机起始点"
                className={input + " mt-4"}
                value={originId}
                onChange={(e) => setOriginId(e.target.value)}
              >
                <option value="">选择司机起始点</option>
                {origins.data
                  ?.filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.address}
                    </option>
                  ))}
              </select>
              <button
                disabled={busy || !units.length || !originId}
                className={btn + " mt-3 w-full bg-blue-600"}
                onClick={() =>
                  void run(async () => {
                    const r = await generate({ data: { tripId, originId } });
                    setMaps((old) => ({ ...old, [tripId]: r.maps }));
                    await refresh();
                    setPage("routes");
                    setExpanded(new Set([tripId]));
                    setFilter("");
                  })
                }
              >
                生成并保存地图与派送线路
              </button>
              <p className="mt-2 text-xs text-slate-400">
                每张最多 21 个地点，沿用后台的 Google 月限额。新增包裹后需重新生成。
              </p>
            </div>
          )}
        </>
      )}
      {(page === "routes" || page === "loading") && (
        <>
          <input
            className={input + " mb-3"}
            aria-label="搜索派送清单"
            placeholder="搜索客户号 / 地址 / 日期 / 司机"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className={btn + " mb-3"} onClick={() => setShowDone((v) => !v)}>
            {showDone ? "隐藏" : "显示"}已完成（{candidates.filter(complete).length} 趟）
          </button>
          {trips.isLoading && <p>正在读取趟次…</p>}
          {trips.isError && <p role="alert">{trips.error.message}</p>}
          {!trips.isLoading && !shown.length && (
            <p className="p-4 text-slate-400">暂无待派送趟次，可点击“显示已完成”查看历史清单。</p>
          )}
          {shown.map((t) => (
            <article key={t.id} className="mb-4 overflow-hidden rounded-xl border border-white/10">
              <button
                className="w-full bg-slate-800 p-4 text-left"
                aria-expanded={expanded.has(t.id)}
                onClick={() => void openTrip(t)}
              >
                <strong>
                  {expanded.has(t.id) ? "▼" : "▶"} {date(t.created_at)} · {t.driver_name}
                </strong>
                <p className="mt-2 text-sm text-emerald-300">
                  已派送 {t.completed} / 共 {t.total} 个派送单位
                </p>
              </button>
              {t.total === 0 && <div className="px-4 pb-3"><button disabled={busy} className={btn + " text-red-300"} onClick={() => void deleteEmpty(t)}>删除空趟</button></div>}
              {expanded.has(t.id) && (
                <div className="space-y-3 p-4">
                  {page === "loading" ? (
                    <button
                      className={btn}
                      onClick={() => {
                        setTripId(t.id);
                        window.scrollTo(0, 0);
                      }}
                    >
                      继续扫描此趟
                    </button>
                  ) : (
                    <>
                      {t.route_revision !== t.revision && (
                        <p className="text-amber-300">
                          上车清单已变化，请回到货物上车重新生成线路。
                        </p>
                      )}
                      {t.route?.plans?.map((plan: any, index: number) => (
                        <div key={index} className="space-y-3">
                          <h3 className="font-bold">第 {index + 1} 张派送线路</h3>
                          {maps[t.id]?.[index] ? (
                            <img
                              src={maps[t.id][index]!}
                              alt="Google 派送路线地图"
                              className="w-full rounded-xl"
                            />
                          ) : (
                            <button
                              disabled={busy || t.route_revision !== t.revision}
                              className={btn}
                              onClick={() =>
                                void run(async () => {
                                  const m = await readMaps({ data: { tripId: t.id } });
                                  setMaps((old) => ({ ...old, [t.id]: m }));
                                })
                              }
                            >
                              加载地图
                            </button>
                          )}
                          <p className="text-xs text-slate-400">出发：{plan.origin}</p>
                          <div className="flex flex-wrap gap-2">
                            {navigationLinks(
                              plan.stops.map((s: any) => s.address),
                              plan.origin,
                              false,
                            ).map((n, i) => (
                              <a
                                key={i}
                                className={btn + " text-blue-300"}
                                href={n.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                导航 {n.from}–{n.to} 站 ↗
                              </a>
                            ))}
                          </div>
                          {plan.stops.map((stop: any, i: number) => (
                            <div key={i} className="rounded-xl border border-white/15 p-3">
                              <p className="text-sm text-amber-300">第 {index * 21 + i + 1} 站</p>
                              {stop.customers.map((c: any) => (
                                <button
                                  key={c.customer_code}
                                  className="mr-3 min-h-11 text-2xl font-bold text-blue-300"
                                  onClick={() => openCustomer(t, c)}
                                >
                                  {c.customer_code} ›
                                </button>
                              ))}
                              <a
                                className="block py-2 text-lg font-bold"
                                href={googlePlace(stop.address)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(stop.address).catch(() => {});
                                }}
                              >
                                {stop.address} ↗
                              </a>
                              <button
                                className={btn}
                                onClick={() =>
                                  void run(async () => {
                                    await navigator.clipboard.writeText(stop.address);
                                    setMessage("地址已复制");
                                  })
                                }
                              >
                                复制地址
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </>
      )}
      {page === "customer" && customer && (
        <>
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const c = detail.data?.route?.plans
                .flatMap((p: any) => p.stops.flatMap((s: any) => s.customers))
                .find((c: any) => c.customer_code === filter.trim().padStart(5, "0"));
              if (c) {
                setCustomer(c);
                setSelected(new Set());
                setError("");
              } else setError("此趟没有该客户");
            }}
          >
            <input
              aria-label="客户号"
              className={input}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="客户号"
            />
            <button className={btn}>搜索</button>
          </form>
          <div className="mb-4 rounded-xl bg-slate-800 p-4">
            <strong className="text-xl">
              {customer.customer_code} · {customer.name}
            </strong>
            <p className="my-2 font-bold">{customer.address}</p>
            <a
              className="text-blue-300"
              href={"tel:" + String(customer.phone || "").replace(/[^+\d]/g, "")}
            >
              {customer.phone}
            </a>
          </div>
          <CameraScanButton
            continuous
            onScan={(value) => {
              const row = customerUnits.find((x) => x.unit.code === value);
              if (!row) throw new Error("此条码不属于当前客户派送单位");
              if (row.unit.status !== "pending") throw new Error("此单位已经派送或取消");
              setSelected((s) => new Set([...s, row.queue_id]));
            }}
          />
          <table className="mt-4 w-full table-fixed text-xs">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="勾选全部待派送单位"
                    checked={
                      customerUnits.some((x) => x.unit.status === "pending") &&
                      customerUnits
                        .filter((x) => x.unit.status === "pending")
                        .every((x) => selected.has(x.queue_id))
                    }
                    onChange={(e) =>
                      setSelected(
                        new Set(
                          e.target.checked
                            ? customerUnits
                                .filter((x) => x.unit.status === "pending")
                                .map((x) => x.queue_id)
                            : [],
                        ),
                      )
                    }
                  />
                </th>
                <th className="w-[40%] p-2 text-left">批次</th>
                <th className="p-2 text-left">箱号 / 运单号 / 托盘号</th>
              </tr>
            </thead>
            <tbody>
              {customerUnits.map((x) => (
                <tr key={x.id} className="border-t border-white/10 align-top">
                  <td className="py-4">
                    <input
                      aria-label={"勾选 " + x.unit.code}
                      type="checkbox"
                      disabled={x.unit.status !== "pending"}
                      checked={selected.has(x.queue_id)}
                      onChange={(e) =>
                        setSelected((old) => {
                          const n = new Set(old);
                          e.target.checked ? n.add(x.queue_id) : n.delete(x.queue_id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="break-all p-2">
                    {x.unit.batch?.display_name}
                    <p className="mt-2 text-slate-400">{x.unit.batch?.batch_no}</p>
                    <p className="mt-2 text-amber-300">
                      {money(groupFor(x.unit.source_batch_id)?.total_cad)} ·{" "}
                      {groupFor(x.unit.source_batch_id)?.payment_label}
                    </p>
                    <p className="mt-1 text-slate-400">
                      计费 {groupFor(x.unit.source_batch_id)?.chargeable_weight_kg ?? "待确认"} kg
                    </p>
                  </td>
                  <td className="break-all p-2">
                    {x.sequence != null && <div className="mb-2 inline-flex items-center gap-1 rounded-lg bg-amber-300 px-2 py-1 text-slate-950">
                      上车 <b className="text-2xl">{x.sequence}</b> 号
                    </div>}
                    <p>
                      {x.unit.kind === "carton"
                        ? "客户箱"
                        : x.unit.kind === "pallet"
                          ? "客户托盘"
                          : "独立运单"}
                    </p>
                    <p>{x.unit.code}</p>
                    <p className="mt-2 text-amber-200">
                      结算备注：{groupFor(x.unit.source_batch_id)?.settlement_note || "未填写"}
                    </p>
                    <p className="mt-2 text-emerald-300">
                      {x.unit.status === "dispatched"
                        ? "已派送"
                        : x.unit.status === "cancelled"
                          ? "已取消"
                          : "待派送"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div id="driver-photos">
            <CustomerTools tripId={tripId} customer={customer} onMessage={setMessage} />
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl border-t border-white/10 bg-slate-900 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <p className="mb-2 text-sm">
              已选 {selected.size} / {customerUnits.length} 个单位
            </p>
            <div className="flex gap-3">
              <button
                className={btn}
                onClick={() =>
                  document
                    .getElementById("driver-photos")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                拍照
              </button>
              <button className={btn} onClick={() => setCollect(true)}>
                收款
              </button>
              <button
                className={btn + " flex-1 bg-emerald-700"}
                disabled={busy || !selected.size}
                onClick={() => {
                  if (
                    window.confirm(
                      `确认派送 ${selected.size} 个单位？运单将完成，并记录已派送及晚30秒的已完成轨迹。`,
                    )
                  )
                    void run(async () => {
                      await dispatch({ data: { tripId, ids: [...selected] } });
                      setSelected(new Set());
                      await refresh();
                      setMessage("已完成派送，可继续补传照片");
                    });
                }}
              >
                派送（{selected.size}）
              </button>
            </div>
          </div>
        </>
      )}
      {collect && (
        <div
          role="dialog"
          aria-label="收款"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-5"
        >
          <div className="w-full max-w-md space-y-3 rounded-xl bg-slate-800 p-5">
            <h2 className="text-xl">收款</h2>
            <button disabled className={btn + " w-full"}>
              收款充值 · 待配置
            </button>
            <button disabled className={btn + " w-full"}>
              收款付费 · 待配置
            </button>
            <button className={btn + " w-full"} onClick={() => setCollect(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
      {busy && (
        <p role="status" className="my-4 animate-pulse text-blue-300">
          正在处理，请勿重复操作…
        </p>
      )}
      {message && page !== "loading" && (
        <p role="status" className="my-3 text-emerald-300">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="my-4 text-rose-300">
          {error}
        </p>
      )}
      {detail.isError && <p role="alert">{detail.error.message}</p>}
    </section>
  );
}

function CustomerTools({
  tripId,
  customer,
  onMessage,
}: {
  tripId: string;
  customer: any;
  onMessage: (s: string) => void;
}) {
  const { user } = useAuth();
  const read = useServerFn(searchDriverDeliveries),
    act = useServerFn(saveDriverTripNote),
    upload = useServerFn(uploadDeliveryProof);
  const q = useQuery({
    queryKey: ["driver-customer-live", user?.id, customer.customer_code],
    queryFn: () => read({ data: { customerCode: customer.customer_code, includeCompleted: true } }),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  return (
    <div className="my-5 space-y-3">
      {customer.groups.map((snapshot: any) => {
        const g = q.data?.find((x) => x.batch_id === snapshot.batch_id) || snapshot;
        const scope = { customerCode: customer.customer_code, batchId: g.batch_id };
        const photo = async (file?: File) => {
          if (!file || busy) return;
          setBusy(true);
          setError("");
          let url = "";
          try {
            if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024)
              throw new Error("请选择25MB以内的照片");
            url = URL.createObjectURL(file);
            const img = new Image();
            img.src = url;
            await img.decode();
            const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("无法读取照片");
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            await upload({
              data: {
                ...scope,
                photoId: crypto.randomUUID(),
                image: canvas.toDataURL("image/jpeg", 0.85),
              },
            });
            setVersion((v) => v + 1);
            onMessage("照片已上传，后台派送详情可查看");
          } catch (e: any) {
            setError(e.message);
          } finally {
            URL.revokeObjectURL(url);
            setBusy(false);
          }
        };
        return (
          <section key={g.batch_id} className="rounded-xl border border-white/10 p-3">
            <h3 className="font-bold">{g.batch_name || g.batch_no}</h3>
            <p className="my-2 font-bold text-amber-300">
              客户余额 {money(g.wallet_balance_cad ?? snapshot.wallet_balance_cad)}
            </p>
            <p>
              运费 {money(g.total_cad)} · {g.payment_label}
            </p>
            <p className="my-2">
              计费重量 {g.chargeable_weight_kg ?? "待确认"} kg · 额外费用{" "}
              {money(g.extra_fee_cad ?? g.fee_cad)}
            </p>
            <button
              className={btn + " my-2 w-full text-left"}
              disabled={busy}
              onClick={() => {
                const note = window.prompt("结算备注", g.settlement_note || "");
                if (note == null) return;
                setBusy(true);
                void act({ data: { ...scope, tripId, note } })
                  .then(async () => {
                    await q.refetch();
                    onMessage("备注已保存");
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              结算备注：{g.settlement_note || "点击填写"}
            </button>
            <div className="flex flex-wrap gap-2">
              <label className={btn + " cursor-pointer"}>
                拍照上传
                <input
                  aria-label={"拍照 " + g.batch_no}
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={busy}
                  onChange={(e) => {
                    void photo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <label className={btn + " cursor-pointer"}>
                选择照片
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    void photo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <DeliveryBatchPhotos {...scope} version={version} />
          </section>
        );
      })}
      {busy && <p role="status">正在保存…</p>}
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      {q.isError && (
        <p className="text-amber-300">实时费用暂未读取，当前显示生成派送单时的资料。</p>
      )}
    </div>
  );
}
