-- Contact page: real "留言" submissions (name/email/phone/message) instead of a form that
-- just alert()s and throws the input away, plus a staff-facing inbox to read them.
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT SELECT, UPDATE ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can submit a message" ON public.contact_messages;
CREATE POLICY "anyone can submit a message" ON public.contact_messages
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "staff can read messages" ON public.contact_messages;
CREATE POLICY "staff can read messages" ON public.contact_messages
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff can update messages" ON public.contact_messages;
CREATE POLICY "staff can update messages" ON public.contact_messages
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON public.contact_messages(created_at DESC);

-- Office info shown on /contact — editable at /admin/system → 办公室信息.
-- app_settings is already world-readable (20260618163353), so the public page can read this
-- directly with no new RLS.
INSERT INTO public.app_settings (key, value) VALUES
  ('contact_offices', '{
    "ca": {
      "label_zh": "多伦多总部", "label_en": "Toronto HQ",
      "address": "200 King St W, Toronto, ON M5H 3T4",
      "phone": "+1 (416) 000-0000", "email": "support@sinocargo.app",
      "hours_zh": "周一至周六 9:00–21:00 EST", "hours_en": "Mon–Sat 9:00–21:00 EST"
    },
    "cn": {
      "label_zh": "广州集运中心", "label_en": "Guangzhou Warehouse",
      "address": "广东省广州市白云区机场路 88 号",
      "phone": "+86 20 0000-0000", "email": "warehouse@sinocargo.app",
      "hours_zh": "周一至周六 9:00–18:00 CST", "hours_en": "Mon–Sat 9:00–18:00 CST"
    }
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
