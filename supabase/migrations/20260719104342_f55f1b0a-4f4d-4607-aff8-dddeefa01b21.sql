DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.google_drive_connections gdc
    WHERE gdc.profile_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.user_id = gdc.user_id AND up.is_default = true
      )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Google Drive connection: default profile is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.google_drive_connections legacy
    JOIN public.user_profiles up
      ON up.user_id = legacy.user_id AND up.is_default = true
    JOIN public.google_drive_connections own
      ON own.user_id = legacy.user_id AND own.profile_id = up.id
    WHERE legacy.profile_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Google Drive connection: both legacy and default-profile rows exist';
  END IF;
END
$$;

UPDATE public.google_drive_connections gdc
SET profile_id = up.id,
    updated_at = now()
FROM public.user_profiles up
WHERE gdc.profile_id IS NULL
  AND up.user_id = gdc.user_id
  AND up.is_default = true;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_id_user_id_unique UNIQUE (id, user_id);

ALTER TABLE public.google_drive_connections
  DROP CONSTRAINT IF EXISTS google_drive_connections_profile_id_fkey;

DROP INDEX IF EXISTS public.google_drive_conn_user_primary_uniq;
DROP INDEX IF EXISTS public.google_drive_conn_user_profile_uniq;

ALTER TABLE public.google_drive_connections
  ALTER COLUMN profile_id SET NOT NULL;

ALTER TABLE public.google_drive_connections
  ADD CONSTRAINT google_drive_connections_profile_owner_fkey
  FOREIGN KEY (profile_id, user_id)
  REFERENCES public.user_profiles (id, user_id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX google_drive_connections_user_profile_unique
  ON public.google_drive_connections (user_id, profile_id);