-- route_type_display unit price is now CAD-denominated (was CNY). If the row already
-- exists, rename unit_price_cny -> unit_price_cad on every method, converting the value
-- (× the current CNY-per-CAD rate) so previously-entered numbers stay proportionally
-- sensible instead of silently being reinterpreted in the wrong currency. If the row
-- doesn't exist yet, insert the CAD-native defaults directly.
DO $$
DECLARE
  cur jsonb;
  fx numeric;
  k text;
  sub jsonb;
  cny numeric;
  next jsonb := '{}'::jsonb;
BEGIN
  SELECT value INTO cur FROM public.app_settings WHERE key = 'route_type_display';

  IF cur IS NULL THEN
    INSERT INTO public.app_settings (key, value) VALUES ('route_type_display', '{
      "air":     {"enabled": true,  "unit_price_cad": 14.5, "transit": "7-12 天",  "route": "广州 → 多伦多 / 温哥华", "dim_divisor": 6000},
      "sea":     {"enabled": true,  "unit_price_cad": 4.2,  "transit": "30-45 天", "route": "广州 → 温哥华，整柜海运", "dim_divisor": 6000},
      "express": {"enabled": false, "unit_price_cad": 18.5, "transit": "4-7 天",   "route": "广州 → 全加拿大", "dim_divisor": 5000},
      "truck":   {"enabled": false, "unit_price_cad": 2.9,  "transit": "15-25 天", "route": "广州 → 多伦多，陆运整柜", "dim_divisor": 6000},
      "storage": {"enabled": false, "unit_price_cad": 0,    "transit": "", "route": "广州 / 义乌仓代为仓储", "dim_divisor": 6000}
    }'::jsonb);
    RETURN;
  END IF;

  SELECT COALESCE((value->>'cny_per_cad')::numeric, 5.26) INTO fx FROM public.app_settings WHERE key = 'fx_rate';

  FOR k IN SELECT jsonb_object_keys(cur) LOOP
    sub := cur -> k;
    IF sub ? 'unit_price_cny' AND NOT (sub ? 'unit_price_cad') THEN
      cny := COALESCE((sub->>'unit_price_cny')::numeric, 0);
      sub := (sub - 'unit_price_cny') || jsonb_build_object('unit_price_cad', round(cny / fx, 2));
    END IF;
    next := next || jsonb_build_object(k, sub);
  END LOOP;

  UPDATE public.app_settings SET value = next WHERE key = 'route_type_display';
END $$;
