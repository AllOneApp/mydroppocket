import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ExpenseEntryType = "expense" | "income";

export type ExpenseRow = {
  id: string;
  type: ExpenseEntryType;
  amount: number;
  currency: string | null;
  category: string;
  expense_date: string;
  description: string | null;
  notes: string | null;
  store: string | null;
  file_path: string | null;
  file_name: string | null;
};

export const expensesQueryKey = ["expenses"] as const;

export async function fetchExpenses(): Promise<ExpenseRow[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Kasutaja sessiooni ei leitud.");

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("user_id", userData.user.id)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ExpenseRow[];
}

export function expensesQueryOptions() {
  return queryOptions({
    queryKey: expensesQueryKey,
    queryFn: fetchExpenses,
  });
}

export function expenseTotals(rows: ExpenseRow[], from: string, to: string) {
  const inRange = rows.filter((row) => row.expense_date >= from && row.expense_date <= to);
  const income = inRange
    .filter((row) => row.type === "income")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const expense = inRange
    .filter((row) => row.type === "expense")
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return { income, expense, balance: income - expense };
}