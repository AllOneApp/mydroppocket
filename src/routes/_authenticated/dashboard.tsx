import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Wallet, FileText, ArrowRight, Bell, TrendingUp, TrendingDown, Repeat } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, warrantyStatus } from "@/lib/records";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DropPocket" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [w, e, a] = await Promise.all([
        supabase.from("warranties").select("*").order("warranty_expiry", { ascending: true }).limit(5),
        supabase.from("expenses").select("*").order("expense_date", { ascending: false }).limit(5),
        supabase.from("agreements").select("*").order("created_at", { ascending: false }).limit(5),
      ]);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      const yearStart = new Date(now.getFullYear(), 0, 1);
      const allExp = await supabase.from("expenses").select("amount, expense_date, type").gte("expense_date", yearStart.toISOString().slice(0, 10));
      const rows = (allExp.data ?? []) as { amount: number; expense_date: string; type: "expense" | "income" }[];
      const sum = (list: typeof rows, type: "expense" | "income") => list.filter((r) => r.type === type).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const todayStr = now.toISOString().slice(0, 10);
      const dayRows = rows.filter((r) => r.expense_date === todayStr);
      const weekRows = rows.filter((r) => new Date(r.expense_date) >= weekStart);
      const monthRows = rows.filter((r) => new Date(r.expense_date) >= monthStart);
      const totals = {
        today: { income: sum(dayRows, "income"), expense: sum(dayRows, "expense") },
        week: { income: sum(weekRows, "income"), expense: sum(weekRows, "expense") },
        month: { income: sum(monthRows, "income"), expense: sum(monthRows, "expense") },
        year: { income: sum(rows, "income"), expense: sum(rows, "expense") },
      };
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
        expenses: e.data ?? [],
        agreements: a.data ?? [],
        totals, expiring,
        recurring: { paid: rpPaid, unpaid: rpUnpaid, overdue: rpOverdue, next: nextPending, nextRec },
      };
    },
  });

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t("dashboard.welcome")}</h1>
        <p className="mt-1 text-muted-foreground">{t("dashboard.subtitle")}</p>
      </div>

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
        <ModuleCard to="/expenses" icon={Wallet} title={t("nav.expenses")} value={formatCurrency((data?.totals.month.income ?? 0) - (data?.totals.month.expense ?? 0))} sub={t("expenses.balance") + " · " + t("expenses.thisMonth")} />
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
                  <p className="mt-1 text-base font-bold">{data.recurring.next.due_date.slice(5).replace("-", ".")}</p>
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
            const p = data.totals[k];
            const bal = p.income - p.expense;
            const label = k === "today" ? t("expenses.today") : k === "week" ? t("expenses.thisWeek") : k === "month" ? t("expenses.thisMonth") : t("expenses.thisYear");
            return (
              <div key={k} className="card-soft p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
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
          {data?.expenses.length ? (
            <ul className="divide-y divide-border">
              {data.expenses.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.description || r.category}</p>
                    <p className="text-xs text-muted-foreground">{r.expense_date} · {r.category}</p>
                  </div>
                  <p className="text-sm font-semibold">{formatCurrency(Number(r.amount), r.currency ?? "EUR")}</p>
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