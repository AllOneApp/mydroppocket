import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CreditCard, ArrowRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/records";
import { formatDate } from "@/lib/format";

type Row = {
  id: string;
  title: string;
  agreement_type: string;
  start_date: string | null;
  end_date: string | null;
  monthly_payment: number | null;
  total_amount: number | null;
  currency: string | null;
  iban: string | null;
  bank: string | null;
  reference_number: string | null;
};

type Derived = {
  row: Row;
  nextDue: string; // YYYY-MM-DD
  amount: number;
  remaining: number | null;
  daysUntil: number;
};

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return m;
}

function derive(row: Row, todayIso: string): Derived | null {
  if (row.agreement_type !== "installment") return null;
  const monthly = Number(row.monthly_payment ?? 0);
  if (!row.start_date || !monthly || monthly <= 0) return null;

  let totalPayments: number | null = null;
  if (row.total_amount && monthly > 0) {
    totalPayments = Math.max(1, Math.round(Number(row.total_amount) / monthly));
  } else if (row.end_date) {
    totalPayments = Math.max(1, monthsBetween(row.start_date, row.end_date) + 1);
  }

  // Payment schedule: due dates at start_date, start_date+1m, ...
  // paid count = number of due dates strictly before today.
  const elapsed = Math.max(0, monthsBetween(row.start_date, todayIso));
  const paid = totalPayments ? Math.min(elapsed, totalPayments) : elapsed;
  if (totalPayments && paid >= totalPayments) return null; // fully paid

  const nextDue = addMonths(row.start_date, paid);
  const remaining = totalPayments ? totalPayments - paid : null;

  const today = new Date(todayIso + "T00:00:00").getTime();
  const due = new Date(nextDue + "T00:00:00").getTime();
  const daysUntil = Math.round((due - today) / 86400000);

  return { row, nextDue, amount: monthly, remaining, daysUntil };
}

function toneFor(daysUntil: number): "green" | "yellow" | "red" {
  if (daysUntil < 0) return "red";
  if (daysUntil === 0) return "red";
  if (daysUntil <= 7) return "yellow";
  return "green";
}

function toneClass(tone: "green" | "yellow" | "red"): string {
  return tone === "green"
    ? "text-green-600"
    : tone === "yellow"
    ? "text-yellow-600"
    : "text-red-600";
}

async function copyPaymentDetails(d: Derived, copiedMsg: string, failedMsg: string) {
  const parts: string[] = [];
  if (d.row.iban) parts.push(`IBAN: ${d.row.iban}`);
  if (d.row.bank) parts.push(`Pank: ${d.row.bank}`);
  if (d.row.reference_number) parts.push(`Viitenumber: ${d.row.reference_number}`);
  parts.push(`Summa: ${formatCurrency(d.amount, d.row.currency ?? "EUR")}`);
  parts.push(`Selgitus: ${d.row.title}`);
  const text = parts.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast.success(copiedMsg);
  } catch {
    toast.error(failedMsg);
  }
}

export function InstallmentsCard() {
  const { t } = useTranslation();

  const { data: rows } = useQuery({
    queryKey: ["dashboard-installments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreements")
        .select("id, title, agreement_type, start_date, end_date, monthly_payment, total_amount, currency, iban, bank, reference_number")
        .eq("agreement_type", "installment");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const derived: Derived[] = (rows ?? [])
    .map((r) => derive(r, todayIso))
    .filter((d): d is Derived => d !== null)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));

  if (derived.length === 0) return null;

  const monthStart = new Date();
  monthStart.setDate(1);
  const mStartIso = monthStart.toISOString().slice(0, 10);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  const dueThisMonth = derived
    .filter((d) => d.nextDue >= mStartIso && d.nextDue <= monthEnd)
    .reduce((s, d) => s + d.amount, 0);
  const overdue = derived.filter((d) => d.daysUntil < 0).length;
  const next = derived[0];

  const copiedMsg = t("agreements.copied", { defaultValue: "Kopeeritud" });
  const failedMsg = t("common.failed", { defaultValue: "Ebaõnnestus" });

  return (
    <div className="mt-6">
      <div className="card-soft p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient-bg text-primary-foreground">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("installments.title", { defaultValue: "Järelmaksud" })}
              </p>
              <p className="text-lg font-semibold">
                {t("installments.subtitle", { defaultValue: "Aktiivsed järelmaksud" })}
              </p>
            </div>
          </div>
          <Link
            to="/agreements"
            className="text-muted-foreground transition hover:text-foreground"
            aria-label={t("dashboard.viewAll", { defaultValue: "Vaata kõiki" })}
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat
            label={t("installments.active", { defaultValue: "Aktiivseid lepinguid" })}
            value={String(derived.length)}
            tone="green"
          />
          <MiniStat
            label={t("installments.dueThisMonth", { defaultValue: "Sel kuul tasuda" })}
            value={formatCurrency(dueThisMonth)}
            tone="orange"
          />
          <MiniStat
            label={t("installments.overdue", { defaultValue: "Hilinenud" })}
            value={String(overdue)}
            tone={overdue > 0 ? "red" : "green"}
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("installments.nextDue", { defaultValue: "Järgmine makse" })}
            </p>
            <p className="mt-1 text-base font-bold">{formatDate(next.nextDue)}</p>
          </div>
        </div>

        <ul className="mt-5 divide-y divide-border">
          {derived.slice(0, 5).map((d) => {
            const tone = toneFor(d.daysUntil);
            return (
              <li key={d.row.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.row.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className={toneClass(tone)}>📅 {formatDate(d.nextDue)}</span>
                    {" · "}
                    <span className="font-semibold">
                      {formatCurrency(d.amount, d.row.currency ?? "EUR")}
                    </span>
                    {d.remaining !== null && (
                      <>
                        {" · "}
                        {t("installments.remainingCount", {
                          defaultValue: "Jäänud {{count}}",
                          count: d.remaining,
                        })}
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void copyPaymentDetails(d, copiedMsg, failedMsg);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg brand-gradient-bg px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                  disabled={!d.row.iban && !d.row.reference_number}
                  aria-label={t("installments.pay", { defaultValue: "Maksa" })}
                >
                  <Copy className="h-3 w-3" />
                  {t("installments.pay", { defaultValue: "Maksa" })}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "orange" | "red";
}) {
  const color =
    tone === "green" ? "text-green-600" : tone === "orange" ? "text-orange-600" : "text-red-600";
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}