-- Change default fee scheme preference from 'merged' to 'split' (不合并收费)
ALTER TABLE public.profiles ALTER COLUMN fee_scheme_preference SET DEFAULT 'split';
-- Reset existing profiles that still hold the old default 'merged' to the new default 'split'.
-- (Owner/manager-set overrides remain since they were made via the admin UI just introduced.)
UPDATE public.profiles SET fee_scheme_preference = 'split' WHERE fee_scheme_preference = 'merged';