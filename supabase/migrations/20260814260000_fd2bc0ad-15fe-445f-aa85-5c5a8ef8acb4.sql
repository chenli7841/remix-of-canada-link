-- Unblock admin_action_logs so it can actually record every admin operation.
--
-- Two problems found while auditing "所有的后台操作需要有操作记录":
--
-- 1. entity_type has a CHECK constraint allowing only 7 values
--    ('order','forwarding','waybill','batch','tracking_event',
--    'delivery_queue','receiving'), but the app has been inserting 20+
--    other entity_type values for a long time (carton, pallet, wallet,
--    system, customer_profile, customer_address, customer_item, and more
--    added in this pass: shop_category, shop_product, warehouse,
--    shipping_route, oversize_rule, customer_hs_item, app_setting,
--    cargo_type, destination, receiving-adjacent types, hs_code, invoice,
--    offline_payment, nav_config, contact_message, ...). None of those
--    inserts had exception handling, so every one of them has been
--    silently rolling back (TS callers) or aborting the whole transaction
--    (the pay_storage_fees/place_forwarding SQL functions from the
--    20260814250000 migration insert entity_type='customer_storage_fee'/
--    'customer_forwarding' with no exception block — a staff member
--    acting on a customer's behalf would have the entire payment/booking
--    roll back on this constraint alone). entity_type is a free-form
--    categorization tag, not a foreign key — drop the allow-list instead
--    of maintaining an ever-growing one.
--
-- 2. entity_id is `uuid NOT NULL`, but several real entities this log
--    needs to reference don't have a uuid identity at all (app_settings
--    is keyed by a text `key`; a bulk nav-config save touches many rows
--    at once with no single natural id). Widen it to text — every
--    existing caller already passes uuid strings, which remain valid
--    text values, so this is backward compatible.

ALTER TABLE public.admin_action_logs DROP CONSTRAINT IF EXISTS admin_action_logs_entity_type_check;

ALTER TABLE public.admin_action_logs ALTER COLUMN entity_id TYPE text;
