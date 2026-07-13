import i18n from "@/i18n";

export function currentLang(): "et" | "en" {
  const l = (i18n.resolvedLanguage || i18n.language || "et").toLowerCase();
  return l.startsWith("et") ? "et" : "en";
}

/**
 * Locale-aware date formatting.
 * ET → DD.MM.YYYY, EN → "July 13, 2026".
 * Accepts YYYY-MM-DD or ISO timestamps; returns "—" for empty input.
 */
export function formatDate(input: string | null | undefined): string {
  if (!input) return "—";
  const s = String(input).slice(0, 10);
  const d = new Date(s + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(input);
  if (currentLang() === "et") {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}.${d.getFullYear()}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** Short DD.MM for ET, "Jul 13" for EN — for compact list badges. */
export function formatDateShort(input: string | null | undefined): string {
  if (!input) return "—";
  const s = String(input).slice(0, 10);
  const d = new Date(s + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(input);
  if (currentLang() === "et") {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}`;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

/** Translate a stored category key using the active language, with graceful fallback. */
export function formatCategory(
  kind: "expenses" | "recurring",
  cat: string | null | undefined,
): string {
  if (!cat) return "—";
  return i18n.t(`${kind}.categories.${cat}`, { defaultValue: cat });
}