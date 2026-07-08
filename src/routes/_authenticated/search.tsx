import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search as SearchIcon, ShieldCheck, Wallet, FileText } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/records";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/search")({
  head: () => ({ meta: [{ title: "Search — DropPocket" }] }),
  component: SearchPage,
});

function SearchPage() {
  const [q, setQ] = useState("");
  const term = q.trim();

  const { data, isFetching } = useQuery({
    queryKey: ["search", term],
    enabled: term.length > 0,
    queryFn: async () => {
      const like = `%${term}%`;
      const asNum = Number(term);
      const numFilter = !Number.isNaN(asNum) ? `,amount.eq.${asNum}` : "";
      const [w, e, a] = await Promise.all([
        supabase.from("warranties").select("*").or(`product_name.ilike.${like},store.ilike.${like},notes.ilike.${like}${numFilter}`).limit(20),
        supabase.from("expenses").select("*").or(`description.ilike.${like},category.ilike.${like},store.ilike.${like},notes.ilike.${like}${numFilter}`).limit(20),
        supabase.from("agreements").select("*").or(`title.ilike.${like},company.ilike.${like},agreement_number.ilike.${like},notes.ilike.${like}`).limit(20),
      ]);
      return { warranties: w.data ?? [], expenses: e.data ?? [], agreements: a.data ?? [] };
    },
  });

  return (
    <AppShell>
      <h1 className="text-3xl font-bold">Search</h1>
      <p className="mt-1 text-muted-foreground">One field, across warranties, expenses and agreements.</p>

      <div className="relative mt-6">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus placeholder="Store, product, company, category, amount…" value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-11 text-base" />
      </div>

      {term.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">Start typing to search everything.</p>}
      {term.length > 0 && isFetching && <p className="mt-10 text-center text-sm text-muted-foreground">Searching…</p>}

      {term.length > 0 && data && (
        <div className="mt-8 grid gap-6">
          <Group icon={ShieldCheck} title={`Warranties (${data.warranties.length})`} to="/warranties">
            {data.warranties.map((r) => (
              <Row key={r.id} title={r.product_name} sub={`${r.store ?? "—"} · ${r.purchase_date ?? ""}`} right={formatCurrency(r.amount ? Number(r.amount) : null, r.currency ?? "EUR")} />
            ))}
          </Group>
          <Group icon={Wallet} title={`Expenses (${data.expenses.length})`} to="/expenses">
            {data.expenses.map((r) => (
              <Row key={r.id} title={r.description || r.category} sub={`${r.expense_date} · ${r.category}`} right={formatCurrency(Number(r.amount), r.currency ?? "EUR")} />
            ))}
          </Group>
          <Group icon={FileText} title={`Agreements (${data.agreements.length})`} to="/agreements">
            {data.agreements.map((r) => (
              <Row key={r.id} title={r.title} sub={`${r.company ?? "—"}${r.agreement_number ? ` · #${r.agreement_number}` : ""}`} right={r.total_amount ? formatCurrency(Number(r.total_amount), r.currency ?? "EUR") : ""} />
            ))}
          </Group>
          {data.warranties.length + data.expenses.length + data.agreements.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">No matches.</p>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Group({ icon: Icon, title, to, children }: { icon: React.ComponentType<{ className?: string }>; title: string; to: "/warranties" | "/expenses" | "/agreements"; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  if (arr.filter(Boolean).length === 0) return null;
  return (
    <div className="card-soft p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <Link to={to} className="ml-auto text-xs text-primary hover:underline">Open</Link>
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