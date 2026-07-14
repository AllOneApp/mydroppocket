
-- Google Calendar connection (separate from Drive; same OAuth client with different scopes)
CREATE TABLE public.google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  google_email text NOT NULL,
  google_sub text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  calendar_id text,
  calendar_name text NOT NULL DEFAULT 'MyDropPocket',
  sync_installments boolean NOT NULL DEFAULT true,
  reminder_minutes integer[] NOT NULL DEFAULT ARRAY[1440]::integer[],
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_connections TO authenticated;
GRANT ALL ON public.google_calendar_connections TO service_role;

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own calendar connection"
  ON public.google_calendar_connections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_google_calendar_connections_updated_at
  BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tracks events we created in Google Calendar to prevent duplicates and support updates
CREATE TABLE public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL,        -- e.g. 'installment' (future: 'recurring','warranty','agreement_end')
  source_id uuid NOT NULL,          -- the originating record id (agreements.id etc.)
  sequence integer NOT NULL DEFAULT 0, -- which payment/occurrence this event represents
  google_event_id text NOT NULL,
  calendar_id text NOT NULL,
  event_date date NOT NULL,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'deleted'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own calendar event tracking"
  ON public.calendar_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_calendar_events_user_source ON public.calendar_events(user_id, source_type, source_id);
