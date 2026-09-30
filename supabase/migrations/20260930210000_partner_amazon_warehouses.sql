begin;
alter table public.partner_shipping_settings drop constraint partner_shipping_settings_section_check;
alter table public.partner_shipping_settings add constraint partner_shipping_settings_section_check check(section in ('general','transport','warehouses','amazonWarehouses'));
commit;
