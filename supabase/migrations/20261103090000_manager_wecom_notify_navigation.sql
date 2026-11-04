-- Sending permission is enforced separately by the server functions.
update public.admin_nav_items
set roles = array_append(roles, 'manager'), updated_at = now()
where path = '/admin/wecom-notify' and not ('manager' = any(roles));
