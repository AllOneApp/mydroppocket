import { formatDate, formatDateShort, formatCategory } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Repeat, Trash2, CheckCircle2, Calendar, History, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDrop } from "@/components/FileDrop";
import { VoiceInput } from "@/components/VoiceInput";
import { ConfirmDeleteDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, signedUrl, uploadFile } from "@/lib/records";
import { syncFileToGoogleDrive, syncBackupCategory, currentBackupLang } from "@/lib/google-drive.functions";
import { syncRecurringPayment, removeCalendarSource } from "@/lib/google-calendar.functions";
import { CATEGORIES, FREQUENCIES, firstDueOnOrAfter, nextDueFrom, statusOf, type Frequency } from "@/lib/recurring";
import { extractDocument } from "@/lib/ocr.functions";
import { useActiveProfile } from "@/hooks/useActiveProfile";

export const Route = createFileRoute("/_authenticated/recurring")({
  head: () => ({ meta: [{ title: "Püsimaksed — MyDropPocket" }] }),
  component: RecurringPage,
});

type Recurring = {
  id: string; user_id: string;
  service_name: string; provider: string | null; category: string | null;
  amount: number; currency: string | null;
  frequency: Frequency; start_date: string; end_date: string | null;
  next_due_date: string; reminder_days_before: number; notes: string | null;
  contract_file_path: string | null; contract_file_name: string | null; contract_file_mime: string | null;
  payee_name: string | null; bank_name: string | null; iban: string | null;
  reference_number: string | null; payment_description: string | null;
  due_day: number | null;
};

type Instance = {
  id: string; user_id: string; recurring_payment_id: string;
  due_date: string; amount: number; currency: string | null;
  status: "pending" | "paid"; paid_at: string | null;
  receipt_file_path: string | null; receipt_file_name: string | null;
  invoice_file_path: string | null; invoice_file_name: string | null;
  notes: string | null;
  expense_id: string | null;
};

function RecurringPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeProfileId } = useActiveProfile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [pendingPay, setPendingPay] = useState<{ instance: Instance; recurring: Recurring } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Recurring | null>(null);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<Instance | null>(null);
  const [paidResult, setPaidResult] = useState<{ expenseId: string | null; label: string } | null>(null);

  const { data: recurring } = useQuery({
    queryKey: ["recurring_payments", activeProfileId],
    enabled: !!activeProfileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_payments")
        .select("*")
        .eq("profile_id", activeProfileId!)
        .order("next_due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Recurring[];
    },
  });

  const { data: instances } = useQuery({
    queryKey: ["recurring_instances", activeProfileId],
    enabled: !!activeProfileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_payment_instances")
        .select("*")
        .eq("profile_id", activeProfileId!)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Instance[];
    },
  });

  // Ensure every active recurring has at least one pending instance (its next_due_date)
  useEffect(() => {
    if (!recurring || !instances) return;
    const missing: { recurring: Recurring }[] = [];
    for (const r of recurring) {
      const has = instances.some((i) => i.recurring_payment_id === r.id && i.status === "pending");
      if (!has) missing.push({ recurring: r });
    }
    if (missing.length === 0) return;
    (async () => {
      const rows = missing.map(({ recurring: r }) => ({
        user_id: r.user_id,
        profile_id: activeProfileId,
        recurring_payment_id: r.id,
        due_date: r.next_due_date,
        amount: r.amount,
        currency: r.currency ?? "EUR",
        status: "pending" as const,
      }));
      await supabase.from("recurring_payment_instances").insert(rows);
      qc.invalidateQueries({ queryKey: ["recurring_instances"] });
    })();
  }, [recurring, instances, qc]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const summary = useMemo(() => {
    const list = instances ?? [];
    const inMonth = list.filter((i) => i.due_date >= monthStart && i.due_date <= monthEnd);
    const paid = inMonth.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
    const toPay = inMonth.filter((i) => i.status === "pending" && i.due_date >= today).reduce((s, i) => s + Number(i.amount), 0);
    const overdue = list.filter((i) => i.status === "pending" && i.due_date < today).reduce((s, i) => s + Number(i.amount), 0);
    const upcoming = list.filter((i) => i.status === "pending").sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
    const upcomingRec = upcoming ? (recurring ?? []).find((r) => r.id === upcoming.recurring_payment_id) : null;
    const paidCount = inMonth.filter((i) => i.status === "paid").length;
    const totalCount = inMonth.length;
    const percent = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;
    const history = list
      .filter((i) => i.status === "paid")
      .sort((a, b) => (b.paid_at ?? b.due_date).localeCompare(a.paid_at ?? a.due_date));
    // Month detail groups
    const monthPaid = inMonth.filter((i) => i.status === "paid")
      .sort((a, b) => (b.paid_at ?? b.due_date).localeCompare(a.paid_at ?? a.due_date));
    const monthToPay = inMonth.filter((i) => i.status === "pending" && i.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const monthOverdue = list.filter((i) => i.status === "pending" && i.due_date < today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    return { paid, toPay, overdue, upcoming, upcomingRec, paidCount, totalCount, percent, history, monthPaid, monthToPay, monthOverdue };
  }, [instances, recurring, monthStart, monthEnd, today]);

  async function markPaid(inst: Instance, rec: Recurring) {
    try {
      // 1) Create the linked expense entry (idempotent via existing expense_id)
      let expenseId: string | null = inst.expense_id;
      if (!expenseId) {
        const { data: exp, error: expErr } = await supabase.from("expenses").insert({
          user_id: rec.user_id,
          profile_id: activeProfileId,
          type: "expense",
          amount: Number(inst.amount ?? rec.amount),
          currency: inst.currency ?? rec.currency ?? "EUR",
          category: rec.category ?? "Other",
          expense_date: inst.due_date,
          description: rec.service_name,
          store: rec.provider ?? rec.service_name,
          notes: `↻ ${t("recurring.title")} · ${rec.service_name}`,
        }).select("id").single();
        if (expErr) throw expErr;
        expenseId = (exp as { id: string } | null)?.id ?? null;
      }
      // 2) Mark instance paid + link expense
      await supabase.from("recurring_payment_instances")
        .update({ status: "paid", paid_at: new Date().toISOString(), expense_id: expenseId })
        .eq("id", inst.id);
      // 3) Compute next due date (anchored to due_day, not paid_at)
      const nextDue = nextDueFrom(inst.due_date, rec.frequency, rec.due_day);
      if (!rec.end_date || nextDue <= rec.end_date) {
        // Idempotent insert — unique index on (recurring_payment_id, due_date)
        await supabase.from("recurring_payment_instances").upsert({
          user_id: rec.user_id,
          profile_id: activeProfileId,
          recurring_payment_id: rec.id,
          due_date: nextDue, amount: rec.amount, currency: rec.currency ?? "EUR",
          status: "pending",
        }, { onConflict: "recurring_payment_id,due_date", ignoreDuplicates: true });
        await supabase.from("recurring_payments").update({ next_due_date: nextDue }).eq("id", rec.id);
      }
      qc.invalidateQueries({ queryKey: ["recurring_payments"] });
      qc.invalidateQueries({ queryKey: ["recurring_instances"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setPaidResult({
        expenseId,
        label: `${rec.service_name} — ${formatCurrency(Number(inst.amount), inst.currency ?? "EUR")}`,
      });
      try {
        await syncBackupCategory({ data: { category: "recurring_payment_instances", lang: currentBackupLang(), profileId: activeProfileId } });
        await syncBackupCategory({ data: { category: "recurring_payments", lang: currentBackupLang(), profileId: activeProfileId } });
        await syncBackupCategory({ data: { category: "expenses", lang: currentBackupLang(), profileId: activeProfileId } });
      } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      try { await syncRecurringPayment({ data: { recurringId: rec.id } }); } catch (e) { console.warn("[gcal] recurring sync failed", e); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function performDelete(r: Recurring) {
    const prev = qc.getQueryData<Recurring[]>(["recurring_payments"]);
    qc.setQueryData<Recurring[]>(["recurring_payments"], (current = []) => current.filter((e) => e.id !== r.id));
    try {
      const { error } = await supabase.from("recurring_payments").delete().eq("id", r.id);
      if (error) throw error;
      if (r.contract_file_path) { try { await deleteFile(r.contract_file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      const insts = (instances ?? []).filter((i) => i.recurring_payment_id === r.id);
      for (const i of insts) {
        if (i.receipt_file_path) { try { await deleteFile(i.receipt_file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
        if (i.invoice_file_path) { try { await deleteFile(i.invoice_file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      }
      try { await removeCalendarSource({ data: { sourceType: "recurring", sourceId: r.id } }); } catch (e) { console.warn("[gcal] recurring remove failed", e); }
      try {
        await syncBackupCategory({ data: { category: "recurring_payments", lang: currentBackupLang(), profileId: activeProfileId } });
        await syncBackupCategory({ data: { category: "recurring_payment_instances", lang: currentBackupLang(), profileId: activeProfileId } });
      } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["recurring_payments"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["recurring_instances"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      toast.success(t("common.deleted"));
    } catch (e) {
      if (prev) qc.setQueryData(["recurring_payments"], prev);
      toast.error(e instanceof Error ? e.message : t("common.deleteFailed"));
    }
  }

  async function performDeleteHistory(inst: Instance, opts: { alsoExpense: boolean }) {
    try {
      const { error } = await supabase.from("recurring_payment_instances").delete().eq("id", inst.id);
      if (error) throw error;
      if (opts.alsoExpense && inst.expense_id) {
        try { await supabase.from("expenses").delete().eq("id", inst.expense_id); } catch (e) { console.warn("[expenses] delete failed", e); }
      }
      if (inst.receipt_file_path) { try { await deleteFile(inst.receipt_file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      if (inst.invoice_file_path) { try { await deleteFile(inst.invoice_file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      try {
        await syncBackupCategory({ data: { category: "recurring_payment_instances", lang: currentBackupLang(), profileId: activeProfileId } });
        if (opts.alsoExpense) await syncBackupCategory({ data: { category: "expenses", lang: currentBackupLang(), profileId: activeProfileId } });
      } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["recurring_instances"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["expenses"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      toast.success(t("recurring.historyDeleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.deleteFailed"));
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{t("recurring.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{t("recurring.desc")}</p>
        </div>
        <Button
          onClick={() => { setEditing(null); setOpen(true); }}
          className="brand-gradient-bg h-11 w-full justify-center text-primary-foreground sm:w-auto"
        >
          <Plus className="mr-1.5 h-4 w-4" />{t("recurring.add")}
        </Button>
      </div>

      {/* Month summary */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SumCard tone="green" label={"💚 " + t("recurring.paid")} value={formatCurrency(summary.paid)} />
        <SumCard tone="orange" label={"🟠 " + t("recurring.unpaid")} value={formatCurrency(summary.toPay)} />
        <SumCard tone="red" label={"🔴 " + t("recurring.overdue")} value={formatCurrency(summary.overdue)} />
        <div className="card-soft p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">📅 {t("recurring.nextDue")}</p>
          {summary.upcoming && summary.upcomingRec ? (
            <>
              <p className="mt-2 text-lg font-bold">{formatDateShort(summary.upcoming.due_date)}</p>
              <p className="truncate text-sm text-muted-foreground">{summary.upcomingRec.service_name}</p>
              <p className="text-sm font-semibold">{formatCurrency(Number(summary.upcoming.amount), summary.upcoming.currency ?? "EUR")}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("recurring.nothingDue")}</p>
          )}
        </div>
      </div>

      {/* Month progress */}
      {summary.totalCount > 0 && (
        <div className="card-soft mb-6 p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{t("recurring.monthProgress")}</p>
            <p className="text-sm font-bold">{summary.percent}%</p>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full brand-gradient-bg transition-all"
              style={{ width: `${summary.percent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("recurring.paymentsPaid", { paid: summary.paidCount, total: summary.totalCount })}
          </p>
        </div>
      )}

      {/* This month grouped view */}
      {(summary.monthOverdue.length + summary.monthToPay.length + summary.monthPaid.length) > 0 && (
        <div className="card-soft mb-6 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{t("recurring.monthDetailTitle")}</h3>
          </div>
          {([
            { key: "overdue", label: t("recurring.sectionOverdue"), items: summary.monthOverdue, tone: "text-red-600" },
            { key: "topay", label: t("recurring.sectionToPay"), items: summary.monthToPay, tone: "text-orange-600" },
            { key: "paid", label: t("recurring.sectionPaid"), items: summary.monthPaid, tone: "text-green-600" },
          ] as const).map((g) => g.items.length === 0 ? null : (
            <div key={g.key} className="mt-3 first:mt-0">
              <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${g.tone}`}>{g.label} · {g.items.length}</p>
              <ul className="divide-y divide-border">
                {g.items.map((i) => {
                  const rec = (recurring ?? []).find((r) => r.id === i.recurring_payment_id);
                  return (
                    <li key={i.id} className="flex items-center gap-3 py-2">
                      <div className={`w-16 shrink-0 text-center text-xs font-semibold ${g.tone}`}>
                        {formatDateShort(i.paid_at ?? i.due_date)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{rec?.service_name ?? "—"}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold">{formatCurrency(Number(i.amount), i.currency ?? "EUR")}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {(recurring ?? []).length === 0 ? (
        <div className="card-soft flex flex-col items-center p-12 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent"><Repeat className="h-6 w-6 text-primary" /></div>
          <h3 className="text-lg font-semibold">{t("recurring.empty.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("recurring.empty.desc")}</p>
          <Button onClick={() => { setEditing(null); setOpen(true); }} className="mt-4 brand-gradient-bg text-primary-foreground">
            <Plus className="mr-1.5 h-4 w-4" />{t("recurring.add")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {(recurring ?? []).map((r) => {
            const next = (instances ?? []).filter((i) => i.recurring_payment_id === r.id && i.status === "pending")
              .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
            const lastPaid = (instances ?? []).filter((i) => i.recurring_payment_id === r.id && i.status === "paid")
              .sort((a, b) => (b.paid_at ?? b.due_date).localeCompare(a.paid_at ?? a.due_date))[0] ?? null;
            const s = next ? statusOf(next.due_date, false) : { tone: "green" as const, label: t("recurring.status.paid"), days: 0 };
            const color = s.tone === "green" ? "text-green-600 bg-green-500/10" : s.tone === "orange" ? "text-orange-600 bg-orange-500/10" : "text-red-600 bg-red-500/10";
            const catLabel = r.category ? t(`recurring.categories.${r.category}` as const, { defaultValue: r.category }) : "";
            return (
              <div key={r.id} className="card-soft p-5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <button onClick={() => { setEditing(r); setOpen(true); }} className="min-w-0 text-left">
                    <h3 className="truncate text-base font-semibold hover:text-primary">{r.service_name}</h3>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {r.provider ?? "—"}{catLabel ? ` · ${catLabel}` : ""} · {t(`recurring.frequencies.${r.frequency}` as const)}
                    </p>
                    <p className="mt-1 text-sm">
                      {t("recurring.nextDue")}: <span className="font-medium">{formatDate(next ? next.due_date : r.next_due_date)}</span>
                    </p>
                    {lastPaid && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("recurring.lastPaid")}: {formatDate(lastPaid.paid_at ?? lastPaid.due_date)}
                      </p>
                    )}
                  </button>
                  <div className="flex flex-col items-end gap-2">
                    <p className="shrink-0 text-lg font-bold">{formatCurrency(Number(r.amount), r.currency ?? "EUR")}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{s.label}</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {next ? (
                    <Button size="sm" onClick={() => setPendingPay({ instance: next, recurring: r })} className="bg-green-600 text-white hover:bg-green-600/90">
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />{t("recurring.markPaid")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setPendingDelete(r)} className="ml-auto text-destructive hover:text-destructive">
                    <Trash2 className="mr-1.5 h-4 w-4" />{t("common.delete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment history */}
      <div className="mt-6">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="card-soft flex w-full items-center justify-between p-4 text-left transition hover:shadow-md"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-primary" />
            {t("recurring.historyTitle")}
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{summary.history.length}</span>
          </span>
          {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showHistory && (
          <div className="card-soft mt-2 p-5">
            {summary.history.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">{t("recurring.historyEmpty")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {summary.history.map((i) => {
                  const rec = (recurring ?? []).find((r) => r.id === i.recurring_payment_id);
                  return (
                    <li key={i.id} className="flex items-center gap-3 py-3">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{rec?.service_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("recurring.paidOn")}: {formatDate(i.paid_at ?? i.due_date)}
                        </p>
                      </div>
                      {i.receipt_file_path && (
                        <button
                          onClick={async () => {
                            try { const url = await signedUrl(i.receipt_file_path!); window.open(url, "_blank"); }
                            catch (e) { toast.error(e instanceof Error ? e.message : t("common.failed")); }
                          }}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title={t("recurring.viewReceipt")}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      )}
                      <p className="shrink-0 text-sm font-semibold">{formatCurrency(Number(i.amount), i.currency ?? "EUR")}</p>
                      <button
                        onClick={() => setPendingHistoryDelete(i)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title={t("recurring.deleteHistory")}
                        aria-label={t("recurring.deleteHistory")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <RecurringDialog
        key={`${activeProfileId ?? "no-profile"}:${editing?.id ?? "new"}`}
        open={open}
        onOpenChange={setOpen}
        row={editing}
      />
      <AlertDialog open={!!pendingPay} onOpenChange={(o) => { if (!o) setPendingPay(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recurring.confirmPayTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = pendingPay;
                setPendingPay(null);
                if (p) markPaid(p.instance, p.recurring);
              }}
              className="bg-green-600 text-white hover:bg-green-600/90"
            >
              {t("recurring.confirmPayAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const r = pendingDelete; setPendingDelete(null); if (r) void performDelete(r); }}
      />
      <Dialog open={!!pendingHistoryDelete} onOpenChange={(o) => { if (!o) setPendingHistoryDelete(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("recurring.historyDeleteChoiceTitle")}</DialogTitle>
            <DialogDescription>{t("recurring.historyDeleteChoiceDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              onClick={() => { const inst = pendingHistoryDelete; setPendingHistoryDelete(null); if (inst) void performDeleteHistory(inst, { alsoExpense: false }); }}
            >{t("recurring.historyDeleteOnly")}</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const inst = pendingHistoryDelete; setPendingHistoryDelete(null); if (inst) void performDeleteHistory(inst, { alsoExpense: true }); }}
              disabled={!pendingHistoryDelete?.expense_id}
            >{t("recurring.historyDeleteWithExpense")}</Button>
            <Button variant="ghost" onClick={() => setPendingHistoryDelete(null)}>{t("common.cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paidResult} onOpenChange={(o) => { if (!o) setPaidResult(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md">
          <DialogHeader>
            <DialogTitle>✅ {t("recurring.paidAndExpenseCreated")}</DialogTitle>
            <DialogDescription className="break-words">{paidResult?.label}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-col">
            <Button
              className="brand-gradient-bg text-primary-foreground"
              onClick={() => {
                const id = paidResult?.expenseId ?? null;
                setPaidResult(null);
                void navigate({ to: "/expenses", search: id ? { open: id } as never : undefined as never });
              }}
            >{t("recurring.viewInExpenses")}</Button>
            <Button variant="ghost" onClick={() => setPaidResult(null)}>{t("recurring.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function SumCard({ tone, label, value }: { tone: "green" | "orange" | "red"; label: string; value: string }) {
  const color = tone === "green" ? "text-green-600" : tone === "orange" ? "text-orange-600" : "text-red-600";
  return (
    <div className="card-soft p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function RecurringDialog({ open, onOpenChange, row }: { open: boolean; onOpenChange: (b: boolean) => void; row: Recurring | null }) {
  const qc = useQueryClient();
  const { t, i18n } = useTranslation();
  const { activeProfileId } = useActiveProfile();
  const extract = useServerFn(extractDocument);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanRequestRef = useRef(0);
  const [form, setForm] = useState(() => makeForm(row));

  useEffect(() => {
    if (open) {
      scanRequestRef.current += 1;
      setForm(makeForm(row));
      setFile(null);
    }
    return () => { scanRequestRef.current += 1; };
  }, [open, row]);
  useEffect(() => {
    if (open) console.info("[VoiceInput] recurring:form-state", { filledFields: Object.values(form).filter(Boolean).length });
  }, [open, form]);

  async function scan() {
    if (!file) return;
    const requestId = ++scanRequestRef.current;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const locale = (i18n.language?.toLowerCase().startsWith("et") ? "et" : "en") as "et" | "en";
      const res = await extract({ data: { kind: "recurring", mime: file.type || "application/octet-stream", base64, locale } });
      if (scanRequestRef.current !== requestId) return;
      if (!res.ok) { toast.error(res.error); return; }
      const d = res.data as Record<string, string | number | null>;
      const startNorm = normalizeDate(typeof d.start_date === "string" ? d.start_date : null);
      const nextRaw = normalizeDate(typeof d.next_due_date === "string" ? d.next_due_date : null);
      const nextFromDay = dueDayToDate(typeof d.due_day === "number" ? d.due_day : null);
      const endNorm = normalizeDate(typeof d.end_date === "string" ? d.end_date : null);
      const freq = (typeof d.frequency === "string" && (FREQUENCIES as readonly string[]).includes(d.frequency)) ? (d.frequency as Frequency) : null;
      const cat = (typeof d.category === "string" && (CATEGORIES as readonly string[]).includes(d.category)) ? (d.category as string) : null;
      setForm((f) => ({
        ...f,
        service_name: (typeof d.service_name === "string" && d.service_name.trim()) || f.service_name,
        provider: (typeof d.provider === "string" && d.provider.trim()) || f.provider,
        category: cat || f.category,
        amount: d.amount != null ? String(d.amount) : f.amount,
        currency: (typeof d.currency === "string" && d.currency.trim()) || f.currency,
        frequency: freq || f.frequency,
        start_date: startNorm || f.start_date,
        end_date: endNorm || f.end_date,
        next_due_date: nextRaw || nextFromDay || startNorm || f.next_due_date,
        due_day: typeof d.due_day === "number" && d.due_day >= 1 && d.due_day <= 31 ? String(d.due_day) : f.due_day,
        notes: (typeof d.notes === "string" && d.notes.trim()) || f.notes,
        payee_name: (typeof d.payee_name === "string" && d.payee_name.trim()) || f.payee_name,
        bank_name: (typeof d.bank_name === "string" && d.bank_name.trim()) || f.bank_name,
        iban: (typeof d.iban === "string" && d.iban.trim()) ? (d.iban as string).replace(/\s+/g, "").toUpperCase() : f.iban,
        reference_number: (typeof d.reference_number === "string" && d.reference_number.trim()) || f.reference_number,
        payment_description: (typeof d.payment_description === "string" && d.payment_description.trim()) || f.payment_description,
      }));
      toast.success(t("common.autoFilled", { defaultValue: "Väljad täidetud" }));
    } catch (e) {
      if (scanRequestRef.current !== requestId) return;
      toast.error(e instanceof Error ? e.message : t("common.scanFailed", { defaultValue: "Skaneerimine ebaõnnestus" }));
    } finally {
      if (scanRequestRef.current === requestId) setScanning(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProfileId) {
      toast.error(t("profiles.notReady", { defaultValue: "Aktiivne profiil pole veel laaditud. Palun proovi mõne hetke pärast uuesti." }));
      return;
    }
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      let fileInfo: { path: string; name: string; mime: string } | null = null;
      if (file) fileInfo = await uploadFile(uid, "recurring", file);
      const payload = {
        user_id: uid,
        profile_id: activeProfileId,
        service_name: form.service_name,
        provider: form.provider || null,
        category: form.category || null,
        amount: Number(form.amount),
        currency: form.currency || "EUR",
        frequency: form.frequency,
        start_date: form.start_date,
        end_date: form.end_date || null,
        next_due_date: form.next_due_date || form.start_date,
        reminder_days_before: Number(form.reminder_days_before),
        notes: form.notes || null,
        due_day: form.due_day ? Number(form.due_day) : null,
        payee_name: form.payee_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        iban: form.iban.replace(/\s+/g, "").toUpperCase() || null,
        reference_number: form.reference_number.trim() || null,
        payment_description: form.payment_description.trim() || null,
        ...(fileInfo ? { contract_file_path: fileInfo.path, contract_file_name: fileInfo.name, contract_file_mime: fileInfo.mime } : {}),
      };
      let recordId: string | null = null;
      if (row) {
        const { error } = await supabase.from("recurring_payments").update(payload).eq("id", row.id);
        if (error) throw error;
        recordId = row.id;
      } else {
        const { data: inserted, error } = await supabase.from("recurring_payments").insert(payload).select("id").single();
        if (error) throw error;
        recordId = inserted?.id ?? null;
      }
      if (fileInfo && recordId) {
        try {
          await syncFileToGoogleDrive({
            data: {
              table: "recurring_payments",
              recordId,
              gdriveColumn: "contract_gdrive_file_id",
              folderKey: "recurring",
              filePath: fileInfo.path,
              fileName: fileInfo.name,
              mime: fileInfo.mime,
              profileId: activeProfileId,
            },
          });
        } catch (err) {
          console.warn("[gdrive] recurring sync failed", err);
        }
      }
      try { await syncBackupCategory({ data: { category: "recurring_payments", lang: currentBackupLang(), profileId: activeProfileId } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      if (recordId) {
        try { await syncRecurringPayment({ data: { recurringId: recordId } }); } catch (e) { console.warn("[gcal] recurring sync failed", e); }
      }
      qc.invalidateQueries({ queryKey: ["recurring_payments"] });
      qc.invalidateQueries({ queryKey: ["recurring_instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(row ? t("common.updated") : t("recurring.added"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden sm:w-full sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? t("recurring.editTitle") : t("recurring.addTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="w-full min-w-0 max-w-full space-y-4">
          <div>
            <Label>{t("recurring.contractFile")}</Label>
            <FileDrop file={file} onFile={setFile} onScan={scan} scanning={scanning} />
          </div>
          <div className="flex justify-end">
            <VoiceInput
              context="recurring_payment"
              onResult={(d) => {
                console.info("[VoiceInput] recurring:onResult", { keys: Object.keys(d) });
                setForm((f) => {
                  const next = {
                    ...f,
                    service_name: (d.service_name as string) || f.service_name,
                    provider: (d.provider as string) || f.provider,
                    category: (d.category as string) && (CATEGORIES as readonly string[]).includes(d.category as string) ? (d.category as string) : f.category,
                    amount: d.amount != null ? String(d.amount) : f.amount,
                    currency: (d.currency as string) || f.currency,
                    frequency: (d.frequency as Frequency) || f.frequency,
                    start_date: (d.start_date as string) || f.start_date,
                    end_date: (d.end_date as string) || f.end_date,
                    next_due_date: (d.next_due_date as string) || dueDayToDate(d.due_day as number | null) || (d.start_date as string) || f.next_due_date,
                    notes: (d.notes as string) || f.notes,
                  };
                  console.info("[VoiceInput] recurring:setForm", { filledFields: Object.values(next).filter(Boolean).length });
                  return next;
                });
              }}
            />
          </div>
          <div><Label>{t("recurring.serviceName")} *</Label><Input required value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} /></div>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0"><Label>{t("recurring.provider")}</Label><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
            <div className="min-w-0">
              <Label>{t("recurring.category")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`recurring.categories.${c}` as const)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0"><Label>{t("recurring.amount")} *</Label><Input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="min-w-0"><Label>{t("recurring.currency")}</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
          </div>
          <div>
            <Label>{t("recurring.frequency")} *</Label>
            <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as Frequency })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{t(`recurring.frequencies.${f}` as const)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("recurring.dueDay")}</Label>
            <Select
              value={form.due_day || "auto"}
              onValueChange={(v) => {
                const nextDay = v === "auto" ? "" : v;
                setForm((f) => {
                  const start = f.start_date || new Date().toISOString().slice(0, 10);
                  const derivedNext = nextDay ? firstDueOnOrAfter(start, Number(nextDay)) : f.next_due_date;
                  return { ...f, due_day: nextDay, next_due_date: derivedNext };
                });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="auto">{t("recurring.dueDayAuto")}</SelectItem>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t("recurring.dueDayHint")}</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="min-w-0"><Label>{t("recurring.startDate")} *</Label><Input required type="date" value={form.start_date} onChange={(e) => {
              const start = e.target.value;
              setForm((f) => ({
                ...f,
                start_date: start,
                next_due_date: f.due_day ? firstDueOnOrAfter(start, Number(f.due_day)) : (f.next_due_date || start),
              }));
            }} /></div>
            <div className="min-w-0"><Label>{t("recurring.endDate")}</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          <div><Label>{t("recurring.nextDue")} *</Label><Input required type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} /></div>
          <div>
            <Label>{t("recurring.reminder")}</Label>
            <Select value={String(form.reminder_days_before)} onValueChange={(v) => setForm({ ...form, reminder_days_before: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t("recurring.reminders.7")}</SelectItem>
                <SelectItem value="3">{t("recurring.reminders.3")}</SelectItem>
                <SelectItem value="1">{t("recurring.reminders.1")}</SelectItem>
                <SelectItem value="0">{t("recurring.reminders.0")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>{t("recurring.notes")}</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-semibold">{t("recurring.paymentDetails")}</p>
            <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
              {t("recurring.aiPaymentWarning")}
            </p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0"><Label>{t("recurring.payeeName")}</Label><Input value={form.payee_name} onChange={(e) => setForm({ ...form, payee_name: e.target.value })} autoComplete="off" /></div>
              <div className="min-w-0"><Label>{t("recurring.bankName")}</Label><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} autoComplete="off" /></div>
            </div>
            <div className="mt-3 min-w-0">
              <Label>{t("recurring.iban")}</Label>
              <Input
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value })}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                data-lpignore="true"
                data-form-type="other"
                name="rp-iban"
              />
            </div>
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0"><Label>{t("recurring.referenceNumber")}</Label><Input value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} autoComplete="off" /></div>
              <div className="min-w-0"><Label>{t("recurring.paymentDescription")}</Label><Input value={form.payment_description} onChange={(e) => setForm({ ...form, payment_description: e.target.value })} autoComplete="off" /></div>
            </div>
          </div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? t("common.saving") : t("common.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function dueDayToDate(day: number | null | undefined): string | null {
  if (!day || day < 1 || day > 31) return null;
  const d = new Date();
  d.setDate(1);
  if (d.getDate() >= day) { /* today >= day → this month still */ }
  const target = new Date(d.getFullYear(), d.getMonth(), day);
  if (target.getTime() < Date.now() - 86400000) target.setMonth(target.getMonth() + 1);
  return target.toISOString().slice(0, 10);
}

function normalizeDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${mo}-${d}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function makeForm(row: Recurring | null) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    service_name: row?.service_name ?? "",
    provider: row?.provider ?? "",
    category: (row?.category ?? "Subscription") as string,
    amount: row?.amount?.toString() ?? "",
    currency: row?.currency ?? "EUR",
    frequency: (row?.frequency ?? "monthly") as Frequency,
    start_date: row?.start_date ?? today,
    end_date: row?.end_date ?? "",
    next_due_date: row?.next_due_date ?? today,
    reminder_days_before: String(row?.reminder_days_before ?? 3),
    notes: row?.notes ?? "",
    payee_name: row?.payee_name ?? "",
    bank_name: row?.bank_name ?? "",
    iban: row?.iban ?? "",
    reference_number: row?.reference_number ?? "",
    payment_description: row?.payment_description ?? "",
    due_day: row?.due_day != null ? String(row.due_day) : "",
  };
}