
-- 1. Profile-level drive mode + legacy migration bookkeeping
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS drive_mode text NOT NULL DEFAULT 'shared'
    CHECK (drive_mode IN ('shared', 'separate'));

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legacy_drive_migration_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_drive_migration_done_at timestamptz;

-- 2. google_drive_connections: add nullable profile_id, replace user_id unique
ALTER TABLE public.google_drive_connections
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.google_drive_connections
  DROP CONSTRAINT IF EXISTS google_drive_connections_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS google_drive_conn_user_primary_uniq
  ON public.google_drive_connections (user_id) WHERE profile_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS google_drive_conn_user_profile_uniq
  ON public.google_drive_connections (user_id, profile_id) WHERE profile_id IS NOT NULL;

-- 3. New per-context folder cache table (replaces subfolders_json going forward)
CREATE TABLE IF NOT EXISTS public.google_drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.google_drive_connections(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  category text NOT NULL,
  folder_id text NOT NULL,
  folder_name text NOT NULL,
  parent_folder_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_drive_folders_conn_null_profile_cat_uniq
  ON public.google_drive_folders (connection_id, category) WHERE profile_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS google_drive_folders_conn_profile_cat_uniq
  ON public.google_drive_folders (connection_id, profile_id, category) WHERE profile_id IS NOT NULL;

GRANT ALL ON public.google_drive_folders TO service_role;
ALTER TABLE public.google_drive_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access; server-only via service_role"
  ON public.google_drive_folders
  TO authenticated
  USING (false) WITH CHECK (false);

CREATE TRIGGER google_drive_folders_updated_at
  BEFORE UPDATE ON public.google_drive_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Backfill existing subfolders_json into the new table (profile_id NULL = legacy root layout)
INSERT INTO public.google_drive_folders (connection_id, profile_id, category, folder_id, folder_name, parent_folder_id)
SELECT c.id,
       NULL::uuid,
       kv.key,
       kv.value,
       kv.key,
       c.root_folder_id
FROM public.google_drive_connections c
CROSS JOIN LATERAL jsonb_each_text(COALESCE(c.subfolders_json, '{}'::jsonb)) kv
WHERE c.subfolders_json IS NOT NULL
ON CONFLICT DO NOTHING;
