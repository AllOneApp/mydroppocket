import i18n from "@/i18n";

export type Frequency = "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual";

export const FREQUENCIES: Frequency[] = ["monthly", "bimonthly", "quarterly", "semiannual", "annual"];

export const CATEGORIES = [
  "Utilities", "Electricity", "Water", "Waste", "Phone", "Internet", "TV",
  "Leasing", "Installment", "Mortgage", "Streaming", "CloudStorage", "AI", "Software", "Insurance", "Subscription", "Other",
] as const;

export type Category = typeof CATEGORIES[number];

export function addFrequency(dateStr: string, freq: Frequency): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = freq === "monthly" ? 1 : freq === "bimonthly" ? 2 : freq === "quarterly" ? 3 : freq === "semiannual" ? 6 : 12;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // clamp to last day of month when overflowing (e.g. Jan 31 -> Feb 28)
  if (d.getDate() < day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }

function monthsFor(freq: Frequency): number {
  return freq === "monthly" ? 1 : freq === "bimonthly" ? 2 : freq === "quarterly" ? 3 : freq === "semiannual" ? 6 : 12;
}

/**
 * Advance one full period from `fromDueIso` (the last scheduled due date — NOT the
 * date the user marked it paid) and snap the day-of-month to `dueDay` when set.
 * Falls back to keeping the original day when `dueDay` is not set. Handles months
 * without the requested day by clamping to the month's last day, while preserving
 * `dueDay` as the anchor for subsequent months.
 */
export function nextDueFrom(fromDueIso: string, freq: Frequency, dueDay: number | null | undefined): string {
  const [y, m, d] = fromDueIso.split("-").map((n) => parseInt(n, 10));
  const targetMonth = (m - 1) + monthsFor(freq);
  const yr = y + Math.floor(targetMonth / 12);
  const mo = ((targetMonth % 12) + 12) % 12;
  const anchor = dueDay && dueDay >= 1 && dueDay <= 31 ? dueDay : d;
  const lastDay = new Date(yr, mo + 1, 0).getDate();
  const day = Math.min(anchor, lastDay);
  return `${yr}-${pad2(mo + 1)}-${pad2(day)}`;
}

/**
 * Compute the first due date on or after `startIso` for a given `dueDay` (1..31).
 * If the start date's day-of-month is past the due day, jumps to next month.
 */
export function firstDueOnOrAfter(startIso: string, dueDay: number): string {
  const [y, m, d] = startIso.split("-").map((n) => parseInt(n, 10));
  let yr = y, mo = m - 1;
  const lastDayStart = new Date(yr, mo + 1, 0).getDate();
  const domInStart = Math.min(dueDay, lastDayStart);
  if (d > domInStart) {
    mo += 1;
    yr += Math.floor(mo / 12);
    mo = ((mo % 12) + 12) % 12;
  }
  const lastDay = new Date(yr, mo + 1, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  return `${yr}-${pad2(mo + 1)}-${pad2(day)}`;
}

export function statusOf(due: string, paid: boolean): { tone: "green" | "orange" | "red"; label: string; days: number } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  const days = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (paid) return { tone: "green", label: i18n.t("recurring.status.paid"), days };
  if (days < 0) return { tone: "red", label: i18n.t("recurring.status.overdue", { days: -days }), days };
  return { tone: "orange", label: i18n.t("recurring.status.dueIn", { days }), days };
}

export function firstOfMonth(): string {
  const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
}
export function endOfMonth(): string {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().slice(0, 10);
}