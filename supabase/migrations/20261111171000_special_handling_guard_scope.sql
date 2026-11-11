CREATE OR REPLACE FUNCTION public.protect_special_handling_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.id='c5ec1a10-1111-4111-8111-000000000001' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION '特殊处理订单是常驻批次，不能删除'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.batch_no IS DISTINCT FROM OLD.batch_no OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
   RAISE EXCEPTION '特殊处理订单暂仅后台使用，不可关闭、改名或启用普通批次状态';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

