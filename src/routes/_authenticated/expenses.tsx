import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDrop } from "@/components/FileDrop";
import { RecordActions } from "@/components/RecordActions";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, uploadFile } from "@/lib/records";
import { extractDocument } from "@/lib/ocr.functions";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Expenses — DropPocket" }] }),
  component: ExpensesPage,
});

const CATEGORIES = ["Groceries", "Fuel", "Restaurant", "Coffee", "Hairdresser", "Nails", "Shopping", "Healthcare", "Travel", "Pets", "Other"];

type Row = {
  id: string; amount: number; currency: string | null; category: string; expense_date: string;
  description: string | null; notes: string | null; store: string | null;
  file_path: string | null; file_name: string | null;
};

function ExpensesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const { data } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").order("expense_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const monthTotal = (data ?? []).filter((r) => new Date(r.expense_date) >= monthStart).reduce((s, r) => s + Number(r.amount), 0);
  const weekTotal = (data ?? []).filter((r) => new Date(r.expense_date) >= weekStart).reduce((s, r) => s + Number(r.amount), 0);

  async function del(r: Row) {
    if (!confirm("Delete this expense?")) return;
    if (r.file_path) await deleteFile(r.file_path);
    await supabase.from("expenses").delete().eq("id", r.id);
    qc.invalidateQueries({ queryKey: ["expenses"] });
    toast.success("Deleted");
  }

  return (
    <AppShell>
      <div className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">Expenses</h1>
          <p className="mt-1 text-muted-foreground">Log everyday spending with or without a receipt.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="shrink-0 brand-gradient-bg text-primary-foreground"><Plus className="mr-1.5 h-4 w-4" />Add expense</Button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="card-soft p-6"><p className="text-sm text-muted-foreground">This month</p><p className="mt-1 text-3xl font-bold">{formatCurrency(monthTotal)}</p></div>
        <div className="card-soft p-6"><p className="text-sm text-muted-foreground">This week</p><p className="mt-1 text-3xl font-bold">{formatCurrency(weekTotal)}</p></div>
      </div>

      {data?.length === 0 ? (
        <div className="card-soft flex flex-col items-center p-12 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent"><Wallet className="h-6 w-6 text-primary" /></div>
          <h3 className="text-lg font-semibold">No expenses yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Log your first expense to see totals.</p>
        </div>
      ) : (
        <div className="card-soft divide-y divide-border">
          {data?.map((r) => (
            <div key={r.id} className="p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                <button onClick={() => { setEditing(r); setOpen(true); }} className="min-w-0 text-left">
                  <p className="truncate font-medium hover:text-primary">{r.description || r.category}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{r.expense_date} · {r.category}{r.store ? ` · ${r.store}` : ""}</p>
                </button>
                <p className="shrink-0 text-lg font-semibold">{formatCurrency(Number(r.amount), r.currency ?? "EUR")}</p>
              </div>
              <div className="mt-3"><RecordActions filePath={r.file_path} fileName={r.file_name} onDelete={() => del(r)} /></div>
            </div>
          ))}
        </div>
      )}

      <ExpenseDialog open={open} onOpenChange={setOpen} row={editing} />
    </AppShell>
  );
}

function ExpenseDialog({ open, onOpenChange, row }: { open: boolean; onOpenChange: (b: boolean) => void; row: Row | null }) {
  const qc = useQueryClient();
  const extract = useServerFn(extractDocument);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    amount: row?.amount?.toString() ?? "",
    currency: row?.currency ?? "EUR",
    category: row?.category ?? "Other",
    expense_date: row?.expense_date ?? new Date().toISOString().slice(0, 10),
    description: row?.description ?? "",
    store: row?.store ?? "",
    notes: row?.notes ?? "",
  }));

  async function scan() {
    if (!file) return;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await extract({ data: { kind: "expense", mime: file.type || "application/octet-stream", base64 } });
      if (res.ok) {
        const d = res.data;
        setForm((f) => ({
          ...f,
          amount: d.amount != null ? String(d.amount) : f.amount,
          currency: (d.currency as string) || f.currency,
          store: (d.store as string) || f.store,
          expense_date: (d.expense_date as string) || f.expense_date,
          category: (d.category as string) && CATEGORIES.includes(d.category as string) ? (d.category as string) : f.category,
          description: (d.description as string) || f.description,
        }));
        toast.success("Fields auto-filled");
      } else toast.error(res.error);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Scan failed"); }
    finally { setScanning(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      let fileInfo: { path: string; name: string; mime: string } | null = null;
      if (file) fileInfo = await uploadFile(uid, "expense", file);
      const payload = {
        user_id: uid,
        amount: Number(form.amount),
        currency: form.currency,
        category: form.category,
        expense_date: form.expense_date,
        description: form.description || null,
        store: form.store || null,
        notes: form.notes || null,
        ...(fileInfo ? { file_path: fileInfo.path, file_name: fileInfo.name, file_mime: fileInfo.mime } : {}),
      };
      if (row) await supabase.from("expenses").update(payload).eq("id", row.id);
      else await supabase.from("expenses").insert(payload);
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(row ? "Updated" : "Expense added");
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? "Edit expense" : "Add expense"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <FileDrop file={file} onFile={setFile} onScan={scan} scanning={scanning} />
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount *</Label><Input type="number" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><Label>Date *</Label><Input type="date" required value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
          </div>
          <div><Label>Category *</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Store</Label><Input value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} /></div>
          <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? "Saving…" : "Save"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}