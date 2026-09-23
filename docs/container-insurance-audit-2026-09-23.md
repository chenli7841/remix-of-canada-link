# Container insurance audit (read only)

Inspected current local feeTotalsForCarton, feeTotalsForPallet and computeBatchFeeSummary, and queried production Sino_Cargo_2. No data changed.

Population: 6,448 forwarding waybills, 52 cartons, 26 pallets, 16 batches; no shop waybills.

- Carton insurance sums constituent waybill insurance. Pallets sum direct and boxed waybills, deduplicating waybill IDs. Batch insurance also deduplicates by ID and sums waybills directly, rather than adding carton/pallet totals on top.
- These calculators still apply effectiveWaybillInsurance (zero for unpaid uninsured/sensitive forwarding, preserve paid). Batch wbInsurance still contains a shop-order CNY fallback when stored CAD is zero; no live shop waybills currently exercise this fallback.
- Two unpaid waybills disagree with allocated-value × current rate: SCHP020060912687 and SCHP020060912511 each store CAD 4.50, while each waybill_items sum is CAD 300 (3% implies CAD 9). Their parent FWHP020060905274 declares only CAD 300 total, and saved combined premiums are CAD 9. This indicates duplicated allocation and must be resolved before increasing premiums. First waybill belongs to pallet d3e5b16a-3a89-4b06-a6ee-dec037219592; second is unassigned. Neither has assigned_batch_id, though nested membership may attach the first to a batch.
- 54 customer settlement snapshots across 8 batches disagree with current hierarchy-based, deduplicated insurance sums. This comparison includes historical snapshots/paid records; do not blindly overwrite paid history.
- Example MSEATOR0922001/customer 02714: snapshot CAD 30 vs current CAD 0. MSEAXXX0905001/customer 02714: snapshot CAD 362 vs current CAD 0. MSEATOR0903001/customer 02006: snapshot CAD 15 vs current CAD 40.50.

Conclusion: container aggregation itself does not double-charge insurance, but batch customer snapshots are stale and two source allocations require review. This is not evidence that all displayed pages or settled invoices are correct. No correction or recalculation was performed in this audit.
