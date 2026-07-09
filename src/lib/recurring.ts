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