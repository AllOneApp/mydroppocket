
-- 1) user_profiles: calendar_mode
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS calendar_mode text NOT NULL DEFAULT 'shared',
  ADD CONSTRAINT user_profiles_calendar_mode_chk CHECK (calendar_mode IN ('shared','separate'));

-- 2) google_calendar_connections: profile_id + adjust uniqueness
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS profile_id uuid NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.google_calendar_connections
  DROP CONSTRAINT IF EXISTS google_calendar_connections_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_user_primary_key
  ON public.google_calendar_connections (user_id)
  WHERE profile_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_connections_user_profile_key
  ON public.google_calendar_connections (user_id, profile_id)
  WHERE profile_id IS NOT NULL;

-- 3) calendar_events: profile_id + updated uniqueness
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS profile_id uuid NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- backfill: current rows belong to the default profile of that user
UPDATE public.calendar_events ce
   SET profile_id = up.id
  FROM public.user_profiles up
 WHERE ce.profile_id IS NULL
   AND up.user_id = ce.user_id
   AND up.is_default = true;

DROP INDEX IF EXISTS public.calendar_events_user_source_seq_key;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_user_profile_source_seq_key
  ON public.calendar_events (user_id, COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type, source_id, sequence);

CREATE INDEX IF NOT EXISTS idx_calendar_events_profile
  ON public.calendar_events (user_id, profile_id, source_type);
