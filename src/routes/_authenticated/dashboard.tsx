import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, Wallet, FileText, ArrowRight, Bell, TrendingUp, TrendingDown, Repeat, Plus, Mic, Upload, Pencil } from "lucide-react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { computeRange } from "@/components/DateRangeFilter";
import { supabase } from "@/integrations/supabase/client";
import { expenseTotals, expensesQueryKey, expensesQueryOptions, type ExpenseRow } from "@/lib/expenses";
import { formatCurrency, warrantyStatus } from "@/lib/records";
import { formatDate, formatDateShort, formatCategory } from "@/lib/format";
import { deleteFile } from "@/lib/records";
import { useTranslation } from "react-i18next";
import { ExpenseDialog } from "./expenses";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DropPocket" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickMode, setQuickMode] = useState<"voice" | "upload" | "manual">("manual");
  function openQuick(mode: "voice" | "upload" | "manual") {
    setQuickMode(mode);
    setQuickOpen(true);
  }
  const [periodKey, setPeriodKey] = useState<null | "today" | "week" | "month" | "year">(null);
  const [editRow, setEditRow] = useState<ExpenseRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<ExpenseRow | null>(null);

  async function performDelete(r: ExpenseRow) {
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", r.id);
      if (error) throw error;
      if (r.file_path) await deleteFile(r.file_path);
      qc.setQueryData<ExpenseRow[]>(expensesQueryKey, (current = []) => current.filter((e) => e.id !== r.id));
      await Promise.all([
        qc.invalidateQueries({ queryKey: expensesQueryKey, refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setDeleteRow(null);
    }
  }

  const { data: expenseRows = [] } = useQuery(expensesQueryOptions());
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Kasutaja sessiooni ei leitud.");

      const [w, a] = await Promise.all([
        supabase.from("warranties").select("*").order("warranty_expiry", { ascending: true }).limit(5),
        supabase.from("agreements").select("*").order("created_at", { ascending: false }).limit(5),
      ]);
      const expiring = (w.data ?? []).filter((r) => {
        const s = warrantyStatus(r.warranty_expiry).tone;
        return s === "orange";
      });

      // Recurring payments summary
      const now2 = new Date();
      const mStart = new Date(now2.getFullYear(), now2.getMonth(), 1).toISOString().slice(0, 10);
      const mEnd = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).toISOString().slice(0, 10);
      const todayStr2 = now2.toISOString().slice(0, 10);
      const [rp, rpi] = await Promise.all([
        supabase.from("recurring_payments").select("id, service_name, next_due_date, amount, currency"),
        supabase.from("recurring_payment_instances").select("id, due_date, amount, status, recurring_payment_id"),
      ]);
      const insts = (rpi.data ?? []) as { id: string; due_date: string; amount: number; status: "pending" | "paid"; recurring_payment_id: string }[];
      const rps = (rp.data ?? []) as { id: string; service_name: string; next_due_date: string; amount: number; currency: string | null }[];
      const monthInsts = insts.filter((i) => i.due_date >= mStart && i.due_date <= mEnd);
      const rpPaid = monthInsts.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
      const rpUnpaid = monthInsts.filter((i) => i.status === "pending" && i.due_date >= todayStr2).reduce((s, i) => s + Number(i.amount), 0);
      const rpOverdue = insts.filter((i) => i.status === "pending" && i.due_date < todayStr2).reduce((s, i) => s + Number(i.amount), 0);
      const nextPending = insts.filter((i) => i.status === "pending").sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
      const nextRec = nextPending ? rps.find((r) => r.id === nextPending.recurring_payment_id) ?? null : null;

      return {
        warranties: w.data ?? [],
        agreements: a.data ?? [],
        expiring,
        recurring: { paid: rpPaid, unpaid: rpUnpaid, overdue: rpOverdue, next: nextPending, nextRec },
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const totals = {
    today: expenseTotals(expenseRows, computeRange("today").from, computeRange("today").to),
    week: expenseTotals(expenseRows, computeRange("thisWeek").from, computeRange("thisWeek").to),
    month: expenseTotals(expenseRows, computeRange("thisMonth").from, computeRange("thisMonth").to),
    year: expenseTotals(expenseRows, computeRange("thisYear").from, computeRange("thisYear").to),
  };
  const recentExpenses = expenseRows.slice(0, 5);

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t("dashboard.welcome")}</h1>
        <p className="mt-1 text-muted-foreground">{t("dashboard.subtitle")}</p>
      </div>

      <div className="card-soft mb-6 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient-bg text-primary-foreground">
            <Plus className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("expenses.title")}</p>
            <p className="text-lg font-semibold">{t("expenses.addTitle")}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => openQuick("voice")}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium transition hover:bg-accent"
          >
            <Mic className="h-4 w-4" />{t("voice.speak")}
          </button>
          <button
            type="button"
            onClick={() => openQuick("upload")}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium transition hover:bg-accent"
          >
            <Upload className="h-4 w-4" />{t("expenses.uploadReceipt")}
          </button>
          <button
            type="button"
            onClick={() => openQuick("manual")}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium transition hover:bg-accent"
          >
            <Pencil className="h-4 w-4" />{t("expenses.fillManually")}
          </button>
        </div>
      </div>

      <ExpenseDialog open={quickOpen} onOpenChange={setQuickOpen} row={null} prefill={null} initialMode={quickMode} />

      {data?.expiring && data.expiring.length > 0 && (
        <div className="card-soft mb-6 flex items-start gap-3 border-orange-200 bg-orange-50 p-4 dark:border-orange-900/40 dark:bg-orange-950/30">
          <Bell className="mt-0.5 h-5 w-5 text-orange-600" />
          <div>
            <p className="font-medium">{t("dashboard.expiring", { count: data.expiring.length })}</p>
            <p className="text-sm text-muted-foreground">{t("dashboard.expiringDesc")}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <ModuleCard to="/warranties" icon={ShieldCheck} title={t("nav.warranties")} value={t("dashboard.warrantiesTracked", { count: data?.warranties.length ?? 0 })} sub={t("dashboard.expiringSoon", { count: data?.expiring.length ?? 0 })} />
        <ModuleCard to="/expenses" icon={Wallet} title={t("nav.expenses")} value={formatCurrency(totals.month.balance)} sub={t("expenses.balance") + " · " + t("expenses.thisMonth")} />
        <ModuleCard to="/agreements" icon={FileText} title={t("nav.agreements")} value={t("dashboard.onFile", { count: data?.agreements.length ?? 0 })} sub={t("dashboard.contractsInstallments")} />
      </div>

      {/* Recurring payments card */}
      <div className="mt-6">
        <Link to="/recurring" className="card-soft group block p-6 transition hover:-translate-y-0.5 hover:shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient-bg text-primary-foreground">
                <Repeat className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("nav.recurring")}</p>
                <p className="text-lg font-semibold">{t("recurring.monthSummary")}</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label={"💚 " + t("recurring.paid")} value={formatCurrency(data?.recurring.paid ?? 0)} tone="green" />
            <MiniStat label={"🟠 " + t("recurring.unpaid")} value={formatCurrency(data?.recurring.unpaid ?? 0)} tone="orange" />
            <MiniStat label={"🔴 " + t("recurring.overdue")} value={formatCurrency(data?.recurring.overdue ?? 0)} tone="red" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">📅 {t("recurring.nextDue")}</p>
              {data?.recurring.next && data.recurring.nextRec ? (
                <>
                  <p className="mt-1 text-base font-bold">{formatDateShort(data.recurring.next.due_date)}</p>
                  <p className="truncate text-xs text-muted-foreground">{data.recurring.nextRec.service_name}</p>
                  <p className="text-sm font-semibold">{formatCurrency(Number(data.recurring.next.amount), data.recurring.nextRec.currency ?? "EUR")}</p>
                </>
              ) : <p className="mt-1 text-sm text-muted-foreground">{t("recurring.nothingDue")}</p>}
            </div>
          </div>
        </Link>
      </div>


      {data && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["today", "week", "month", "year"] as const).map((k) => {
            const p = totals[k];
            const bal = p.balance;
            const label = k === "today" ? t("expenses.today") : k === "week" ? t("expenses.thisWeek") : k === "month" ? t("expenses.thisMonth") : t("expenses.thisYear");
            return (
              <div key={k} className="card-soft p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                  <button
                    type="button"
                    onClick={() => setPeriodKey(k)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("dashboard.viewMore")}
                  </button>
                </div>
                <div className="mt-3 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-green-600" />{t("expenses.income")}</span><span className="font-medium text-green-600">{formatCurrency(p.income)}</span></div>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><TrendingDown className="h-3.5 w-3.5 text-red-600" />{t("expenses.expense")}</span><span className="font-medium text-red-600">{formatCurrency(p.expense)}</span></div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5"><span className="font-semibold">{t("expenses.balance")}</span><span className={`font-bold ${bal >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(bal)}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="card-soft p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t("dashboard.recentExpenses")}</h3>
            <Link to="/expenses" className="text-sm text-primary hover:underline">{t("dashboard.viewAll")}</Link>
          </div>
          {recentExpenses.length ? (
            <ul className="divide-y divide-border">
              {recentExpenses.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.description || formatCategory("expenses", r.category)}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(r.expense_date)} · {formatCategory("expenses", r.category)}</p>
                  </div>
                  <p className={`text-sm font-semibold ${r.type === "income" ? "text-green-600" : "text-red-600"}`}>
                    {r.type === "income" ? "+" : "−"}{formatCurrency(Number(r.amount), r.currency ?? "EUR")}
                  </p>
                </li>
              ))}
            </ul>
          ) : <EmptyState msg={t("dashboard.noExpenses")} />}
        </div>

        <div className="card-soft p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t("dashboard.upcomingWarranties")}</h3>
            <Link to="/warranties" className="text-sm text-primary hover:underline">{t("dashboard.viewAll")}</Link>
          </div>
          {data?.warranties.length ? (
            <ul className="divide-y divide-border">
              {data.warranties.map((r) => {
                const s = warrantyStatus(r.warranty_expiry);
                const color = s.tone === "green" ? "text-green-600" : s.tone === "orange" ? "text-orange-600" : s.tone === "red" ? "text-red-600" : "text-muted-foreground";
                return (
                  <li key={r.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.product_name}</p>
                      <p className="text-xs text-muted-foreground">{r.store ?? "—"}</p>
                    </div>
                    <p className={`text-sm font-medium ${color}`}>{s.label}</p>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState msg={t("dashboard.noWarranties")} />}
        </div>
      </div>

      {(() => {
        if (!periodKey) return null;
        const rangeMap = {
          today: { range: computeRange("today"), label: t("expenses.today") },
          week: { range: computeRange("thisWeek"), label: t("expenses.thisWeek") },
          month: { range: computeRange("thisMonth"), label: t("expenses.thisMonth") },
          year: { range: computeRange("thisYear"), label: t("expenses.thisYear") },
        } as const;
        const { range, label } = rangeMap[periodKey];
        const rows = expenseRows.filter((r) => r.expense_date >= range.from && r.expense_date <= range.to);
        const inc = rows.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
        const exp = rows.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
        const bal = inc - exp;
        return (
          <Dialog open={!!periodKey} onOpenChange={(o) => !o && setPeriodKey(null)}>
            <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
              <DialogHeader className="border-b border-border p-6 pb-4">
                <DialogTitle>{label}</DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto p-6">
                {rows.length === 0 ? (
                  <EmptyState msg={t("dashboard.noEntries")} />
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((r) => {
                      const isIncome = r.type === "income";
                      const catLabel = t(`expenses.categories.${r.category}` as const, { defaultValue: r.category });
                      return (
                        <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 truncate text-sm font-medium">
                              {isIncome ? <TrendingUp className="h-3.5 w-3.5 shrink-0 text-green-600" /> : <TrendingDown className="h-3.5 w-3.5 shrink-0 text-red-600" />}
                              <span className="truncate">{r.description || catLabel}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(r.expense_date)} · {catLabel}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <p className={`text-sm font-semibold ${isIncome ? "text-green-600" : "text-red-600"}`}>
                              {isIncome ? "+" : "−"}{formatCurrency(Number(r.amount), r.currency ?? "EUR")}
                            </p>
                            <Button size="icon" variant="ghost" aria-label={t("common.edit")} onClick={() => { setEditRow(r); setEditOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label={t("common.delete")} onClick={() => setDeleteRow(r)} className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="border-t border-border p-6 pt-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("expenses.income")}</p>
                    <p className="mt-0.5 font-bold text-green-600">{formatCurrency(inc)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("expenses.expense")}</p>
                    <p className="mt-0.5 font-bold text-red-600">{formatCurrency(exp)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("expenses.balance")}</p>
                    <p className={`mt-0.5 font-bold ${bal >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(bal)}</p>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      <ExpenseDialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditRow(null); }} row={editRow} prefill={null} />

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("expenses.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>&nbsp;</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", { defaultValue: "Loobu" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteRow) void performDelete(deleteRow); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function ModuleCard({ to, icon: Icon, title, value, sub }: { to: "/warranties" | "/expenses" | "/agreements"; icon: React.ComponentType<{ className?: string }>; title: string; value: string; sub: string }) {
  return (
    <Link to={to} className="card-soft group flex flex-col justify-between p-6 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="mb-6 flex items-center justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient-bg text-primary-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </div>
    </Link>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{msg}</p>;
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "green" | "orange" | "red" }) {
  const color = tone === "green" ? "text-green-600" : tone === "orange" ? "text-orange-600" : "text-red-600";
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}