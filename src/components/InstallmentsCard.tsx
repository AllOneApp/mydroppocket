import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CreditCard, ArrowRight, Copy, Calendar, Wallet, Check, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/records";
import { formatDate } from "@/lib/format";
import { syncInstallmentAgreement } from "@/lib/google-calendar.functions";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  payments_made: number | null;
  agreement_number: string | null;
  payee_name: string | null;
};

type Derived = {
  row: Row;
  nextDue: string; // YYYY-MM-DD
  amount: number;
  remaining: number | null;
  daysUntil: number;
  paid: number;
  totalPayments: number | null;
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

  // Manually tracked paid count via payments_made.
  const paid = Math.max(0, Number(row.payments_made ?? 0));
  if (totalPayments && paid >= totalPayments) return null; // fully paid

  const nextDue = addMonths(row.start_date, paid);
  const remaining = totalPayments ? totalPayments - paid : null;

  const today = new Date(todayIso + "T00:00:00").getTime();
  const due = new Date(nextDue + "T00:00:00").getTime();
  const daysUntil = Math.round((due - today) / 86400000);

  return { row, nextDue, amount: monthly, remaining, daysUntil, paid, totalPayments };
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

function toneDotClass(tone: "green" | "yellow" | "red"): string {
  return tone === "green"
    ? "bg-green-500"
    : tone === "yellow"
    ? "bg-yellow-500"
    : "bg-red-500";
}

async function copyText(value: string, copiedMsg: string, failedMsg: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(copiedMsg, { duration: 1500 });
  } catch {
    toast.error(failedMsg);
  }
}

export function InstallmentsCard({ fullPage = false }: { fullPage?: boolean } = {}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { activeProfileId } = useActiveProfile();
  const [payDialog, setPayDialog] = useState<Derived | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["dashboard-installments", activeProfileId],
    enabled: !!activeProfileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreements")
        .select("id, title, agreement_type, start_date, end_date, monthly_payment, total_amount, currency, iban, bank, reference_number, payments_made, agreement_number, payee_name")
        .eq("profile_id", activeProfileId!)
        .eq("agreement_type", "installment");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const markPaidMutation = useMutation({
    mutationFn: async (d: Derived) => {
      const next = d.paid + 1;
      const { error } = await supabase
        .from("agreements")
        .update({ payments_made: next })
        .eq("id", d.row.id);
      if (error) throw error;
      // Best-effort: after marking paid, refresh the tracked Google Calendar event
      // (removes the just-paid one and creates the next). No-op if not connected.
      try {
        await syncInstallmentAgreement({ data: { agreementId: d.row.id } });
      } catch (e) {
        console.warn("[gcal] sync after markPaid failed", e);
      }
      return next;
    },
    onSuccess: () => {
      toast.success(t("installments.markedPaid", { defaultValue: "Makse märgitud tasutuks" }));
      void queryClient.invalidateQueries({ queryKey: ["dashboard-installments"] });
      void queryClient.invalidateQueries({ queryKey: ["agreements"] });
      setConfirmOpen(false);
      setPayDialog(null);
    },
    onError: () => {
      toast.error(t("common.failed", { defaultValue: "Ebaõnnestus" }));
    },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const derived: Derived[] = (rows ?? [])
    .map((r) => derive(r, todayIso))
    .filter((d): d is Derived => d !== null)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));

  if (derived.length === 0) {
    if (!fullPage) return null;
  }

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
  const totalRemaining = derived.reduce(
    (s, d) => (d.remaining !== null ? s + d.amount * d.remaining : s),
    0,
  );
  const avgMonthly = derived.length > 0
    ? derived.reduce((s, d) => s + d.amount, 0) / derived.length
    : 0;

  const copiedMsg = t("agreements.copied", { defaultValue: "Kopeeritud" });
  const failedMsg = t("common.failed", { defaultValue: "Ebaõnnestus" });

  return (
    <>
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
            label={t("installments.totalRemaining", { defaultValue: "Kokku jäänud tasuda" })}
            value={formatCurrency(totalRemaining)}
            tone="orange"
          />
          <MiniStat
            label={t("installments.avgMonthly", { defaultValue: "Keskmine kuumakse" })}
            value={formatCurrency(avgMonthly)}
            tone="green"
          />
          <MiniStat
            label={t("installments.overdue", { defaultValue: "Hilinenud" })}
            value={String(overdue)}
            tone={overdue > 0 ? "red" : "green"}
          />
        </div>

        {next && (
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="font-medium">
              {t("installments.nextDue", { defaultValue: "Järgmine makse" })}:
            </span>{" "}
            {formatDate(next.nextDue)}
          </p>
        )}

        <ul className="mt-5 space-y-3">
          {(fullPage ? derived : derived.slice(0, 5)).map((d) => {
            const tone = toneFor(d.daysUntil);
            return (
              <li
                key={d.row.id}
                className="rounded-xl border bg-card p-3 sm:p-4"
              >
                <div className="flex items-start gap-2">
                  <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
                    {d.row.title}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${toneClass(tone)}`}
                    aria-hidden
                  >
                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${toneDotClass(tone)}`} />
                    {d.daysUntil < 0
                      ? t("installments.overdue", { defaultValue: "Hilinenud" })
                      : d.daysUntil === 0
                      ? t("installments.today", { defaultValue: "Täna" })
                      : t("installments.inDays", { defaultValue: "{{n}} p", n: d.daysUntil })}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {t("installments.nextDue", { defaultValue: "Järgmine makse" })}
                    </p>
                    <p className={`mt-0.5 font-semibold ${toneClass(tone)}`}>
                      {formatDate(d.nextDue)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 text-muted-foreground">
                      <Wallet className="h-3 w-3" />
                      {t("installments.amount", { defaultValue: "Summa" })}
                    </p>
                    <p className="mt-0.5 font-semibold">
                      {formatCurrency(d.amount, d.row.currency ?? "EUR")}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground">
                      {t("installments.remainingLabel", { defaultValue: "Jäänud" })}
                    </p>
                    <p className="mt-0.5 font-semibold">
                      {d.remaining !== null
                        ? t("installments.remainingCountFull", {
                            defaultValue: "{{count}} makset",
                            count: d.remaining,
                          })
                        : "—"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setPayDialog(d)}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg brand-gradient-bg px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
                  aria-label={t("installments.pay", { defaultValue: "Maksa" })}
                >
                  <CreditCard className="h-3 w-3" />
                  {t("installments.pay", { defaultValue: "Maksa" })}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>

    <Dialog open={!!payDialog} onOpenChange={(o) => { if (!o) setPayDialog(null); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md gap-3 p-4 sm:p-6 max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {t("installments.payDialogTitle", { defaultValue: "Makse andmed" })}
          </DialogTitle>
          <DialogDescription className="break-words">{payDialog?.row.title}</DialogDescription>
        </DialogHeader>
        {payDialog && (
          <div className="space-y-3">
            <PayField
              label={t("installments.payeeName", { defaultValue: "Saaja nimi" })}
              value={payDialog.row.payee_name ?? ""}
              copiedMsg={t("installments.copied.payeeName", { defaultValue: "Saaja nimi kopeeritud" })}
              failedMsg={failedMsg}
            />
            <PayField
              label={t("agreements.bank", { defaultValue: "Pank" })}
              value={payDialog.row.bank ?? ""}
              copiedMsg={t("installments.copied.bank", { defaultValue: "Pank kopeeritud" })}
              failedMsg={failedMsg}
            />
            <PayField
              label={t("agreements.iban", { defaultValue: "Pangakonto (IBAN)" })}
              value={payDialog.row.iban ?? ""}
              copiedMsg={t("installments.copied.iban", { defaultValue: "Pangakonto kopeeritud" })}
              failedMsg={failedMsg}
              mono
            />
            <PayField
              label={t("agreements.referenceNumber", { defaultValue: "Viitenumber" })}
              value={payDialog.row.reference_number ?? ""}
              copiedMsg={t("installments.copied.reference", { defaultValue: "Viitenumber kopeeritud" })}
              failedMsg={failedMsg}
              mono
            />
            <PayField
              label={t("installments.amount", { defaultValue: "Summa" })}
              value={formatCurrency(payDialog.amount, payDialog.row.currency ?? "EUR")}
              copyValue={String(payDialog.amount.toFixed(2))}
              copiedMsg={t("installments.copied.amount", { defaultValue: "Summa kopeeritud" })}
              failedMsg={failedMsg}
            />
            <PayField
              label={t("installments.description", { defaultValue: "Selgitus" })}
              value={
                payDialog.row.agreement_number
                  ? t("installments.descriptionWithNumber", {
                      defaultValue: "Järelmaksu makse – Lepingu nr: {{n}}",
                      n: payDialog.row.agreement_number,
                    })
                  : t("installments.descriptionFallback", {
                      defaultValue: "Järelmaksu makse",
                    })
              }
              copiedMsg={t("installments.copied.description", { defaultValue: "Selgitus kopeeritud" })}
              failedMsg={failedMsg}
            />
          </div>
        )}
        <DialogFooter className="mt-2 sm:flex-col sm:space-x-0 sm:gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            {t("installments.markPaid", { defaultValue: "Märgi makstuks" })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("installments.confirmTitle", { defaultValue: "Kas oled kindel, et see makse on tasutud?" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("installments.confirmDesc", {
              defaultValue: "See märgib makse MyDropPocketis tasutuks. Pangamakset ei tehta.",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel", { defaultValue: "Tühista" })}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (payDialog) markPaidMutation.mutate(payDialog);
            }}
            disabled={markPaidMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            <Check className="mr-1 h-4 w-4" />
            {t("installments.confirmYes", { defaultValue: "Jah, märgi makstuks" })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function PayField({
  label,
  value,
  copyValue,
  copiedMsg,
  failedMsg,
  mono,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copiedMsg: string;
  failedMsg: string;
  mono?: boolean;
}) {
  const toCopy = (copyValue ?? value).trim();
  const disabled = !toCopy;
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <p
          className={`min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] break-words ${mono ? "font-mono" : ""}`}
          title={value || undefined}
        >
          {value || "—"}
        </p>
        <button
          type="button"
          onClick={() => void copyText(toCopy, copiedMsg, failedMsg)}
          disabled={disabled}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3 w-3" />
        </button>
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