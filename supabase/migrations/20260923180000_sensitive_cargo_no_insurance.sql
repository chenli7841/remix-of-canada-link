-- Sensitive cargo is not insurable. Enforce every RPC/client write at the database boundary.
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_sensitive_insurance() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE sensitive boolean; old_insurance numeric;
BEGIN
  IF TG_TABLE_NAME = 'freight_rules' THEN
    SELECT cargo_type = 'sensitive' INTO sensitive FROM public.shipping_routes WHERE id = NEW.route_id;
    IF sensitive THEN NEW.insurance_rate_pct := 0; END IF;
  ELSIF TG_TABLE_NAME = 'forwarding_orders' THEN
    SELECT cargo_type = 'sensitive' INTO sensitive FROM public.shipping_routes WHERE id = NEW.route_id;
    IF sensitive THEN
      NEW.insured := false;
      NEW.insurance_cny := 0;
      IF NEW.freight_snapshot IS NOT NULL THEN
        old_insurance := coalesce((NEW.freight_snapshot->>'insurance_cad')::numeric, 0);
        IF NEW.freight_snapshot ? 'total_cad' THEN
          NEW.freight_snapshot := jsonb_set(NEW.freight_snapshot, '{total_cad}', to_jsonb(greatest(0, (NEW.freight_snapshot->>'total_cad')::numeric - old_insurance)));
        END IF;
        NEW.freight_snapshot := NEW.freight_snapshot || '{"insurance_cad":0,"insurance_rate_pct":0,"insured":false}'::jsonb;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'waybills' THEN
    SELECT r.cargo_type = 'sensitive' INTO sensitive
    FROM public.shipping_routes r
    WHERE r.id = coalesce((SELECT route_id FROM public.forwarding_orders WHERE id = NEW.forwarding_id), (SELECT route_id FROM public.orders WHERE id = NEW.order_id));
    -- Settled records are accounting history; this rule applies to new/unpaid charges.
    IF sensitive AND NEW.payment_status IS DISTINCT FROM 'paid' THEN NEW.insurance_cad := 0; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER enforce_sensitive_freight_insurance
BEFORE INSERT OR UPDATE ON public.freight_rules
FOR EACH ROW EXECUTE FUNCTION public.enforce_sensitive_insurance();
CREATE OR REPLACE TRIGGER enforce_sensitive_forwarding_insurance
BEFORE INSERT OR UPDATE OF route_id, insured, insurance_cny, freight_snapshot ON public.forwarding_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_sensitive_insurance();
CREATE OR REPLACE TRIGGER enforce_sensitive_waybill_insurance
BEFORE INSERT OR UPDATE OF forwarding_id, order_id, insurance_cad ON public.waybills
FOR EACH ROW EXECUTE FUNCTION public.enforce_sensitive_insurance();

-- Cargo classification edits must also clear forward/reverse freight rules.
CREATE OR REPLACE FUNCTION public.sync_sensitive_route_insurance() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cargo_type = 'sensitive' THEN
    UPDATE public.freight_rules SET insurance_rate_pct = 0 WHERE route_id = NEW.id AND insurance_rate_pct <> 0;
    UPDATE public.forwarding_orders SET insured = false
    WHERE route_id = NEW.id AND payment_status = 'unpaid';
    UPDATE public.waybills w SET insurance_cad = 0
    WHERE w.payment_status = 'unpaid' AND w.insurance_cad <> 0
      AND (EXISTS(SELECT 1 FROM public.forwarding_orders f WHERE f.id=w.forwarding_id AND f.route_id=NEW.id)
        OR EXISTS(SELECT 1 FROM public.orders o WHERE o.id=w.order_id AND o.route_id=NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER sync_sensitive_route_insurance
AFTER UPDATE OF cargo_type ON public.shipping_routes
FOR EACH ROW EXECUTE FUNCTION public.sync_sensitive_route_insurance();

-- Existing data: save original values before clearing sensitive rules and unpaid charges.
INSERT INTO public.admin_action_logs(action,entity_type,entity_id,"before",note)
SELECT 'sensitive_insurance_cleanup_20260923','freight_rule',f.id::text,to_jsonb(f),'Sensitive cargo: insurance rate fixed at zero'
FROM public.freight_rules f JOIN public.shipping_routes r ON r.id=f.route_id
WHERE r.cargo_type='sensitive' AND f.insurance_rate_pct<>0;
UPDATE public.freight_rules f SET insurance_rate_pct=0 FROM public.shipping_routes r
WHERE r.id=f.route_id AND r.cargo_type='sensitive' AND f.insurance_rate_pct<>0;

INSERT INTO public.admin_action_logs(action,entity_type,entity_id,"before",note)
SELECT 'sensitive_insurance_cleanup_20260923','waybill',w.id::text,to_jsonb(w),'Sensitive cargo: clear unpaid insurance only'
FROM public.waybills w JOIN public.forwarding_orders f ON f.id=w.forwarding_id JOIN public.shipping_routes r ON r.id=f.route_id
WHERE r.cargo_type='sensitive' AND w.payment_status='unpaid' AND w.insurance_cad<>0;
UPDATE public.waybills w SET insurance_cad=0 FROM public.forwarding_orders f, public.shipping_routes r
WHERE f.id=w.forwarding_id AND r.id=f.route_id AND r.cargo_type='sensitive' AND w.payment_status='unpaid' AND w.insurance_cad<>0;

INSERT INTO public.admin_action_logs(action,entity_type,entity_id,"before",note)
SELECT 'sensitive_insurance_cleanup_20260923','forwarding',f.id::text,to_jsonb(f),'Sensitive cargo: clear unpaid insurance and insurance snapshot'
FROM public.forwarding_orders f JOIN public.shipping_routes r ON r.id=f.route_id
WHERE r.cargo_type='sensitive' AND f.payment_status='unpaid' AND (f.insured OR f.insurance_cny<>0 OR coalesce((f.freight_snapshot->>'insurance_cad')::numeric,0)<>0);
UPDATE public.forwarding_orders f SET insured=false FROM public.shipping_routes r
WHERE r.id=f.route_id AND r.cargo_type='sensitive' AND f.payment_status='unpaid' AND (f.insured OR f.insurance_cny<>0 OR coalesce((f.freight_snapshot->>'insurance_cad')::numeric,0)<>0);
COMMIT;
