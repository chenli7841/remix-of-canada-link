# VerykShip deployment verification — 2026-09-29

- Lovable project a7040f64-14a3-483e-aa91-dad51eb50070: saved VERYKSHIP_ENV, VERYKSHIP_APP_ID, VERYKSHIP_APP_SECRET, VERYKSHIP_PURCHASE_ENABLED in Cloud Secrets; production, purchase disabled.
- Published latest synced code (0ceabf5); Lovable reported website updated.
- Supabase fhfsrrbzubgjrjhgwerv: manually applied supabase/migrations/20260928150000_express_shipping.sql in a BEGIN/COMMIT transaction through SQL Editor. Do not blindly rerun this non-idempotent migration. CLI migration-history registration was not performed.
- Verified all five express tables exist, RLS enabled, anon SELECT=false, authenticated INSERT=false.
- Local account-only provider request: HTTP 200, provider status 1. No label creation or payment.
- Authenticated production admin connection probe: failed with generic VerykShip request error. Credentials are accepted locally, but production outbound request remains unverified. Lovable request log only reports outer server-function HTTP 200; no provider HTTP status or underlying cause available.
- Actual shipping quote and customer workflow not verified. Route origin fields are still empty.
