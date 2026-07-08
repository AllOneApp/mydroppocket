
-- Update updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  theme TEXT NOT NULL DEFAULT 'light',
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON public.profiles FOR ALL
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- WARRANTIES
CREATE TABLE public.warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  store TEXT,
  purchase_date DATE,
  warranty_expiry DATE,
  amount NUMERIC(12,2),
  currency TEXT DEFAULT 'EUR',
  notes TEXT,
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  ocr_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranties TO authenticated;
GRANT ALL ON public.warranties TO service_role;
ALTER TABLE public.warranties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warranties_own" ON public.warranties FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX warranties_user_idx ON public.warranties(user_id, warranty_expiry);
CREATE TRIGGER warranties_updated_at BEFORE UPDATE ON public.warranties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- EXPENSES
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'EUR',
  category TEXT NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  notes TEXT,
  store TEXT,
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  ocr_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_own" ON public.expenses FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX expenses_user_date_idx ON public.expenses(user_id, expense_date DESC);
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- AGREEMENTS
CREATE TABLE public.agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  agreement_type TEXT NOT NULL DEFAULT 'contract',
  company TEXT,
  agreement_number TEXT,
  start_date DATE,
  end_date DATE,
  monthly_payment NUMERIC(12,2),
  total_amount NUMERIC(12,2),
  currency TEXT DEFAULT 'EUR',
  notes TEXT,
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  ocr_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements TO authenticated;
GRANT ALL ON public.agreements TO service_role;
ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agreements_own" ON public.agreements FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX agreements_user_idx ON public.agreements(user_id, end_date);
CREATE TRIGGER agreements_updated_at BEFORE UPDATE ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage RLS: users can only access files under their own user id prefix
CREATE POLICY "documents_select_own" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "documents_insert_own" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "documents_update_own" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "documents_delete_own" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);
