-- Remove the 'manual' order classification: all orders are e-commerce (source='shop')
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE source = 'manual');
DELETE FROM public.waybills WHERE order_id IN (SELECT id FROM public.orders WHERE source = 'manual');
DELETE FROM public.orders WHERE source = 'manual';