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

// Estonian noun endings and generic suffixes to strip so "ripptooli" matches
// "ripptool", "garantiitšekk" matches "garantii", etc. Order matters (longest first).
const ET_SUFFIXES = [
  "idega", "idele", "idelt", "idesse", "idena", "ideni",
  "tega", "tele", "telt", "tesse", "tena", "teni",
  "dega", "dele", "delt", "desse", "dena", "deni",
  "iga", "ile", "ilt", "isse", "ina", "ini", "iks",
  "ega", "ele", "elt", "esse", "ena", "eni", "eks",
  "aga", "ale", "alt", "asse", "ana", "ani", "aks",
  "uga", "ule", "ult", "usse", "una", "uni", "uks",
  "tšekk", "tsekk", "tšeki", "tseki",
  "de", "te", "id", "is", "ks", "le", "lt", "ga", "na", "ni", "st",
  "i", "u", "a", "e", "l", "s", "t",
];

function stem(word: string): string {
  let w = word;
  for (const s of ET_SUFFIXES) {
    if (w.length - s.length >= 4 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

const STOPWORDS = new Set([
  "leia", "leida", "näita", "kus", "on", "minu", "mu", "kas", "veel", "kõik", "koik",
  "ost", "ostud", "ostu", "tšekk", "tsekk", "tšeki", "tseki", "arve", "dokument",
  "garantii", "garantiid", "garantiitšekk", "garantiitsekk",
  "find", "show", "where", "is", "my", "the", "all", "receipt", "invoice", "document",
  "warranty", "purchase",
]);

function tokenize(needle: string): string[] {
  return normalize(needle)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function tokenMatch(haystack: string, needle: string | null | undefined): boolean {
  if (!needle) return true;
  const hay = normalize(haystack);
  if (!hay) return false;
  const tokens = tokenize(needle);
  if (tokens.length === 0) {
    // Fall back to plain substring (short queries, brand-only)
    const n = normalize(needle);
    return !n || hay.includes(n);
  }
  // Match if ANY meaningful token (or its stem prefix) appears anywhere.
  return tokens.some((tok) => {
    if (hay.includes(tok)) return true;
    const st = stem(tok);
    if (st.length >= 3 && hay.includes(st)) return true;
    // last-resort prefix match (min 4 chars)
    if (tok.length >= 5 && hay.includes(tok.slice(0, Math.max(4, tok.length - 2)))) return true;
    return false;
  });
}

function extractOcrText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw).replace(/[{}[\]",:]/g, " ");
  } catch {
    return "";
  }
}

function fuzzyText(row: Record<string, unknown>, keys: string[], needle: string | null | undefined): boolean {
  if (!needle) return true;
  const parts: string[] = [];
  for (const k of keys) {
    const v = row[k];
    if (k === "ocr_raw" || k === "ocr_text") {
      parts.push(extractOcrText(v));
    } else {
      parts.push(String(v ?? ""));
    }
  }
  return tokenMatch(parts.join(" "), needle);
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
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["product_name", "store", "notes", "file_name", "ocr_raw"], f.query))
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
        // Treat unknown expiry as "possibly active" — don't hide the row just
        // because the field wasn't captured from OCR. Only exclude items that
        // are definitely expired.
        return r.warranty_expiry ? r.warranty_expiry >= today : true;
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
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["description", "store", "category", "notes", "file_name", "ocr_raw"], f.query))
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
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["description", "store", "category", "notes", "file_name", "ocr_raw"], f.query))
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
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["title", "company", "notes", "agreement_number", "payee_name", "file_name", "ocr_raw"], f.query))
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["company", "payee_name"], f.store))
      .filter((r) => inRange(r.start_date, f.dateFrom, f.dateTo))
      .filter((r) => amountInRange(r.total_amount ?? r.monthly_payment, f.minAmount, f.maxAmount))
      .filter((r) => (f.activeOnly ? (!r.end_date || r.end_date >= today) : true))
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
      .filter((r) => fuzzyText(r as unknown as Record<string, unknown>, ["title", "company", "notes", "payee_name", "agreement_number", "file_name", "ocr_raw"], f.query))
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