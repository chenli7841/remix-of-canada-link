-- Preserve existing menu permissions and ordering; insert immediately after delivery queue.
DO $$
DECLARE anchor public.admin_nav_items%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_nav_items WHERE path='/admin/express-labels') THEN RETURN; END IF;
  SELECT * INTO anchor FROM public.admin_nav_items WHERE path='/admin/delivery-queue' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery queue menu entry is missing'; END IF;
  UPDATE public.admin_nav_items SET item_sort_order=item_sort_order+1
    WHERE group_title=anchor.group_title AND item_sort_order>anchor.item_sort_order;
  INSERT INTO public.admin_nav_items(path,label,icon,group_title,group_sort_order,item_sort_order,roles)
    VALUES('/admin/express-labels','快递面单打印','FileText',anchor.group_title,anchor.group_sort_order,anchor.item_sort_order+1,anchor.roles);
END $$;
