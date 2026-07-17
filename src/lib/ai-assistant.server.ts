import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AssistantIntent = "warranties" | "expenses" | "income" | "agreements" | "installments" | "recurring";

export type AssistantFilters = {
  query?: string | null;
  brand?: string | null;
  store?: string | null;
  category?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  expiringInDays?: number | null;
  activeOnly?: boolean | null;
};

export type AssistantItem = {
  id: string;
  kind: AssistantIntent;
  title: string;
  subtitle: string | null;
  date: string | null;
  amount: number | null;
  currency: string | null;
  filePath: string | null;
  gdriveFileId: string | null;
  route: string;
  meta: Record<string, string | number | null>;
};

export type AssistantGroup = {
  kind: AssistantIntent;
  label: string;
  count: number;
  total: number | null;
  currency: string | null;
  items: AssistantItem[];
};

type Supa = SupabaseClient<Database>;

const HAY_LIMIT = 50;

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim();
}

function tokenMatch(haystack: string, needle: string | null | undefined): boolean {
  if (!needle) return true;
  const n = normalize(needle);
  if (!n) return true;
  return normalize(haystack).includes(n);
}

function fuzzyText(row: Record<string, unknown>, keys: string[], needle: string | null | undefined): boolean {
  if (!needle) return true;
  const combined = keys.map((k) => String(row[k] ?? "")).join(" ");
  return tokenMatch(combined, needle);
}

function inRange(dateStr: string | null, from?: string | null, to?: string | null): boolean {
  if (!dateStr) return !from && !to;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

function amountInRange(amount: number | null, min?: number | null, max?: number | null): boolean {
  const a = amount == null ? null : Number(amount);
  if (min != null && (a == null || a < min)) return false;
  if (max != null && (a == null || a > max)) return false;
  return true;
}

/** Module searchers registry — add a new module by adding one entry here. */
export const MODULE_SEARCHERS: Record<AssistantIntent, (s: Supa, profileId: string, f: AssistantFilters) => Promise<AssistantItem[]>> = {
  warranties: async (s, profileId, f) => {
    const { data } = await s.from("warranties").select("*").eq("profile_id", profileId).limit(200);
    const rows = data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return rows
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["product_name", "store", "notes"], f.query))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["product_name", "notes"], f.brand))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["store"], f.store))
      .filter((r) => inRange(r.purchase_date, f.dateFrom, f.dateTo))
      .filter((r) => amountInRange(r.amount, f.minAmount, f.maxAmount))
      .filter((r) => {
        if (f.expiringInDays == null) return true;
        if (!r.warranty_expiry) return false;
        const to = new Date(Date.now() + f.expiringInDays * 86400000).toISOString().slice(0, 10);
        return r.warranty_expiry >= today && r.warranty_expiry <= to;
      })
      .filter((r) => {
        if (!f.activeOnly) return true;
        return r.warranty_expiry ? r.warranty_expiry >= today : false;
      })
      .slice(0, HAY_LIMIT)
      .map((r) => ({
        id: r.id,
        kind: "warranties" as const,
        title: r.product_name,
        subtitle: r.store,
        date: r.purchase_date,
        amount: r.amount ? Number(r.amount) : null,
        currency: r.currency,
        filePath: r.file_path,
        gdriveFileId: r.gdrive_file_id,
        route: "/warranties",
        meta: { warranty_expiry: r.warranty_expiry },
      }));
  },
  expenses: async (s, profileId, f) => {
    const { data } = await s.from("expenses").select("*").eq("profile_id", profileId).eq("type", "expense").limit(300);
    const rows = data ?? [];
    return rows
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["description", "store", "category", "notes"], f.query))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["description", "notes"], f.brand))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["store"], f.store))
      .filter((r) => tokenMatch(r.category ?? "", f.category))
      .filter((r) => inRange(r.expense_date, f.dateFrom, f.dateTo))
      .filter((r) => amountInRange(Number(r.amount), f.minAmount, f.maxAmount))
      .slice(0, HAY_LIMIT)
      .map((r) => ({
        id: r.id,
        kind: "expenses" as const,
        title: r.description || r.store || r.category,
        subtitle: r.store ?? r.category,
        date: r.expense_date,
        amount: Number(r.amount),
        currency: r.currency,
        filePath: r.file_path,
        gdriveFileId: r.gdrive_file_id,
        route: "/expenses",
        meta: { category: r.category },
      }));
  },
  income: async (s, profileId, f) => {
    const { data } = await s.from("expenses").select("*").eq("profile_id", profileId).eq("type", "income").limit(300);
    const rows = data ?? [];
    return rows
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["description", "store", "category", "notes"], f.query))
      .filter((r) => tokenMatch(r.category ?? "", f.category))
      .filter((r) => inRange(r.expense_date, f.dateFrom, f.dateTo))
      .filter((r) => amountInRange(Number(r.amount), f.minAmount, f.maxAmount))
      .slice(0, HAY_LIMIT)
      .map((r) => ({
        id: r.id,
        kind: "income" as const,
        title: r.description || r.store || r.category,
        subtitle: r.store ?? r.category,
        date: r.expense_date,
        amount: Number(r.amount),
        currency: r.currency,
        filePath: r.file_path,
        gdriveFileId: r.gdrive_file_id,
        route: "/expenses",
        meta: { category: r.category, type: "income" },
      }));
  },
  agreements: async (s, profileId, f) => {
    let q = s.from("agreements").select("*").eq("profile_id", profileId).limit(200);
    q = q.neq("agreement_type", "installment");
    const { data } = await q;
    const rows = data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return rows
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["title", "company", "notes", "agreement_number", "payee_name"], f.query))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["company", "payee_name"], f.store))
      .filter((r) => inRange(r.start_date, f.dateFrom, f.dateTo))
      .filter((r) => amountInRange(r.total_amount ?? r.monthly_payment, f.minAmount, f.maxAmount))
      .filter((r) => (f.activeOnly ? !r.end_date || r.end_date >= today : true))
      .filter((r) => {
        if (f.expiringInDays == null) return true;
        if (!r.end_date) return false;
        const to = new Date(Date.now() + f.expiringInDays * 86400000).toISOString().slice(0, 10);
        return r.end_date >= today && r.end_date <= to;
      })
      .slice(0, HAY_LIMIT)
      .map((r) => ({
        id: r.id,
        kind: "agreements" as const,
        title: r.title,
        subtitle: r.company ?? r.payee_name,
        date: r.start_date,
        amount: r.monthly_payment ? Number(r.monthly_payment) : (r.total_amount ? Number(r.total_amount) : null),
        currency: r.currency,
        filePath: r.file_path,
        gdriveFileId: r.gdrive_file_id,
        route: "/agreements",
        meta: { end_date: r.end_date, agreement_type: r.agreement_type },
      }));
  },
  installments: async (s, profileId, f) => {
    const { data } = await s.from("agreements").select("*").eq("profile_id", profileId).eq("agreement_type", "installment").limit(200);
    const rows = data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return rows
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["title", "company", "notes", "payee_name"], f.query))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["company", "payee_name"], f.store))
      .filter((r) => amountInRange(r.monthly_payment, f.minAmount, f.maxAmount))
      .filter((r) => (f.activeOnly ? !r.end_date || r.end_date >= today : true))
      .slice(0, HAY_LIMIT)
      .map((r) => ({
        id: r.id,
        kind: "installments" as const,
        title: r.title,
        subtitle: r.company ?? r.payee_name,
        date: r.start_date,
        amount: r.monthly_payment ? Number(r.monthly_payment) : null,
        currency: r.currency,
        filePath: r.file_path,
        gdriveFileId: r.gdrive_file_id,
        route: "/installments",
        meta: {
          end_date: r.end_date,
          payments_made: r.payments_made,
          total_payments: r.total_payments,
        },
      }));
  },
  recurring: async (s, profileId, f) => {
    const { data } = await s.from("recurring_payments").select("*").eq("profile_id", profileId).limit(200);
    const rows = data ?? [];
    return rows
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["service_name", "provider", "notes", "category"], f.query))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["service_name", "provider"], f.store))
      .filter((r) => tokenMatch(r.category ?? "", f.category))
      .filter((r) => amountInRange(Number(r.amount), f.minAmount, f.maxAmount))
      .slice(0, HAY_LIMIT)
      .map((r) => ({
        id: r.id,
        kind: "recurring" as const,
        title: r.service_name,
        subtitle: r.provider ?? r.category,
        date: r.next_due_date,
        amount: Number(r.amount),
        currency: r.currency,
        filePath: r.contract_file_path,
        gdriveFileId: r.contract_gdrive_file_id,
        route: "/recurring",
        meta: { frequency: r.frequency, next_due_date: r.next_due_date },
      }));
  },
};

export function summarizeGroup(kind: AssistantIntent, items: AssistantItem[]): AssistantGroup {
  const total = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const currency = items.find((i) => i.currency)?.currency ?? "EUR";
  return {
    kind,
    label: kind,
    count: items.length,
    total: items.length ? total : null,
    currency,
    items,
  };
}