-- Invoice header info, editable by the customer under 我的账户 → 个人资料.
-- Separate from full_name/phone/email (login identity) and reg_* (used for
-- forwarding declarations) — these four are specifically what flows onto
-- the generated invoice's "付款方" block (see InvoiceDocument.tsx), so a
-- business customer can put their company name/billing address there
-- instead of their personal account details.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invoice_title text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invoice_phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invoice_email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invoice_address text;
