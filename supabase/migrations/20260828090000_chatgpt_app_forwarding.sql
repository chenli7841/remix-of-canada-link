-- Customer-owned ChatGPT App drafts and CAD-only forwarding quote/confirmation RPCs.
-- This is intentionally separate from the service-role WeChat conversation drafts.

CREATE TABLE IF NOT EXISTS public.ai_forwarding_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'cancelled', 'expired')),
  version integer NOT NULL DEFAULT 1,
  forwarding_id uuid REFERENCES public.forwarding_orders(id) ON DELETE SET NULL,
  request_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_forwarding_drafts_user_time
  ON public.ai_forwarding_drafts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_forwarding_drafts_active
  ON public.ai_forwarding_drafts(user_id) WHERE status = 'active';

ALTER TABLE public.ai_forwarding_drafts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.ai_forwarding_drafts TO authenticated;
GRANT UPDATE (draft_data) ON public.ai_forwarding_drafts TO authenticated;

DROP POLICY IF EXISTS "customers read own ai drafts" ON public.ai_forwarding_drafts;
CREATE POLICY "customers read own ai drafts" ON public.ai_forwarding_drafts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "customers create own ai drafts" ON public.ai_forwarding_drafts;
CREATE POLICY "customers create own ai drafts" ON public.ai_forwarding_drafts
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND status = 'active' AND version = 1
    AND forwarding_id IS NULL AND request_no IS NULL AND confirmed_at IS NULL
    AND draft_data->>'currency' = 'CAD'
  );
DROP POLICY IF EXISTS "customers update own active ai drafts" ON public.ai_forwarding_drafts;
CREATE POLICY "customers update own active ai drafts" ON public.ai_forwarding_drafts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'active')
  WITH CHECK (user_id = auth.uid() AND status = 'active');

CREATE OR REPLACE FUNCTION public.bump_ai_forwarding_draft_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_forwarding_draft_version ON public.ai_forwarding_drafts;
CREATE TRIGGER trg_ai_forwarding_draft_version
BEFORE UPDATE ON public.ai_forwarding_drafts
FOR EACH ROW EXECUTE FUNCTION public.bump_ai_forwarding_draft_version();

-- Route availability is a server-side authorization rule.  The web UI also
-- filters these routes, but callers must not be able to bypass that filter by
-- invoking place_forwarding/quote RPCs directly.
CREATE OR REPLACE FUNCTION public.is_forwarding_route_visible_to_user(
  _route_id uuid,
  _user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route public.shipping_routes;
  v_profile public.profiles;
  v_customer_code text;
BEGIN
  IF _route_id IS NULL OR _user_id IS NULL THEN RETURN false; END IF;

  SELECT * INTO v_route
  FROM public.shipping_routes
  WHERE id = _route_id
    AND is_active = true
    AND usage_scope IN ('forwarding', 'both');
  IF v_route IS NULL THEN RETURN false; END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
  IF v_profile IS NULL THEN RETURN false; END IF;
  v_customer_code := upper(trim(COALESCE(v_profile.customer_code, '')));

  IF v_profile.vip_level = ANY(COALESCE(v_route.blacklist_vip_levels, ARRAY[]::public.vip_level[])) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_route.blacklist_customer_codes, ARRAY[]::text[])) AS code
    WHERE upper(trim(code)) = v_customer_code AND v_customer_code <> ''
  ) THEN
    RETURN false;
  END IF;

  IF cardinality(COALESCE(v_route.visible_vip_levels, ARRAY[]::public.vip_level[])) = 0
     AND cardinality(COALESCE(v_route.visible_customer_codes, ARRAY[]::text[])) = 0 THEN
    RETURN true;
  END IF;
  IF v_profile.vip_level = ANY(COALESCE(v_route.visible_vip_levels, ARRAY[]::public.vip_level[])) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_route.visible_customer_codes, ARRAY[]::text[])) AS code
    WHERE upper(trim(code)) = v_customer_code AND v_customer_code <> ''
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_forwarding_route_visible_to_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_forwarding_route_visible_to_user(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_forwarding_route_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_route_id uuid;
BEGIN
  v_route_id := NEW.route_id;
  IF v_route_id IS NULL AND NULLIF(NEW.route_code, '') IS NOT NULL THEN
    SELECT id INTO v_route_id FROM public.shipping_routes WHERE code = NEW.route_code;
  END IF;
  IF v_route_id IS NOT NULL
     AND NOT public.is_forwarding_route_visible_to_user(v_route_id, NEW.user_id) THEN
    RAISE EXCEPTION 'route unavailable for customer';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_forwarding_route_visibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_forwarding_route_visibility() TO authenticated;

DROP TRIGGER IF EXISTS trg_enforce_forwarding_route_visibility ON public.forwarding_orders;
CREATE TRIGGER trg_enforce_forwarding_route_visibility
BEFORE INSERT OR UPDATE OF route_id, route_code, user_id ON public.forwarding_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_forwarding_route_visibility();

CREATE OR REPLACE FUNCTION public.quote_forwarding_cad(
  _route_code text,
  _weight_kg numeric,
  _volume_cm3 numeric DEFAULT 0,
  _declared_cad numeric DEFAULT 0,
  _direction text DEFAULT 'forward'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route public.shipping_routes;
  v_rule public.freight_rules;
  v_customs public.customs_rules;
  v_actual numeric := GREATEST(COALESCE(_weight_kg, 0), 0);
  v_volume numeric := GREATEST(COALESCE(_volume_cm3, 0), 0);
  v_volumetric numeric;
  v_chargeable numeric;
  v_freight numeric;
  v_clearance numeric;
  v_duty numeric := 0;
  v_insurance numeric := 0;
  v_tax_rate numeric := 0;
  v_tax numeric := 0;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _direction NOT IN ('forward', 'reverse') THEN RAISE EXCEPTION 'invalid direction'; END IF;

  SELECT * INTO v_route FROM public.shipping_routes
   WHERE code = _route_code AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION 'route unavailable'; END IF;
  IF NOT public.is_forwarding_route_visible_to_user(v_route.id, auth.uid()) THEN
    RAISE EXCEPTION 'route unavailable for customer';
  END IF;

  SELECT * INTO v_rule FROM public.freight_rules
   WHERE route_id = v_route.id AND is_active = true AND direction = _direction
   ORDER BY created_at DESC LIMIT 1;
  IF v_rule IS NULL THEN RAISE EXCEPTION 'no active pricing rule'; END IF;
  IF COALESCE(v_rule.pricing_mode, 'weight') = 'pallet' THEN
    RETURN jsonb_build_object(
      'ok', false, 'currency', 'CAD', 'reason', 'pallet_dimensions_required',
      'message', 'This pallet route requires staff verification of package dimensions.'
    );
  END IF;

  SELECT * INTO v_customs FROM public.customs_rules WHERE route_id = v_route.id LIMIT 1;
  v_volumetric := CASE WHEN v_rule.volumetric_divisor > 0 THEN v_volume / v_rule.volumetric_divisor ELSE 0 END;
  v_chargeable := CASE v_rule.weight_mode
    WHEN 'actual' THEN v_actual
    WHEN 'volumetric' THEN v_volumetric
    ELSE GREATEST(v_actual, v_volumetric)
  END;
  v_freight := ROUND(GREATEST(v_chargeable * COALESCE(v_rule.unit_price_cad, 0),
                               COALESCE(v_rule.min_charge_waybill_cad, 0)), 2);
  v_clearance := ROUND(COALESCE(v_rule.clearance_fee_waybill_cad, 0), 2);
  IF COALESCE(v_customs.enabled, false) AND _declared_cad >= COALESCE(v_customs.threshold_cad, 0) THEN
    v_duty := ROUND(_declared_cad * COALESCE(v_customs.rate_pct, 0) / 100, 2);
  END IF;
  v_insurance := ROUND(_declared_cad * COALESCE(v_rule.insurance_rate_pct, 0) / 100, 2);
  v_tax_rate := CASE WHEN v_route.sales_tax_enabled THEN COALESCE(v_route.sales_tax_rate_pct, 0) ELSE 0 END;
  v_tax := ROUND((v_freight + v_clearance + v_duty + v_insurance) * v_tax_rate / 100, 2);
  v_total := ROUND(v_freight + v_clearance + v_duty + v_insurance + v_tax, 2);

  RETURN jsonb_build_object(
    'ok', true, 'currency', 'CAD', 'route_code', v_route.code, 'route_name', v_route.name_zh,
    'actual_weight_kg', ROUND(v_actual, 3), 'volumetric_weight_kg', ROUND(v_volumetric, 3),
    'chargeable_weight_kg', ROUND(v_chargeable, 3), 'freight_cad', v_freight,
    'clearance_cad', v_clearance, 'duty_cad', v_duty, 'insurance_cad', v_insurance,
    'sales_tax_cad', v_tax, 'total_cad', v_total, 'is_estimate', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quote_forwarding_cad(text, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_forwarding_cad(text, numeric, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_ai_forwarding_draft(_draft_id uuid, _expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.ai_forwarding_drafts;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_draft FROM public.ai_forwarding_drafts
   WHERE id = _draft_id AND user_id = auth.uid() FOR UPDATE;
  IF v_draft IS NULL THEN RAISE EXCEPTION 'draft not found'; END IF;
  IF v_draft.status = 'confirmed' THEN
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true,
      'id', v_draft.forwarding_id, 'request_no', v_draft.request_no, 'currency', 'CAD');
  END IF;
  IF v_draft.status <> 'active' OR v_draft.expires_at < now() THEN RAISE EXCEPTION 'draft is not active'; END IF;
  IF _expected_version IS NULL OR v_draft.version <> _expected_version THEN
    RAISE EXCEPTION 'draft changed; review again';
  END IF;
  IF COALESCE(v_draft.draft_data->>'currency', '') <> 'CAD' THEN RAISE EXCEPTION 'draft currency must be CAD'; END IF;

  v_result := public.place_forwarding(v_draft.draft_data, NULL);
  UPDATE public.ai_forwarding_drafts
     SET status = 'confirmed', forwarding_id = (v_result->>'id')::uuid,
         request_no = v_result->>'request_no', confirmed_at = now()
   WHERE id = _draft_id;
  RETURN v_result || jsonb_build_object('currency', 'CAD', 'already_confirmed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_ai_forwarding_draft(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_ai_forwarding_draft(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_ai_forwarding_draft(_draft_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.ai_forwarding_drafts SET status = 'cancelled'
   WHERE id = _draft_id AND user_id = auth.uid() AND status = 'active'
   RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN RAISE EXCEPTION 'active draft not found'; END IF;
  RETURN jsonb_build_object('ok', true, 'draft_id', v_updated, 'status', 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_ai_forwarding_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_ai_forwarding_draft(uuid) TO authenticated;
