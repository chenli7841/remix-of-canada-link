import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Product } from "./mock-data";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

// A selected variant, as picked on the product page. Every weight/dims/pack field is
// optional — when a variant doesn't set one, the line falls back to the product's own
// value (same fallback order the checkout pricing functions use server-side).
export interface CartVariant {
  id: string;
  sku: string;
  label: string; // e.g. "红色 / 26寸" — shown under the product name in the cart
  priceCNY?: number | null;
  weightKg?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  packQty?: number | null;
  packWeightKg?: number | null;
  packLengthCm?: number | null;
  packWidthCm?: number | null;
  packHeightCm?: number | null;
}

export interface CartLine {
  slug: string;
  nameZh: string;
  nameEn: string;
  image: string;
  priceCNY: number;
  weightKg: number;
  purchaseType: "personal" | "business";
  moq?: number;
  packQty?: number;
  packWeightKg?: number;
  /** Shipping routes this product is restricted to; empty = all routes allowed */
  availableRouteCodes?: string[];
  /** Routes configured for this product in personal / business purchase mode */
  personalRouteCodes?: string[];
  businessRouteCodes?: string[];
  quantity: number;
  /** Present when this line is a specific SKU rather than the product's default. */
  variantId?: string;
  variantSku?: string;
  variantLabel?: string;
}

// Same product + different variant = different cart line (so a shopper can order
// two colors of the same item independently). No variant = plain product-level line,
// exactly as before.
export function cartLineKey(i: { slug: string; variantId?: string }): string {
  return i.variantId ? `${i.slug}::${i.variantId}` : i.slug;
}

// Personal: per-unit chargeable weight × quantity.
// Business: package/carton weight × number of packs (quantity ÷ units-per-pack) — falls
// back to the personal formula if no pack weight has been configured for the product yet.
// This is a client-side estimate only — the authoritative number always comes from the
// quote_shop_order/place_shop_order server functions, which apply the identical fallback.
export function lineWeightKg(i: CartLine): number {
  if (i.purchaseType === "business" && i.packWeightKg && i.packQty) {
    return i.packWeightKg * (i.quantity / i.packQty);
  }
  return i.weightKg * i.quantity;
}

// ---- Server-side cart (logged-in users) -------------------------------------------------
// The backend cart (shop_carts / shop_cart_items) is the price authority: every amount here
// is computed server-side by shop_cart_reprice (same _compute_line_quote as checkout). The
// local CartLine list above stays the display/membership source; these snapshots overlay
// the authoritative money, matched by cartLineKey. override_* is written by staff (admin
// price adjustments) and, when present, is what the shopper is charged.
export interface ServerCartItem {
  id: string;
  product_slug: string;
  variant_id: string | null;
  quantity: number;
  mode: "personal" | "business";
  unit_price_cny: number;
  line_subtotal_cny: number;
  line_freight_cny: number;
  line_customs_cny: number;
  line_insurance_cny: number;
  override_unit_price_cny: number | null;
  override_reason: string | null;
}

export interface ServerCart {
  cart: {
    id: string;
    status: string;
    route_code: string | null;
    shipping_method: string | null;
    coupon_code: string | null;
    note: string | null;
    subtotal_cny: number;
    freight_cny: number;
    customs_cny: number;
    insurance_cny: number;
    discount_cny: number;
    total_cny: number;
    needs_route: boolean;
    quoted_at: string | null;
    override_total_cny: number | null;
    override_reason: string | null;
  };
  items: ServerCartItem[];
}

export interface CartSyncPayload {
  items?: { slug: string; variant_id: string | null; quantity: number; mode: string }[];
  route_code?: string | null;
  shipping_method?: string | null;
  coupon_code?: string | null;
  note?: string | null;
  address_id?: string | null;
  address_snapshot?: unknown;
}

const sb = supabase as any;

function serverItemKey(s: ServerCartItem): string {
  return s.variant_id ? `${s.product_slug}::${s.variant_id}` : s.product_slug;
}

// The amount actually owed for a server line: staff override wins, else the repriced value.
export function serverLineTotal(s: ServerCartItem): number {
  if (s.override_unit_price_cny != null) return s.override_unit_price_cny * s.quantity;
  return s.line_subtotal_cny;
}

interface CartCtx {
  items: CartLine[];
  count: number;
  subtotalCNY: number;
  totalWeightKg: number;
  selected: Record<string, boolean>;
  selectedItems: CartLine[];
  selectedCount: number;
  selectedSubtotalCNY: number;
  selectedWeightKg: number;
  toggleSelect: (slug: string, variantId?: string) => void;
  setAllSelected: (v: boolean) => void;
  isSelected: (slug: string, variantId?: string) => boolean;
  add: (p: Product, qty?: number, variant?: CartVariant) => void;
  update: (slug: string, qty: number, variantId?: string) => void;
  remove: (slug: string, variantId?: string) => void;
  clear: () => void;
  clearSlugs: (keys: string[]) => void;
  /** Backend cart snapshot for logged-in users (null for anon / before first sync). */
  serverCart: ServerCart | null;
  serverSyncing: boolean;
  /** Server price snapshot for one local cart line, matched by cartLineKey. */
  serverLineFor: (i: { slug: string; variantId?: string }) => ServerCartItem | undefined;
  /** Push route / coupon / address / note (and optionally items) into the backend cart. */
  syncServerCart: (payload: CartSyncPayload) => Promise<ServerCart | null>;
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "sinocargo.cart.v1";
const SEL_KEY = "sinocargo.cart.sel.v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  const [serverCart, setServerCart] = useState<ServerCart | null>(null);
  const [serverSyncing, setServerSyncing] = useState(false);
  const hydratedForUser = useRef<string | null>(null); // reconcile started for this user
  const syncedForUser = useRef<string | null>(null); // reconcile finished for this user
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemsRef = useRef<CartLine[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw) as CartLine[]);
      const sraw = localStorage.getItem(SEL_KEY);
      if (sraw) setSelected(JSON.parse(sraw));
    } catch {
      // ignore corrupt/unavailable localStorage — start from an empty cart
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(KEY, JSON.stringify(items));
      localStorage.setItem(SEL_KEY, JSON.stringify(selected));
    }
  }, [items, selected, hydrated]);

  const toPayloadItems = useCallback(
    (list: CartLine[]) =>
      list.map((i) => ({
        slug: i.slug,
        variant_id: i.variantId ?? null,
        quantity: i.quantity,
        mode: i.purchaseType,
      })),
    [],
  );

  const syncServerCart = useCallback(
    async (payload: CartSyncPayload): Promise<ServerCart | null> => {
      if (!user) return null;
      setServerSyncing(true);
      try {
        const { data } = await sb.rpc("shop_cart_sync", { _payload: payload });
        if (data?.ok) {
          setServerCart(data as ServerCart);
          return data as ServerCart;
        }
        return null;
      } catch {
        return null;
      } finally {
        setServerSyncing(false);
      }
    },
    [user],
  );

  // One-time reconciliation when a user signs in (or the page loads already signed in):
  // read the backend cart, union it with whatever is in localStorage (local lines win
  // per key, server-only lines are kept), and push the union back.
  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      hydratedForUser.current = null;
      syncedForUser.current = null;
      setServerCart(null);
      return;
    }
    if (hydratedForUser.current === user.id) return;
    hydratedForUser.current = user.id;
    const uid = user.id;
    let cancelled = false;
    (async () => {
      setServerSyncing(true);
      try {
        const { data: got } = await sb.rpc("shop_cart_get");
        if (cancelled) return;
        const serverItems: ServerCartItem[] = got?.ok ? (got.items ?? []) : [];
        const byKey = new Map<string, { slug: string; variant_id: string | null; quantity: number; mode: string }>();
        for (const s of serverItems) {
          byKey.set(serverItemKey(s), {
            slug: s.product_slug,
            variant_id: s.variant_id,
            quantity: s.quantity,
            mode: s.mode,
          });
        }
        for (const l of itemsRef.current) {
          byKey.set(cartLineKey(l), {
            slug: l.slug,
            variant_id: l.variantId ?? null,
            quantity: l.quantity,
            mode: l.purchaseType,
          });
        }
        const merged = [...byKey.values()];
        const synced = await syncServerCart({ items: merged });
        if (!cancelled && !synced && got?.ok) setServerCart(got as ServerCart);
      } finally {
        if (!cancelled) {
          syncedForUser.current = uid;
          setServerSyncing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, user, syncServerCart]);

  // After the sign-in reconciliation, every local mutation debounce-pushes to the backend
  // so the pre-order stays a faithful mirror (and staff can see / adjust it).
  useEffect(() => {
    if (!hydrated || !user) return;
    if (syncedForUser.current !== user.id) return; // wait for the sign-in reconcile first
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      syncServerCart({ items: toPayloadItems(itemsRef.current) });
    }, 500);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [items, hydrated, user, syncServerCart, toPayloadItems]);

  const add = (p: Product, qty = 1, variant?: CartVariant) => {
    const minQty = p.purchaseType === "business" ? Math.max(qty, p.moq ?? 1) : qty;
    const key = cartLineKey({ slug: p.slug, variantId: variant?.id });
    setItems((prev) => {
      const ex = prev.find((i) => cartLineKey(i) === key);
      if (ex) return prev.map((i) => (cartLineKey(i) === key ? { ...i, quantity: i.quantity + qty } : i));
      return [
        ...prev,
        {
          slug: p.slug,
          nameZh: p.name.zh,
          nameEn: p.name.en,
          image: p.image,
          priceCNY: variant?.priceCNY ?? p.priceCNY,
          weightKg: variant?.weightKg ?? p.weightKg,
          purchaseType: p.purchaseType,
          moq: p.moq,
          packQty: variant?.packQty ?? p.packQty,
          packWeightKg: variant?.packWeightKg ?? p.packWeightKg,
          availableRouteCodes: p.availableRouteCodes ?? [],
          personalRouteCodes: p.personalRouteCodes ?? [],
          businessRouteCodes: p.businessRouteCodes ?? [],
          quantity: minQty,
          variantId: variant?.id,
          variantSku: variant?.sku,
          variantLabel: variant?.label,
        },
      ];
    });
    setSelected((s) => ({ ...s, [key]: true }));
  };

  const update = (slug: string, qty: number, variantId?: string) => {
    const key = cartLineKey({ slug, variantId });
    const line = items.find((i) => cartLineKey(i) === key);
    if (line?.purchaseType === "business") {
      // Wholesale items can never drop below their minimum order quantity — clamp
      // instead of removing, even if the user keeps pressing "-" at the floor.
      const floor = Math.max(line.moq ?? 1, 1);
      setItems((prev) => prev.map((i) => (cartLineKey(i) === key ? { ...i, quantity: Math.max(qty, floor) } : i)));
      return;
    }
    if (qty <= 0) return remove(slug, variantId);
    setItems((prev) => prev.map((i) => (cartLineKey(i) === key ? { ...i, quantity: qty } : i)));
  };
  const remove = (slug: string, variantId?: string) => {
    const key = cartLineKey({ slug, variantId });
    setItems((prev) => prev.filter((i) => cartLineKey(i) !== key));
    setSelected((s) => {
      const n = { ...s };
      delete n[key];
      return n;
    });
  };
  const clear = () => {
    setItems([]);
    setSelected({});
  };
  const clearSlugs = (keys: string[]) => {
    const set = new Set(keys);
    setItems((prev) => prev.filter((i) => !set.has(cartLineKey(i))));
    setSelected((s) => {
      const n = { ...s };
      for (const k of keys) delete n[k];
      return n;
    });
  };

  const isSelected = (slug: string, variantId?: string) => {
    const key = cartLineKey({ slug, variantId });
    return selected[key] !== false; // default selected
  };
  const toggleSelect = (slug: string, variantId?: string) => {
    const key = cartLineKey({ slug, variantId });
    setSelected((s) => ({ ...s, [key]: !(s[key] !== false) }));
  };
  const setAllSelected = (v: boolean) => setSelected(Object.fromEntries(items.map((i) => [cartLineKey(i), v])));

  const serverByKey = useMemo(() => {
    const m = new Map<string, ServerCartItem>();
    for (const s of serverCart?.items ?? []) m.set(serverItemKey(s), s);
    return m;
  }, [serverCart]);
  const serverLineFor = useCallback(
    (i: { slug: string; variantId?: string }) => serverByKey.get(cartLineKey(i)),
    [serverByKey],
  );

  const count = items.reduce((n, i) => n + i.quantity, 0);
  // Prefer the server-computed amount for each line; fall back to the local estimate
  // for anon users or lines not yet reflected in the backend snapshot.
  const lineSubtotal = (i: CartLine) => {
    const s = serverLineFor(i);
    return s ? serverLineTotal(s) : i.priceCNY * i.quantity;
  };
  const subtotalCNY = items.reduce((s, i) => s + lineSubtotal(i), 0);
  const totalWeightKg = items.reduce((w, i) => w + lineWeightKg(i), 0);

  const selectedItems = useMemo(() => items.filter((i) => isSelected(i.slug, i.variantId)), [items, selected]);
  const selectedCount = selectedItems.reduce((n, i) => n + i.quantity, 0);
  const selectedSubtotalCNY = selectedItems.reduce((s, i) => s + lineSubtotal(i), 0);
  const selectedWeightKg = selectedItems.reduce((w, i) => w + lineWeightKg(i), 0);

  return (
    <Ctx.Provider
      value={{
        items,
        count,
        subtotalCNY,
        totalWeightKg,
        selected,
        selectedItems,
        selectedCount,
        selectedSubtotalCNY,
        selectedWeightKg,
        toggleSelect,
        setAllSelected,
        isSelected,
        add,
        update,
        remove,
        clear,
        clearSlugs,
        serverCart,
        serverSyncing,
        serverLineFor,
        syncServerCart,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}
