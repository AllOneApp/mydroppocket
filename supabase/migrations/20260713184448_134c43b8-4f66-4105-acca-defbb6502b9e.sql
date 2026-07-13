
CREATE TABLE public.agreement_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_mime text,
  file_size bigint,
  gdrive_file_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_attachments TO authenticated;
GRANT ALL ON public.agreement_attachments TO service_role;

ALTER TABLE public.agreement_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own agreement attachments"
  ON public.agreement_attachments
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_agreement_attachments_agreement ON public.agreement_attachments(agreement_id);

ALTER TABLE public.agreements ADD COLUMN IF NOT EXISTS gdrive_folder_id text;
