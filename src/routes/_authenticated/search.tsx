import { formatDate, formatDateShort, formatCategory } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search as SearchIcon, ShieldCheck, Wallet, FileText } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { VoiceInput } from "@/components/VoiceInput";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/records";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/search")({
  head: () => ({ meta: [{ title: "Search — DropPocket" }] }),
  component: SearchPage,
});

function SearchPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<{ module?: string | null; type?: string | null; store?: string | null; category?: string | null; date_from?: string | null; date_to?: string | null } | null>(null);
  const term = q.trim();

  const { data, isFetching } = useQuery({
    queryKey: ["search", term, filters],
    enabled: term.length > 0 || !!filters,
    queryFn: async () => {
      const kw = (filters?.store || filters?.category || term).trim();
      const like = `%${kw}%`;
      const asNum = Number(term);
      const numFilter = !Number.isNaN(asNum) && term ? `,amount.eq.${asNum}` : "";
      const wq = supabase.from("warranties").select("*").limit(20);
      const eq = supabase.from("expenses").select("*").limit(20);
      const aq = supabase.from("agreements").select("*").limit(20);
      if (kw) {
        wq.or(`product_name.ilike.${like},store.ilike.${like},notes.ilike.${like}${numFilter}`);
        eq.or(`description.ilike.${like},category.ilike.${like},store.ilike.${like},notes.ilike.${like}${numFilter}`);
        aq.or(`title.ilike.${like},company.ilike.${like},agreement_number.ilike.${like},notes.ilike.${like}`);
      }
      if (filters?.type) eq.eq("type", filters.type);
      if (filters?.category) eq.eq("category", filters.category);
      if (filters?.date_from) { wq.gte("purchase_date", filters.date_from); eq.gte("expense_date", filters.date_from); aq.gte("start_date", filters.date_from); }
      if (filters?.date_to) { wq.lte("purchase_date", filters.date_to); eq.lte("expense_date", filters.date_to); aq.lte("start_date", filters.date_to); }

      const [w, e, a] = await Promise.all([wq, eq, aq]);
      const mod = filters?.module ?? "all";
      return {
        warranties: mod === "all" || mod === "warranties" ? (w.data ?? []) : [],
        expenses: mod === "all" || mod === "expenses" ? (e.data ?? []) : [],
        agreements: mod === "all" || mod === "agreements" ? (a.data ?? []) : [],
      };
    },
  });

  return (
    <AppShell>
      <h1 className="text-3xl font-bold">{t("search.title")}</h1>
      <p className="mt-1 text-muted-foreground">{t("search.subtitle")}</p>

      <div className="mt-6 flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus placeholder={t("search.placeholder")} value={q} onChange={(e) => { setQ(e.target.value); setFilters(null); }} className="h-12 pl-11 text-base" />
        </div>
        <VoiceInput
          context="search"
          size="default"
          onResult={(d, transcript) => {
            setQ(transcript);
            setFilters({
              module: (d.module as string) || "all",
              type: (d.type as string) || null,
              store: (d.store as string) || null,
              category: (d.category as string) || null,
              date_from: (d.date_from as string) || null,
              date_to: (d.date_to as string) || null,
            });
          }}
        />
      </div>
      {filters && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {filters.module && filters.module !== "all" && <span className="rounded-full bg-accent px-2.5 py-1">{filters.module}</span>}
          {filters.type && <span className="rounded-full bg-accent px-2.5 py-1">{filters.type}</span>}
          {filters.store && <span className="rounded-full bg-accent px-2.5 py-1">{filters.store}</span>}
          {filters.category && <span className="rounded-full bg-accent px-2.5 py-1">{filters.category}</span>}
          {(filters.date_from || filters.date_to) && <span className="rounded-full bg-accent px-2.5 py-1">{filters.date_from ?? "…"} → {filters.date_to ?? "…"}</span>}
        </div>
      )}

      {term.length === 0 && !filters && <p className="mt-10 text-center text-sm text-muted-foreground">{t("search.hint")}</p>}
      {(term.length > 0 || filters) && isFetching && <p className="mt-10 text-center text-sm text-muted-foreground">{t("search.searching")}</p>}

      {(term.length > 0 || filters) && data && (
        <div className="mt-8 grid gap-6">
          <Group icon={ShieldCheck} title={t("search.warrantiesN", { count: data.warranties.length })} to="/warranties">
            {data.warranties.map((r) => (
              <Row key={r.id} title={r.product_name} sub={`${r.store ?? "—"} · ${formatDate(r.purchase_date)}`} right={formatCurrency(r.amount ? Number(r.amount) : null, r.currency ?? "EUR")} />
            ))}
          </Group>
          <Group icon={Wallet} title={t("search.expensesN", { count: data.expenses.length })} to="/expenses">
            {data.expenses.map((r) => (
              <Row key={r.id} title={r.description || formatCategory("expenses", r.category)} sub={`${formatDate(r.expense_date)} · ${formatCategory("expenses", r.category)}`} right={formatCurrency(Number(r.amount), r.currency ?? "EUR")} />
            ))}
          </Group>
          <Group icon={FileText} title={t("search.agreementsN", { count: data.agreements.length })} to="/agreements">
            {data.agreements.map((r) => (
              <Row key={r.id} title={r.title} sub={`${r.company ?? "—"}${r.agreement_number ? ` · #${r.agreement_number}` : ""}`} right={r.total_amount ? formatCurrency(Number(r.total_amount), r.currency ?? "EUR") : ""} />
            ))}
          </Group>
          {data.warranties.length + data.expenses.length + data.agreements.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">{t("search.noMatches")}</p>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Group({ icon: Icon, title, to, children }: { icon: React.ComponentType<{ className?: string }>; title: string; to: "/warranties" | "/expenses" | "/agreements"; children: React.ReactNode }) {
  const { t } = useTranslation();
  const arr = Array.isArray(children) ? children : [children];
  if (arr.filter(Boolean).length === 0) return null;
  return (
    <div className="card-soft p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <Link to={to} className="ml-auto text-xs text-primary hover:underline">{t("common.openApp")}</Link>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function Row({ title, sub, right }: { title: string; sub: string; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      {right && <p className="shrink-0 text-sm font-semibold">{right}</p>}
    </div>
  );
}