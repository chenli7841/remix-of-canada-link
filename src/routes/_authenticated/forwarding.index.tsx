import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useApp } from "@/lib/i18n";
import {
  Loader2,
  Phone,
  Package,
  ShieldCheck,
  ArrowRight,
  Warehouse,
  Route as RouteIcon,
  MapPin,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Plane,
  Ship,
  Truck,
  ChevronDown,
  Info,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/forwarding/")({
  head: () => ({
    meta: [
      { title: "申请集运 / Request Shipment — SinoCargo" },
      { name: "description", content: "Submit a consolidation request from China to Canada." },
    ],
  }),
  component: ForwardingPage,
});

const sb = supabase as any;

interface WarehouseRow {
  id: string;
  code: string;
  name_zh: string;
  name_en: string | null;
  address: string | null;
  business_hours: string | null;
  phone: string | null;
}
interface RouteRow {
  id: string;
  code: string;
  name_zh: string;
  name_en: string | null;
  shipping_method: string;
  destination_code: string | null;
  origin_warehouse_id: string | null;
  destination_warehouse_id: string | null;
  is_bidirectional: boolean;
  transit_days_min: number | null;
  transit_days_max: number | null;
  item_fields: string[] | null;
  item_field_required: Record<string, boolean> | null;
  visible_vip_levels: string[] | null;
  visible_customer_codes: string[] | null;
  blacklist_vip_levels: string[] | null;
  blacklist_customer_codes: string[] | null;
}
interface FreightRule {
  route_id: string;
  weight_mode: string;
  volumetric_divisor: number;
  unit_price_cad: number;
  min_charge_cad: number;
  clearance_fee_cad: number;
  unit_price_cny: number;
  min_charge_cny: number;
  extra_fee_cny: number;
  insurance_rate_pct: number;
}
interface AddressRow {
  id: string;
  recipient: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  destination_code: string | null;
}
interface DestinationRow {
  code: string;
  name_zh: string;
  name_en: string | null;
  country: string;
}
interface MyItemRow {
  id: string;
  sku: string | null;
  name: string;
  hs_code: string | null;
  declared_value_cad: number | null;
  inner_qty: number | null;
  material: string | null;
  origin: string | null;
  brand: string | null;
  weight_kg: number | null;
}

type ItemFieldKey =
  | "name"
  | "hscode"
  | "box_count"
  | "inner_qty"
  | "material"
  | "origin"
  | "unit_price"
  | "quantity"
  | "brand"
  | "length_cm"
  | "width_cm"
  | "height_cm"
  | "weight_kg";
interface ItemDraft {
  name: string;
  sku?: string;
  quantity?: number;
  unit_price_cad?: number;
  hscode?: string;
  box_count?: number;
  inner_qty?: number;
  material?: string;
  origin?: string;
  brand?: string;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  weight_kg?: number;
  locked?: boolean;
}
interface ParcelDraft {
  tracking_no: string;
  items: ItemDraft[];
}

// Shared with src/routes/_authenticated/account.tsx — key for handing off
// locked item drafts (and the warehouse they must ship from) when shipping straight from My Inventory.
const FORWARDING_PREFILL_KEY = "sc_forwarding_prefill";
const LOCKED_FIELDS = new Set<ItemFieldKey>(["name", "quantity", "box_count", "inner_qty"]);

interface ForwardingPrefill {
  warehouseId?: string;
  items?: ItemDraft[];
}
function readAndClearPrefill(): ForwardingPrefill | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(FORWARDING_PREFILL_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(FORWARDING_PREFILL_KEY);
  try {
    return JSON.parse(raw) as ForwardingPrefill;
  } catch {
    return null;
  }
}

const FIELD_META: Record<ItemFieldKey, { zh: string; en: string; type: "text" | "number"; w: string }> = {
  // `w`: full width on mobile so each field sits on its own row; the fixed
  // sizes only kick in at `sm:` where the row goes back to wrapping inline.
  name: {
    zh: "品名",
    en: "Item name",
    type: "text",
    w: "w-full sm:min-w-[140px] sm:w-auto sm:flex-1",
  },
  hscode: { zh: "HSCODE", en: "HS code", type: "text", w: "w-full sm:w-32" },
  box_count: { zh: "箱数/板数", en: "Boxes/Pal.", type: "number", w: "w-full sm:w-28" },
  inner_qty: { zh: "内件数/箱·板", en: "Pcs/box", type: "number", w: "w-full sm:w-36" },
  material: { zh: "材质", en: "Material", type: "text", w: "w-full sm:w-28" },
  origin: { zh: "产地", en: "Origin", type: "text", w: "w-full sm:w-24" },
  unit_price: { zh: "单价 CA$", en: "Unit CA$", type: "number", w: "w-full sm:w-28" },
  quantity: { zh: "数量", en: "Qty", type: "number", w: "w-full sm:w-24" },
  brand: { zh: "品牌", en: "Brand", type: "text", w: "w-full sm:w-28" },
  length_cm: { zh: "长 cm", en: "L cm", type: "number", w: "w-full sm:w-24" },
  width_cm: { zh: "宽 cm", en: "W cm", type: "number", w: "w-full sm:w-24" },
  height_cm: { zh: "高 cm", en: "H cm", type: "number", w: "w-full sm:w-24" },
  weight_kg: { zh: "重 kg", en: "kg", type: "number", w: "w-full sm:w-24" },
};

function newItem(): ItemDraft {
  return { name: "" };
}

// Desktop item-field layout: two fixed rows (name/hscode/brand/material/unit
// price, then box/inner qty/quantity), rendered as separate flex rows so the
// grouping holds regardless of container width — plain flex-wrap would just
// pack fields by available space, not by this intended grouping. Any other
// enabled fields (origin, dimensions, weight) fall into a trailing row.
const ROW1_FIELDS: ItemFieldKey[] = ["name", "hscode", "brand", "material", "unit_price"];
const ROW2_FIELDS: ItemFieldKey[] = ["box_count", "inner_qty", "quantity"];

function ForwardingPage() {
  const { user } = useAuth();
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const [phoneRow, setPhoneRow] = useState<string | null | undefined>(undefined);
  const [myVip, setMyVip] = useState<string | null>(null);
  const [myCustomerCode, setMyCustomerCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [rules, setRules] = useState<Record<string, FreightRule>>({});
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [destinations, setDestinations] = useState<DestinationRow[]>([]);

  const [prefill] = useState<ForwardingPrefill | null>(() => readAndClearPrefill());
  const [warehouseId, setWarehouseId] = useState<string>(prefill?.warehouseId ?? "");
  const [routeCode, setRouteCode] = useState<string>("");
  const [addressId, setAddressId] = useState<string>("");
  const [parcels, setParcels] = useState<ParcelDraft[]>(() =>
    prefill?.items && prefill.items.length > 0
      ? [{ tracking_no: "", items: prefill.items }]
      : [{ tracking_no: "", items: [newItem()] }],
  );
  const hasLockedItems = parcels.some((p) => p.items.some((it) => it.locked));
  const lockedWarehouseId = prefill?.warehouseId ?? null;
  const [insured, setInsured] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; waybills: number } | null>(null);

  // Whether the customer has any rows at all in their own "My Items" library —
  // used to tell "nothing matches this search" apart from "you haven't set up
  // any items yet" when the SKU search comes up empty.
  const [hasMyItems, setHasMyItems] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [p, w, r, fr, a, d, mi] = await Promise.all([
        sb.from("profiles").select("phone, vip_level, customer_code").eq("id", user.id).maybeSingle(),
        sb
          .from("warehouses")
          .select("id,code,name_zh,name_en,address,business_hours,phone,country,type")
          .eq("is_active", true)
          .order("sort_order"),
        sb
          .from("shipping_routes")
          .select(
            "id,code,name_zh,name_en,shipping_method,destination_code,origin_warehouse_id,destination_warehouse_id,is_bidirectional,transit_days_min,transit_days_max,item_fields,item_field_required,visible_vip_levels,visible_customer_codes,blacklist_vip_levels,blacklist_customer_codes",
          )
          .eq("is_active", true)
          .in("usage_scope", ["forwarding", "both"])
          .order("sort_order"),
        sb
          .from("freight_rules")
          .select(
            "route_id,weight_mode,volumetric_divisor,unit_price_cad,min_charge_cad,clearance_fee_cad,unit_price_cny,min_charge_cny,extra_fee_cny,insurance_rate_pct",
          )
          .eq("is_active", true),
        sb.from("addresses").select("*").order("is_default", { ascending: false }),
        sb.from("destinations").select("code,name_zh,name_en,country").eq("active", true).order("sort_order"),
        sb.from("my_items").select("id", { count: "exact", head: true }),
      ]);
      setPhoneRow(p.data?.phone ?? null);
      setMyVip(((p.data as any)?.vip_level as string) ?? null);
      setMyCustomerCode(((p.data as any)?.customer_code as string) ?? null);
      setHasMyItems((mi.count ?? 0) > 0);
      // Show all warehouses that any active route can ship FROM:
      // forward (origin_warehouse_id) and, for bidirectional routes, also the destination warehouse.
      const allRoutes = (r.data ?? []) as RouteRow[];
      const usableWhIds = new Set<string>();
      for (const rt of allRoutes) {
        if (rt.origin_warehouse_id) usableWhIds.add(rt.origin_warehouse_id);
        if (rt.is_bidirectional && rt.destination_warehouse_id) usableWhIds.add(rt.destination_warehouse_id);
      }
      const wAll = (w.data ?? []) as WarehouseRow[];
      const wlist = wAll.filter((x) => usableWhIds.has(x.id));
      setWarehouses(wlist.length > 0 ? wlist : wAll.filter((x: any) => x.type === "origin" || x.country === "CN"));
      setRoutes(allRoutes);
      const ruleMap: Record<string, FreightRule> = {};
      ((fr.data ?? []) as FreightRule[]).forEach((x) => {
        ruleMap[x.route_id] = x;
      });
      setRules(ruleMap);
      setAddresses((a.data ?? []) as AddressRow[]);
      setDestinations((d.data ?? []) as DestinationRow[]);
      const def = ((a.data ?? []) as AddressRow[]).find((x) => x.is_default) ?? (a.data ?? [])[0];
      if (def) setAddressId(def.id);
      setLoading(false);
    })();
  }, [user]);

  // 线路权限：指定可见，不向下兼容 —— 只有会员等级 / 客户号被精确列出（或线路未做限制）才可见；
  // 命中黑名单则一律不可见。
  const canSeeRoute = (r: RouteRow) => {
    const code = (myCustomerCode ?? "").trim().toUpperCase();
    const blackVip = r.blacklist_vip_levels ?? [];
    const blackCodes = (r.blacklist_customer_codes ?? []).map((x) => String(x).trim().toUpperCase());
    if (myVip && blackVip.includes(myVip)) return false;
    if (code && blackCodes.includes(code)) return false;
    const whiteVip = r.visible_vip_levels ?? [];
    const whiteCodes = (r.visible_customer_codes ?? []).map((x) => String(x).trim().toUpperCase());
    if (whiteVip.length === 0 && whiteCodes.length === 0) return true;
    if (code && whiteCodes.includes(code)) return true;
    return !!myVip && whiteVip.includes(myVip);
  };

  const availableRoutes = useMemo(() => {
    if (!warehouseId) return [];
    return routes.filter(
      (r) =>
        (r.origin_warehouse_id === warehouseId || (r.is_bidirectional && r.destination_warehouse_id === warehouseId)) &&
        canSeeRoute(r),
    );
  }, [routes, warehouseId, myVip, myCustomerCode]);

  useEffect(() => {
    setRouteCode("");
  }, [warehouseId]);

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId) ?? null;
  const selectedRoute = availableRoutes.find((r) => r.code === routeCode) ?? null;
  const selectedRule = selectedRoute ? rules[selectedRoute.id] : null;
  const selectedAddress = addresses.find((x) => x.id === addressId) ?? null;

  const updateParcel = (i: number, patch: Partial<ParcelDraft>) =>
    setParcels((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addParcel = () => setParcels((ps) => [...ps, { tracking_no: "", items: [newItem()] }]);
  const removeParcel = (i: number) => setParcels((ps) => ps.filter((_, idx) => idx !== i));
  const updateItem = (pi: number, ii: number, patch: Partial<ItemDraft>) =>
    setParcels((ps) =>
      ps.map((p, idx) =>
        idx === pi ? { ...p, items: p.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : p,
      ),
    );
  const addItem = (pi: number) => updateParcel(pi, { items: [...parcels[pi].items, newItem()] });
  const removeItem = (pi: number, ii: number) =>
    updateParcel(pi, { items: parcels[pi].items.filter((_, j) => j !== ii) });

  // Fuzzy search against the customer's own item library (My Items), matched
  // on SKU, name, or HS code — as they type, show a dropdown of rows whose
  // sku/name/hs_code contain the typed text; picking one auto-fills
  // name/HS code/unit price/inner qty. If the search comes up empty, tell
  // them apart: "nothing matches" vs. "you haven't added any items yet"
  // (in which case they need to go set that up first).
  const [skuActiveKey, setSkuActiveKey] = useState<string | null>(null);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuResults, setSkuResults] = useState<MyItemRow[]>([]);
  const skuDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchSku = (pi: number, ii: number, term: string) => {
    updateItem(pi, ii, { sku: term });
    const key = `${pi}-${ii}`;
    setSkuActiveKey(key);
    if (skuDebounce.current) clearTimeout(skuDebounce.current);
    const q = term.trim();
    if (!q) {
      setSkuResults([]);
      return;
    }
    skuDebounce.current = setTimeout(async () => {
      setSkuLoading(true);
      const { data, error } = await sb
        .from("my_items")
        .select("id,sku,name,hs_code,declared_value_cad,inner_qty,material,origin,brand,weight_kg")
        .or(`sku.ilike.%${q}%,name.ilike.%${q}%,hs_code.ilike.%${q}%`)
        .order("updated_at", { ascending: false })
        .limit(8);
      setSkuLoading(false);
      if (error) return;
      const rows = (data ?? []) as MyItemRow[];
      setSkuResults(rows);
      if (rows.length === 0) {
        if (hasMyItems === false) {
          toast.info(
            tr(
              "您还没有添加个人常用运输物品，请登录后在「我的物品」内添加",
              "You haven't added any frequently-used items yet — please add some under My Items.",
            ),
          );
        } else {
          toast.info(
            tr(`未找到匹配「${q}」的物品资料，请手动填写`, `No saved item matches "${q}" — please fill in manually`),
          );
        }
      }
    }, 350);
  };

  const pickSkuResult = (pi: number, ii: number, row: MyItemRow) => {
    updateItem(pi, ii, {
      sku: row.sku ?? "",
      name: row.name ?? "",
      hscode: row.hs_code ?? undefined,
      unit_price_cad: row.declared_value_cad ?? undefined,
      inner_qty: row.inner_qty ?? undefined,
      material: row.material ?? undefined,
      origin: row.origin ?? "China",
      brand: row.brand ?? undefined,
      weight_kg: row.weight_kg ?? undefined,
    });
    setSkuActiveKey(null);
    setSkuResults([]);
    toast.success(tr(`已自动带入「${row.name}」的资料`, `Auto-filled details for "${row.name}"`));
  };

  const submit = async () => {
    if (!user) return;
    if (!selectedWarehouse) return toast.error(tr("请选择仓库", "Choose warehouse"));
    if (!selectedRoute) return toast.error(tr("请选择线路", "Choose route"));
    if (!addressId) return toast.error(tr("请选择收件地址", "Pick shipping address"));
    const trackedParcels = parcels.filter((p) => !p.items.some((it) => it.locked));
    const nos = trackedParcels.map((p) => p.tracking_no.trim().replace(/\s+/g, "")).filter(Boolean);
    if (trackedParcels.length > 0) {
      if (nos.length === 0) return toast.error(tr("请至少填写一个国内单号", "Enter at least one tracking number"));
      if (new Set(nos).size !== nos.length) return toast.error(tr("国内单号有重复", "Duplicate tracking numbers"));
    }

    // required-field validation per route
    const reqMap = (selectedRoute.item_field_required ?? {}) as Record<string, boolean>;
    const reqKeys = Object.keys(reqMap).filter((k) => reqMap[k]);
    for (const p of parcels) {
      for (const it of p.items) {
        if (!it.name.trim()) continue;
        for (const k of reqKeys) {
          const valKey = k === "unit_price" ? "unit_price_cad" : k;
          const v = (it as any)[valKey];
          if (v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v))) {
            const meta = FIELD_META[k as ItemFieldKey];
            const fieldLabel = meta ? tr(meta.zh, meta.en) : k;
            return toast.error(
              tr(
                `物品「${it.name}」缺少必填项：${fieldLabel}`,
                `Item "${it.name}" is missing required field: ${fieldLabel}`,
              ),
            );
          }
        }
      }
    }

    setBusy(true);
    let created = 0;
    let totalWaybills = 0;
    for (const parcel of parcels) {
      const isLocked = parcel.items.some((it) => it.locked);
      const t = parcel.tracking_no.trim().replace(/\s+/g, "");
      if (!t && !isLocked) continue;
      const payload = {
        warehouse: selectedWarehouse.code,
        route_code: selectedRoute.code,
        address_id: addressId,
        domestic_tracking_no: t || null,
        note: [insured ? (lang === "zh" ? "[已购买保险]" : "[Insured]") : null, note].filter(Boolean).join(" ") || null,
        insured,
        items: parcel.items
          .filter((i) => i.name.trim())
          .map((i) => ({
            name: i.name.trim(),
            quantity: i.quantity ?? 1,
            unit_price_cad: i.unit_price_cad ?? 0,
            extras: {
              sku: i.sku?.trim() || null,
              hscode: i.hscode ?? null,
              // place_forwarding() auto-creates one waybill per box when extras.box_count > 0.
              // Items shipped from My Inventory already have real waybills in storage, so we
              // withhold box_count/inner_qty here — this submission should only create the
              // forwarding order, not spawn new waybills.
              box_count: i.locked ? null : (i.box_count ?? null),
              inner_qty: i.locked ? null : (i.inner_qty ?? null),
              // 库存发货标记：入库扫描页据此列出待入库的库存发货订单，并核对每个 SKU 的箱数。
              inv_box_count: i.locked ? (i.box_count ?? null) : null,
              material: i.material ?? null,
              origin: i.origin ?? null,
              brand: i.brand ?? null,
              length_cm: i.length_cm ?? null,
              width_cm: i.width_cm ?? null,
              height_cm: i.height_cm ?? null,
              weight_kg: i.weight_kg ?? null,
            },
          })),
      };
      let { data, error } = await sb.rpc("place_forwarding", { _payload: payload });
      const isStatementTimeout = error?.code === "57014" || /statement timeout/i.test(error?.message ?? "");
      // PostgreSQL statement_timeout aborts and rolls back the whole RPC, so one
      // bounded retry is safe. Do not retry unknown network failures because the
      // first request may have committed and a blind retry could duplicate a job.
      if (isStatementTimeout) {
        toast.info(tr("数据库繁忙，正在自动重试一次…", "Database busy; retrying once…"));
        await new Promise((resolve) => setTimeout(resolve, 800));
        const retry = await sb.rpc("place_forwarding", { _payload: payload });
        data = retry.data;
        error = retry.error;
      }
      if (error) {
        toast.error(`${t}: ${error.message}`);
        continue;
      }
      if (!data?.ok) {
        toast.error(`${t}: ${data?.reason ?? "failed"}`);
        continue;
      }
      created++;
      totalWaybills += Number(data?.waybills ?? 0);
    }
    setBusy(false);
    if (created > 0) setDone({ count: created, waybills: totalWaybills });
  };

  const resetForm = () => {
    setParcels([{ tracking_no: "", items: [newItem()] }]);
    setNote("");
    setDone(null);
  };

  if (loading)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
      </div>
    );

  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold">{tr("提交成功", "Request submitted")}</h1>
        <p className="mt-2 text-ink-soft">
          {tr(
            `已创建 ${done.count} 个集运订单，到仓后将通知您`,
            `Created ${done.count} forwarding order(s). We'll notify you on arrival.`,
          )}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={resetForm}
            className="inline-flex items-center gap-2 rounded-full bg-cta-gradient px-6 py-3 text-sm font-semibold text-cta-foreground shadow-elevated"
          >
            <Plus className="h-4 w-4" />
            {tr("再次创建", "Create another")}
          </button>
          <Link
            to="/account"
            search={{ tab: "myOrders" }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-6 py-3 text-sm font-medium"
          >
            {tr("查看我的订单", "View my orders")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (!phoneRow) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <section className="rounded-3xl border border-warning/40 bg-warning/5 p-6 text-center sm:p-8">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-warning/10 text-warning">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">
            {tr("请到个人中心完善发货信息", "Complete your shipping info in Account")}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {tr(
              "集运客户需先绑定手机号，每个节点都会通过短信通知您。",
              "Consolidation customers must link a phone first — we send SMS at every milestone.",
            )}
          </p>
          <Link
            to="/account"
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cta-gradient px-6 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110"
          >
            {tr("前往个人中心", "Go to Account")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-ink-soft">
          <Package className="h-3.5 w-3.5" />
          {tr("集运服务", "Consolidation")}
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">{tr("申请集运单", "Request a Shipment")}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          {tr(
            "依次选择仓库 → 线路 → 收件地址，再填写国内单号与内件。",
            "Step through warehouse → route → address, then add domestic tracking numbers & contents.",
          )}
        </p>
      </header>

      <div className="space-y-6">
        {/* 1. Warehouse */}
        <Step n={1} icon={<Warehouse className="h-4 w-4" />} title={tr("选择入库仓库", "Choose warehouse")}>
          {lockedWarehouseId && (
            <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs text-brand">
              <ShieldCheck className="h-3.5 w-3.5" />
              {tr("已根据库存货物所在仓库锁定，无法更改", "Locked to the warehouse your inventory items are stored in")}
            </div>
          )}
          {warehouses.length === 0 ? (
            <div className="text-xs text-ink-soft">{tr("后台暂未配置仓库", "No warehouses configured")}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {warehouses.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={!!lockedWarehouseId}
                  onClick={() => setWarehouseId(w.id)}
                  className={`rounded-xl border p-4 text-left transition ${warehouseId === w.id ? "border-brand bg-brand/5" : "border-border bg-surface hover:border-brand/40"} ${lockedWarehouseId ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <div className="font-semibold">{lang === "zh" ? w.name_zh : (w.name_en ?? w.name_zh)}</div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-soft">{w.code}</div>
                </button>
              ))}
            </div>
          )}
          {selectedWarehouse && (
            <div className="mt-3 space-y-2 rounded-xl bg-accent/40 p-3 text-xs">
              {selectedWarehouse.address && (
                <div>
                  <div className="mb-1 inline-flex items-center gap-1 font-semibold">
                    <MapPin className="h-3 w-3" />
                    {tr("仓库地址（请寄到此地址）", "Warehouse address (ship here)")}
                  </div>
                  <div>{selectedWarehouse.address}</div>
                </div>
              )}
              {selectedWarehouse.business_hours && (
                <div>
                  <div className="mb-1 inline-flex items-center gap-1 font-semibold">
                    <Clock className="h-3 w-3" />
                    {tr("营业时间", "Business hours")}
                  </div>
                  <div>{selectedWarehouse.business_hours}</div>
                </div>
              )}
              {selectedWarehouse.phone && (
                <div>
                  <div className="mb-1 inline-flex items-center gap-1 font-semibold">
                    <Phone className="h-3 w-3" />
                    {tr("联系电话", "Phone")}
                  </div>
                  <div>{selectedWarehouse.phone}</div>
                </div>
              )}
            </div>
          )}
        </Step>

        {/* 2. Route */}
        <Step
          n={2}
          icon={<RouteIcon className="h-4 w-4" />}
          title={tr("选择线路", "Choose route")}
          disabled={!warehouseId}
        >
          {!warehouseId ? (
            <div className="text-xs text-ink-soft">{tr("请先选择仓库", "Pick a warehouse first")}</div>
          ) : availableRoutes.length === 0 ? (
            <div className="text-xs text-ink-soft">{tr("该仓库暂无可用线路", "No routes available")}</div>
          ) : (
            <div className="grid gap-2">
              {availableRoutes.map((r) => {
                const Icon = r.shipping_method === "sea" ? Ship : r.shipping_method === "express" ? Truck : Plane;
                const eta = [r.transit_days_min, r.transit_days_max].filter(Boolean).join("-");
                const rule = rules[r.id];
                const isSel = routeCode === r.code;
                return (
                  <div key={r.code}>
                    <button
                      type="button"
                      onClick={() => setRouteCode(r.code)}
                      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${isSel ? "border-brand bg-brand/5" : "border-border bg-surface hover:border-brand/40"}`}
                    >
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{lang === "zh" ? r.name_zh : (r.name_en ?? r.name_zh)}</span>
                          {eta && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] text-ink-soft">
                              <Clock className="h-3 w-3" />
                              {eta} {tr("天", "d")}
                            </span>
                          )}
                          {rule && (
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                              CA$
                              {Number(rule.unit_price_cad || rule.unit_price_cny * 0.19).toFixed(2)}
                              /kg
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] font-mono text-ink-soft">
                          {r.code} · {r.shipping_method} · {r.destination_code ?? "—"}
                        </div>
                      </div>
                    </button>
                    {isSel && rule && (
                      <div className="mt-2 rounded-xl bg-accent/40 p-3 text-xs">
                        <div className="mb-1.5 inline-flex items-center gap-1 font-semibold">
                          <Info className="h-3 w-3" />
                          {tr("收费规则", "Pricing rules")}
                        </div>
                        <ul className="space-y-1 text-ink-soft">
                          <li>
                            {tr("单价", "Unit price")}:{" "}
                            <b className="text-foreground">
                              CA$
                              {Number(rule.unit_price_cad || rule.unit_price_cny * 0.19).toFixed(2)}
                              /kg
                            </b>
                          </li>
                          <li>
                            {tr("计费重量", "Chargeable weight")}:{" "}
                            {rule.weight_mode === "actual"
                              ? tr("实重", "actual")
                              : rule.weight_mode === "volumetric"
                                ? tr("体积重", "volumetric")
                                : tr("取实重/体积重较大者", "max(actual, volumetric)")}
                            （{tr("体积除数", "divisor")} {rule.volumetric_divisor}）
                          </li>
                          {Number(rule.min_charge_cad || rule.min_charge_cny * 0.19) > 0 && (
                            <li>
                              {tr("最低收费", "Min charge")}: CA$
                              {Number(rule.min_charge_cad || rule.min_charge_cny * 0.19).toFixed(2)}
                            </li>
                          )}
                          {Number(rule.clearance_fee_cad || rule.extra_fee_cny * 0.19) > 0 && (
                            <li>
                              {tr("清关费", "Clearance fee")}: CA$
                              {Number(rule.clearance_fee_cad || rule.extra_fee_cny * 0.19).toFixed(2)}
                            </li>
                          )}
                          {Number(rule.insurance_rate_pct) > 0 && (
                            <li>
                              {tr("保险费率", "Insurance rate")}: {Number(rule.insurance_rate_pct).toFixed(2)}%
                            </li>
                          )}
                          {(r.transit_days_min || r.transit_days_max) && (
                            <li>
                              {tr("预计到货时间", "Estimated transit")}:{" "}
                              {[r.transit_days_min, r.transit_days_max].filter(Boolean).join("-")} {tr("天", "days")}
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Step>

        {/* 3. Address */}
        <Step n={3} icon={<MapPin className="h-4 w-4" />} title={tr("收件地址", "Shipping address")}>
          {addresses.length === 0 ? (
            <Link
              to="/account"
              search={{ tab: "addresses" }}
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-border px-4 py-3 text-sm text-ink-soft hover:border-brand"
            >
              {tr("还没有地址，去添加 →", "No address yet — add one →")}
            </Link>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                  className="h-10 flex-1 min-w-[200px] rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                >
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.recipient} · {a.city}, {a.province} {a.postal_code}
                      {a.is_default ? tr("（默认）", " (default)") : ""}
                    </option>
                  ))}
                </select>
                {selectedAddress &&
                  (() => {
                    const d = destinations.find((x) => x.code === selectedAddress.destination_code);
                    const txt = d
                      ? `${lang === "zh" ? d.name_zh : (d.name_en ?? d.name_zh)} (${d.code})`
                      : (selectedAddress.destination_code ?? tr("未设置目的地", "No destination"));
                    return (
                      <div className="inline-flex items-center gap-1 text-sm">
                        <MapPin className="h-3.5 w-3.5 text-brand" />
                        <span className="text-ink-soft">{tr("目的地", "Destination")}:</span>
                        <span className="font-bold text-foreground">{txt}</span>
                      </div>
                    );
                  })()}
              </div>
              {selectedAddress && (
                <div className="rounded-xl border border-border bg-surface p-3 text-xs text-ink-soft">
                  <div className="font-semibold text-foreground">
                    {selectedAddress.recipient}{" "}
                    <span className="font-normal text-ink-soft">{selectedAddress.phone}</span>
                  </div>
                  <div className="mt-1">
                    {selectedAddress.line1}
                    {selectedAddress.line2 ? `, ${selectedAddress.line2}` : ""}, {selectedAddress.city},{" "}
                    {selectedAddress.province} {selectedAddress.postal_code} · {selectedAddress.country}
                  </div>
                </div>
              )}
              <Link
                to="/account"
                search={{ tab: "addresses" }}
                className="inline-flex text-xs text-brand hover:underline"
              >
                {tr("管理收件地址 →", "Manage addresses →")}
              </Link>
            </div>
          )}
        </Step>

        {/* 4. Parcels */}
        <Step
          n={4}
          icon={<Package className="h-4 w-4" />}
          title={tr("国内单号 / 内件清单", "Domestic tracking & items")}
        >
          {(() => {
            const defaultFields: ItemFieldKey[] = ["name", "quantity", "unit_price"];
            const fields = (
              selectedRoute?.item_fields && selectedRoute.item_fields.length > 0
                ? selectedRoute.item_fields
                : defaultFields
            ) as ItemFieldKey[];
            const fieldSet = new Set<ItemFieldKey>(fields);
            if (hasLockedItems) {
              fieldSet.add("name");
              fieldSet.add("quantity");
              fieldSet.add("box_count");
              fieldSet.add("inner_qty");
            }
            const orderedFields: ItemFieldKey[] = [
              "name",
              "hscode",
              "box_count",
              "inner_qty",
              "material",
              "origin",
              "brand",
              "quantity",
              "unit_price",
              "length_cm",
              "width_cm",
              "height_cm",
              "weight_kg",
            ].filter((f) => fieldSet.has(f as ItemFieldKey)) as ItemFieldKey[];
            const fieldRows: ItemFieldKey[][] = [
              ROW1_FIELDS.filter((f) => fieldSet.has(f)),
              ROW2_FIELDS.filter((f) => fieldSet.has(f)),
              orderedFields.filter((f) => !ROW1_FIELDS.includes(f) && !ROW2_FIELDS.includes(f)),
            ].filter((row) => row.length > 0);
            const reqMap = (selectedRoute?.item_field_required ?? {}) as Record<string, boolean>;
            const isReq = (f: ItemFieldKey) => f === "name" || !!reqMap[f];
            return (
              <>
                {hasLockedItems && (
                  <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs text-ink-soft">
                    <div className="mb-1 inline-flex items-center gap-1.5 font-bold text-brand">
                      <Package className="h-3.5 w-3.5" />
                      {tr("已从「我的库存」带入", "Brought in from My Inventory")}
                    </div>
                    {tr(
                      "品名、数量、箱数、内件数已按库存自动填写并锁定，无法修改；请填写国内单号并确认其他信息。",
                      "Item name, quantity, box count and units/box are auto-filled and locked from your inventory. Please add the domestic tracking number and confirm the rest.",
                    )}
                  </div>
                )}
                {!selectedRoute && (
                  <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs text-ink-soft">
                    <div className="mb-1 inline-flex items-center gap-1.5 font-bold text-brand">
                      <Info className="h-3.5 w-3.5" />
                      {tr("填写说明", "How to fill")}
                    </div>
                    {tr(
                      "提示：选择线路后，每个空格内会显示该项目的填写说明（占位文字）。",
                      "Tip: pick a route to reveal per-field guidance as placeholder text inside each input.",
                    )}
                  </div>
                )}

                <div className="space-y-4">
                  {parcels.map((p, pi) => {
                    const parcelLocked = p.items.some((it) => it.locked);
                    return (
                      <div key={pi} className="rounded-xl border border-border bg-surface p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-xs font-semibold text-ink-soft">#{pi + 1}</span>
                          {parcelLocked ? (
                            <span className="flex-1 text-xs text-ink-soft">
                              {tr(
                                "库存发货 · 无需国内单号",
                                "Shipped from inventory — no domestic tracking number needed",
                              )}
                            </span>
                          ) : (
                            <input
                              value={p.tracking_no}
                              onChange={(e) => updateParcel(pi, { tracking_no: e.target.value })}
                              placeholder={tr("国内快递单号", "Domestic tracking no.")}
                              className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                            />
                          )}
                          {parcels.length > 1 && !parcelLocked && (
                            <button onClick={() => removeParcel(pi)} className="text-rose-400 hover:text-rose-300">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <div className="space-y-2">
                          {p.items.map((it, ii) => (
                            <div
                              key={ii}
                              className="space-y-2 rounded-lg border border-border/60 p-2 sm:border-0 sm:p-0"
                            >
                              {(it.locked || (p.items.length > 1 && !it.locked)) && (
                                <div className="flex items-center justify-between gap-2">
                                  {it.locked ? (
                                    <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[9px] font-semibold text-brand">
                                      {tr("已锁定", "Locked")}
                                    </span>
                                  ) : (
                                    <span />
                                  )}
                                  {p.items.length > 1 && !it.locked && (
                                    <button
                                      onClick={() => removeItem(pi, ii)}
                                      className="text-rose-400 hover:text-rose-300"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                              {!it.locked && (
                                <div className="relative flex items-center gap-2">
                                  <input
                                    value={it.sku ?? ""}
                                    onChange={(e) => searchSku(pi, ii, e.target.value)}
                                    onFocus={() => {
                                      if ((it.sku ?? "").trim()) searchSku(pi, ii, it.sku ?? "");
                                    }}
                                    onBlur={() =>
                                      setTimeout(() => setSkuActiveKey((k) => (k === `${pi}-${ii}` ? null : k)), 150)
                                    }
                                    placeholder={tr(
                                      "SKU / 品名 / HSCODE（选填，模糊搜索自动带出资料）",
                                      "SKU / name / HS code (optional — fuzzy search auto-fills details)",
                                    )}
                                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand sm:w-56"
                                  />
                                  {skuActiveKey === `${pi}-${ii}` && skuLoading && (
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-soft" />
                                  )}
                                  {skuActiveKey === `${pi}-${ii}` && !skuLoading && skuResults.length > 0 && (
                                    <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full min-w-[220px] overflow-auto rounded-md border border-border bg-surface shadow-elevated sm:w-56">
                                      {skuResults.map((row) => (
                                        <button
                                          key={row.id}
                                          type="button"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => pickSkuResult(pi, ii, row)}
                                          className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-accent"
                                        >
                                          {row.sku && (
                                            <span className="font-mono font-semibold text-brand">{row.sku}</span>
                                          )}{" "}
                                          <span className="text-ink-soft">
                                            {row.sku ? "· " : ""}
                                            {row.name}
                                            {row.hs_code ? ` · ${row.hs_code}` : ""}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              {fieldRows.map((rowFields, ri) => (
                                <div key={ri} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                  {rowFields.map((f) => {
                                    const meta = FIELD_META[f];
                                    const valKey = f === "unit_price" ? "unit_price_cad" : f;
                                    const v = (it as any)[valKey];
                                    const isLocked = !!it.locked && LOCKED_FIELDS.has(f);
                                    const onChange = (raw: string) => {
                                      let val: any = raw;
                                      if (meta.type === "number") val = raw === "" ? undefined : Number(raw) || 0;
                                      updateItem(pi, ii, { [valKey]: val } as any);
                                    };
                                    return (
                                      // A native placeholder disappears the moment the field has a
                                      // value (typed, or pre-filled/locked from inventory) — which is
                                      // exactly when a bare number like "3" or "60" most needs its
                                      // label. So the field name lives as a small fixed tag pinned
                                      // inside the box instead, which stays visible either way.
                                      <div key={f} className={`relative ${meta.w}`}>
                                        <span className="pointer-events-none absolute left-2 top-1 text-[8px] font-semibold uppercase tracking-wide text-ink-soft/80">
                                          {tr(meta.zh, meta.en)}
                                          {isReq(f) && <span className="text-rose-500"> *</span>}
                                        </span>
                                        <input
                                          type={meta.type}
                                          min={meta.type === "number" ? 0 : undefined}
                                          step={f === "unit_price" ? "0.01" : undefined}
                                          value={v ?? (meta.type === "number" ? "" : "")}
                                          onChange={(e) => onChange(e.target.value)}
                                          disabled={isLocked}
                                          className={`h-11 w-full rounded-md border border-border px-2 pb-1 pt-4 text-xs outline-none focus:border-brand ${isLocked ? "cursor-not-allowed bg-accent/60 text-ink-soft" : "bg-background"}`}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          ))}
                          {!parcelLocked && (
                            <button
                              onClick={() => addItem(pi)}
                              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                            >
                              <Plus className="h-3 w-3" />
                              {tr("再加一个物品", "Add another item")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </Step>

        {/* 5. Misc */}
        <Step n={5} icon={<ShieldCheck className="h-4 w-4" />} title={tr("其他", "Other")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} />
              {tr("购买运输保险", "Add insurance")}
            </label>
            <button
              type="button"
              onClick={() => setShowAgreement((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              {tr("查看运输理赔协议", "View claims agreement")}
              <ChevronDown className={`h-3 w-3 transition-transform ${showAgreement ? "rotate-180" : ""}`} />
            </button>
          </div>
          {showAgreement && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-border bg-background/60 p-4 text-[11px] leading-relaxed text-ink-soft">
              <div className="mb-2 font-display text-sm font-bold text-foreground">
                {tr("通用运输理赔协议", "General Shipping & Claims Agreement")}
              </div>
              {lang === "zh" ? (
                <ol className="ml-4 list-decimal space-y-1.5">
                  <li>承保范围：包裹在承运人保管期间因运输事故造成的灭失或损坏。</li>
                  <li>保险费率：按申报价值的指定百分比收取，已在线路收费规则中列示。</li>
                  <li>
                    最高赔付：未购买保险包裹按运费 3 倍赔付且不超过 100 CAD；购买保险后按申报价值赔付，单件最高 5,000
                    CNY。
                  </li>
                  <li>除外责任：违禁品、易碎品未特别声明、内件与申报不符、自然损耗、延误所致间接损失不在赔付范围。</li>
                  <li>理赔时效：收件之日起 7 天内须以书面方式提出，并提供照片、外包装与购买凭证。</li>
                  <li>申报真实：发件人对申报品名、数量、价值的真实性负责，虚报将导致拒赔。</li>
                  <li>争议解决：本协议适用承运人所在地法律，协商不成可提交所在地有管辖权的法院。</li>
                </ol>
              ) : (
                <ol className="ml-4 list-decimal space-y-1.5">
                  <li>Coverage: loss or damage to the parcel during transit while in the carrier's custody.</li>
                  <li>Premium: a percentage of declared value as listed under the selected route's pricing rules.</li>
                  <li>
                    Maximum payout: uninsured parcels are capped at 3× freight or CAD 100, whichever is lower. Insured
                    parcels are paid up to declared value, max CNY 5,000 per piece.
                  </li>
                  <li>
                    Exclusions: prohibited items, fragile items not declared, contents differing from declaration,
                    natural wear, and indirect losses from delays.
                  </li>
                  <li>
                    Claims window: written claims must be filed within 7 days of delivery, with photos, original
                    packaging and purchase proof.
                  </li>
                  <li>
                    Truthful declaration: the sender is responsible for the accuracy of item name, quantity and value.
                    False declarations void coverage.
                  </li>
                  <li>
                    Disputes: governed by the carrier's local law; unresolved disputes may be submitted to a competent
                    local court.
                  </li>
                </ol>
              )}
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={tr("备注（可选）", "Note (optional)")}
            className="mt-3 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-brand"
          />
        </Step>

        <button
          onClick={submit}
          disabled={busy || !selectedWarehouse || !selectedRoute || !addressId}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-cta-gradient px-6 py-3.5 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {tr("提交集运申请", "Submit forwarding request")}
        </button>
      </div>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  disabled,
  children,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-3xl border border-border bg-surface/40 p-5 sm:p-6 ${disabled ? "opacity-50" : ""}`}>
      <header className="mb-4 flex items-center gap-2 text-sm font-bold">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-white">{n}</span>
        <span className="inline-flex items-center gap-1.5">
          {icon}
          {title}
        </span>
      </header>
      {children}
    </section>
  );
}
