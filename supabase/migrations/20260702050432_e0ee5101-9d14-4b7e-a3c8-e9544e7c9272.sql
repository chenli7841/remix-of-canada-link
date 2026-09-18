-- Backfill: recompute waybill declared_cad / duty / insurance and forwarding freight_snapshot
-- using the customer-entered unit_price_cad from forwarding_items (CAD authoritative).
DO $$
DECLARE
  v_fo RECORD;
  v_wb RECORD;
  v_rule RECORD;
  v_customs RECORD;
  v_price_map JSONB;
  v_declared_cad NUMERIC;
  v_qty NUMERIC;
  v_unit_cad NUMERIC;
  v_unit_cny NUMERIC;
  v_it JSONB;
  v_inner NUMERIC;
  v_boxes NUMERIC;
  v_raw_qty NUMERIC;
  v_fx NUMERIC := 0.19;
  v_settings JSONB;
  v_vol NUMERIC;
  v_actual NUMERIC;
  v_volw NUMERIC;
  v_charge NUMERIC;
  v_freight_cad NUMERIC;
  v_duty NUMERIC;
  v_ins NUMERIC;
  v_customs_applies BOOLEAN;
  v_snapshot JSONB;
  v_tot_actual NUMERIC;
  v_tot_vol NUMERIC;
  v_tot_charge NUMERIC;
  v_tot_duty NUMERIC;
  v_tot_ins NUMERIC;
  v_tot_freight NUMERIC;
  v_any_customs BOOLEAN;
  v_sur_cny NUMERIC;
  v_sur_cad NUMERIC;
  v_total_cad NUMERIC;
BEGIN
  SELECT value INTO v_settings FROM app_settings WHERE key='fx_rate';
  IF v_settings IS NOT NULL AND (v_settings->>'cny_per_cad')::numeric > 0 THEN
    v_fx := 1.0 / (v_settings->>'cny_per_cad')::numeric;
  END IF;

  FOR v_fo IN SELECT id, route_id, insured FROM forwarding_orders WHERE route_id IS NOT NULL LOOP
    SELECT * INTO v_rule FROM freight_rules
      WHERE route_id=v_fo.route_id AND is_active=true
      ORDER BY created_at DESC LIMIT 1;
    IF v_rule IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_customs FROM customs_rules WHERE route_id=v_fo.route_id LIMIT 1;

    -- Build price map (name -> {cad,cny})
    SELECT COALESCE(jsonb_object_agg(name, jsonb_build_object(
      'cad', COALESCE(unit_price_cad,0),
      'cny', COALESCE(unit_price_cny,0)
    )), '{}'::jsonb)
      INTO v_price_map FROM forwarding_items WHERE forwarding_id=v_fo.id;

    v_tot_actual := 0; v_tot_vol := 0; v_tot_charge := 0;
    v_tot_duty := 0; v_tot_ins := 0; v_tot_freight := 0;
    v_any_customs := false;

    FOR v_wb IN SELECT id, weight_kg, length_cm, width_cm, height_cm, items_summary
                FROM waybills WHERE forwarding_id=v_fo.id LOOP
      -- Declared CAD sum
      v_declared_cad := 0;
      IF v_wb.items_summary IS NOT NULL AND jsonb_typeof(v_wb.items_summary)='array' THEN
        FOR v_it IN SELECT * FROM jsonb_array_elements(v_wb.items_summary) LOOP
          v_unit_cad := COALESCE((v_it->>'unit_price_cad')::numeric, 0);
          v_unit_cny := COALESCE((v_it->>'unit_price_cny')::numeric, 0);
          IF v_unit_cad = 0 AND v_it ? 'name' AND v_price_map ? (v_it->>'name') THEN
            v_unit_cad := COALESCE(((v_price_map->(v_it->>'name'))->>'cad')::numeric, 0);
            IF v_unit_cny = 0 THEN
              v_unit_cny := COALESCE(((v_price_map->(v_it->>'name'))->>'cny')::numeric, 0);
            END IF;
          END IF;
          IF v_unit_cad = 0 AND v_unit_cny > 0 THEN v_unit_cad := v_unit_cny * v_fx; END IF;
          v_inner := COALESCE((v_it#>>'{extras,inner_qty}')::numeric, 0);
          v_boxes := COALESCE((v_it#>>'{extras,box_count}')::numeric, 0);
          v_raw_qty := COALESCE((v_it->>'quantity')::numeric, 0);
          IF v_inner > 0 THEN v_qty := v_inner;
          ELSIF v_boxes > 0 THEN v_qty := v_raw_qty / v_boxes;
          ELSE v_qty := v_raw_qty;
          END IF;
          IF v_unit_cad > 0 AND v_qty > 0 THEN
            v_declared_cad := v_declared_cad + v_unit_cad * v_qty;
          END IF;
        END LOOP;
      END IF;
      v_declared_cad := ROUND(v_declared_cad, 2);

      v_actual := COALESCE(v_wb.weight_kg, 0);
      IF v_wb.length_cm IS NOT NULL AND v_wb.width_cm IS NOT NULL AND v_wb.height_cm IS NOT NULL THEN
        v_vol := v_wb.length_cm * v_wb.width_cm * v_wb.height_cm;
      ELSE v_vol := 0; END IF;
      v_volw := v_vol / COALESCE(v_rule.volumetric_divisor, 6000);
      v_charge := CASE v_rule.weight_mode
        WHEN 'actual' THEN v_actual
        WHEN 'volumetric' THEN v_volw
        ELSE GREATEST(v_actual, v_volw) END;

      IF COALESCE(v_rule.unit_price_cad,0) > 0 THEN
        v_freight_cad := v_charge * v_rule.unit_price_cad;
      ELSIF COALESCE(v_rule.unit_price_cny,0) > 0 THEN
        v_freight_cad := v_charge * v_rule.unit_price_cny * v_fx;
      ELSE v_freight_cad := 0; END IF;
      v_freight_cad := ROUND(v_freight_cad, 2);

      v_customs_applies := COALESCE(v_customs.enabled, false);
      v_duty := 0;
      IF v_customs_applies AND v_declared_cad >= COALESCE(v_customs.threshold_cad, 0) THEN
        v_duty := ROUND(v_declared_cad * COALESCE(v_customs.rate_pct,0)/100, 2);
      END IF;
      IF v_fo.insured AND COALESCE(v_rule.insurance_rate_pct,0) > 0 THEN
        v_ins := ROUND(v_declared_cad * v_rule.insurance_rate_pct/100, 2);
      ELSE v_ins := 0; END IF;

      v_snapshot := jsonb_build_object(
        'actual_weight', ROUND(v_actual,3),
        'volumetric_weight', ROUND(v_volw,3),
        'chargeable_weight', ROUND(v_charge,3),
        'declared_cad', v_declared_cad,
        'declared_cny', CASE WHEN v_fx>0 THEN ROUND(v_declared_cad/v_fx,2) ELSE 0 END,
        'freight_cad', v_freight_cad,
        'duty_cad', v_duty,
        'insurance_cad', v_ins,
        'fx_rate', v_fx,
        'weight_mode', v_rule.weight_mode,
        'customs_applies', v_customs_applies,
        'insurance_rate_pct', COALESCE(v_rule.insurance_rate_pct,0),
        'computed_at', now()
      );
      UPDATE waybills SET
        freight_cad=v_freight_cad, duty_cad=v_duty, insurance_cad=v_ins,
        weight_snapshot=v_snapshot
      WHERE id=v_wb.id;

      v_tot_actual := v_tot_actual + v_actual;
      v_tot_vol := v_tot_vol + v_volw;
      v_tot_charge := v_tot_charge + v_charge;
      v_tot_duty := v_tot_duty + v_duty;
      v_tot_ins := v_tot_ins + v_ins;
      IF v_customs_applies THEN v_any_customs := true; END IF;
    END LOOP;

    -- Forwarding freight = total chargeable * unit
    IF v_rule.weight_mode='actual' THEN v_tot_charge := v_tot_actual;
    ELSIF v_rule.weight_mode='volumetric' THEN v_tot_charge := v_tot_vol;
    ELSE v_tot_charge := GREATEST(v_tot_actual, v_tot_vol); END IF;
    IF COALESCE(v_rule.unit_price_cad,0) > 0 THEN
      v_tot_freight := v_tot_charge * v_rule.unit_price_cad;
    ELSIF COALESCE(v_rule.unit_price_cny,0) > 0 THEN
      v_tot_freight := v_tot_charge * v_rule.unit_price_cny * v_fx;
    ELSE v_tot_freight := 0; END IF;
    v_tot_freight := ROUND(v_tot_freight, 2);

    SELECT COALESCE(SUM(amount_cny),0) INTO v_sur_cny FROM surcharges
      WHERE (scope='forwarding' AND forwarding_id=v_fo.id)
         OR (scope='waybill' AND waybill_id IN (SELECT id FROM waybills WHERE forwarding_id=v_fo.id))
         OR (scope='pallet' AND pallet_id IN (SELECT DISTINCT pallet_id FROM waybills WHERE forwarding_id=v_fo.id AND pallet_id IS NOT NULL));
    v_sur_cad := ROUND(v_sur_cny * v_fx, 2);
    v_total_cad := ROUND(v_tot_freight + v_tot_duty + v_tot_ins + v_sur_cad, 2);

    UPDATE forwarding_orders SET
      freight_snapshot = COALESCE(freight_snapshot,'{}'::jsonb) || jsonb_build_object(
        'source','waybill_sum',
        'actual_weight', ROUND(v_tot_actual,3),
        'volumetric_weight', ROUND(v_tot_vol,3),
        'chargeable_weight', ROUND(v_tot_charge,3),
        'freight_cad', v_tot_freight,
        'freight_cny', CASE WHEN v_fx>0 THEN ROUND(v_tot_freight/v_fx,2) ELSE 0 END,
        'duty_cad', ROUND(v_tot_duty,2),
        'insurance_cad', ROUND(v_tot_ins,2),
        'surcharges_cny', ROUND(v_sur_cny,2),
        'surcharges_cad', v_sur_cad,
        'total_cad', v_total_cad,
        'insured', v_fo.insured,
        'fx_rate', v_fx,
        'weight_mode', v_rule.weight_mode,
        'customs_applies', v_any_customs,
        'computed_at', now()
      ),
      fee_cny = CASE WHEN v_fx>0 THEN ROUND(v_tot_freight/v_fx,2) ELSE 0 END
    WHERE id=v_fo.id;
  END LOOP;
END $$;