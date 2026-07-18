
ALTER TABLE public.google_drive_connections
  ADD COLUMN IF NOT EXISTS backup_format text NOT NULL DEFAULT 'excel_pdf'
  CHECK (backup_format IN ('excel_pdf','excel_only','pdf_only'));
