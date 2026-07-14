
-- Allow multiple calendar events per source (installments already need this per-payment; recurring will too)
ALTER TABLE public.calendar_events DROP CONSTRAINT IF EXISTS calendar_events_user_id_source_type_source_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_user_source_seq_key
  ON public.calendar_events (user_id, source_type, source_id, sequence);

-- Per-module sync toggles and reminder configs on the calendar connection
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS sync_recurring boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sync_warranties boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sync_agreements boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS warranty_reminder_days integer[] NOT NULL DEFAULT ARRAY[30,7,0]::integer[],
  ADD COLUMN IF NOT EXISTS agreement_reminder_days integer[] NOT NULL DEFAULT ARRAY[30,7,0]::integer[];
