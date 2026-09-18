-- Display-only "route type" info (unit price, transit time, route/lane, dim-weight divisor)
-- per shipping_method — shown on the public shipping page / freight calculator only. This is
-- NOT wired into real billing (freight_rules / shipping_routes stay the source of truth for
-- actual order pricing); app_settings is already world-readable (see 20260618163353), so no
-- new RLS is needed for the public page to read it.
INSERT INTO public.app_settings (key, value) VALUES
  ('route_type_display', '{
    "air":     {"enabled": true,  "unit_price_cny": 75, "transit": "7-12 天",  "route": "广州 → 多伦多 / 温哥华", "dim_divisor": 6000},
    "sea":     {"enabled": true,  "unit_price_cny": 22, "transit": "30-45 天", "route": "广州 → 温哥华，整柜海运", "dim_divisor": 6000},
    "express": {"enabled": false, "unit_price_cny": 95, "transit": "4-7 天",   "route": "广州 → 全加拿大", "dim_divisor": 5000},
    "truck":   {"enabled": false, "unit_price_cny": 15, "transit": "15-25 天", "route": "广州 → 多伦多，陆运整柜", "dim_divisor": 6000}
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
