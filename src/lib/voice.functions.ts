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
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const ext = (data.mime.split("/")[1] || "webm").split(";")[0];
    const filename = data.filename || `recording.${ext}`;
    const blob = new Blob([bin], { type: data.mime });
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("model", "openai/gpt-4o-mini-transcribe");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("STT failed", res.status, body);
      return { ok: false as const, error: `Transcription failed (${res.status})` };
    }
    const json = (await res.json()) as { text?: string };
    return { ok: true as const, text: json.text ?? "" };
  });

const Kinds = ["expense", "income", "expense_or_income", "warranty", "agreement", "search", "document"] as const;

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
  type: z.enum(["expense", "income"]).nullable().describe("expense = spending money, income = receiving money"),
  amount: z.number().nullable(),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EUR"),
  store: z.string().nullable().describe("Merchant / payer / counterparty"),
  category: z.string().nullable().describe(`One of: ${[...ExpenseCategories, ...IncomeCategories].join(", ")}`),
  expense_date: z.string().nullable().describe("YYYY-MM-DD; today if unspecified"),
  description: z.string().nullable(),
});

const WarrantySchema = z.object({
  product_name: z.string().nullable(),
  store: z.string().nullable(),
  purchase_date: z.string().nullable(),
  warranty_expiry: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
});

const AgreementSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  agreement_number: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  monthly_payment: z.number().nullable(),
  total_amount: z.number().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
});

const SearchSchema = z.object({
  module: z.enum(["all", "warranties", "expenses", "agreements"]).nullable(),
  type: z.enum(["expense", "income"]).nullable(),
  store: z.string().nullable(),
  category: z.string().nullable(),
  keyword: z.string().nullable(),
  date_from: z.string().nullable().describe("YYYY-MM-DD inclusive"),
  date_to: z.string().nullable().describe("YYYY-MM-DD inclusive"),
});

const DocumentLinkSchema = z.object({
  module: z.enum(["warranties", "expenses", "agreements"]).nullable(),
  keyword: z.string().nullable().describe("product / company / store keyword to find the record"),
  description: z.string().nullable(),
});

function today() { return new Date().toISOString().slice(0, 10); }

function schemaFor(kind: (typeof Kinds)[number]) {
  switch (kind) {
    case "warranty": return WarrantySchema;
    case "agreement": return AgreementSchema;
    case "search": return SearchSchema;
    case "document": return DocumentLinkSchema;
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
    default:
      return `Extract a financial record from a spoken note. Decide type=expense (spending) or income (received). Pick a category from: expense=${ExpenseCategories.join(", ")}; income=${IncomeCategories.join(", ")}. Currency defaults to EUR. If no date is given use today (${t}). ${langNote}`;
  }
}

export const parseVoiceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ParseInput.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGateway(key);
    const model = gateway("google/gemini-2.5-flash");
    const schema = schemaFor(data.context);
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: schema as z.ZodType<Record<string, unknown>> }),
        messages: [
          { role: "system", content: promptFor(data.context, data.lang) },
          { role: "user", content: data.text },
        ],
      });
      return { ok: true as const, data: output as Record<string, unknown> };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        return { ok: false as const, error: "Could not parse voice command" };
      }
      console.error("Voice parse error", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "Parse failed" };
    }
  });