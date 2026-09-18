-- "客户视图" (admin/customer-view) was owner-only. Open it to warehouse,
-- support (客服) and sales staff too, with the same full read/write scope
-- owner already has (search by customer_code, view, and every existing
-- on-behalf-of action: profile/address/items edits, wallet, forwarding,
-- storage fee payment). admin_nav_items is the sidebar's real source of
-- truth (src/routes/admin/route.tsx reads it over the hardcoded fallback
-- once seeded), so the row must be updated here, not just in code.
UPDATE public.admin_nav_items
SET roles = ARRAY['owner', 'warehouse_cn', 'warehouse_ca', 'support', 'sales']
WHERE path = '/admin/customer-view';
