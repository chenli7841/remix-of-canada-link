CREATE TABLE IF NOT EXISTS public.express_dispatch_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_key text NOT NULL UNIQUE,
 source jsonb NOT NULL,
 number text NOT NULL,
 customer_code text NOT NULL DEFAULT '',
 draft jsonb NOT NULL,
 updated_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.express_dispatch_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.express_dispatch_drafts FROM anon, authenticated;
GRANT ALL ON public.express_dispatch_drafts TO service_role;
