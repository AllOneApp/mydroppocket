ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS payment_day_of_month smallint
  CHECK (payment_day_of_month IS NULL OR (payment_day_of_month BETWEEN 1 AND 31));