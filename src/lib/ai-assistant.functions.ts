import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGateway } from "./ai-gateway.server";
import {
  MODULE_SEARCHERS,
  summarizeGroup,
  type AssistantFilters,
  type AssistantGroup,
  type AssistantIntent,
  type AssistantItem,
} from "./ai-assistant.server";

const HistoryMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const InputSchema = z.object({
  question: z.string(),
  profileId: z.string(),
  locale: z.enum(["et", "en"]).optional(),
  history: z.array(HistoryMsg).optional(),
});

const INTENTS = ["warranties", "expenses", "income", "agreements", "installments", "recurring"] as const;

const ClassificationSchema = z.object({
  intents: z.array(z.enum(INTENTS)).nullable(),
  filters: z.object({
    query: z.string().nullable(),
    brand: z.string().nullable(),
    store: z.string().nullable(),
    category: z.string().nullable(),
    minAmount: z.number().nullable(),
    maxAmount: z.number().nullable(),
    dateFrom: z.string().nullable(),
    dateTo: z.string().nullable(),
    expiringInDays: z.number().nullable(),
    activeOnly: z.boolean().nullable(),
  }),
  aggregation: z.enum(["list", "sum", "count"]).nullable(),
  answerHint: z.string().nullable(),
});

type Classification = z.infer<typeof ClassificationSchema>;

export type AssistantResponse = {
  ok: true;
  answer: string;
  suggestions: string[];
  groups: AssistantGroup[];
} | { ok: false; error: string };

function buildClassificationPrompt(locale: "et" | "en", today: string): string {
  const langLine = locale === "en" ? "Reply text in English." : "Vasta eesti keeles.";
  return `You are a routing classifier for a personal-documents assistant. Convert the user's natural-language question into a structured search plan.
Today: ${today}.

Available data modules (intents):
- warranties: purchased items with warranty periods (fields: product_name, store, purchase_date, amount, warranty_expiry)
- expenses: purchases / bills (fields: description, store, category, amount, expense_date)
- income: earnings entries in the same expense table
- agreements: contracts (non-installment) — insurance, subscriptions, service contracts
- installments: installment contracts (financed purchases, järelmaks)
- recurring: recurring subscription/utility payments

Return JSON matching the schema:
- intents: which modules to search. Pick all that could plausibly match. If unsure, include multiple. If completely unrelated to the modules, return an empty array.
- filters.query: main fuzzy text to search across product names, stores, descriptions. Correct obvious typos (e.g. "purma" -> "puma", "eronics" -> "euronics"). Understand synonyms: tšekk/ost/arve/dokument all mean receipts; telefon/mobiil/nutitelefon all mean phone.
- filters.brand: brand-like tokens (Bosch, Puma, LG, ...)
- filters.store: store/company (Euronics, Sportland, Bolt, ...)
- filters.category: category name if the user mentioned one (e.g. "auto" -> Transport/Car)
- filters.minAmount / maxAmount: numeric bounds when the user says "over 500", "üle 500 euro" etc.
- filters.dateFrom / dateTo: ISO YYYY-MM-DD. Resolve phrases like "eelmisel kuul" ("last month") against today. "sel aastal" = current year. "järgmise 30 päeva jooksul" -> expiringInDays=30 (NOT dateTo).
- filters.expiringInDays: use ONLY for warranties/agreements expiring within N days from today.
- filters.activeOnly: true when the user asks about "kehtiv" / "aktiivne" warranties, agreements, installments.
- aggregation: "sum" for "kui palju kulutasin" / "how much did I spend"; "count" for "mitu"; "list" otherwise.
- answerHint: one short natural-language sentence to introduce the results (same language as the user). Keep it under ~140 characters. ${langLine} Do NOT invent counts; the app will compute them.

Only include fields with a clear signal; use null everywhere else.`;
}

async function classify(question: string, locale: "et" | "en", history: { role: string; content: string }[]): Promise<Classification | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const gateway = createLovableAiGateway(key);
  const model = gateway("google/gemini-2.5-flash");
  const today = new Date().toISOString().slice(0, 10);
  const system = buildClassificationPrompt(locale, today);
  const contextMsgs = history.slice(-6).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  const userText = contextMsgs
    ? `Prior conversation (for context — resolve pronouns like "see", "seda", "that one" against it):\n${contextMsgs}\n\nCurrent question:\n${question}`
    : question;
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: ClassificationSchema as z.ZodType<Record<string, unknown>> }),
      system,
      prompt: userText,
    });
    return output as unknown as Classification;
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      console.error("[ai-assistant] classification schema mismatch", err.text?.slice(0, 500));
      try {
        const raw = JSON.parse(err.text ?? "{}");
        return ClassificationSchema.partial().parse(raw) as unknown as Classification;
      } catch {
        return null;
      }
    }
    throw err;
  }
}

function currencyFmt(n: number, cur: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: cur || "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function buildAnswer(
  classification: Classification,
  groups: AssistantGroup[],
  locale: "et" | "en",
  question: string,
): string {
  const total = groups.reduce((s, g) => s + g.count, 0);
  const et = locale === "et";
  if (total === 0) {
    const base = et
      ? "Ei leidnud selle profiili andmete hulgast midagi sobivat."
      : "Nothing matching was found in this profile.";
    const q = question.trim();
    const hint = et
      ? " Proovi teisi märksõnu või kontrolli, kas dokument on juba lisatud."
      : " Try different keywords or check if the document has been added.";
    return `${base}${q ? ` (${q})` : ""}${hint}`;
  }
  if (classification.aggregation === "sum") {
    const grand = groups.reduce((s, g) => s + (g.total ?? 0), 0);
    const cur = groups.find((g) => g.currency)?.currency ?? "EUR";
    return et
      ? `Kokku ${currencyFmt(grand, cur, "et-EE")} (${total} kirjet).`
      : `Total ${currencyFmt(grand, cur, "en-US")} across ${total} entries.`;
  }
  if (classification.aggregation === "count") {
    return et ? `Leidsin ${total} kirjet.` : `Found ${total} entries.`;
  }
  return classification.answerHint || (et ? `Leidsin ${total} tulemust.` : `Found ${total} results.`);
}

function suggestFollowups(groups: AssistantGroup[], locale: "et" | "en"): string[] {
  const et = locale === "et";
  const s: string[] = [];
  const w = groups.find((g) => g.kind === "warranties");
  const e = groups.find((g) => g.kind === "expenses");
  const a = groups.find((g) => g.kind === "agreements");
  const r = groups.find((g) => g.kind === "recurring");
  if (w && w.count > 0) s.push(et ? "Näita garantiisid, mis lõppevad 30 päeva jooksul" : "Show warranties expiring in 30 days");
  if (e && e.count > 0) s.push(et ? "Kui palju kulutasin eelmisel kuul?" : "How much did I spend last month?");
  if (a && a.count > 0) s.push(et ? "Näita aktiivseid lepinguid" : "Show active contracts");
  if (r && r.count > 0) s.push(et ? "Näita kõiki püsimakseid" : "List all recurring payments");
  if (s.length === 0) {
    return et
      ? ["Leia minu Puma tossude tšekk", "Mis garantiid lõppevad varsti?", "Kui palju kulutasin eelmisel kuul?"]
      : ["Find my Puma shoes receipt", "Which warranties expire soon?", "How much did I spend last month?"];
  }
  return s.slice(0, 4);
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AssistantResponse> => {
    const question = data.question.trim();
    if (!question) return { ok: false, error: "Empty question" };
    const locale = data.locale ?? "et";

    // Verify the profile belongs to this user (RLS also enforces this).
    const { data: prof, error: pErr } = await context.supabase
      .from("user_profiles")
      .select("id")
      .eq("id", data.profileId)
      .maybeSingle();
    if (pErr || !prof) return { ok: false, error: "Profile not accessible" };

    const classification = await classify(question, locale, data.history ?? []);
    if (!classification) {
      return {
        ok: true,
        answer:
          locale === "et"
            ? "Ma ei saanud küsimusest päris hästi aru. Proovi täpsemalt sõnastada."
            : "I couldn't understand the question. Please rephrase.",
        suggestions: suggestFollowups([], locale),
        groups: [],
      };
    }

    const intents = (classification.intents && classification.intents.length > 0)
      ? classification.intents
      : (INTENTS as unknown as AssistantIntent[]);

    const filters: AssistantFilters = classification.filters;

    const groupPromises = intents.map(async (intent) => {
      const searcher = MODULE_SEARCHERS[intent];
      if (!searcher) return null;
      const items: AssistantItem[] = await searcher(context.supabase, data.profileId, filters);
      return items.length > 0 ? summarizeGroup(intent, items) : null;
    });
    const resolved = await Promise.all(groupPromises);
    const groups = resolved.filter((g): g is AssistantGroup => !!g);

    const answer = buildAnswer(classification, groups, locale, question);
    const suggestions = suggestFollowups(groups, locale);

    return { ok: true, answer, suggestions, groups };
  });