import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGateway } from "./ai-gateway.server";

const TranscribeInput = z.object({
  mime: z.string(),
  base64: z.string(),
  filename: z.string().optional(),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => TranscribeInput.parse(data))
  .handler(async ({ data }) => {
    console.info("[VoiceInput] server:transcribe:start", { mime: data.mime, base64Length: data.base64.length });
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const ext = (data.mime.split("/")[1] || "webm").split(";")[0];
    const filename = data.filename || `recording.${ext}`;
    console.info("[VoiceInput] server:transcribe:file", { filename, bytes: bin.byteLength });
    const blob = new Blob([bin], { type: data.mime });
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("model", "openai/gpt-4o-mini-transcribe");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Lovable-API-Key": key },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("STT failed", res.status, body);
      return { ok: false as const, error: `Transcription failed (${res.status})` };
    }
    const json = (await res.json()) as { text?: string };
    console.info("[VoiceInput] server:transcribe:done", { hasText: Boolean(json.text?.trim()), textLength: json.text?.length ?? 0 });
    return { ok: true as const, text: json.text ?? "" };
  });

const Kinds = ["expense", "income", "expense_or_income", "warranty", "agreement", "search", "document", "recurring_payment"] as const;

const ParseInput = z.object({
  text: z.string(),
  context: z.enum(Kinds),
  lang: z.string().default("et"),
});

const ExpenseCategories = [
  "Groceries", "Fuel", "Restaurant", "Coffee", "Hairdresser", "Nails",
  "Shopping", "Healthcare", "Travel", "Pets", "Other",
];
const IncomeCategories = ["Salary", "Sale", "Gift", "Investment", "Refund", "OtherIncome"];

const RecordSchema = z.object({
  type: z.string().nullish().describe("expense = spending money, income = receiving money"),
  amount: z.number().nullish(),
  currency: z.string().nullish().describe("ISO 4217 code, e.g. EUR"),
  store: z.string().nullish().describe("Merchant / payer / counterparty"),
  category: z.string().nullish().describe(`One of: ${[...ExpenseCategories, ...IncomeCategories].join(", ")}`),
  expense_date: z.string().nullish().describe("YYYY-MM-DD; today if unspecified"),
  description: z.string().nullish(),
});

const WarrantySchema = z.object({
  product_name: z.string().nullish(),
  store: z.string().nullish(),
  purchase_date: z.string().nullish(),
  warranty_expiry: z.string().nullish(),
  amount: z.number().nullish(),
  currency: z.string().nullish(),
  notes: z.string().nullish(),
});

const AgreementSchema = z.object({
  title: z.string().nullish(),
  company: z.string().nullish(),
  agreement_number: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  monthly_payment: z.number().nullish(),
  total_amount: z.number().nullish(),
  currency: z.string().nullish(),
  notes: z.string().nullish(),
});

const SearchSchema = z.object({
  module: z.string().nullish(),
  type: z.string().nullish(),
  store: z.string().nullish(),
  category: z.string().nullish(),
  keyword: z.string().nullish(),
  date_from: z.string().nullish().describe("YYYY-MM-DD inclusive"),
  date_to: z.string().nullish().describe("YYYY-MM-DD inclusive"),
});

const DocumentLinkSchema = z.object({
  module: z.string().nullish(),
  keyword: z.string().nullish().describe("product / company / store keyword to find the record"),
  description: z.string().nullish(),
});

const RecurringSchema = z.object({
  service_name: z.string().nullish(),
  provider: z.string().nullish(),
  category: z.string().nullish().describe("e.g. Utilities, Electricity, Water, Phone, Internet, TV, Streaming, Software, Insurance, Leasing, Installment, Mortgage, Subscription, Other"),
  amount: z.number().nullish(),
  currency: z.string().nullish(),
  frequency: z.string().nullish(),
  due_day: z.number().nullish().describe("Day of month the payment is due, 1-31"),
  start_date: z.string().nullish().describe("YYYY-MM-DD"),
  end_date: z.string().nullish().describe("YYYY-MM-DD, when the recurring payment ends"),
  next_due_date: z.string().nullish().describe("YYYY-MM-DD, first / next due date if the user gave a full date"),
  notes: z.string().nullish(),
});

function today() { return new Date().toISOString().slice(0, 10); }

function schemaFor(kind: (typeof Kinds)[number]) {
  switch (kind) {
    case "warranty": return WarrantySchema;
    case "agreement": return AgreementSchema;
    case "search": return SearchSchema;
    case "document": return DocumentLinkSchema;
    case "recurring_payment": return RecurringSchema;
    default: return RecordSchema;
  }
}

function promptFor(kind: (typeof Kinds)[number], lang: string) {
  const t = today();
  const langNote = `The user spoke in ${lang}. Return fields as they appear in the transcript; use null when a field is missing. Today is ${t}.`;
  switch (kind) {
    case "warranty":
      return `Extract warranty/purchase fields from a spoken note. ${langNote}`;
    case "agreement":
      return `Extract agreement/contract fields from a spoken note. ${langNote}`;
    case "search":
      return `Turn the spoken query into search filters across warranties/expenses/agreements. Detect module, type (income/expense), store, category, keyword and date range (support "today", "yesterday", "this week/month/year", "last week/month/year"). ${langNote}`;
    case "document":
      return `The user is attaching a document and describing what it belongs to. Detect which module (warranties/expenses/agreements) and the key search keyword (product name, company, or store). ${langNote}`;
    case "recurring_payment":
      return `Extract a recurring payment (subscription, utility, installment, streaming, insurance, etc.) from a spoken note. Detect service_name, provider, category, amount, currency, frequency (monthly/bimonthly/quarterly/semiannual/annual), due_day (day of month), start_date, end_date and next_due_date. Map Estonian frequency words: "iga kuu"→monthly, "kord aastas"/"aastane"→annual, "kord kvartalis"→quarterly, "iga 2 kuu tagant"→bimonthly, "kord poolaastas"→semiannual. Map Estonian category words to English: telefon→Phone, internet→Internet, elekter→Electricity, vesi→Water, prügi→Waste, kindlustus→Insurance, voogedastus/striiming→Streaming, tarkvara→Software, liising→Leasing, järelmaks→Installment, kodulaen→Mortgage, tellimus→Subscription, kommunaal→Utilities, TV/kaabel→TV, pilv→CloudStorage. Full dates like "15. august 2026" become YYYY-MM-DD (2026-08-15). Currency defaults to EUR. ${langNote}`;
    default:
      return `Extract a financial record from a spoken note. Decide type=expense (spending) or income (received). Pick a category from: expense=${ExpenseCategories.join(", ")}; income=${IncomeCategories.join(", ")}. Map Estonian words to these categories: toit/toidukaubad→Groceries, kütus/bensiin→Fuel, restoran/söök väljas→Restaurant, kohv→Coffee, juuksur→Hairdresser, küüned→Nails, ost/pood/riided→Shopping, arst/apteek/tervis→Healthcare, reis/reisimine→Travel, lemmikloom→Pets; palk→Salary, müük→Sale, kingitus→Gift, investeering/dividend→Investment, tagastus→Refund. "Prisma/Rimi/Selver/Maxima/Coop" are grocery stores → store field, category=Groceries. Currency defaults to EUR. If no date is given use today (${t}). ${langNote}`;
  }
}

function normalizeCategory(value: unknown, map: Record<string, string>) {
  if (typeof value !== "string") return value;
  return map[value.trim().toLowerCase()] ?? value;
}

function normalizeOneOf(value: unknown, map: Record<string, string>, allowed: readonly string[]) {
  if (typeof value !== "string") return value;
  const normalized = map[value.trim().toLowerCase()] ?? value;
  return allowed.includes(normalized) ? normalized : value;
}

function parseJsonObject(text: string) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/({[\s\S]*})/);
  const raw = (match?.[1] ?? match?.[0] ?? text).trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeVoiceOutput(kind: (typeof Kinds)[number], output: Record<string, unknown>) {
  const normalized = { ...output } as Record<string, unknown>;
  if (typeof normalized.currency === "string") normalized.currency = normalized.currency.toUpperCase();
  if (kind === "recurring_payment") {
    normalized.frequency = normalizeOneOf(normalized.frequency, {
      "iga kuu": "monthly",
      kuine: "monthly",
      monthly: "monthly",
      "kord kuus": "monthly",
      "iga 2 kuu tagant": "bimonthly",
      bimonthly: "bimonthly",
      "kord kvartalis": "quarterly",
      kvartalis: "quarterly",
      quarterly: "quarterly",
      "kord poolaastas": "semiannual",
      poolaastas: "semiannual",
      semiannual: "semiannual",
      "kord aastas": "annual",
      aastane: "annual",
      annual: "annual",
    }, ["monthly", "bimonthly", "quarterly", "semiannual", "annual"]);
    normalized.category = normalizeCategory(normalized.category, {
      telefon: "Phone",
      internet: "Internet",
      elekter: "Electricity",
      vesi: "Water",
      prügi: "Waste",
      prugi: "Waste",
      kindlustus: "Insurance",
      voogedastus: "Streaming",
      striiming: "Streaming",
      tarkvara: "Software",
      liising: "Leasing",
      järelmaks: "Installment",
      jarelmaks: "Installment",
      kodulaen: "Mortgage",
      tellimus: "Subscription",
      kommunaal: "Utilities",
      tv: "TV",
      kaabel: "TV",
      pilv: "CloudStorage",
    });
  } else if (kind === "expense" || kind === "income" || kind === "expense_or_income") {
    normalized.type = normalizeOneOf(normalized.type, {
      kulu: "expense",
      kulutus: "expense",
      väljaminek: "expense",
      valjaminek: "expense",
      expense: "expense",
      tulu: "income",
      sissetulek: "income",
      income: "income",
    }, ["expense", "income"]);
    normalized.category = normalizeCategory(normalized.category, {
      toit: "Groceries",
      toidukaubad: "Groceries",
      kütus: "Fuel",
      kutus: "Fuel",
      bensiin: "Fuel",
      restoran: "Restaurant",
      kohv: "Coffee",
      juuksur: "Hairdresser",
      küüned: "Nails",
      kuuned: "Nails",
      pood: "Shopping",
      riided: "Shopping",
      arst: "Healthcare",
      apteek: "Healthcare",
      tervis: "Healthcare",
      reis: "Travel",
      lemmikloom: "Pets",
      palk: "Salary",
      müük: "Sale",
      muuk: "Sale",
      kingitus: "Gift",
      investeering: "Investment",
      dividend: "Investment",
      tagastus: "Refund",
    });
  }
  if (kind === "search") {
    normalized.module = normalizeOneOf(normalized.module, {
      kõik: "all",
      koik: "all",
      all: "all",
      garantiid: "warranties",
      warranties: "warranties",
      kulud: "expenses",
      tulud: "expenses",
      expenses: "expenses",
      lepingud: "agreements",
      agreements: "agreements",
    }, ["all", "warranties", "expenses", "agreements"]);
    normalized.type = normalizeOneOf(normalized.type, {
      kulu: "expense",
      expense: "expense",
      tulu: "income",
      income: "income",
    }, ["expense", "income"]);
  }
  return normalized;
}

export const parseVoiceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ParseInput.parse(data))
  .handler(async ({ data }) => {
    console.info("[VoiceInput] server:parse:start", { context: data.context, lang: data.lang, textLength: data.text.length });
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGateway(key);
    const model = gateway("google/gemini-2.5-flash");
    const schema = schemaFor(data.context);
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: schema as z.ZodType<Record<string, unknown>> }),
        instructions: promptFor(data.context, data.lang),
        prompt: data.text,
      });
      const normalized = normalizeVoiceOutput(data.context, output as Record<string, unknown>);
      console.info("[VoiceInput] server:parse:done", { context: data.context, keys: Object.keys(normalized ?? {}) });
      return { ok: true as const, data: normalized as Record<string, string | number | null> };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        console.error("[VoiceInput] server:parse:no-object", { textLength: err.text?.length ?? 0 });
        const fallback = parseJsonObject(err.text ?? "");
        if (fallback) {
          const normalized = normalizeVoiceOutput(data.context, fallback);
          console.info("[VoiceInput] server:parse:fallback", { context: data.context, keys: Object.keys(normalized) });
          return { ok: true as const, data: normalized as Record<string, string | number | null> };
        }
        return { ok: false as const, error: "Could not parse voice command" };
      }
      console.error("Voice parse error", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Parse failed" };
    }
  });