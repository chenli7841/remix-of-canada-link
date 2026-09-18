ALTER TABLE public.addresses ADD COLUMN IF NOT EXISTS destination_code text;
GRANT SELECT ON public.destinations TO authenticated;
