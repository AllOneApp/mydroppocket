import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGREEMENT_ANALYSIS_PROMPT, parseAgreementResponse } from "./agreement-extraction.server";
import { createLovableAiGateway } from "./ai-gateway.server";

const DocumentFileSchema = z.object({
  name: z.string(),
  mime: z.string(),
  base64: z.string(),
});

const InputSchema = z.object({
  kind: z.enum(["warranty", "expense", "agreement", "recurring"]),
  mime: z.string().optional(),
  base64: z.string().optional(),
  files: z.array(DocumentFileSchema).optional(),
  locale: z.enum(["et", "en"]).optional(),
});

export const extractDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const supportedImageMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
    const supportedDocumentMimes = ["application/pdf"];
    const maxInlineBytes = 20 * 1024 * 1024;
    const warrantySchema = z.object({
      product_name: z.string().nullable(),
      store: z.string().nullable(),
      purchase_date: z.string().nullable().describe("ISO date YYYY-MM-DD"),
      amount: z.number().nullable(),
      currency: z.string().nullable(),
    });
    const expenseSchema = z.object({
      store: z.string().nullable(),
      amount: z.number().nullable(),
      currency: z.string().nullable(),
      expense_date: z.string().nullable(),
      category: z.string().nullable(),
      description: z.string().nullable(),
      vat: z.number().nullable(),
      purchased_items: z.array(z.string()).nullable(),
      warranty_candidates: z
        .array(
          z.object({
            name: z.string(),
            is_warranty_candidate: z.boolean(),
            suggested_warranty_months: z.number().nullable(),
            estimated_price: z.number().nullable(),
          }),
        )
        .nullable(),
    });
    const agreementSchema = z.object({
      title: z.string().nullable(),
      agreement_type: z.string().nullable(),
      company: z.string().nullable(),
      agreement_number: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      monthly_payment: z.number().nullable(),
      total_amount: z.number().nullable(),
      currency: z.string().nullable(),
      notes: z.string().nullable(),
    });
    const recurringSchema = z.object({
      service_name: z.string().nullable(),
      provider: z.string().nullable(),
      category: z.string().nullable(),
      amount: z.number().nullable(),
      currency: z.string().nullable(),
      frequency: z.string().nullable(),
      start_date: z.string().nullable(),
      next_due_date: z.string().nullable(),
      end_date: z.string().nullable(),
      due_day: z.number().nullable(),
      notes: z.string().nullable(),
      payee_name: z.string().nullable(),
      bank_name: z.string().nullable(),
      iban: z.string().nullable(),
      reference_number: z.string().nullable(),
      payment_description: z.string().nullable(),
    });
    const extractionPrompts = {
      warranty:
        `Read this receipt/invoice carefully using OCR and extract fields for a warranty record.
Return a JSON object with EXACTLY these keys (no others): product_name, store, purchase_date, amount, currency.
Return null for any field that is not clearly present, and never invent a value.
- product_name: the main purchased product name (the durable item being warranted). If several items exist, pick the most expensive durable good; otherwise the first product row. Clean brand/model text, no prices or quantities.
- store: merchant/store name, without address or company registration suffix when a clear brand name is shown
- purchase_date: transaction date in YYYY-MM-DD
- amount: final amount paid / grand total, not a subtotal
- currency: ISO currency code only when stated by code or symbol (e.g. EUR, USD)`,
      expense:
        `Read this receipt/document carefully using OCR and extract every clearly visible expense field.
Return null for an unknown scalar field and never invent a value.
- store: merchant/store name, without address or company registration suffix when a clear brand name is shown
- expense_date: transaction date in YYYY-MM-DD
- amount: final amount paid / grand total, not a subtotal
- currency: ISO currency code only when stated by code or symbol
- vat: total VAT amount only when explicitly present
- purchased_items: all purchased product/service row names in document order; omit prices, quantities, discounts, totals, payment lines and loyalty lines; return null only if no item row is readable
- description: exactly "[store] ost" when store is known, otherwise null
- category: one of Groceries, Fuel, Restaurant, Coffee, Shopping, Healthcare, Travel, Other when supported by the receipt, otherwise null.
- warranty_candidates: for every purchased row that is a durable physical product likely to have a manufacturer warranty (electronics, appliances, phones, computers, tablets, cameras, TVs, kitchen appliances such as kettles/mixers/coffee machines/vacuum cleaners, power tools, sporting equipment, furniture with mechanical/electrical parts, bicycles, watches), return an object:
  * name: the product name from that row, cleaned
  * is_warranty_candidate: true when the row plausibly has a warranty, false otherwise
  * suggested_warranty_months: typical consumer warranty length in months (24 for electronics/appliances/phones/computers in the EU, 12 for small electronics/accessories, 60 for premium appliances when explicitly stated); null when unclear
  * estimated_price: the row-level price if visible on the receipt, otherwise null
  Do NOT include consumables (food, beverages, tobacco, cleaning supplies, cosmetics, medicines, fuel, parking, services). Return null when nothing on the receipt looks like a warranty candidate.`,
      agreement: AGREEMENT_ANALYSIS_PROMPT,
      recurring:
        `Read this invoice/contract/subscription document carefully with OCR and extract fields describing a RECURRING PAYMENT (utility bill, subscription, leasing, installment, insurance, phone/internet contract, streaming, cloud/software).
Return a JSON object with EXACTLY these keys (no others): service_name, provider, category, amount, currency, frequency, start_date, next_due_date, end_date, due_day, notes, payee_name, bank_name, iban, reference_number, payment_description.
Return null for any field that is not clearly present, and never invent a value.
- service_name: short human name for the payment (e.g. "Telefoniarve", "Netflix", "Elektrileping", "Autoliising"); infer from the document heading when explicit.
- provider: company that issues the bill/contract (e.g. Elisa, Telia, Netflix, Enefit).
- category: one of Utilities, Electricity, Water, Waste, Phone, Internet, TV, Leasing, Installment, Mortgage, Streaming, CloudStorage, AI, Software, Insurance, Subscription, Other. Pick the best match, otherwise null.
- amount: the recurring amount charged each period (not a one-off setup fee, not a yearly total unless the doc says the frequency is annual).
- currency: ISO code (EUR, USD…) when explicit.
- frequency: one of "monthly", "bimonthly", "quarterly", "semiannual", "annual". Choose the value that matches the billing cadence described on the document. Default to "monthly" ONLY when the document clearly implies a monthly cycle.
- start_date: contract/service start date in YYYY-MM-DD when stated.
- next_due_date: next payment due date in YYYY-MM-DD when the document lists one.
- end_date: contract end/termination date in YYYY-MM-DD when stated.
- due_day: monthly payment day of month (1–31) when the contract states a fixed day (e.g. "makse 10. kuupäeval"); null otherwise.
- notes: short free-text note only when helpful, otherwise null.
- payee_name: exact legal recipient/company name to which the payment must be made (e.g. "Telia Eesti AS", "STV AS"); null when not clearly on the document.
- bank_name: bank name of the recipient account when explicitly shown (e.g. "Swedbank", "SEB", "LHV"); null otherwise.
- iban: recipient IBAN / bank account number exactly as printed, keep spaces removed and letters uppercase; null when not clearly present. NEVER invent an IBAN.
- reference_number: payment reference number (viitenumber) exactly as printed; null when not clearly present. NEVER invent a reference number.
- payment_description: payment description / explanation line (selgitus) exactly as printed on the invoice; null when not clearly present.`,
    };
    const locale = data.locale ?? "en";
    const languageName = locale === "et" ? "Estonian (eesti keel)" : "English";
    const languageDirective = `\n\nIMPORTANT LANGUAGE RULE: Return every free-text field (title, notes, description, category, purchased_items, and any other human-readable text) in ${languageName}. Translate values into ${languageName} when the source document is written in another language. Keep proper nouns (company names, store names, brand names), agreement numbers, ISO dates (YYYY-MM-DD), numeric amounts, and ISO currency codes unchanged.`;
    extractionPrompts.warranty += languageDirective;
    extractionPrompts.expense += languageDirective;
    extractionPrompts.agreement += languageDirective;
    extractionPrompts.recurring += languageDirective;
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGateway(key);
    const model = gateway("google/gemini-2.5-flash");

    const schema: z.ZodTypeAny =
      data.kind === "warranty"
        ? warrantySchema
        : data.kind === "expense"
          ? expenseSchema
          : data.kind === "agreement"
            ? agreementSchema
            : recurringSchema;

    const files = data.files?.length
      ? data.files
      : data.mime && data.base64
        ? [{ name: "document", mime: data.mime, base64: data.base64 }]
        : [];
    if (files.length === 0 || files.length > 20) {
      console.error("[ocr] invalid file count", { kind: data.kind, count: files.length });
      return { ok: false as const, error: "Please add between 1 and 20 document files." };
    }
    for (const [index, file] of files.entries()) {
      const mime = file.mime.toLowerCase();
      const isImage = mime.startsWith("image/");
      const approxBytes = Math.floor((file.base64.length * 3) / 4);
      if (!file.base64 || file.base64.length < 32) {
        console.error("[ocr] empty or too small base64", { kind: data.kind, index, name: file.name, mime, len: file.base64.length });
        return { ok: false as const, error: `File ${index + 1} is empty or unreadable.` };
      }
      if (approxBytes > maxInlineBytes) {
        console.error("[ocr] file too large", { kind: data.kind, index, name: file.name, mime, approxBytes });
        return { ok: false as const, error: `File ${index + 1} is too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Max 20 MB.` };
      }
      const mimeOk = isImage ? supportedImageMimes.includes(mime) : supportedDocumentMimes.includes(mime);
      if (!mimeOk) {
        console.error("[ocr] unsupported mime", { kind: data.kind, index, name: file.name, mime });
        return { ok: false as const, error: `Unsupported file format: ${file.mime || "unknown"}. Supported: JPG, PNG, WEBP, HEIC, PDF.` };
      }
    }

    console.info("[ocr] extracting", {
      kind: data.kind,
      fileCount: files.length,
      files: files.map((file, index) => ({ index, name: file.name, mime: file.mime, approxBytes: Math.floor((file.base64.length * 3) / 4) })),
    });

    try {
      if (data.kind === "agreement") {
        const content: Array<Record<string, unknown>> = [{ type: "text", text: extractionPrompts.agreement }];
        files.forEach((file, index) => {
          content.push({ type: "text", text: `Agreement page/file ${index + 1} of ${files.length}: ${file.name}` });
          const dataUrl = `data:${file.mime};base64,${file.base64}`;
          if (file.mime.toLowerCase().startsWith("image/")) {
            content.push({ type: "image", image: dataUrl });
          } else {
            content.push({ type: "file", data: dataUrl, mediaType: file.mime, filename: file.name });
          }
        });
        const agreementResult = await generateText({
          model,
          messages: [{ role: "user", content: content as never }],
        });
        const rawResponse = agreementResult.text ?? "";
        console.info("[ocr][agreement] AI raw response", rawResponse);
        const parsed = parseAgreementResponse(rawResponse);
        console.info("[ocr][agreement] OCR text", parsed.ocrText);
        if (parsed.parserErrors.length > 0) console.error("[ocr][agreement] parser errors", parsed.parserErrors);
        if (parsed.invalidFields.length > 0) console.error("[ocr][agreement] fields that failed normalization", parsed.invalidFields);
        const hasAny = Object.values(parsed.data).some((value) => value !== null && value !== "");
        if (!hasAny) {
          console.error("[ocr][agreement] no usable fields", {
            finishReason: agreementResult.finishReason,
            parserErrors: parsed.parserErrors,
            invalidFields: parsed.invalidFields,
          });
          return { ok: false as const, error: "No usable agreement details were found in the uploaded pages." };
        }
        console.info("[ocr][agreement] success", {
          finishReason: agreementResult.finishReason,
          keys: Object.keys(parsed.data).filter((key) => parsed.data[key as keyof typeof parsed.data] != null),
        });
        return { ok: true as const, data: parsed.data as Record<string, string | number | null> };
      }

      const primaryFile = files[0];
      const dataUrl = `data:${primaryFile.mime};base64,${primaryFile.base64}`;
      const isImage = primaryFile.mime.toLowerCase().startsWith("image/");
      const { output } = await generateText({
        model,
        output: Output.object({ schema: schema as z.ZodType<Record<string, unknown>> }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: extractionPrompts[data.kind] },
              isImage
                ? { type: "image", image: dataUrl }
                : {
                    type: "file",
                    data: dataUrl,
                    mediaType: primaryFile.mime,
                  },
            ],
          },
        ],
      });
      const result = output as Record<string, string | number | null | string[]>;
      // Detect "AI returned an object, but every field is null/empty" — this is
      // effectively "no readable data on the document".
      const hasAny = Object.values(result).some((v) => {
        if (v === null || v === undefined) return false;
        if (typeof v === "string") return v.trim().length > 0;
        if (Array.isArray(v)) return v.length > 0;
        return true;
      });
      if (!hasAny) {
        console.warn("[ocr] AI returned all-null object", { kind: data.kind, result });
        return { ok: false as const, error: "No readable text found on the document." };
      }
      console.info("[ocr] success", { kind: data.kind, keys: Object.keys(result).filter((k) => result[k] != null) });
      return { ok: true as const, data: result as Record<string, string | number | null> };
    } catch (err) {
      // Extract as much detail as possible for logs + user message.
      const anyErr = err as { message?: string; statusCode?: number; status?: number; cause?: unknown; responseBody?: string };
      const status = anyErr?.statusCode ?? anyErr?.status;
      console.error("[ocr] extract failed", {
        kind: data.kind,
        files: files.map((file) => ({ name: file.name, mime: file.mime })),
        status,
        message: anyErr?.message,
        responseBody: anyErr?.responseBody,
        cause: anyErr?.cause,
      });
      if (NoObjectGeneratedError.isInstance(err)) {
        return { ok: false as const, error: "AI could not analyse the document (no structured output)." };
      }
      if (status === 429) {
        return { ok: false as const, error: "AI rate limit reached. Please try again in a moment." };
      }
      if (status === 402) {
        return { ok: false as const, error: "AI credits exhausted for this workspace." };
      }
      if (status === 413) {
        return { ok: false as const, error: "File is too large for the AI service." };
      }
      if (anyErr?.message?.toLowerCase().includes("timeout")) {
        return { ok: false as const, error: "AI request timed out. Please try again." };
      }
      return {
        ok: false as const,
        error: err instanceof Error ? `AI service error: ${err.message}` : "AI service error.",
      };
    }
  });