
CREATE TABLE public.google_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  google_sub text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  root_folder_id text,
  root_folder_name text NOT NULL DEFAULT 'MyDropPocket',
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.google_drive_connections TO service_role;

ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER google_drive_connections_updated_at
  BEFORE UPDATE ON public.google_drive_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
