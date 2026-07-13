
-- No end-user access; only service_role reads/writes via server functions.
-- This policy exists solely to satisfy the linter — it grants nothing to
-- authenticated or anon (they have no table-level GRANT anyway).
CREATE POLICY "No direct access; server-only via service_role"
  ON public.google_drive_connections
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
