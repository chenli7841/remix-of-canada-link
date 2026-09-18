-- Add the 5th route type (仓储 / storage) to route_type_display. Written as an idempotent
-- upsert-merge so it's safe whether or not the previous seed migration (20260709140927)
-- has already run, and won't clobber any values an admin has already edited and saved.
INSERT INTO public.app_settings (key, value) VALUES
  ('route_type_display', '{
    "air":     {"enabled": true,  "unit_price_cny": 75, "transit": "7-12 天",  "route": "广州 → 多伦多 / 温哥华", "dim_divisor": 6000},
    "sea":     {"enabled": true,  "unit_price_cny": 22, "transit": "30-45 天", "route": "广州 → 温哥华，整柜海运", "dim_divisor": 6000},
    "express": {"enabled": false, "unit_price_cny": 95, "transit": "4-7 天",   "route": "广州 → 全加拿大", "dim_divisor": 5000},
    "truck":   {"enabled": false, "unit_price_cny": 15, "transit": "15-25 天", "route": "广州 → 多伦多，陆运整柜", "dim_divisor": 6000},
    "storage": {"enabled": false, "unit_price_cny": 0,  "transit": "", "route": "广州 / 义乌仓代为仓储", "dim_divisor": 6000}
  }'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value || jsonb_build_object(
    'storage',
    COALESCE(
      public.app_settings.value->'storage',
      '{"enabled": false, "unit_price_cny": 0, "transit": "", "route": "广州 / 义乌仓代为仓储", "dim_divisor": 6000}'::jsonb
    )
  );
