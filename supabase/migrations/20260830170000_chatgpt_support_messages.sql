-- EPLUS GPT / website support inbox. This does not copy private ChatGPT conversation text.
CREATE TABLE IF NOT EXISTS public.ai_support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_code text NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread_for_customer integer NOT NULL DEFAULT 0 CHECK (unread_for_customer >= 0),
  unread_for_staff integer NOT NULL DEFAULT 0 CHECK (unread_for_staff >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_user_id)
);

CREATE TABLE IF NOT EXISTS public.ai_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.ai_support_threads(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'staff', 'system')),
  source text NOT NULL DEFAULT 'chatgpt' CHECK (source IN ('chatgpt', 'website', 'admin', 'system')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  read_by_customer_at timestamptz,
  read_by_staff_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_support_threads_recent ON public.ai_support_threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS ai_support_messages_thread ON public.ai_support_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_support_messages_customer ON public.ai_support_messages(customer_user_id, created_at DESC);

ALTER TABLE public.ai_support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_support_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_support_threads, public.ai_support_messages TO authenticated;
GRANT ALL ON public.ai_support_threads, public.ai_support_messages TO service_role;

DROP POLICY IF EXISTS "customers read own support thread" ON public.ai_support_threads;
CREATE POLICY "customers read own support thread" ON public.ai_support_threads
  FOR SELECT TO authenticated USING (customer_user_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "customers read own support messages" ON public.ai_support_messages;
CREATE POLICY "customers read own support messages" ON public.ai_support_messages
  FOR SELECT TO authenticated USING (customer_user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.chatgpt_send_my_support_message(_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_code text; v_thread uuid; v_message public.ai_support_messages;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid message'; END IF;
  SELECT customer_code INTO v_code FROM public.profiles WHERE id = v_uid;
  IF v_code IS NULL THEN RAISE EXCEPTION 'customer profile not found' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.ai_support_threads(customer_user_id, customer_code, last_message_at, unread_for_staff)
  VALUES (v_uid, v_code, now(), 1)
  ON CONFLICT (customer_user_id) DO UPDATE SET customer_code = EXCLUDED.customer_code, last_message_at = now(), unread_for_staff = ai_support_threads.unread_for_staff + 1, updated_at = now()
  RETURNING id INTO v_thread;
  INSERT INTO public.ai_support_messages(thread_id, customer_user_id, sender_user_id, sender_role, source, body, read_by_customer_at)
  VALUES (v_thread, v_uid, v_uid, 'customer', 'chatgpt', trim(_body), now()) RETURNING * INTO v_message;
  RETURN to_jsonb(v_message);
END; $$;

CREATE OR REPLACE FUNCTION public.chatgpt_list_my_support_messages(_limit integer DEFAULT 20)
RETURNS SETOF public.ai_support_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  UPDATE public.ai_support_messages SET read_by_customer_at = coalesce(read_by_customer_at, now()) WHERE customer_user_id = auth.uid() AND sender_role <> 'customer';
  UPDATE public.ai_support_threads SET unread_for_customer = 0, updated_at = now() WHERE customer_user_id = auth.uid();
  RETURN QUERY SELECT * FROM public.ai_support_messages WHERE customer_user_id = auth.uid() ORDER BY created_at DESC LIMIT least(greatest(coalesce(_limit, 20), 1), 50);
END; $$;

CREATE OR REPLACE FUNCTION public.chatgpt_staff_send_support_message(_customer_code text, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_customer uuid; v_code text; v_thread uuid; v_message public.ai_support_messages;
BEGIN
  IF NOT (public.has_role(v_uid, 'owner') OR public.has_role(v_uid, 'manager')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(_body, ''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid message'; END IF;
  SELECT id, customer_code INTO v_customer, v_code FROM public.profiles WHERE customer_code = trim(_customer_code);
  IF v_customer IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  INSERT INTO public.ai_support_threads(customer_user_id, customer_code, last_message_at, unread_for_customer)
  VALUES (v_customer, v_code, now(), 1)
  ON CONFLICT (customer_user_id) DO UPDATE SET customer_code = EXCLUDED.customer_code, last_message_at = now(), unread_for_customer = ai_support_threads.unread_for_customer + 1, updated_at = now()
  RETURNING id INTO v_thread;
  INSERT INTO public.ai_support_messages(thread_id, customer_user_id, sender_user_id, sender_role, source, body, read_by_staff_at)
  VALUES (v_thread, v_customer, v_uid, 'staff', 'chatgpt', trim(_body), now()) RETURNING * INTO v_message;
  RETURN to_jsonb(v_message);
END; $$;

REVOKE ALL ON FUNCTION public.chatgpt_send_my_support_message(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chatgpt_list_my_support_messages(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chatgpt_staff_send_support_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chatgpt_send_my_support_message(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chatgpt_list_my_support_messages(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chatgpt_staff_send_support_message(text, text) TO authenticated;
