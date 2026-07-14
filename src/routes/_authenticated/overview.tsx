import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BarChart3, TrendingUp, TrendingDown, Wallet, ShieldCheck, FileText,
  Repeat, CreditCard, FileImage, FileIcon, Sparkles, AlertCircle, Calendar,
  ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

import { AppShell } from "@/components/AppShell";
import { computeRange, type PresetKey } from "@/components/DateRangeFilter";
import { supabase } from "@/integrations/supabase/client";
import { expensesQueryOptions, expenseTotals } from "@/lib/expenses";
import { formatCurrency, warrantyStatus } from "@/lib/records";
import { formatDate, formatCategory } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Ülevaade — MyDropPocket" }] }),
  component: OverviewPage,
});

type Preset = Extract<PresetKey, "today" | "thisWeek" | "thisMonth" | "thisYear" | "lastMonth" | "lastYear" | "custom">;

const CHART_COLORS = ["#22c55e", "#ef4444", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#6366f1"];

function OverviewPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [customFrom, setCustomFrom] = useState(computeRange("thisMonth").from);
  const [customTo, setCustomTo] = useState(computeRange("thisMonth").to);
  const range = preset === "custom" ? { from: customFrom, to: customTo } : computeRange(preset);

  const { data: expenses = [] } = useQuery(expensesQueryOptions());

  const { data: warranties = [] } = useQuery({
    queryKey: ["overview-warranties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("warranties").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: agreements = [] } = useQuery({
    queryKey: ["overview-agreements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: recurring = [] } = useQuery({
    queryKey: ["overview-recurring"],
    queryFn: async () => {
      const { data, error } = await supabase.from("recurring_payments").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: rpInstances = [] } = useQuery({
    queryKey: ["overview-rp-instances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("recurring_payment_instances").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  // ===== Money by period =====
  const periods = useMemo(() => {
    const p: Array<{ key: string; label: string; range: { from: string; to: string } }> = [
      { key: "today", label: t("expenses.today"), range: computeRange("today") },
      { key: "thisWeek", label: t("expenses.thisWeek"), range: computeRange("thisWeek") },
      { key: "thisMonth", label: t("expenses.thisMonth"), range: computeRange("thisMonth") },
      { key: "thisYear", label: t("expenses.thisYear"), range: computeRange("thisYear") },
    ];
    return p.map((x) => ({ ...x, totals: expenseTotals(expenses, x.range.from, x.range.to) }));
  }, [expenses, t]);

  const rangedExpenses = useMemo(
    () => expenses.filter((e) => e.expense_date >= range.from && e.expense_date <= range.to),
    [expenses, range.from, range.to],
  );
  const rangedTotals = expenseTotals(expenses, range.from, range.to);

  // Monthly income vs expense (last 12 months)
  const monthly = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; income: number; expense: number; balance: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString(undefined, { month: "short" });
      buckets.push({ key, label, income: 0, expense: 0, balance: 0 });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const e of expenses) {
      const k = String(e.expense_date).slice(0, 7);
      const b = byKey.get(k);
      if (!b) continue;
      const amt = Number(e.amount ?? 0);
      if (e.type === "income") b.income += amt;
      else b.expense += amt;
    }
    buckets.forEach((b) => (b.balance = b.income - b.expense));
    return buckets;
  }, [expenses]);

  // Yearly income vs expense
  const yearly = useMemo(() => {
    const map = new Map<string, { year: string; income: number; expense: number }>();
    for (const e of expenses) {
      const y = String(e.expense_date).slice(0, 4);
      if (!map.has(y)) map.set(y, { year: y, income: 0, expense: 0 });
      const b = map.get(y)!;
      const amt = Number(e.amount ?? 0);
      if (e.type === "income") b.income += amt;
      else b.expense += amt;
    }
    return Array.from(map.values()).sort((a, b) => a.year.localeCompare(b.year));
  }, [expenses]);

  // Category pie (expenses only, in range)
  const categoryPie = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rangedExpenses) {
      if (e.type !== "expense") continue;
      const cat = e.category || "Other";
      map.set(cat, (map.get(cat) ?? 0) + Number(e.amount ?? 0));
    }
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount, label: formatCategory("expenses", category) }))
      .sort((a, b) => b.amount - a.amount);
  }, [rangedExpenses]);

  // Biggest expenses
  const monthRange = computeRange("thisMonth");
  const yearRange = computeRange("thisYear");
  const biggestThisMonth = expenses
    .filter((e) => e.type === "expense" && e.expense_date >= monthRange.from && e.expense_date <= monthRange.to)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const biggestThisYear = expenses
    .filter((e) => e.type === "expense" && e.expense_date >= yearRange.from && e.expense_date <= yearRange.to)
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];

  const yearExpenses = expenses.filter(
    (e) => e.type === "expense" && e.expense_date >= yearRange.from && e.expense_date <= yearRange.to,
  );
  const catCount = new Map<string, number>();
  const catSum = new Map<string, number>();
  for (const e of yearExpenses) {
    const c = e.category || "Other";
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
    catSum.set(c, (catSum.get(c) ?? 0) + Number(e.amount ?? 0));
  }
  const mostFrequentCat = Array.from(catCount.entries()).sort((a, b) => b[1] - a[1])[0];
  const highestSpendCat = Array.from(catSum.entries()).sort((a, b) => b[1] - a[1])[0];

  // Documents counts
  const totalWarranties = warranties.length;
  const installmentAgreements = agreements.filter((a: { agreement_type?: string | null }) => a.agreement_type === "installment").length;
  const otherAgreements = agreements.length - installmentAgreements;
  const totalRecurring = recurring.length;
  const allFiles: { name: string | null; mime: string | null }[] = [
    ...expenses.map((e) => ({ name: e.file_name, mime: null })),
    ...warranties.map((w: { file_name: string | null; file_mime: string | null }) => ({ name: w.file_name, mime: w.file_mime })),
    ...agreements.map((a: { file_name: string | null; file_mime: string | null }) => ({ name: a.file_name, mime: a.file_mime })),
  ].filter((f) => f.name);
  const isPdf = (f: { name: string | null; mime: string | null }) =>
    (f.mime && f.mime.includes("pdf")) || (f.name && /\.pdf$/i.test(f.name));
  const isImage = (f: { name: string | null; mime: string | null }) =>
    (f.mime && f.mime.startsWith("image/")) || (f.name && /\.(jpe?g|png|webp|heic|gif)$/i.test(f.name));
  const pdfCount = allFiles.filter(isPdf).length;
  const imageCount = allFiles.filter(isImage).length;
  const receiptCount = expenses.filter((e) => e.file_name).length;

  // Warranties
  const today = new Date().toISOString().slice(0, 10);
  const activeWarranties = warranties.filter((w: { warranty_expiry: string | null }) => !w.warranty_expiry || w.warranty_expiry >= today).length;
  const expiringSoon = warranties.filter((w: { warranty_expiry: string | null }) => {
    const s = warrantyStatus(w.warranty_expiry);
    return s.tone === "orange";
  }).length;
  const expiredCount = warranties.filter((w: { warranty_expiry: string | null }) => {
    const s = warrantyStatus(w.warranty_expiry);
    return s.tone === "red";
  }).length;

  // Installments computation
  const installments = agreements.filter((a: { agreement_type?: string | null }) => a.agreement_type === "installment") as Array<{
    id: string; title: string; start_date: string | null; end_date: string | null;
    monthly_payment: number | null; total_amount: number | null; payments_made: number | null; currency: string | null;
  }>;

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

  const installmentDerived = installments.map((row) => {
    const monthly = Number(row.monthly_payment ?? 0);
    if (!row.start_date || monthly <= 0) return null;
    let totalPayments: number | null = null;
    if (row.total_amount && monthly > 0) totalPayments = Math.max(1, Math.round(Number(row.total_amount) / monthly));
    else if (row.end_date) totalPayments = Math.max(1, monthsBetween(row.start_date, row.end_date) + 1);
    const paid = Math.max(0, Number(row.payments_made ?? 0));
    if (totalPayments && paid >= totalPayments) return null;
    const nextDue = addMonths(row.start_date, paid);
    const remaining = totalPayments ? totalPayments - paid : null;
    const daysUntil = Math.round((new Date(nextDue + "T00:00:00").getTime() - Date.now()) / 86400000);
    return { row, monthly, nextDue, remaining, daysUntil };
  }).filter((d): d is NonNullable<typeof d> => d !== null);

  const inMonthStart = monthRange.from;
  const inMonthEnd = monthRange.to;
  const instActive = installmentDerived.length;
  const instTotalRemaining = installmentDerived.reduce((s, d) => (d.remaining !== null ? s + d.monthly * d.remaining : s), 0);
  const instMonth = installmentDerived
    .filter((d) => d.nextDue >= inMonthStart && d.nextDue <= inMonthEnd)
    .reduce((s, d) => s + d.monthly, 0);
  const instOverdue = installmentDerived.filter((d) => d.daysUntil < 0).length;
  const instAvgMonthly = installmentDerived.length ? installmentDerived.reduce((s, d) => s + d.monthly, 0) / installmentDerived.length : 0;
  const instNext = [...installmentDerived].sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0];

  // Recurring
  const rpMonth = rpInstances.filter((i: { due_date: string }) => i.due_date >= inMonthStart && i.due_date <= inMonthEnd);
  const rpOverdue = rpInstances.filter((i: { due_date: string; status: string }) => i.status === "pending" && i.due_date < today).length;
  const rpNext = [...rpInstances]
    .filter((i: { status: string }) => i.status === "pending")
    .sort((a: { due_date: string }, b: { due_date: string }) => a.due_date.localeCompare(b.due_date))[0];
  const rpNextParent = rpNext ? recurring.find((r: { id: string }) => r.id === (rpNext as { recurring_payment_id: string }).recurring_payment_id) : null;

  // Upcoming timeline (next 30 days)
  type TL = { date: string; label: string; amount?: number; kind: "recurring" | "installment" | "warranty"; icon: typeof Repeat };
  const timeline: TL[] = [];
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Iso = in30.toISOString().slice(0, 10);

  installmentDerived.forEach((d) => {
    if (d.nextDue >= today && d.nextDue <= in30Iso) {
      timeline.push({ date: d.nextDue, label: d.row.title, amount: d.monthly, kind: "installment", icon: CreditCard });
    }
  });
  rpInstances.forEach((i: { due_date: string; status: string; amount: number; recurring_payment_id: string }) => {
    if (i.status === "pending" && i.due_date >= today && i.due_date <= in30Iso) {
      const parent = recurring.find((r: { id: string }) => r.id === i.recurring_payment_id) as { service_name?: string } | undefined;
      timeline.push({ date: i.due_date, label: parent?.service_name ?? "—", amount: Number(i.amount), kind: "recurring", icon: Repeat });
    }
  });
  warranties.forEach((w: { warranty_expiry: string | null; product_name: string }) => {
    if (w.warranty_expiry && w.warranty_expiry >= today && w.warranty_expiry <= in30Iso) {
      timeline.push({ date: w.warranty_expiry, label: w.product_name, kind: "warranty", icon: ShieldCheck });
    }
  });
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  // AI summary (rule-based)
  const summaryPoints: string[] = [];
  const lastMonthRange = computeRange("lastMonth");
  const thisMonthExpense = expenseTotals(expenses, monthRange.from, monthRange.to).expense;
  const lastMonthExpense = expenseTotals(expenses, lastMonthRange.from, lastMonthRange.to).expense;
  if (lastMonthExpense > 0) {
    const diff = ((thisMonthExpense - lastMonthExpense) / lastMonthExpense) * 100;
    const abs = Math.abs(diff).toFixed(0);
    if (diff < -1) summaryPoints.push(`Selle kuu kulud on ${abs}% väiksemad kui eelmisel kuul.`);
    else if (diff > 1) summaryPoints.push(`Selle kuu kulud on ${abs}% suuremad kui eelmisel kuul.`);
  }
  if (highestSpendCat) {
    summaryPoints.push(`Kõige rohkem kulutasid kategooriale "${formatCategory("expenses", highestSpendCat[0])}" — ${formatCurrency(highestSpendCat[1])}.`);
  }
  const next7 = new Date(); next7.setDate(next7.getDate() + 7);
  const next7Iso = next7.toISOString().slice(0, 10);
  const upcoming7 = timeline.filter((x) => x.date <= next7Iso && (x.kind === "recurring" || x.kind === "installment"));
  if (upcoming7.length > 0) {
    const sum = upcoming7.reduce((s, x) => s + (x.amount ?? 0), 0);
    summaryPoints.push(`Järgmise 7 päeva jooksul tuleb tasuda ${upcoming7.length} makset kogusummas ${formatCurrency(sum)}.`);
  }
  const soon = warranties.filter((w: { warranty_expiry: string | null }) => {
    if (!w.warranty_expiry) return false;
    const s = warrantyStatus(w.warranty_expiry);
    return s.tone === "orange";
  });
  if (soon.length > 0) {
    const nearest = [...soon].sort((a: { warranty_expiry: string | null }, b: { warranty_expiry: string | null }) =>
      String(a.warranty_expiry).localeCompare(String(b.warranty_expiry)))[0] as { warranty_expiry: string };
    const days = Math.max(0, Math.round((new Date(nearest.warranty_expiry).getTime() - Date.now()) / 86400000));
    summaryPoints.push(`${soon.length} garantii${soon.length > 1 ? "d" : ""} aegub varsti (lähim ${days} päeva pärast).`);
  }
  if (summaryPoints.length === 0) summaryPoints.push("Kõik on korras — olulisi muudatusi ega tähtaegasid pole.");

  const PRESETS: Preset[] = ["today", "thisWeek", "thisMonth", "thisYear", "lastMonth", "lastYear", "custom"];

  return (
    <AppShell>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <BarChart3 className="h-7 w-7 text-primary" />
            {t("overview.title", { defaultValue: "Ülevaade" })}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t("overview.subtitle", { defaultValue: "Sinu finantside, dokumentide ja kohustuste põhjalik vaade." })}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card-soft mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem]">
            <Label className="text-xs">{t("dateRange.period", { defaultValue: "Periood" })}</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>{t(`dateRange.presets.${p}`, { defaultValue: p })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {preset === "custom" && (
            <>
              <div><Label className="text-xs">{t("dateRange.from", { defaultValue: "Alates" })}</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></div>
              <div><Label className="text-xs">{t("dateRange.to", { defaultValue: "Kuni" })}</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>
            </>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            {formatDate(range.from)} — {formatDate(range.to)}
          </div>
        </div>
      </div>

      {/* Money by period */}
      <Section title={t("overview.money", { defaultValue: "Raha ülevaade" })}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {periods.map((p) => (
            <PeriodCard key={p.key} label={p.label} income={p.totals.income} expense={p.totals.expense} balance={p.totals.balance} />
          ))}
        </div>
        <div className="mt-4 card-soft p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("overview.selectedRange", { defaultValue: "Valitud periood" })}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground">{t("expenses.income")}: </span><span className="font-semibold text-green-600">{formatCurrency(rangedTotals.income)}</span></div>
            <div><span className="text-muted-foreground">{t("expenses.expense")}: </span><span className="font-semibold text-red-600">{formatCurrency(rangedTotals.expense)}</span></div>
            <div><span className="text-muted-foreground">{t("expenses.balance")}: </span><span className={`font-semibold ${rangedTotals.balance >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(rangedTotals.balance)}</span></div>
          </div>
        </div>
      </Section>

      {/* Charts */}
      <Section title={t("overview.charts", { defaultValue: "Graafikud" })}>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={t("overview.incomeVsExpense", { defaultValue: "📈 Tulud vs kulud kuude lõikes" })}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="income" name={t("expenses.income")} fill="#22c55e" />
                <Bar dataKey="expense" name={t("expenses.expense")} fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("overview.balanceTrend", { defaultValue: "📉 Saldo muutumine" })}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("overview.yearly", { defaultValue: "📊 Tulud ja kulud aastate lõikes" })}>
            {yearly.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={yearly}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="year" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="income" name={t("expenses.income")} fill="#22c55e" />
                  <Bar dataKey="expense" name={t("expenses.expense")} fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </ChartCard>

          <ChartCard title={t("overview.byCategory", { defaultValue: "🥧 Kulud kategooriate kaupa" })}>
            {categoryPie.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={categoryPie} dataKey="amount" nameKey="label" cx="50%" cy="50%" outerRadius={90} label={(e: { label: string }) => e.label}>
                    {categoryPie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </ChartCard>
        </div>
      </Section>

      {/* Biggest expenses */}
      <Section title={t("overview.biggest", { defaultValue: "Kõige suuremad kulud" })}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={ArrowUpRight}
            label={t("overview.biggestMonth", { defaultValue: "Selle kuu suurim ost" })}
            value={biggestThisMonth ? formatCurrency(Number(biggestThisMonth.amount), biggestThisMonth.currency ?? "EUR") : "—"}
            sub={biggestThisMonth ? (biggestThisMonth.description || formatCategory("expenses", biggestThisMonth.category)) : ""}
          />
          <StatCard
            icon={ArrowUpRight}
            label={t("overview.biggestYear", { defaultValue: "Selle aasta suurim ost" })}
            value={biggestThisYear ? formatCurrency(Number(biggestThisYear.amount), biggestThisYear.currency ?? "EUR") : "—"}
            sub={biggestThisYear ? (biggestThisYear.description || formatCategory("expenses", biggestThisYear.category)) : ""}
          />
          <StatCard
            icon={Repeat}
            label={t("overview.mostFrequentCategory", { defaultValue: "Kõige sagedamini kasutatud kategooria" })}
            value={mostFrequentCat ? formatCategory("expenses", mostFrequentCat[0]) : "—"}
            sub={mostFrequentCat ? `${mostFrequentCat[1]}×` : ""}
          />
          <StatCard
            icon={ArrowDownRight}
            label={t("overview.highestSpendCategory", { defaultValue: "Kõige rohkem kulutatud kategooria" })}
            value={highestSpendCat ? formatCategory("expenses", highestSpendCat[0]) : "—"}
            sub={highestSpendCat ? formatCurrency(highestSpendCat[1]) : ""}
          />
        </div>
      </Section>

      {/* Documents */}
      <Section title={t("overview.documents", { defaultValue: "Dokumendid" })}>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          <MiniStatCard icon={ShieldCheck} label="📄 Garantiisid" value={totalWarranties} />
          <MiniStatCard icon={FileText} label="📄 Lepinguid" value={otherAgreements} />
          <MiniStatCard icon={CreditCard} label="📄 Järelmaksulepinguid" value={installmentAgreements} />
          <MiniStatCard icon={Repeat} label="📄 Püsimakseid" value={totalRecurring} />
          <MiniStatCard icon={FileIcon} label="📄 PDF-faile" value={pdfCount} />
          <MiniStatCard icon={Wallet} label="📄 Tšekke" value={receiptCount} />
          <MiniStatCard icon={FileImage} label="📄 Pilte" value={imageCount} />
        </div>
      </Section>

      {/* Warranties */}
      <Section title={t("overview.warranties", { defaultValue: "Garantiid" })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard icon={ShieldCheck} tone="green" label={t("overview.activeWarranties", { defaultValue: "Aktiivseid garantiisid" })} value={String(activeWarranties)} />
          <StatCard icon={AlertCircle} tone="orange" label={t("overview.expiringSoon", { defaultValue: "Aeguvad varsti" })} value={String(expiringSoon)} />
          <StatCard icon={AlertCircle} tone="red" label={t("overview.expired", { defaultValue: "Aegunud" })} value={String(expiredCount)} />
        </div>
      </Section>

      {/* Installments */}
      <Section title={t("overview.installmentsSummary", { defaultValue: "Järelmaksud" })}>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <MiniStatCard icon={CreditCard} label="💳 Aktiivseid" value={instActive} />
          <MiniStatCard icon={Wallet} label="💰 Kokku jäänud" value={formatCurrency(instTotalRemaining)} />
          <MiniStatCard icon={Calendar} label="📅 Sel kuul" value={formatCurrency(instMonth)} />
          <MiniStatCard icon={AlertCircle} label="🔴 Hilinenud" value={instOverdue} />
          <MiniStatCard icon={Calendar} label="📆 Järgmine" value={instNext ? formatDate(instNext.nextDue) : "—"} sub={instNext?.row.title ?? ""} />
          <MiniStatCard icon={Wallet} label="💶 Keskmine kuu" value={formatCurrency(instAvgMonthly)} />
        </div>
      </Section>

      {/* Recurring */}
      <Section title={t("overview.recurringSummary", { defaultValue: "Püsimaksed" })}>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <MiniStatCard icon={Repeat} label={t("overview.activeRecurring", { defaultValue: "Aktiivseid" })} value={totalRecurring} />
          <MiniStatCard icon={Calendar} label={t("overview.monthPayments", { defaultValue: "Sel kuul" })} value={rpMonth.length} />
          <MiniStatCard icon={AlertCircle} label={t("overview.recurringOverdue", { defaultValue: "Hilinenud" })} value={rpOverdue} />
          <MiniStatCard icon={Calendar} label={t("overview.nextRecurring", { defaultValue: "Järgmine" })}
            value={rpNext ? formatDate((rpNext as { due_date: string }).due_date) : "—"}
            sub={rpNextParent ? (rpNextParent as { service_name: string }).service_name : ""} />
        </div>
      </Section>

      {/* Upcoming timeline */}
      <Section title={t("overview.upcoming", { defaultValue: "Tulevased kohustused (30 päeva)" })}>
        <div className="card-soft p-4">
          {timeline.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-border">
              {timeline.slice(0, 20).map((item, i) => {
                const days = Math.max(0, Math.round((new Date(item.date + "T00:00:00").getTime() - Date.now()) / 86400000));
                const rel = days === 0 ? "Täna" : days === 1 ? "Homme" : `${days} päeva pärast`;
                const Icon = item.icon;
                const badge = item.kind === "warranty" ? "bg-orange-100 text-orange-700" : item.kind === "installment" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700";
                return (
                  <li key={i} className="flex items-center gap-3 py-2.5">
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${badge}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">📅 {rel} · {formatDate(item.date)}</p>
                    </div>
                    {item.amount !== undefined && (
                      <p className="text-sm font-semibold">{formatCurrency(item.amount)}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>

      {/* AI summary */}
      <Section title={t("overview.aiSummary", { defaultValue: "AI kokkuvõte" })}>
        <div className="card-soft border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="text-sm font-semibold">{t("overview.smartInsights", { defaultValue: "Nutikad tähelepanekud" })}</p>
          </div>
          <ul className="space-y-2 text-sm">
            {summaryPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function PeriodCard({ label, income, expense, balance }: { label: string; income: number; expense: number; balance: number }) {
  return (
    <div className="card-soft p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-green-600" />Tulud</span><span className="font-semibold text-green-600">{formatCurrency(income)}</span></div>
        <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><TrendingDown className="h-3.5 w-3.5 text-red-600" />Kulud</span><span className="font-semibold text-red-600">{formatCurrency(expense)}</span></div>
        <div className="flex items-center justify-between border-t pt-1"><span className="font-semibold">Saldo</span><span className={`font-bold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(balance)}</span></div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-soft p-4">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, tone = "neutral",
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone?: "green" | "orange" | "red" | "neutral" }) {
  const color = tone === "green" ? "text-green-600" : tone === "orange" ? "text-orange-600" : tone === "red" ? "text-red-600" : "text-foreground";
  return (
    <div className="card-soft p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <p className="text-xs font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MiniStatCard({
  icon: Icon, label, value, sub,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string }) {
  return (
    <div className="card-soft p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[10px] font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Empty() {
  return <div className="grid h-[240px] place-items-center text-sm text-muted-foreground">Andmed puuduvad</div>;
}
