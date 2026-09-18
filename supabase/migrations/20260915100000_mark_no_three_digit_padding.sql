-- 唛头号（mark_no）里的箱序号/总箱数之前写死按2位补零，超过99箱（比如800箱的
-- 大单）就变成宽度不统一的"1/800"~"800/800"，不会撞号丢数据，但打出来的标签
-- 不对齐。改成3位，跟box_no的补零位数一致，覆盖到999箱。

CREATE OR REPLACE FUNCTION public.recompute_mark_nos_for_parent(
  _order_id uuid, _forwarding_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cust text; ono text; last5 text; total int;
BEGIN
  IF _order_id IS NOT NULL THEN
    SELECT customer_code, order_no INTO cust, ono FROM public.orders WHERE id = _order_id;
    last5 := lpad(right(regexp_replace(COALESCE(ono,''),'\D','','g'),5),5,'0');
    SELECT count(*) INTO total FROM public.waybills WHERE order_id = _order_id;
    IF total > 0 THEN
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
          FROM public.waybills WHERE order_id = _order_id)
      UPDATE public.waybills w
         SET mark_no = lpad(COALESCE(cust,''),5,'0') || '-' || last5
                       || '-' || lpad(o.rn::text,3,'0') || '/' || lpad(total::text,3,'0')
        FROM ordered o WHERE w.id = o.id;
    END IF;
  ELSIF _forwarding_id IS NOT NULL THEN
    SELECT customer_code, request_no INTO cust, ono FROM public.forwarding_orders WHERE id = _forwarding_id;
    last5 := lpad(right(regexp_replace(COALESCE(ono,''),'\D','','g'),5),5,'0');
    SELECT count(*) INTO total FROM public.waybills WHERE forwarding_id = _forwarding_id;
    IF total > 0 THEN
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
          FROM public.waybills WHERE forwarding_id = _forwarding_id)
      UPDATE public.waybills w
         SET mark_no = lpad(COALESCE(cust,''),5,'0') || '-' || last5
                       || '-' || lpad(o.rn::text,3,'0') || '/' || lpad(total::text,3,'0')
        FROM ordered o WHERE w.id = o.id;
    END IF;
  END IF;
END $$;
