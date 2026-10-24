import {driverRouteMapKey, driverStopProgress} from "@/lib/driver-route-addresses";
import { LoadingUnitList } from "@/components/LoadingUnitList";
import { driverTripPrintHtml } from "@/lib/driver-trip-print";
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
import { googlePlace, stopLabel } from "@/lib/delivery-sheet";
import { useAuth } from "@/lib/auth";
import { useDriverLanguage } from "@/lib/driver-language";
const btn = "min-h-11 rounded-xl border border-white/15 bg-slate-800 px-4 py-2 disabled:opacity-40";
const input =
  "min-h-12 w-full min-w-0 rounded-xl border border-white/15 bg-slate-900 p-3 text-white";
export function DriverWorkspace() {
  const { t: tr, date, money } = useDriverLanguage();
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
  const trips = useQuery({ queryKey: ["driver-trips", driverId], queryFn: () => list(), refetchInterval: 15000 });
  const origins = useQuery({ queryKey: ["driver-origins"], queryFn: () => originsFn() });
  const [loadingSelected,setLoadingSelected] = useState<Set<string>>(new Set());
  const runRequest=useRef(crypto.randomUUID());
  const selectLoading=(ids:string[],checked:boolean)=>{runRequest.current=crypto.randomUUID();setLoadingSelected(old=>{const n=new Set(old);ids.forEach(id=>checked?n.add(id):n.delete(id));return n;});};
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
    [deliveryCard, setDeliveryCard] = useState(false);
  const lock = useRef(false),
    newId = useRef<string | null>(null);
  const detail = useQuery({
    queryKey: ["driver-trip", driverId, tripId],
    queryFn: () => read({ data: { tripId } }),
    enabled: !!tripId,
    refetchInterval: 15000,
  });
  const readCustomer = useServerFn(searchDriverDeliveries);
  const liveCustomer = useQuery({
    queryKey: ["driver-customer-live", driverId, customer?.customer_code],
    queryFn: () =>
      readCustomer({ data: { customerCode: customer.customer_code, includeCompleted: true } }),
    enabled: page === "customer" && !!customer?.customer_code,
    refetchInterval: 15000,
  });
  const customerAddress = detail.data?.route?.plans?.flatMap((p: any) => p.stops.flatMap((s: any) => s.customers))
    .find((c: any) => c.customer_code === customer?.customer_code && c.ids?.some((id: string) => customer?.ids?.includes(id)))?.address ?? customer?.address;
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
      setError(e.message || tr("操作失败"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const add = async (value: string) => {
    if (!tripId) throw new Error(tr("请先新建或选择上车趟次"));
    if (lock.current) throw new Error(tr("正在保存上一件，请稍后重扫"));
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await scan({ data: { tripId, code: value.trim() } });
      setMessage(`${r.duplicate ? tr("已上车，原序号") : tr("上车成功，序号")} ${r.sequence}`);
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
      setTripId(t.id);setLoadingSelected(new Set());
      setPage("loading");
      setExpanded((s) => new Set([...s, t.id]));
      setMessage(tr("新一趟从 1 开始编号"));
      await trips.refetch();
    });
  const printTrip = (t: any) => {
    if (lock.current) return;
    const popup = window.open('', '_blank');
    if (!popup) { setError(tr('请允许弹出窗口后重试')); return; }
    popup.opener = null;
    popup.document.body.textContent = tr('正在准备打印…');
    void run(async () => {
      try {
        const current = await read({ data: { tripId: t.id } });
        if (current.route_revision !== current.revision) throw new Error(tr('上车清单已变化，请重新生成线路'));
        const images = maps[driverRouteMapKey(current)]?.length === current.route?.plans?.length && maps[driverRouteMapKey(current)]?.every(Boolean)
          ? maps[driverRouteMapKey(current)] : await readMaps({ data: { tripId: t.id } });
        setMaps(old => ({ ...old, [driverRouteMapKey(current)]: images }));
        const html = driverTripPrintHtml(current, images, tr, date(current.created_at), showDone);
        if (popup.closed) return;
        popup.document.open(); popup.document.write(html); popup.document.close();
      } catch (error) { popup.close(); throw error; }
    });
  };
  const deleteEmpty = async (t: any) => {
    if (lock.current || !window.confirm(tr("确认删除这趟空派送清单？删除后无法恢复。"))) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await removeEmpty({ data: { tripId: t.id } });
      if (tripId === t.id) {
        setTripId("");
        setSelected(new Set());
        setCustomer(null);
      }
      setExpanded((old) => {
        const next = new Set(old);
        next.delete(t.id);
        return next;
      });
      setMaps((old) => {
        const next = { ...old };
        delete next[t.id];
        return next;
      });
      setMessage(tr("空派送趟已删除"));
      await trips.refetch();
    } catch (e: any) {
      setError(e.message || tr("删除失败"));
      await trips.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const complete = (t: any) => t.total > 0 && t.completed === t.total;
  const matchesCustomer = (c: any) => !filter.trim() || String(c.customer_code || '').includes(filter.trim());
  const visibleCustomer = (t: any, c: any) => matchesCustomer(c) &&
    (showDone || !c.ids?.length || c.ids.some((id: string) => !t.dispatched_ids?.includes(id)));
  const candidates = (trips.data || [])
    .filter((t) => page === "loading" ? !t.loading_trip_id : page !== "routes" || t.loading_trip_id || t.generated_at)

    .filter(
      (t) =>
        page !== "routes" || !filter.trim() ||
        t.route?.plans?.some((p: any) => p.stops.some((s: any) => s.customers.some(matchesCustomer))),
    );
  const shown = candidates.filter((t) => showDone || !complete(t));
  const units: any[] = detail.data?.items || [];
  // Match driver_load_unit: gaps and hidden delivered parcels still reserve their sequence.
  const nextLoadingSequence = units.reduce((max, item) => Math.max(max, item.sequence ?? 0), 0) + 1;
  const customerUnits = units
    .filter(
      (x) =>
        x.unit?.customer_code === customer?.customer_code && customer?.ids.includes(x.queue_id) &&
        (showDone || x.unit?.status !== "dispatched"),
    )
    .sort(
      (a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER),
    );
  const toggle = (id: string) =>
    setExpanded((old) => {
      const n = new Set(old);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const openTrip = async (t: any) => {
    setTripId(t.id);setLoadingSelected(new Set());
    setLoadingSelected(new Set());
    if (page === "loading") setExpanded(old => old.has(t.id) ? new Set() : new Set([t.id]));
    else toggle(t.id);
    if (page === "routes" && !maps[driverRouteMapKey(t)] && !expanded.has(t.id) && t.route_revision === t.revision)
      await run(async () => {
        const m = await readMaps({ data: { tripId: t.id } });
        setMaps((old) => ({ ...old, [driverRouteMapKey(t)]: m }));
      });
  };
  const openCustomer = (t: any, c: any) => {
    setTripId(t.id);setLoadingSelected(new Set());
    setCustomer(c);
    setSelected(new Set());
    setFilter(c.customer_code);
    setPage("customer");
  };
  return (
    <section className="pb-28">
      {page !== "home" && (
        <button
          className="mb-4 min-h-11 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
          onClick={() => {
            setPage(page === "customer" ? "routes" : "home");
            setFilter("");
            setError("");
          }}
        >
          ‹ {page === "customer" ? tr("返回派送线路") : tr("返回主页面")}
        </button>
      )}
      {page === "home" ? (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">{tr("司机工作台")}</h2>
          <button
            className={btn + " w-full p-6 text-left"}
            onClick={() => {
              setPage("loading");
              setShowDone(false);
            }}
          >
            ▣ <strong className="text-xl">{tr("货物上车")}</strong>
            <p className="mt-2 text-slate-400">{tr("连续扫码 · 按上车顺序编号 · 生成线路")}</p>
          </button>
          <button
            className={btn + " w-full p-6 text-left"}
            onClick={() => {
              setPage("routes");
              setShowDone(false);
            }}
          >
            ➜ <strong className="text-xl">{tr("司机派送")}</strong>
            <p className="mt-2 text-slate-400">{tr("查看已生成清单 · 找货派送 · 拍照")}</p>
          </button>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">
            {page === "loading" ? tr("货物上车") : tr("司机派送")}
          </h2>
          {page === "loading" && (
            <button
              type="button"
              disabled={busy}
              className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
              onClick={() => void make()}
            >
              + {tr("新建上车趟次")}
            </button>
          )}
        </div>
      )}
      {(page === "routes" || page === "loading") && (
        <>
          {page === "routes" && (
          <input
            className={input + " mb-3"}
            aria-label={tr("按客户号筛选")}
            placeholder={tr("输入客户号筛选下方列表")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          )}
          <label className="mb-3 flex min-h-11 items-center gap-2 text-slate-200">
            <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            {tr("显示全部（含已派送）")}
          </label>
          {trips.isLoading && <p>{tr("正在读取趟次…")}</p>}
          {trips.isError && <p role="alert">{tr(trips.error.message)}</p>}
          {!trips.isLoading && !shown.length && (
            <p className="p-4 text-slate-400">
              {tr("暂无待派送趟次，勾选“显示全部”查看历史清单。")}
            </p>
          )}
          {shown.map((t, tripIndex) => (
            <article key={t.id} className={"mb-4 overflow-hidden rounded-xl border " + (tripIndex % 2 === 0 ? "border-slate-500/50 bg-slate-900/50" : "border-sky-500/40 bg-sky-950/30")}>
              <button
                className={"w-full p-4 text-left " + (tripIndex % 2 === 0 ? "bg-slate-800" : "bg-sky-900")}
                aria-expanded={expanded.has(t.id)}
                onClick={() => void openTrip(t)}
              >
                <strong>
                  {expanded.has(t.id) ? "▼" : "▶"} {date(t.created_at)} · {t.driver_name}
                </strong>
                <p className="mt-2 text-sm text-emerald-300">
                  {tr("已派送 {0} / 共 {1} 个派送单位", t.completed, t.total)}
                </p>
                {page === "routes" && <p className="mt-2 text-sm font-semibold text-amber-300">
                  {tr("未派送站点 {0} / 共 {1} 站", driverStopProgress(t).remaining, driverStopProgress(t).total)}
                </p>}
              </button>
              {t.total === 0 && (
                <div className="px-4 pb-3">
                  <button
                    disabled={busy}
                    className={btn + " text-red-300"}
                    onClick={() => void deleteEmpty(t)}
                  >
                    {tr("删除空趟")}
                  </button>
                </div>
              )}
              {expanded.has(t.id) && (
                <div className="space-y-3 p-4">
                  {page === "loading" ? (
                    detail.isLoading || detail.data?.id !== t.id ? <p>{tr("读取中…")}</p> : (
            <div className="space-y-3">
              <select
                aria-label={tr("司机起始点")}
                className={input + " mt-4"}
                value={originId}
                onChange={(e) => setOriginId(e.target.value)}
              >
                <option value="">{tr("选择司机起始点")}</option>
                {origins.data
                  ?.filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.address}
                    </option>
                  ))}
              </select>
              <button
                disabled={busy || !loadingSelected.size || !originId}
                className={btn + " mt-3 w-full bg-blue-600"}
                onClick={() =>
                  void run(async () => {
                    const r = await generate({ data: { tripId, originId, ids:[...loadingSelected],runId:runRequest.current } });
                    setLoadingSelected(new Set());runRequest.current=crypto.randomUUID();
                    setMaps((old) => ({ ...old, [driverRouteMapKey(r)]: r.maps }));
                    await refresh();
                    setPage("routes");
                    setExpanded(new Set([r.id]));
                    setTripId(r.id);
                    setFilter("");
                  })
                }
              >
                {tr("生成司机派送趟")}
              </button>
              <p className="mt-2 text-xs text-slate-400">
                {tr("每张最多 21 个地点，沿用后台的 Google 月限额。新增包裹后需重新生成。")}
              </p>
              <p className="font-semibold">
                {tr("当前趟次：")}
                {detail.data
                  ? `${date(detail.data.created_at)} · ${detail.data.driver_name}`
                  : tr("读取中…")}
              </p>
              <p className="my-3 text-amber-300">
                {tr("已上车 {0} 件 · 下一件 {1} 号", units.length, nextLoadingSequence)}
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(code).catch(() => {});
                }}
              >
                <input
                  aria-label={tr("上车条码")}
                  className={input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={tr("扫描或输入箱号 / 运单号 / 订单号 / 国内单号")}
                />
                <button disabled={busy || !code.trim()} className={btn}>
                  {tr("加入")}
                </button>
              </form>
              <CameraScanButton continuous onScan={add} />
              {message && (
                <p role="status" className="my-3 text-emerald-300">
                  {tr(message)}
                </p>
              )}

              <div className="mt-3"><LoadingUnitList showAll={showDone} items={units} selected={loadingSelected} onSelect={selectLoading}/></div>
            </div>
                    )
                  ) : (
                    <>
                      <button className={btn + " bg-blue-600"} disabled={busy || !t.route?.plans?.length || t.route_revision !== t.revision} onClick={() => printTrip(t)}>
                        {tr("打印地图和列表")}
                      </button>
                      {t.route_revision !== t.revision && (
                        <p className="text-amber-300">
                          {tr("上车清单已变化，请回到货物上车重新生成线路。")}
                        </p>
                      )}
                      {t.route?.plans?.map((plan: any, index: number) => plan.stops.some((stop: any) => stop.customers.some((c: any) => visibleCustomer(t, c))) && (
                        <div key={index} className="space-y-3">
                          {plan.stops.map((stop: any, i: number) => stop.customers.some((c: any) => visibleCustomer(t, c)) && (
                            <div key={i} className="rounded-xl border border-white/15 p-3">
                              <p className="text-sm text-amber-300">
                                {tr("站点")} {stopLabel(i)}
                              </p>
                              {stop.customers.filter((c: any) => visibleCustomer(t, c)).map((c: any) => (
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
                                    setMessage(tr("地址已复制"));
                                  })
                                }
                              >
                                {tr("复制地址")}
                              </button>
                              <a className={btn + " ml-2 inline-flex items-center text-blue-300"} href={'https://www.google.com/search?q=' + encodeURIComponent(stop.address)} target="_blank" rel="noopener noreferrer">
                                {tr("Google搜索")} ↗
                              </a>
                            </div>
                          ))}
                          {maps[driverRouteMapKey(t)]?.[index] ? (
                            <img
                              src={maps[driverRouteMapKey(t)][index]!}
                              alt={tr("Google 派送路线地图")}
                              className="w-full rounded-xl"
                            />
                          ) : (
                            <button
                              disabled={busy || t.route_revision !== t.revision}
                              className={btn}
                              onClick={() =>
                                void run(async () => {
                                  const m = await readMaps({ data: { tripId: t.id } });
                                  setMaps((old) => ({ ...old, [driverRouteMapKey(t)]: m }));
                                })
                              }
                            >
                              {tr("加载地图")}
                            </button>
                          )}
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
              } else setError(tr("此趟没有该客户"));
            }}
          >
            <input
              aria-label={tr("客户号")}
              className={input}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={tr("客户号")}
            />
            <button className={btn}>{tr("搜索")}</button>
          </form>
          <label className="mb-3 flex min-h-11 items-center gap-2 text-slate-200">
            <input type="checkbox" className="h-5 w-5 accent-blue-500" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            {tr("显示全部（含已派送）")}
          </label>
          {customerUnits.length > 0 && <div className="mb-4 rounded-xl bg-slate-800 p-4">
            <strong className="text-xl">
              {customer.customer_code} · {customer.name}
            </strong>
            <p className="my-2 font-bold">{customerAddress}</p>
            {customerAddress && <a className={btn + " mb-2 inline-flex items-center text-blue-300"} href={googlePlace(customerAddress)} target="_blank" rel="noopener noreferrer">{tr("Google地图搜索")} ↗</a>}
            <a
              className="text-blue-300"
              href={"tel:" + String(customer.phone || "").replace(/[^+\d]/g, "")}
            >
              {customer.phone}
            </a>
          </div>}
          <CameraScanButton
            continuous
            onScan={(value) => {
              const row = customerUnits.find((x) => x.unit.code === value);
              if (!row) throw new Error(tr("此条码不属于当前客户派送单位"));
              if (row.unit.status !== "pending") throw new Error(tr("此单位已经派送或取消"));
              setSelected((s) => new Set([...s, row.queue_id]));
            }}
          />
          <table className="mt-4 w-full table-fixed text-xs">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label={tr("勾选全部待派送单位")}
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
                <th className="w-[40%] p-2 text-left">{tr("批次")}</th>
                <th className="p-2 text-left">{tr("箱号 / 运单号 / 托盘号")}</th>
              </tr>
            </thead>
            <tbody>
              {customerUnits.map((x) => (
                <tr key={x.id} className="border-t border-white/10 align-top">
                  <td className="py-4">
                    <input
                      aria-label={tr("勾选 ") + x.unit.code}
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
                      {tr(groupFor(x.unit.source_batch_id)?.payment_label || "")}
                    </p>
                    <p className="mt-1 text-slate-400">
                      {tr("计费")}
                      {groupFor(x.unit.source_batch_id)?.chargeable_weight_kg ?? tr("待确认")} kg
                    </p>
                  </td>
                  <td className="break-all p-2">
                    {x.sequence != null && (
                      <div className="mb-2 inline-flex items-center gap-1 rounded-lg bg-amber-300 px-2 py-1 text-slate-950">
                        {tr("上车")}
                        <b className="text-2xl">{x.sequence}</b>
                        {tr("号")}
                      </div>
                    )}
                    <p>
                      {x.unit.kind === "carton"
                        ? tr("客户箱")
                        : x.unit.kind === "pallet"
                          ? tr("客户托盘")
                          : tr("独立运单")}
                    </p>
                    <p>{x.unit.code}</p>
                    <p className="mt-2 text-slate-200">{tr("体积重")}：{x.volumetric_weight_kg == null ? tr("未记录") : `${Number(x.volumetric_weight_kg.toFixed(3))} kg`}</p>
                    <p className="mt-2 text-amber-200">
                      {tr("结算备注：")}
                      {groupFor(x.unit.source_batch_id)?.settlement_note || tr("未填写")}
                    </p>
                    <p className="mt-2 text-emerald-300">
                      {x.unit.status === "dispatched"
                        ? tr("已派送")
                        : x.unit.status === "cancelled"
                          ? tr("已取消")
                          : tr("待派送")}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl border-t border-white/10 bg-slate-900 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <p className="mb-2 text-sm">{tr("已选")} {selected.size} / {customerUnits.length} {tr("个单位")}</p>
            <div className="flex gap-3">
              <button className={btn} onClick={() => setDeliveryCard(true)}>{tr("拍照")}</button>
              <button className="min-h-14 flex-1 rounded-xl bg-orange-500 px-5 py-3 text-xl font-bold text-white shadow-lg shadow-orange-500/25 hover:bg-orange-400 disabled:opacity-40" disabled={busy || !selected.size} onClick={() => setDeliveryCard(true)}>{tr("派送（{0}）", selected.size)}</button>
            </div>
          </div>
          {deliveryCard && <div role="dialog" aria-modal="true" aria-label={tr("派送确认")} className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-3">
            <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-4 shadow-2xl">
              <h2 className="text-xl font-bold">{tr("派送确认")} · {customer.customer_code}</h2>
              <CustomerTools key={tripId + ':' + customer.customer_code} tripId={tripId} customer={customer} onMessage={setMessage} selectedCount={selected.size} onClose={() => setDeliveryCard(false)} onComplete={async () => {
                await dispatch({ data: { tripId, ids: [...selected] } });
                setSelected(new Set()); setDeliveryCard(false);
                setMessage(tr("已完成派送，可继续补传照片")); await refresh();
              }} />
            </div>
          </div>}
        </>
      )}
      {busy && (
        <p role="status" className="my-4 animate-pulse text-blue-300">
          {tr("正在处理，请勿重复操作…")}
        </p>
      )}
      {message && page !== "loading" && (
        <p role="status" className="my-3 text-emerald-300">
          {tr(message)}
        </p>
      )}
      {error && (
        <p role="alert" className="my-4 text-rose-300">
          {tr(error)}
        </p>
      )}
      {detail.isError && <p role="alert">{tr(detail.error.message)}</p>}
    </section>
  );
}

function CustomerTools({
  tripId,
  customer,
  onMessage,
  selectedCount,
  onComplete,
  onClose,
}: {
  tripId: string;
  customer: any;
  onMessage: (s: string) => void;
  selectedCount: number;
  onComplete: () => Promise<void>;
  onClose: () => void;
}) {
  const { t: tr, money } = useDriverLanguage();
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
  const [notes, setNotes] = useState<Record<string, string>>({});
  const saving = useRef(false);
  const finish = async (complete: boolean) => {
    if (saving.current || busy) return;
    if (complete && !window.confirm(tr("确认派送 {0} 个单位？运单将完成，并记录已派送及晚30秒的已完成轨迹。", selectedCount))) return;
    saving.current = true; setBusy(true); setError("");
    try {
      for (const [batchId, note] of Object.entries(notes)) await act({ data: { tripId, customerCode: customer.customer_code, batchId, note } });
      await q.refetch();
      if (complete) await onComplete(); else onMessage(tr("备注已保存"));
    } catch (e: any) { setError(e.message || tr("操作失败")); }
    finally { saving.current = false; setBusy(false); }
  };
  return (
    <div className="my-5 space-y-3">
      {customer.groups.map((snapshot: any) => {
        const g = q.data?.find((x) => x.batch_id === snapshot.batch_id) || snapshot;
        const scope = { customerCode: customer.customer_code, batchId: g.batch_id };
        const photo = async (file?: File) => {
          if (!file || busy || saving.current) return;
          saving.current = true;
          setBusy(true);
          setError("");
          let url = "";
          try {
            if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024)
              throw new Error(tr("请选择25MB以内的照片"));
            url = URL.createObjectURL(file);
            const img = new Image();
            img.src = url;
            await img.decode();
            const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error(tr("无法读取照片"));
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
            onMessage(tr("照片已上传，后台派送详情可查看"));
          } catch (e: any) {
            setError(e.message);
          } finally {
            URL.revokeObjectURL(url);
            saving.current = false;
            setBusy(false);
          }
        };
        return (
          <section key={g.batch_id} className="rounded-xl border border-white/10 p-3">
            <h3 className="font-bold">{g.batch_name || g.batch_no}</h3>
            <p className="my-2 font-bold text-amber-300">
              {tr("客户余额")}
              {money(g.wallet_balance_cad ?? snapshot.wallet_balance_cad)}
            </p>
            <p>
              {tr("运费")}
              {money(g.total_cad)} · {tr(g.payment_label || "")}
            </p>
            <p className="my-2">
              {tr("计费重量")}
              {g.chargeable_weight_kg ?? tr("待确认")}
              {tr("kg · 额外费用")} {money(g.extra_fee_cad ?? g.fee_cad)}
            </p>
            <label className="my-3 block">
              <span className="mb-2 block font-semibold">{tr("结算备注")}</span>
              <textarea className={input + " min-h-24"} maxLength={2000} disabled={busy} value={notes[g.batch_id] ?? g.settlement_note ?? ""} onChange={e => setNotes(old => ({...old, [g.batch_id]: e.target.value}))} placeholder={tr("填写或修改结算备注")} />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className={btn + " cursor-pointer"}>
                {tr("拍照上传")}
                <input
                  aria-label={tr("拍照 ") + g.batch_no}
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
                {tr("选择照片")}
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
      <section className="rounded-xl border border-white/10 p-3">
        <h3 className="mb-2 font-bold">{tr("收款")}</h3>
        <div className="flex flex-wrap gap-2"><button disabled className={btn}>{tr("收款充值 · 待配置")}</button><button disabled className={btn}>{tr("收款付费 · 待配置")}</button></div>
      </section>
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-white/10 bg-slate-900 py-3">
        <button disabled={busy} className={btn} onClick={onClose}>{tr("关闭")}</button>
        <button disabled={busy || !Object.keys(notes).length} className={btn} onClick={() => void finish(false)}>{tr("保存备注")}</button>
        <button disabled={busy || !selectedCount} className="min-h-12 flex-1 rounded-xl bg-orange-500 px-4 py-3 text-lg font-bold text-white hover:bg-orange-400 disabled:opacity-40" onClick={() => void finish(true)}>{tr("完成派送（{0}）", selectedCount)}</button>
      </div>
      {busy && <p role="status">{tr("正在保存…")}</p>}
      {error && (
        <p role="alert" className="text-rose-300">
          {tr(error)}
        </p>
      )}
      {q.isError && (
        <p className="text-amber-300">{tr("实时费用暂未读取，当前显示生成派送单时的资料。")}</p>
      )}
    </div>
  );
}
