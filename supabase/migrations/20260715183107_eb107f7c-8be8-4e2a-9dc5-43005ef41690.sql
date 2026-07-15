
DO $$ BEGIN
  CREATE TYPE public.profile_type AS ENUM ('personal', 'family', 'company', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.profile_type NOT NULL DEFAULT 'personal',
  avatar_url text,
  color text NOT NULL DEFAULT '#3b82f6',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_user_id_idx ON public.user_profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_one_default_per_user
  ON public.user_profiles(user_id) WHERE is_default = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own profiles" ON public.user_profiles;
CREATE POLICY "Users manage own profiles" ON public.user_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforce_user_profile_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO cnt FROM public.user_profiles WHERE user_id = NEW.user_id;
    IF cnt >= 10 THEN
      RAISE EXCEPTION 'Maksimaalselt 10 profiili kasutaja kohta';
    END IF;
  END IF;

  IF NEW.is_default THEN
    UPDATE public.user_profiles
       SET is_default = false
     WHERE user_id = NEW.user_id
       AND id <> NEW.id
       AND is_default = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_rules ON public.user_profiles;
CREATE TRIGGER user_profiles_rules
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_profile_rules();

INSERT INTO public.user_profiles (user_id, name, type, is_default, color)
SELECT u.id, 'Isiklik', 'personal', true, '#3b82f6'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_profiles p WHERE p.user_id = u.id
);

ALTER TABLE public.warranties                  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.expenses                    ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.agreements                  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.recurring_payments          ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.recurring_payment_instances ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS warranties_profile_id_idx                  ON public.warranties(profile_id);
CREATE INDEX IF NOT EXISTS expenses_profile_id_idx                    ON public.expenses(profile_id);
CREATE INDEX IF NOT EXISTS agreements_profile_id_idx                  ON public.agreements(profile_id);
CREATE INDEX IF NOT EXISTS recurring_payments_profile_id_idx          ON public.recurring_payments(profile_id);
CREATE INDEX IF NOT EXISTS recurring_payment_instances_profile_id_idx ON public.recurring_payment_instances(profile_id);

UPDATE public.warranties w
   SET profile_id = p.id
  FROM public.user_profiles p
 WHERE w.profile_id IS NULL AND p.user_id = w.user_id AND p.is_default = true;

UPDATE public.expenses e
   SET profile_id = p.id
  FROM public.user_profiles p
 WHERE e.profile_id IS NULL AND p.user_id = e.user_id AND p.is_default = true;

UPDATE public.agreements a
   SET profile_id = p.id
  FROM public.user_profiles p
 WHERE a.profile_id IS NULL AND p.user_id = a.user_id AND p.is_default = true;

UPDATE public.recurring_payments r
   SET profile_id = p.id
  FROM public.user_profiles p
 WHERE r.profile_id IS NULL AND p.user_id = r.user_id AND p.is_default = true;

UPDATE public.recurring_payment_instances i
   SET profile_id = r.profile_id
  FROM public.recurring_payments r
 WHERE i.profile_id IS NULL AND r.id = i.recurring_payment_id;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_profiles (user_id, name, type, is_default, color)
  VALUES (NEW.id, 'Isiklik', 'personal', true, '#3b82f6')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;
