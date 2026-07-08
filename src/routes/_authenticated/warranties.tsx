import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDrop } from "@/components/FileDrop";
import { RecordActions } from "@/components/RecordActions";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, uploadFile, warrantyStatus } from "@/lib/records";
import { extractDocument } from "@/lib/ocr.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/warranties")({
  head: () => ({ meta: [{ title: "Warranties — DropPocket" }] }),
  component: WarrantiesPage,
});

type Row = {
  id: string; product_name: string; store: string | null; purchase_date: string | null;
  warranty_expiry: string | null; amount: number | null; currency: string | null; notes: string | null;
  file_path: string | null; file_name: string | null; file_mime: string | null;
};

function WarrantiesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const { data } = useQuery({
    queryKey: ["warranties"],
    queryFn: async () => {
      const { data, error } = await supabase.from("warranties").select("*").order("warranty_expiry", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const groups = {
    active: [] as Row[], expiring: [] as Row[], expired: [] as Row[],
  };
  (data ?? []).forEach((r) => {
    const t = warrantyStatus(r.warranty_expiry).tone;
    if (t === "orange") groups.expiring.push(r);
    else if (t === "red") groups.expired.push(r);
    else groups.active.push(r);
  });

  async function del(r: Row) {
    if (!confirm("Delete this warranty?")) return;
    if (r.file_path) await deleteFile(r.file_path);
    await supabase.from("warranties").delete().eq("id", r.id);
    qc.invalidateQueries({ queryKey: ["warranties"] });
    toast.success("Deleted");
  }

  return (
    <AppShell>
      <PageHeader title="Warranties" desc="Track active warranties and be alerted before they expire." onAdd={() => { setEditing(null); setOpen(true); }} />
      <Section title="Expiring soon" count={groups.expiring.length} tone="orange" items={groups.expiring} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={del} />
      <Section title="Active" count={groups.active.length} tone="green" items={groups.active} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={del} />
      <Section title="Expired" count={groups.expired.length} tone="red" items={groups.expired} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={del} />
      {data?.length === 0 && <EmptyCard icon={ShieldCheck} title="No warranties yet" desc="Add your first purchase to start tracking warranties." onAdd={() => setOpen(true)} />}
      <WarrantyDialog open={open} onOpenChange={setOpen} row={editing} />
    </AppShell>
  );
}

function Section({ title, count, tone, items, onEdit, onDelete }: {
  title: string; count: number; tone: "green" | "orange" | "red";
  items: Row[]; onEdit: (r: Row) => void; onDelete: (r: Row) => void;
}) {
  if (items.length === 0) return null;
  const dot = tone === "green" ? "bg-green-500" : tone === "orange" ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {title} · {count}
      </h2>
      <div className="grid gap-3">
        {items.map((r) => {
          const s = warrantyStatus(r.warranty_expiry);
          const color = s.tone === "green" ? "text-green-600" : s.tone === "orange" ? "text-orange-600" : s.tone === "red" ? "text-red-600" : "text-muted-foreground";
          return (
            <div key={r.id} className="card-soft p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:justify-between">
                <div className="min-w-0">
                  <button onClick={() => onEdit(r)} className="text-left">
                    <h3 className="truncate text-base font-semibold hover:text-primary">{r.product_name}</h3>
                  </button>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.store ?? "—"} · Bought {r.purchase_date ?? "—"} · {formatCurrency(r.amount ? Number(r.amount) : null, r.currency ?? "EUR")}
                  </p>
                  {r.notes && <p className="mt-2 text-sm text-muted-foreground">{r.notes}</p>}
                </div>
                <span className={`shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium ${color}`}>{s.label}</span>
              </div>
              <div className="mt-4"><RecordActions filePath={r.file_path} fileName={r.file_name} onDelete={() => onDelete(r)} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WarrantyDialog({ open, onOpenChange, row }: { open: boolean; onOpenChange: (b: boolean) => void; row: Row | null }) {
  const qc = useQueryClient();
  const extract = useServerFn(extractDocument);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    product_name: row?.product_name ?? "",
    store: row?.store ?? "",
    purchase_date: row?.purchase_date ?? "",
    warranty_expiry: row?.warranty_expiry ?? "",
    amount: row?.amount?.toString() ?? "",
    currency: row?.currency ?? "EUR",
    notes: row?.notes ?? "",
  }));

  async function scan() {
    if (!file) return;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await extract({ data: { kind: "warranty", mime: file.type || "application/octet-stream", base64 } });
      if (res.ok) {
        const d = res.data;
        setForm((f) => ({
          ...f,
          product_name: (d.product_name as string) || f.product_name,
          store: (d.store as string) || f.store,
          purchase_date: (d.purchase_date as string) || f.purchase_date,
          amount: d.amount != null ? String(d.amount) : f.amount,
          currency: (d.currency as string) || f.currency,
        }));
        toast.success("Fields auto-filled");
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally { setScanning(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      let fileInfo: { path: string; name: string; mime: string } | null = null;
      if (file) fileInfo = await uploadFile(uid, "warranty", file);
      const payload = {
        user_id: uid,
        product_name: form.product_name,
        store: form.store || null,
        purchase_date: form.purchase_date || null,
        warranty_expiry: form.warranty_expiry || null,
        amount: form.amount ? Number(form.amount) : null,
        currency: form.currency || "EUR",
        notes: form.notes || null,
        ...(fileInfo ? { file_path: fileInfo.path, file_name: fileInfo.name, file_mime: fileInfo.mime } : {}),
      };
      if (row) {
        await supabase.from("warranties").update(payload).eq("id", row.id);
      } else {
        await supabase.from("warranties").insert(payload);
      }
      qc.invalidateQueries({ queryKey: ["warranties"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(row ? "Updated" : "Warranty added");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? "Edit warranty" : "Add warranty"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <FileDrop file={file} onFile={setFile} onScan={scan} scanning={scanning} />
          <div><Label>Product name *</Label><Input required value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Store</Label><Input value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} /></div>
            <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Purchase date</Label><Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
            <div><Label>Warranty expiry</Label><Input type="date" value={form.warranty_expiry} onChange={(e) => setForm({ ...form, warranty_expiry: e.target.value })} /></div>
          </div>
          <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? "Saving…" : "Save"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PageHeader({ title, desc, onAdd }: { title: string; desc: string; onAdd: () => void }) {
  return (
    <div className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-muted-foreground">{desc}</p>
      </div>
      <Button onClick={onAdd} className="shrink-0 brand-gradient-bg text-primary-foreground"><Plus className="mr-1.5 h-4 w-4" />Add</Button>
    </div>
  );
}

function EmptyCard({ icon: Icon, title, desc, onAdd }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; onAdd: () => void }) {
  return (
    <div className="card-soft flex flex-col items-center p-12 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent"><Icon className="h-6 w-6 text-primary" /></div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <Button onClick={onAdd} className="mt-4 brand-gradient-bg text-primary-foreground"><Plus className="mr-1.5 h-4 w-4" />Add</Button>
    </div>
  );
}