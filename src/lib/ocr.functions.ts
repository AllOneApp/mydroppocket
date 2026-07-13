import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGateway } from "./ai-gateway.server";

const InputSchema = z.object({
  kind: z.enum(["warranty", "expense", "agreement"]),
  mime: z.string(),
  base64: z.string(),
});

const SUPPORTED_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
const SUPPORTED_DOC_MIMES = ["application/pdf"];
// Approx byte size from base64 length. Gemini limit ~20MB inline.
const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export const extractDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
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
    });
    const agreementSchema = z.object({
      company: z.string().nullable(),
      agreement_number: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      monthly_payment: z.number().nullable(),
      total_amount: z.number().nullable(),
      currency: z.string().nullable(),
    });
    const extractionPrompts = {
      warranty:
        "Extract purchase receipt fields for a warranty record. Return null when a field is not clearly present.",
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
- category: one of Groceries, Fuel, Restaurant, Coffee, Shopping, Healthcare, Travel, Other when supported by the receipt, otherwise null.`,
      agreement:
        "Extract fields from this agreement/contract document. Dates in YYYY-MM-DD. Return null when unknown.",
    };
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGateway(key);
    const model = gateway("google/gemini-2.5-flash");

    const schema: z.ZodTypeAny =
      data.kind === "warranty"
        ? warrantySchema
        : data.kind === "expense"
          ? expenseSchema
          : agreementSchema;

    const dataUrl = `data:${data.mime};base64,${data.base64}`;
    const isImage = data.mime.startsWith("image/");

    // ── Input validation ────────────────────────────────────────────────
    if (!data.base64 || data.base64.length < 32) {
      console.error("[ocr] empty or too small base64", { kind: data.kind, mime: data.mime, len: data.base64.length });
      return { ok: false as const, error: "File is empty or unreadable." };
    }
    const approxBytes = Math.floor((data.base64.length * 3) / 4);
    if (approxBytes > MAX_INLINE_BYTES) {
      console.error("[ocr] file too large", { kind: data.kind, mime: data.mime, approxBytes });
      return {
        ok: false as const,
        error: `File is too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`,
      };
    }
    const mimeOk = isImage
      ? SUPPORTED_IMAGE_MIMES.includes(data.mime.toLowerCase())
      : SUPPORTED_DOC_MIMES.includes(data.mime.toLowerCase());
    if (!mimeOk) {
      console.error("[ocr] unsupported mime", { kind: data.kind, mime: data.mime });
      return {
        ok: false as const,
        error: `Unsupported file format: ${data.mime || "unknown"}. Supported: JPG, PNG, WEBP, HEIC, PDF.`,
      };
    }

    console.info("[ocr] extracting", { kind: data.kind, mime: data.mime, approxBytes });

    try {
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
                    mediaType: data.mime,
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
        mime: data.mime,
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