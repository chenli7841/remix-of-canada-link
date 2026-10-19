// Group by both parties and packaging type; never silently merge different recipients.
export function groupExpressDrafts(rows: any[]): any[][] {
  const groups = new Map<string, any[]>();
  const addressKey = (a: any) =>
    [
      "name",
      "company",
      "mobile_phone",
      "region_id",
      "province",
      "city",
      "postalcode",
      "address",
      "address2",
      "type",
    ].map((k) =>
      String(a?.[k] ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase(),
    );
  for (const row of rows) {
    const key = JSON.stringify([
      row.customer_code,
      addressKey(row.draft.from),
      addressKey(row.draft.to),
      row.draft.packageType,
      row.draft.leg,
      row.draft.signature,
      row.draft.liftgate,
      row.draft.pickupDate,
      row.draft.pickupStart,
      row.draft.pickupEnd,
    ]);
    const items = groups.get(key) ?? [];
    if (!items.some((i) => i.source_key === row.source_key)) items.push(row);
    groups.set(key, items);
  }
  return [...groups.values()];
}

export function mergedPackages(rows: any[]) {
  return rows.flatMap((row) =>
    row.draft.packages.map((p: any) => ({ ...p, reference: p.reference || row.number })),
  );
}
