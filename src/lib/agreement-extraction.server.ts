export type AgreementExtraction = {
  title: string | null;
  agreement_type: string | null;
  company: string | null;
  agreement_number: string | null;
  start_date: string | null;
  end_date: string | null;
  monthly_payment: number | null;
  total_amount: number | null;
  currency: string | null;
  notes: string | null;
};

const AGREEMENT_TYPES = ["installment", "warranty_extension", "purchase_contract", "service", "contract"] as const;

export const AGREEMENT_ANALYSIS_PROMPT = `You are analysing an agreement, not a receipt or a warranty card.
Treat every attached image and PDF, in the exact order supplied, as pages or appendices of ONE agreement. Read every page before answering. Information missing from the first page may appear on later pages.

First identify whether it is an installment/consumer-credit agreement, service agreement, purchase contract, warranty extension, or another contract. Installment agreements may use terms such as credit amount, financed amount, repayment schedule, monthly instalment, total repayable amount, and contract number. Service agreements may use customer number, service period, monthly fee, provider, and termination date.

Extract these fields independently. A missing field must be null and must never prevent other fields from being returned:
- title: the document title or a concise descriptive title
- agreement_type: exactly installment, warranty_extension, purchase_contract, service, or contract
- company: provider, creditor, seller, or service company
- agreement_number: agreement/contract/credit number
- start_date: agreement date or effective/start date in YYYY-MM-DD
- end_date: explicit end date in YYYY-MM-DD; null when no end date is stated
- monthly_payment: recurring monthly instalment/fee as a number
- total_amount: total financed, total payable, or contract total as a number; prefer the total payable by the customer when clearly stated
- currency: ISO currency code, for example EUR
- notes: concise useful details not represented above, or null
- ocr_text: page-labelled source excerpts that support the extracted values, including labels and nearby values

Return one JSON object with every key above. Do not wrap it in Markdown. Do not invent values. If exact JSON is not possible, return one "field: value" line per field.`;

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractBalancedObject(text: string) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function parseJsonCandidate(candidate: string, errors: string[]) {
  const variants = [
    candidate.trim(),
    candidate.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const variant of variants) {
    try {
      const parsed = JSON.parse(variant);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown JSON parser error");
    }
  }
  return null;
}

function parseLooseLines(text: string) {
  const result: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?([\p{L}\p{N}_ #/()-]{2,50})\s*[:=]\s*(.*?)\s*$/u);
    if (!match || !match[2]) continue;
    result[normalizeKey(match[1])] = match[2].replace(/^['"]|['"],?$/g, "").trim();
  }
  return result;
}

function addPlainTextMatches(source: Record<string, unknown>, text: string) {
  const patterns: Array<[string, RegExp]> = [
    ["title", /(?:document title|agreement title|title|pealkiri)\s+(?:is|on)\s+([^.;\n]+)/i],
    ["company", /(?:company|provider|creditor|seller|ettevõte|ettevote|teenusepakkuja|krediidiandja)\s+(?:is|on)\s+([^.;\n]+)/i],
    ["agreement_number", /(?:agreement|contract|credit|lepingu|krediidi)\s*(?:number|nr|no|number on|nr on)?\s*[#:]?\s*([A-Z0-9][A-Z0-9./_-]{2,})/i],
    ["start_date", /(?:start date|effective date|agreement date|alguskuupäev|alguskuupaev|lepingu kuupäev|lepingu kuupaev)\s+(?:is|on)?\s*([^.;\n]+)/i],
    ["end_date", /(?:end date|termination date|maturity date|lõppkuupäev|loppkuupaev)\s+(?:is|on)?\s*([^.;\n]+)/i],
    ["monthly_payment", /(?:monthly payment|monthly instalment|monthly installment|monthly fee|kuumakse)\s+(?:is|on)?\s*([^.;\n]+)/i],
    ["total_amount", /(?:total amount|total payable|contract total|credit amount|kogusumma|kokku tasuda)\s+(?:is|on)?\s*([^.;\n]+)/i],
    ["currency", /(?:currency|valuuta)\s+(?:is|on)?\s*([A-Z]{3})\b/i],
    ["notes", /(?:notes|remarks|märkmed|markmed)\s+(?:are|is|on)?\s*([^\n]+)/i],
  ];
  for (const [field, pattern] of patterns) {
    if (source[field] != null) continue;
    const match = text.match(pattern);
    if (match?.[1]) source[field] = match[1].trim();
  }
  return source;
}

function valueFor(source: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(source);
  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const match = entries.find(([key]) => normalizeKey(key) === wanted);
    if (match) return match[1];
  }
  return null;
}

function asText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || /^(null|undefined|unknown|not found|puudub|teadmata|n\/a|-|—)$/i.test(text)) return null;
  return text;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asText(value);
  if (!text) return null;
  const compact = text.replace(/[^0-9,.-]/g, "");
  const normalized = compact.includes(",") && compact.includes(".")
    ? compact.lastIndexOf(",") > compact.lastIndexOf(".")
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "")
    : compact.replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function asDate(value: unknown) {
  const text = asText(value);
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  return null;
}

function asAgreementType(value: unknown, searchableText: string) {
  const text = asText(value)?.toLowerCase() ?? "";
  if ((AGREEMENT_TYPES as readonly string[]).includes(text)) return text;
  const haystack = `${text}\n${searchableText}`.toLowerCase();
  if (/järelmaks|jarelmaks|instalment|installment|consumer credit|tarbijakrediit/.test(haystack)) return "installment";
  if (/garantii pikendus|extended warranty|warranty extension/.test(haystack)) return "warranty_extension";
  if (/ostu-?müügi|ostuleping|purchase contract|sales contract/.test(haystack)) return "purchase_contract";
  if (/teenusleping|service agreement|subscription agreement|liitumisleping/.test(haystack)) return "service";
  return text ? "contract" : null;
}

export function parseAgreementResponse(rawResponse: string) {
  const parserErrors: string[] = [];
  const fenced = [...rawResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  const balanced = extractBalancedObject(rawResponse);
  const candidates = [...fenced, ...(balanced ? [balanced] : []), rawResponse];
  let parsed: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    parsed = parseJsonCandidate(candidate, parserErrors);
    if (parsed) break;
  }
  const source = addPlainTextMatches(parsed
    ? ((parsed.agreement && typeof parsed.agreement === "object" ? parsed.agreement : parsed) as Record<string, unknown>)
    : parseLooseLines(rawResponse), rawResponse);
  const ocrText = asText(valueFor(source, ["ocr_text", "source_text", "extracted_text", "document_text"])) ?? rawResponse;
  const data: AgreementExtraction = {
    title: asText(valueFor(source, ["title", "pealkiri", "document_title", "agreement_title"])),
    agreement_type: asAgreementType(valueFor(source, ["agreement_type", "type", "lepingu_tüüp", "lepingu_tyyp"]), `${ocrText}\n${rawResponse}`),
    company: asText(valueFor(source, ["company", "ettevõte", "ettevote", "provider", "creditor", "seller"])),
    agreement_number: asText(valueFor(source, ["agreement_number", "contract_number", "credit_number", "lepingu_number", "lepingu_nr"])),
    start_date: asDate(valueFor(source, ["start_date", "agreement_date", "effective_date", "algus", "alguskuupäev", "alguskuupaev"])),
    end_date: asDate(valueFor(source, ["end_date", "termination_date", "maturity_date", "lõpp", "lopp", "lõppkuupäev", "loppkuupaev"])),
    monthly_payment: asNumber(valueFor(source, ["monthly_payment", "monthly_fee", "monthly_instalment", "monthly_installment", "kuumakse"])),
    total_amount: asNumber(valueFor(source, ["total_amount", "total_payable", "contract_total", "credit_amount", "kogusumma", "kokku"])),
    currency: asText(valueFor(source, ["currency", "valuuta"]))?.toUpperCase() ?? null,
    notes: asText(valueFor(source, ["notes", "remarks", "summary", "märkmed", "markmed"])),
  };
  const invalidFields: string[] = [];
  for (const [field, value] of Object.entries(source)) {
    const key = normalizeKey(field);
    if ((key.includes("date") || key.includes("kuupaev")) && asText(value) && !asDate(value)) invalidFields.push(field);
    if ((key.includes("amount") || key.includes("payment") || key.includes("summa") || key.includes("kuumakse")) && asText(value) && asNumber(value) == null) invalidFields.push(field);
  }
  return { data, ocrText, parserErrors: [...new Set(parserErrors)], invalidFields };
}