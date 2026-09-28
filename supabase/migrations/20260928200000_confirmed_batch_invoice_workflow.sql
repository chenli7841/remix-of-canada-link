-- Local migration: confirmation is the only batch invoice creation operation.
-- Snapshot, invoice header and invoice lines commit or roll back together.
CREATE OR REPLACE FUNCTION public.confirm_batch_invoice_v2(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bid uuid := (_payload->>'batch_id')::uuid;
  code text := _payload->>'customer_code';
  op uuid := (_payload->>'operator_id')::uuid;
  snap jsonb := _payload->'snapshot';
  lines jsonb := _payload->'lines';
  uid uuid; bno text; inv public.invoices%ROWTYPE; st public.batch_settlements%ROWTYPE;
  dirty timestamptz;
  amount numeric; line_total numeric; f numeric; c numeric; i numeric; o numeric; n integer;
BEGIN
  IF NOT public.is_staff(op) OR (auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM op) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(bid::text || ':' || code, 0));
  SELECT batch_no,fees_dirty_at INTO STRICT bno,dirty FROM public.batches WHERE id=bid FOR UPDATE;
  IF dirty IS DISTINCT FROM (_payload->>'expected_dirty_at')::timestamptz THEN RAISE EXCEPTION '费用在确认期间发生变化，请刷新后重新确认'; END IF;
  SELECT id INTO STRICT uid FROM public.profiles WHERE customer_code=code;
  SELECT * INTO st FROM public.batch_settlements WHERE batch_id=bid AND customer_code=code FOR UPDATE;
  IF st.is_paid THEN RAISE EXCEPTION '已付款账单不能重新确认'; END IF;
  SELECT count(*) INTO n FROM public.invoices WHERE user_id=uid AND type='batch' AND batch_no=bno AND status IN ('unpaid','overdue','paid');
  IF n>1 THEN RAISE EXCEPTION '同一客户批次有多张有效账单，请先核对，不能自动覆盖'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE user_id=uid AND type='batch' AND batch_no=bno AND status IN ('unpaid','overdue','paid') FOR UPDATE;
  IF inv.status='paid' THEN RAISE EXCEPTION '已有已付款账单，不能重新确认'; END IF;
  IF coalesce(inv.paid_cad,0)>0 OR EXISTS(SELECT 1 FROM public.offline_payments WHERE invoice_id=inv.id) THEN RAISE EXCEPTION '账单已有收款记录，请先核对，不能重新生成'; END IF;
  IF st.confirmed AND st.fee_breakdown->>'billing_version'='2' THEN
    IF inv.id IS NULL OR st.fee_breakdown->>'invoice_id' IS DISTINCT FROM inv.id::text OR round(inv.total_cny*inv.fx_rate,2) IS DISTINCT FROM st.subtotal_cad THEN RAISE EXCEPTION '已确认快照与账单不一致，请先取消确认'; END IF;
    RETURN jsonb_build_object('ok',true,'invoice_id',inv.id,'invoice_no',inv.invoice_no);
  END IF;
  IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)=0 THEN RAISE EXCEPTION '缺少账单明细'; END IF;
  amount := (snap->>'subtotal_cad')::numeric;
  SELECT sum((x->>'amount_cny')::numeric), sum((x->>'freight_cny')::numeric), sum((x->>'customs_cny')::numeric), sum((x->>'insurance_cny')::numeric), sum((x->>'other_cny')::numeric)
    INTO line_total,f,c,i,o FROM jsonb_array_elements(lines) x;
  IF amount IS NULL OR amount<0 OR round(line_total,2) IS DISTINCT FROM amount OR round(f+c+i+o,2) IS DISTINCT FROM amount THEN RAISE EXCEPTION '账单总额、分类金额和明细不一致'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(lines) x WHERE (x->>'amount_cny') IS NULL OR (x->>'amount_cny')::numeric IS DISTINCT FROM ((x->>'freight_cny')::numeric+(x->>'customs_cny')::numeric+(x->>'insurance_cny')::numeric+(x->>'other_cny')::numeric)) THEN RAISE EXCEPTION '账单明细缺少金额或分类不一致'; END IF;
  -- CAD amounts use fx_rate=1 in legacy *_cny columns; all readers multiply by fx_rate.
  IF inv.id IS NULL THEN
    INSERT INTO public.invoices(user_id,type,status,batch_no,subtotal_cny,total_cny,freight_cny,customs_cny,insurance_cny,other_cny,fx_rate,currency,due_date,created_by,note)
    VALUES(uid,'batch','unpaid',bno,amount,amount,f,c,i,o,1,'CAD',current_date+7,op,'批次 '||bno||' · 已确认账单 v2') RETURNING * INTO inv;
  ELSE
    UPDATE public.invoices SET subtotal_cny=amount,total_cny=amount,freight_cny=f,customs_cny=c,insurance_cny=i,other_cny=o,fx_rate=1,currency='CAD',note='批次 '||bno||' · 已确认账单 v2' WHERE id=inv.id RETURNING * INTO inv;
    DELETE FROM public.invoice_items WHERE invoice_id=inv.id;
  END IF;
  INSERT INTO public.invoice_items(invoice_id,description,amount_cny,freight_cny,customs_cny,insurance_cny,other_cny,meta)
  SELECT inv.id,x->>'description',(x->>'amount_cny')::numeric,(x->>'freight_cny')::numeric,(x->>'customs_cny')::numeric,(x->>'insurance_cny')::numeric,(x->>'other_cny')::numeric,x->'meta' FROM jsonb_array_elements(lines) x;
  INSERT INTO public.batch_settlements(batch_id,customer_code,confirmed,confirmed_by,confirmed_at,subtotal_cad,waybill_count,carton_count,pallet_count,route_codes,is_paid,fee_breakdown,snapshot_at,calc_version)
  VALUES(bid,code,true,op,now(),amount,(snap->>'waybill_count')::integer,(snap->>'carton_count')::integer,(snap->>'pallet_count')::integer,snap->>'route_codes',false,
    (snap->'fee_breakdown')||jsonb_build_object('invoice_id',inv.id,'invoice_no',inv.invoice_no,'billing_version',2),now(),2)
  ON CONFLICT(batch_id,customer_code) DO UPDATE SET confirmed=true,confirmed_by=op,confirmed_at=now(),subtotal_cad=excluded.subtotal_cad,waybill_count=excluded.waybill_count,carton_count=excluded.carton_count,pallet_count=excluded.pallet_count,route_codes=excluded.route_codes,fee_breakdown=excluded.fee_breakdown,snapshot_at=excluded.snapshot_at,calc_version=2;
  RETURN jsonb_build_object('ok',true,'invoice_id',inv.id,'invoice_no',inv.invoice_no);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_batch_invoice_v2(_batch_id uuid,_customer_code text,_operator_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid; bno text;
BEGIN
  IF NOT public.is_staff(_operator_id) OR (auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM _operator_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_batch_id::text||':'||_customer_code,0));
  SELECT batch_no INTO STRICT bno FROM public.batches WHERE id=_batch_id FOR UPDATE;
  SELECT id INTO STRICT uid FROM public.profiles WHERE customer_code=_customer_code;
  PERFORM 1 FROM public.invoices WHERE user_id=uid AND type='batch' AND batch_no=bno FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.invoices WHERE user_id=uid AND type='batch' AND batch_no=bno AND (status='paid' OR coalesce(paid_cad,0)>0)) THEN RAISE EXCEPTION '已有收款记录的账单不能取消确认'; END IF;
  UPDATE public.batch_settlements SET confirmed=false,confirmed_at=null,confirmed_by=null,fee_breakdown=fee_breakdown-'invoice_id'-'invoice_no'-'billing_version' WHERE batch_id=_batch_id AND customer_code=_customer_code;
  UPDATE public.invoices SET status='void',note=coalesce(note,'')||' · 取消确认' WHERE user_id=uid AND type='batch' AND batch_no=bno AND status IN ('unpaid','overdue');
END $$;

CREATE OR REPLACE FUNCTION public.settle_confirmed_batch_invoice_v2(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  bid uuid:=(_payload->>'batch_id')::uuid; uid uuid:=(_payload->>'customer_user_id')::uuid;
  code text; bno text; inv public.invoices%ROWTYPE; st public.batch_settlements%ROWTYPE;
  amount numeric; expected numeric:=(_payload->>'expected_cad')::numeric; result jsonb; n integer;
BEGIN
  SELECT customer_code INTO STRICT code FROM public.profiles WHERE id=uid;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR (auth.uid()<>uid AND NOT public.is_staff(auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
    IF NOT public.is_staff(auth.uid()) AND (_payload->>'method' IS DISTINCT FROM 'wallet' OR NOT coalesce((_payload->>'enforce_balance')::boolean,false)) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  END IF;
  IF coalesce(_payload->>'method','') NOT IN ('wallet','emt','cash') THEN RAISE EXCEPTION '不支持的收款方式'; END IF;
  IF coalesce((_payload->>'discount_cad')::numeric,0)<>0 THEN RAISE EXCEPTION '收款不能追加折扣，请取消确认后修改费用再确认'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(bid::text||':'||code,0));
  SELECT batch_no INTO STRICT bno FROM public.batches WHERE id=bid FOR UPDATE;
  SELECT * INTO st FROM public.batch_settlements WHERE batch_id=bid AND customer_code=code FOR UPDATE;
  IF st.confirmed IS DISTINCT FROM true OR st.fee_breakdown->>'billing_version' IS DISTINCT FROM '2' THEN RAISE EXCEPTION '请先确认价格并生成统一账单'; END IF;
  SELECT count(*) INTO n FROM public.invoices WHERE user_id=uid AND type='batch' AND batch_no=bno AND status IN ('unpaid','overdue','paid');
  IF n<>1 THEN RAISE EXCEPTION '账单不存在或存在重复账单，请先核对'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE id=(st.fee_breakdown->>'invoice_id')::uuid AND user_id=uid AND type='batch' AND batch_no=bno FOR UPDATE;
  IF inv.id IS NULL OR inv.status NOT IN ('unpaid','overdue','paid') THEN RAISE EXCEPTION '关联账单不存在或已失效'; END IF;
  IF inv.status='paid' THEN RETURN jsonb_build_object('ok',false,'reason','already_paid'); END IF;
  IF EXISTS(SELECT 1 FROM public.offline_payments WHERE invoice_id=inv.id) THEN RAISE EXCEPTION '账单已有线下收款记录，请先核对，不能重复结算'; END IF;
  amount:=round(inv.total_cny*inv.fx_rate,2);
  IF inv.fx_rate IS NULL OR inv.fx_rate<=0 OR amount IS NULL OR expected IS NULL OR amount IS DISTINCT FROM expected OR amount IS DISTINCT FROM st.subtotal_cad THEN RAISE EXCEPTION '账单、批次显示与扣款金额不一致，请刷新并核对'; END IF;
  IF round((SELECT sum(amount_cny) FROM public.invoice_items WHERE invoice_id=inv.id)*inv.fx_rate,2) IS DISTINCT FROM amount THEN RAISE EXCEPTION '账单明细与总额不一致，禁止收款'; END IF;
  IF amount=0 THEN RETURN jsonb_build_object('ok',false,'reason','nothing_to_pay'); END IF;
  result:=public.settle_batch_customer_txn(_payload||jsonb_build_object('customer_code',code,'discount_cad',0));
  IF (result->>'ok')::boolean AND ((result->>'paid_cad')::numeric IS DISTINCT FROM amount OR result->>'invoice_id' IS DISTINCT FROM inv.id::text) THEN RAISE EXCEPTION '实际结算金额或账单发生变化，交易已回滚'; END IF;
  IF (result->>'ok')::boolean AND _payload->>'method' IN ('emt','cash') THEN
    INSERT INTO public.offline_payments(invoice_id,method,amount_cad,reference,paid_at,note,recorded_by,attachment_url)
    VALUES(inv.id,coalesce(_payload->'receipt'->>'method',CASE WHEN _payload->>'method'='emt' THEN 'interac' ELSE 'cash' END),amount,_payload->>'ref_no',coalesce((_payload->'receipt'->>'paid_at')::timestamptz,now()),_payload->>'note',(_payload->>'operator_id')::uuid,_payload->'receipt'->>'attachment_url');
  END IF;
  RETURN result;
END $$;

-- Old settlement already requires an invoice. Do not classify fee-only invoices as paid.
DO $$ DECLARE d text; old text; BEGIN
  d:=replace(pg_get_functiondef('public.settle_batch_customer_txn(jsonb)'::regprocedure),chr(13),'');
  old:=$s$IF v_wb_ids IS NULL OR array_length\(v_wb_ids, 1\) IS NULL THEN\s+RETURN jsonb_build_object\('ok', false, 'reason', 'already_paid'\);\s+END IF;$s$;
  IF d ~ old THEN
    d:=regexp_replace(d,old,'v_wb_ids := COALESCE(v_wb_ids, ARRAY[]::uuid[]);'); EXECUTE d;
  ELSIF position('v_wb_ids := COALESCE(v_wb_ids, ARRAY[]::uuid[])' in d)=0 THEN
    RAISE EXCEPTION 'Unexpected settlement definition: inspect before applying migration';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.confirm_batch_invoice_v2(jsonb),public.cancel_batch_invoice_v2(uuid,text,uuid),public.settle_confirmed_batch_invoice_v2(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_batch_invoice_v2(jsonb),public.cancel_batch_invoice_v2(uuid,text,uuid),public.settle_confirmed_batch_invoice_v2(jsonb) TO authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.settle_batch_customer_txn(jsonb) FROM authenticated,anon,PUBLIC;

-- Refreshes and legacy editing paths cannot silently change a confirmed bill.
CREATE OR REPLACE FUNCTION public.protect_confirmed_batch_snapshot_v2()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.confirmed AND NEW.confirmed AND OLD.fee_breakdown->>'billing_version'='2'
     AND (NEW.subtotal_cad IS DISTINCT FROM OLD.subtotal_cad OR NEW.fee_breakdown IS DISTINCT FROM OLD.fee_breakdown) THEN
    RAISE EXCEPTION '已确认账单已冻结，请先取消确认再修改费用';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_confirmed_batch_snapshot_v2 ON public.batch_settlements;
CREATE TRIGGER protect_confirmed_batch_snapshot_v2 BEFORE UPDATE ON public.batch_settlements FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_batch_snapshot_v2();

CREATE OR REPLACE FUNCTION public.protect_confirmed_batch_invoice_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE iid uuid;
BEGIN
  IF TG_TABLE_NAME='invoice_items' THEN
    IF TG_OP='INSERT' THEN iid:=NEW.invoice_id; ELSE iid:=OLD.invoice_id; END IF;
  ELSE iid:=OLD.id; END IF;
  IF EXISTS(SELECT 1 FROM public.batch_settlements WHERE confirmed AND fee_breakdown->>'billing_version'='2' AND fee_breakdown->>'invoice_id'=iid::text) THEN
    IF TG_TABLE_NAME='invoice_items' OR TG_OP='DELETE' THEN RAISE EXCEPTION '已确认批次账单不能修改明细、删除、合并或拆分，请先取消确认'; END IF;
    IF NEW.total_cny IS DISTINCT FROM OLD.total_cny OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate OR NEW.status='void'
      OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.batch_no IS DISTINCT FROM OLD.batch_no
      OR NEW.freight_cny IS DISTINCT FROM OLD.freight_cny OR NEW.customs_cny IS DISTINCT FROM OLD.customs_cny
      OR NEW.insurance_cny IS DISTINCT FROM OLD.insurance_cny OR NEW.other_cny IS DISTINCT FROM OLD.other_cny
    THEN RAISE EXCEPTION '已确认批次账单金额已冻结'; END IF;
    IF NEW.status='paid' AND (NEW.paid_cad IS DISTINCT FROM round(OLD.total_cny*OLD.fx_rate,2) OR NEW.paid_cny IS DISTINCT FROM OLD.total_cny) THEN RAISE EXCEPTION '实收金额必须与账单金额一致，请通过批次收款操作'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_confirmed_batch_invoice_v2 ON public.invoices;
CREATE TRIGGER protect_confirmed_batch_invoice_v2 BEFORE UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_batch_invoice_v2();
DROP TRIGGER IF EXISTS protect_confirmed_batch_invoice_items_v2 ON public.invoice_items;
CREATE TRIGGER protect_confirmed_batch_invoice_items_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.protect_confirmed_batch_invoice_v2();
