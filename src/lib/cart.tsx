import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Product } from "./mock-data";

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
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "sinocargo.cart.v1";
const SEL_KEY = "sinocargo.cart.sel.v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw) as CartLine[]);
      const sraw = localStorage.getItem(SEL_KEY);
      if (sraw) setSelected(JSON.parse(sraw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(KEY, JSON.stringify(items));
      localStorage.setItem(SEL_KEY, JSON.stringify(selected));
    }
  }, [items, selected, hydrated]);

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

  const count = items.reduce((n, i) => n + i.quantity, 0);
  const subtotalCNY = items.reduce((s, i) => s + i.priceCNY * i.quantity, 0);
  const totalWeightKg = items.reduce((w, i) => w + lineWeightKg(i), 0);

  const selectedItems = useMemo(() => items.filter((i) => isSelected(i.slug, i.variantId)), [items, selected]);
  const selectedCount = selectedItems.reduce((n, i) => n + i.quantity, 0);
  const selectedSubtotalCNY = selectedItems.reduce((s, i) => s + i.priceCNY * i.quantity, 0);
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
