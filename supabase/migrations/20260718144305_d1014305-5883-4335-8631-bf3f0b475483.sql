
-- Add due_day (payment day of month) to recurring_payments
ALTER TABLE public.recurring_payments
  ADD COLUMN IF NOT EXISTS due_day integer;

ALTER TABLE public.recurring_payments
  DROP CONSTRAINT IF EXISTS recurring_payments_due_day_check;
ALTER TABLE public.recurring_payments
  ADD CONSTRAINT recurring_payments_due_day_check
  CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31));

-- Backfill from existing next_due_date
UPDATE public.recurring_payments
   SET due_day = EXTRACT(day FROM next_due_date)::int
 WHERE due_day IS NULL AND next_due_date IS NOT NULL;

-- Link recurring payment instances to an auto-created expense entry
ALTER TABLE public.recurring_payment_instances
  ADD COLUMN IF NOT EXISTS expense_id uuid;

ALTER TABLE public.recurring_payment_instances
  DROP CONSTRAINT IF EXISTS recurring_payment_instances_expense_id_fkey;
ALTER TABLE public.recurring_payment_instances
  ADD CONSTRAINT recurring_payment_instances_expense_id_fkey
  FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS recurring_payment_instances_expense_idx
  ON public.recurring_payment_instances(expense_id);

-- Prevent duplicate instances for the same recurring + period (due_date).
-- Uses a unique index to be idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS recurring_payment_instances_rp_due_uidx
  ON public.recurring_payment_instances(recurring_payment_id, due_date);
