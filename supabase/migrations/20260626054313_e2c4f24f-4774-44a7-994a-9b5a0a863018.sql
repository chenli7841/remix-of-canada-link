
ALTER TABLE public.admin_action_logs DROP CONSTRAINT IF EXISTS admin_action_logs_entity_type_check;
ALTER TABLE public.admin_action_logs ADD CONSTRAINT admin_action_logs_entity_type_check
  CHECK (entity_type IN ('order','forwarding','waybill','batch','tracking_event','delivery_queue','receiving'));
