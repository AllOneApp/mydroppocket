ALTER TABLE public.google_drive_connections
  ADD COLUMN IF NOT EXISTS auto_backup boolean NOT NULL DEFAULT true;