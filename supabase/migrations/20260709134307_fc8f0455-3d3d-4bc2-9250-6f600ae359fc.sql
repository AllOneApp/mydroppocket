
CREATE TABLE public.recurring_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  service_name text NOT NULL,
  provider text,
  category text,
  amount numeric NOT NULL,
  currency text DEFAULT 'EUR',
  frequency text NOT NULL DEFAULT 'monthly',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  next_due_date date NOT NULL DEFAULT CURRENT_DATE,
  reminder_days_before integer NOT NULL DEFAULT 3,
  notes text,
  contract_file_path text,
  contract_file_name text,
  contract_file_mime text,
  linked_purchase_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_payments TO authenticated;
GRANT ALL ON public.recurring_payments TO service_role;

ALTER TABLE public.recurring_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_payments_own ON public.recurring_payments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_recurring_payments_updated_at
  BEFORE UPDATE ON public.recurring_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.recurring_payment_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  recurring_payment_id uuid NOT NULL REFERENCES public.recurring_payments(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  amount numeric NOT NULL,
  currency text DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamp with time zone,
  receipt_file_path text,
  receipt_file_name text,
  receipt_file_mime text,
  invoice_file_path text,
  invoice_file_name text,
  invoice_file_mime text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_payment_instances TO authenticated;
GRANT ALL ON public.recurring_payment_instances TO service_role;

ALTER TABLE public.recurring_payment_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_payment_instances_own ON public.recurring_payment_instances
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX recurring_payment_instances_rp_idx ON public.recurring_payment_instances(recurring_payment_id);
CREATE INDEX recurring_payment_instances_due_idx ON public.recurring_payment_instances(user_id, due_date);

CREATE TRIGGER update_recurring_payment_instances_updated_at
  BEFORE UPDATE ON public.recurring_payment_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
