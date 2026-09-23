# Uninsured unpaid waybill insurance correction

Executed in Supabase Sino_Cargo_2 (`fhfsrrbzubgjrjhgwerv`) on 2026-09-23, as explicitly requested by the user.

Scope: `forwarding_orders.insured IS NOT TRUE`, `waybills.payment_status = 'unpaid'`, and nonzero `waybills.insurance_cad`. Only `insurance_cad` was set to zero; the existing update timestamp trigger also ran. Related forwarding orders and waybills were locked during the transaction.

- Updated 923 waybills; removed CAD 4,672.07 in stored insurance charges.
- Saved 923 original complete waybill rows in `admin_action_logs.before`, with action `uninsured_unpaid_insurance_cleanup_20260923`.
- Post-update matching nonzero rows: 0; audited target rows still nonzero: 0.
- Paid waybills remained 14, with total insurance CAD 205.64, unchanged from preflight.
- Entire invoices table hash remained `59b41be0095f1cfa8bf1cf48bd6d77cf`.
- Entire wallets table hash remained `ed665d17c4229d68483554e0f0672c58`.

Execution SQL: `sql/zero-uninsured-unpaid-insurance-20260923.sql`. This is a one-time correction, not a deployment migration.

Excluded: paid waybills, invoice and invoice item amounts, forwarding freight snapshots, route insurance settings, and application code. Existing unpaid invoices/snapshots may therefore still show insurance. The previously discovered invoice calculation path and sensitive-route eligibility rules require separate correction to prevent future incorrect recalculation.
