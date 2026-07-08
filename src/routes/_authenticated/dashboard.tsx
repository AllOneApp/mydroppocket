import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Wallet, FileText, ArrowRight, Bell } from "lucide-react";

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
      const allExp = await supabase.from("expenses").select("amount, expense_date").gte("expense_date", monthStart.toISOString().slice(0, 10));
      const rows = allExp.data ?? [];
      const monthTotal = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const weekTotal = rows.filter((r) => new Date(r.expense_date) >= weekStart).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const expiring = (w.data ?? []).filter((r) => {
        const s = warrantyStatus(r.warranty_expiry).tone;
        return s === "orange";
      });
      return {
        warranties: w.data ?? [],
        expenses: e.data ?? [],
        agreements: a.data ?? [],
        monthTotal, weekTotal, expiring,
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
        <ModuleCard to="/expenses" icon={Wallet} title={t("nav.expenses")} value={formatCurrency(data?.monthTotal ?? 0)} sub={t("dashboard.thisWeek", { amount: formatCurrency(data?.weekTotal ?? 0) })} />
        <ModuleCard to="/agreements" icon={FileText} title={t("nav.agreements")} value={t("dashboard.onFile", { count: data?.agreements.length ?? 0 })} sub={t("dashboard.contractsInstallments")} />
      </div>

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