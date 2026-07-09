import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Repeat, Trash2, CheckCircle2, Upload, Camera, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileDrop } from "@/components/FileDrop";
import { VoiceInput } from "@/components/VoiceInput";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, formatCurrency, uploadFile } from "@/lib/records";
import { addFrequency, CATEGORIES, FREQUENCIES, statusOf, type Category, type Frequency } from "@/lib/recurring";

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
};

type Instance = {
  id: string; user_id: string; recurring_payment_id: string;
  due_date: string; amount: number; currency: string | null;
  status: "pending" | "paid"; paid_at: string | null;
  receipt_file_path: string | null; receipt_file_name: string | null;
  invoice_file_path: string | null; invoice_file_name: string | null;
  notes: string | null;
};

function RecurringPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [payAsk, setPayAsk] = useState<{ instance: Instance; recurring: Recurring } | null>(null);

  const { data: recurring } = useQuery({
    queryKey: ["recurring_payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("recurring_payments").select("*").order("next_due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Recurring[];
    },
  });

  const { data: instances } = useQuery({
    queryKey: ["recurring_instances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("recurring_payment_instances").select("*").order("due_date", { ascending: true });
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
    return { paid, toPay, overdue, upcoming, upcomingRec };
  }, [instances, recurring, monthStart, monthEnd, today]);

  async function markPaid(inst: Instance, rec: Recurring) {
    try {
      await supabase.from("recurring_payment_instances")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", inst.id);
      // create next instance and advance recurring.next_due_date
      const nextDue = addFrequency(inst.due_date, rec.frequency);
      if (!rec.end_date || nextDue <= rec.end_date) {
        await supabase.from("recurring_payment_instances").insert({
          user_id: rec.user_id, recurring_payment_id: rec.id,
          due_date: nextDue, amount: rec.amount, currency: rec.currency ?? "EUR",
          status: "pending",
        });
        await supabase.from("recurring_payments").update({ next_due_date: nextDue }).eq("id", rec.id);
      }
      qc.invalidateQueries({ queryKey: ["recurring_payments"] });
      qc.invalidateQueries({ queryKey: ["recurring_instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(t("recurring.paidMarked"));
      setPayAsk({ instance: { ...inst, status: "paid" }, recurring: rec });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function del(r: Recurring) {
    if (!confirm(t("recurring.confirmDelete"))) return;
    if (r.contract_file_path) await deleteFile(r.contract_file_path);
    // remove instance files
    const insts = (instances ?? []).filter((i) => i.recurring_payment_id === r.id);
    for (const i of insts) {
      if (i.receipt_file_path) await deleteFile(i.receipt_file_path);
      if (i.invoice_file_path) await deleteFile(i.invoice_file_path);
    }
    await supabase.from("recurring_payments").delete().eq("id", r.id);
    qc.invalidateQueries({ queryKey: ["recurring_payments"] });
    qc.invalidateQueries({ queryKey: ["recurring_instances"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    toast.success(t("common.deleted"));
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
              <p className="mt-2 text-lg font-bold">{summary.upcoming.due_date.slice(5).replace("-", ".")}</p>
              <p className="truncate text-sm text-muted-foreground">{summary.upcomingRec.service_name}</p>
              <p className="text-sm font-semibold">{formatCurrency(Number(summary.upcoming.amount), summary.upcoming.currency ?? "EUR")}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("recurring.nothingDue")}</p>
          )}
        </div>
      </div>

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
                      {t("recurring.nextDue")}: <span className="font-medium">{next ? next.due_date : r.next_due_date}</span>
                    </p>
                  </button>
                  <div className="flex flex-col items-end gap-2">
                    <p className="shrink-0 text-lg font-bold">{formatCurrency(Number(r.amount), r.currency ?? "EUR")}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{s.label}</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {next ? (
                    <Button size="sm" onClick={() => markPaid(next, r)} className="bg-green-600 text-white hover:bg-green-600/90">
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />{t("recurring.markPaid")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => del(r)} className="ml-auto text-destructive hover:text-destructive">
                    <Trash2 className="mr-1.5 h-4 w-4" />{t("common.delete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RecurringDialog open={open} onOpenChange={setOpen} row={editing} />
      <AttachReceiptDialog data={payAsk} onClose={() => setPayAsk(null)} />
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
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => makeForm(row));

  useEffect(() => { if (open) { setForm(makeForm(row)); setFile(null); } }, [open, row]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      let fileInfo: { path: string; name: string; mime: string } | null = null;
      if (file) fileInfo = await uploadFile(uid, "recurring", file);
      const payload = {
        user_id: uid,
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
        ...(fileInfo ? { contract_file_path: fileInfo.path, contract_file_name: fileInfo.name, contract_file_mime: fileInfo.mime } : {}),
      };
      if (row) {
        await supabase.from("recurring_payments").update(payload).eq("id", row.id);
      } else {
        await supabase.from("recurring_payments").insert(payload);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? t("recurring.editTitle") : t("recurring.addTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex justify-end">
            <VoiceInput
              context="recurring_payment"
              onResult={(d) => setForm((f) => ({
                ...f,
                service_name: (d.service_name as string) || f.service_name,
                provider: (d.provider as string) || f.provider,
                category: (d.category as string) && (CATEGORIES as readonly string[]).includes(d.category as string) ? (d.category as string) : f.category,
                amount: d.amount != null ? String(d.amount) : f.amount,
                currency: (d.currency as string) || f.currency,
                frequency: (d.frequency as Frequency) || f.frequency,
                next_due_date: dueDayToDate(d.due_day as number | null) || f.next_due_date,
                notes: (d.notes as string) || f.notes,
              }))}
            />
          </div>
          <div><Label>{t("recurring.serviceName")} *</Label><Input required value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("recurring.provider")}</Label><Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
            <div>
              <Label>{t("recurring.category")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`recurring.categories.${c}` as const)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("recurring.amount")} *</Label><Input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><Label>{t("recurring.currency")}</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
          </div>
          <div>
            <Label>{t("recurring.frequency")} *</Label>
            <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as Frequency })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{t(`recurring.frequencies.${f}` as const)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("recurring.startDate")} *</Label><Input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, next_due_date: form.next_due_date || e.target.value })} /></div>
            <div><Label>{t("recurring.endDate")}</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
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
          <div><Label>{t("recurring.contractFile")}</Label><FileDrop file={file} onFile={setFile} /></div>
          <div><Label>{t("recurring.notes")}</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? t("common.saving") : t("common.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttachReceiptDialog({ data, onClose }: { data: { instance: Instance; recurring: Recurring } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!data) setFile(null); }, [data]);

  if (!data) return null;

  async function attach(kind: "receipt" | "invoice") {
    if (!file || !data) return;
    setSaving(true);
    try {
      const info = await uploadFile(data.recurring.user_id, "recurring", file);
      const patch = kind === "receipt"
        ? { receipt_file_path: info.path, receipt_file_name: info.name, receipt_file_mime: info.mime }
        : { invoice_file_path: info.path, invoice_file_name: info.name, invoice_file_mime: info.mime };
      await supabase.from("recurring_payment_instances").update(patch).eq("id", data.instance.id);
      qc.invalidateQueries({ queryKey: ["recurring_instances"] });
      toast.success(t("common.saved"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={!!data} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("recurring.attachReceipt")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <FileDrop file={file} onFile={setFile} />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={!file || saving} onClick={() => attach("receipt")}>
              <Camera className="mr-1.5 h-4 w-4" />{t("recurring.receiptFile")}
            </Button>
            <Button type="button" variant="outline" disabled={!file || saving} onClick={() => attach("invoice")}>
              <Upload className="mr-1.5 h-4 w-4" />{t("recurring.invoiceFile")}
            </Button>
          </div>
          <Button type="button" variant="ghost" onClick={onClose} className="w-full">
            <XIcon className="mr-1.5 h-4 w-4" />{t("recurring.skip")}
          </Button>
        </div>
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
  };
}