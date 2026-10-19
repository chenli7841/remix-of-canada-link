import { emptyAddress, type ExpressAddress } from "./express";
import { canadaLocations } from "./canada-address";
import type { Warehouse } from "./partner-settings";

export function dispatchWarehouseExpressAddress(w: Warehouse): ExpressAddress {
  return {
    ...emptyAddress,
    name: w.name,
    company: w.company,
    mobile_phone: w.phone,
    region_id: "CA",
    province: w.province,
    city: w.city,
    postalcode: w.postal,
    address: w.street,
    address2: w.unit,
    type: "commercial",
  };
}

export function warehouseExpressAddress(w: {
  address?: string | null;
  contact?: string | null;
  phone?: string | null;
  country: string;
  name_zh: string;
  name_en?: string | null;
}): ExpressAddress {
  const address = (w.address || "").trim();
  const country =
    ({ Canada: "CA", 加拿大: "CA", China: "CN", 中国: "CN" } as Record<string, string>)[
      w.country
    ] || w.country.toUpperCase();
  const result: ExpressAddress = {
    ...emptyAddress,
    name: w.contact || w.name_en || w.name_zh,
    company: w.name_en || w.name_zh,
    mobile_phone: w.phone || "",
    region_id: country,
    address,
    type: "commercial",
  };
  if (country !== "CA") return result;
  const postal = address.match(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i);
  if (postal) result.postalcode = `${postal[1]} ${postal[2]}`.toUpperCase();
  const prefix = postal ? address.slice(0, postal.index) : address;
  const region = prefix.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s*[, ]*$/i);
  if (!region) return result;
  result.province = region[1].toUpperCase();
  const beforeRegion = prefix
    .slice(0, region.index)
    .trim()
    .replace(/[,\s]+$/, "");
  const city = canadaLocations
    .find((p) => p.code === result.province)
    ?.cities.slice()
    .sort((a, b) => b.length - a.length)
    .find(
      (c) =>
        beforeRegion.toLowerCase().endsWith(" " + c.toLowerCase()) ||
        beforeRegion.toLowerCase().endsWith("," + c.toLowerCase()),
    );
  if (city) {
    result.city = city;
    const street = beforeRegion
      .slice(0, -city.length)
      .trim()
      .replace(/[,\s]+$/, "");
    if (street) result.address = street;
  }
  return result;
}
