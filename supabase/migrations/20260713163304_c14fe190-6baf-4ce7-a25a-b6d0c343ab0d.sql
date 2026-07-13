
ALTER TABLE public.warranties ADD COLUMN IF NOT EXISTS gdrive_file_id text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS gdrive_file_id text;
ALTER TABLE public.agreements ADD COLUMN IF NOT EXISTS gdrive_file_id text;
ALTER TABLE public.recurring_payments ADD COLUMN IF NOT EXISTS contract_gdrive_file_id text;
ALTER TABLE public.recurring_payment_instances ADD COLUMN IF NOT EXISTS receipt_gdrive_file_id text;
ALTER TABLE public.recurring_payment_instances ADD COLUMN IF NOT EXISTS invoice_gdrive_file_id text;
ALTER TABLE public.google_drive_connections ADD COLUMN IF NOT EXISTS subfolders_json jsonb;
