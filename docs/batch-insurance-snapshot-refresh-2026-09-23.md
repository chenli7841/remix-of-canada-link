# Batch insurance snapshot correction

Executed in Sino_Cargo_2 on user request. Updated 53 unpaid customer settlement snapshots across 7 batches, adjusting insurance by CAD -2,482.23. Per-route and settlement subtotals adjusted by the same insurance delta; other fee components unchanged. No waybill amounts, allocations, invoices or wallets were modified.

Source: deduplicated stored waybill insurance under direct batch, carton, pallet and pallet-carton membership, grouped by customer and route. Existing paid waybill amounts within mixed settlements were preserved. Only settlement rows with is_paid IS NOT TRUE and paid_at IS NULL were eligible.

Original settlement rows saved in admin_action_logs.before under action `batch_insurance_snapshot_refresh_20260923`. Updates were transactional with settlement/source locks. Verification found zero remaining route insurance differences and zero unpaid populated snapshot insurance total differences. Paid snapshot table hash stayed `c489d51786311126e9029c209cc5c903`.

Pending allocation review: SCHP020060912687 and SCHP020060912511. Both retain CAD 4.50 premiums. This correction does not resolve their duplicated declared-value allocation.
