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
      return { ok: true as const, data: output as Record<string, string | number | null> };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        return { ok: false as const, error: "Could not read document" };
      }
      console.error("OCR error", err);
      return { ok: false as const, error: err instanceof Error ? err.message : "OCR failed" };
    }
  });