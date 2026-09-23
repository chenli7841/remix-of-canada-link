# Sensitive cargo insurance

Rule: `shipping_routes.cargo_type = 'sensitive'` means insurance is unavailable and the premium/rate is zero. Customer text: 敏感线路 不支持购买保险，若丢失按照最高每kg7刀赔付。

Implemented in customer intake, staff intake, staff insurance editing, forward/reverse route pricing settings, freight previews, measuring/recalculation and database write guards. Switching a form to sensitive cargo clears the opt-in. Database triggers protect RPC/direct writes and clear rates when the cargo classification changes.

Invoices only record the persisted `waybills.insurance_cad`, converted at the invoice exchange rate. They do not re-evaluate opt-in, route eligibility, declared value or insurance rate. Batch invoice generation follows the same rule.

Live database Sino_Cargo_2 updated:
- 16 sensitive freight rules zeroed, including old inactive rules.
- 2 unpaid waybill premiums zeroed: CAD 90.
- 21 unpaid forwarding insurance flags/snapshots corrected.
- 6 existing unpaid invoice lines synchronized to their unpaid waybills' stored premium (zero), removing CNY 2,165. Invoice insurance/subtotal/total reduced by the same delta; other charges unchanged.
- Original rows recorded in admin_action_logs: `sensitive_insurance_cleanup_20260923` and `sensitive_invoice_sync_20260923`.
- Paid waybills/invoices and wallet balances excluded from data correction. Historical records are not refunds.

Validation: 8 insurance tests passed, including real freight/measurement calculations and invoice reading stored values with a contradictory old rate/opt-in. Live rollback test attempted rate=100, insured=true and waybill premium=99 on sensitive records; all were normalized to zero/false and test writes rolled back. Production build passed. Full type-check still reports existing generic inference errors in cartons.functions.ts from the previous insurance helper integration.

Migration: `supabase/migrations/20260923180000_sensitive_cargo_no_insurance.sql`, applied to the live database. Frontend changes require the user's Lovable publish.
