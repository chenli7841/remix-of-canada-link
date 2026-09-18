-- Non-secret config for the contact-form email notification (sender/recipient/cc addresses,
-- on/off switch). Deliberately does NOT store the Gmail App Password here — app_settings is
-- world-readable (20260618163353), so the SMTP credential lives in a server-only env var
-- (GMAIL_APP_PASSWORD) instead, never in the database.
INSERT INTO public.app_settings (key, value) VALUES
  ('contact_email_notify', '{
    "enabled": false,
    "from_email": "",
    "to_email": "",
    "cc_emails": []
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
