import { formatDate, formatDateShort, formatCategory } from "@/lib/format";
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
import { VoiceInput } from "@/components/VoiceInput";
import { ConfirmDeleteDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, uploadFile, warrantyStatus } from "@/lib/records";
import { syncFileToGoogleDrive, syncBackupCategory, deleteGoogleDriveFile, currentBackupLang } from "@/lib/google-drive.functions";
import { syncWarranty, removeCalendarSource } from "@/lib/google-calendar.functions";
import { extractDocument } from "@/lib/ocr.functions";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { useActiveProfile } from "@/hooks/useActiveProfile";

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
  const { t } = useTranslation();
  const { activeProfileId } = useActiveProfile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);

  const { data } = useQuery({
    queryKey: ["warranties", activeProfileId],
    enabled: !!activeProfileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warranties")
        .select("*")
        .eq("profile_id", activeProfileId!)
        .order("warranty_expiry", { ascending: true });
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

  async function performDelete(r: Row) {
    const prev = qc.getQueryData<Row[]>(["warranties"]);
    qc.setQueryData<Row[]>(["warranties"], (current = []) => current.filter((e) => e.id !== r.id));
    try {
      const { error } = await supabase.from("warranties").delete().eq("id", r.id);
      if (error) throw error;
      if (r.file_path) { try { await deleteFile(r.file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      const gdid = (r as unknown as { gdrive_file_id?: string | null }).gdrive_file_id;
      if (gdid) { try { await deleteGoogleDriveFile({ data: { fileId: gdid } }); } catch (e) { console.warn("[gdrive] delete file failed", e); } }
      try { await removeCalendarSource({ data: { sourceType: "warranty", sourceId: r.id } }); } catch (e) { console.warn("[gcal] warranty remove failed", e); }
      try { await syncBackupCategory({ data: { category: "warranties", lang: currentBackupLang() } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["warranties"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      toast.success(t("common.deleted"));
    } catch (e) {
      if (prev) qc.setQueryData(["warranties"], prev);
      toast.error(e instanceof Error ? e.message : t("common.deleteFailed"));
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("warranties.title")} desc={t("warranties.desc")} onAdd={() => { setEditing(null); setOpen(true); }} />
      <Section title={t("warranties.expiringSoon")} count={groups.expiring.length} tone="orange" items={groups.expiring} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={setPendingDelete} />
      <Section title={t("warranties.active")} count={groups.active.length} tone="green" items={groups.active} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={setPendingDelete} />
      <Section title={t("warranties.expired")} count={groups.expired.length} tone="red" items={groups.expired} onEdit={(r) => { setEditing(r); setOpen(true); }} onDelete={setPendingDelete} />
      {data?.length === 0 && <EmptyCard icon={ShieldCheck} title={t("warranties.empty.title")} desc={t("warranties.empty.desc")} onAdd={() => setOpen(true)} />}
      <WarrantyDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} row={editing} />
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const r = pendingDelete; setPendingDelete(null); if (r) void performDelete(r); }}
      />
    </AppShell>
  );
}

function Section({ title, count, tone, items, onEdit, onDelete }: {
  title: string; count: number; tone: "green" | "orange" | "red";
  items: Row[]; onEdit: (r: Row) => void; onDelete: (r: Row) => void;
}) {
  if (items.length === 0) return null;
  const { t } = useTranslation();
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
                    {r.store ?? "—"} · {t("warranties.bought")} {formatDate(r.purchase_date)} · {formatCurrency(r.amount ? Number(r.amount) : null, r.currency ?? "EUR")}
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
  const { t, i18n } = useTranslation();
  const { activeProfileId } = useActiveProfile();
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
    if (!file) {
      toast.error(t("file.pickFirst", { defaultValue: "Please add a file first" }));
      return;
    }
    if (file.size === 0) {
      console.error("[scan] file is empty", { name: file.name });
      toast.error("Selected file is empty.");
      return;
    }
    console.info("[scan] warranty starting", { name: file.name, type: file.type, size: file.size });
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      if (!base64) {
        console.error("[scan] fileToBase64 returned empty");
        toast.error("Could not read file contents.");
        return;
      }
      const locale = (i18n.language?.toLowerCase().startsWith("et") ? "et" : "en") as "et" | "en";
      const res = await extract({ data: { kind: "warranty", mime: file.type || "application/octet-stream", base64, locale } });
      console.info("[scan] warranty response", res);
      if (res.ok) {
        const d = res.data;
        const filled = [d.product_name, d.store, d.purchase_date, d.amount, d.currency]
          .some((v) => v !== null && v !== undefined && v !== "");
        if (!filled) {
          toast.error(t("common.noDataFound", { defaultValue: "No usable data found on the document." }));
          return;
        }
        setForm((f) => ({
          ...f,
          product_name: (d.product_name as string) || f.product_name,
          store: (d.store as string) || f.store,
          purchase_date: (d.purchase_date as string) || f.purchase_date,
          amount: d.amount != null ? String(d.amount) : f.amount,
          currency: (d.currency as string) || f.currency,
        }));
        toast.success(t("common.autoFilled"));
      } else {
        console.error("[scan] extract returned error", res.error);
        toast.error(res.error);
      }
    } catch (e) {
      console.error("[scan] failed", e);
      toast.error(e instanceof Error ? e.message : t("common.scanFailed"));
    } finally { setScanning(false); }
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
      if (file) fileInfo = await uploadFile(uid, "warranty", file);
      const payload = {
        user_id: uid,
        profile_id: activeProfileId,
        product_name: form.product_name,
        store: form.store || null,
        purchase_date: form.purchase_date || null,
        warranty_expiry: form.warranty_expiry || null,
        amount: form.amount ? Number(form.amount) : null,
        currency: form.currency || "EUR",
        notes: form.notes || null,
        ...(fileInfo ? { file_path: fileInfo.path, file_name: fileInfo.name, file_mime: fileInfo.mime } : {}),
      };
      let recordId: string | null = null;
      if (row) {
        const { error } = await supabase.from("warranties").update(payload).eq("id", row.id);
        if (error) throw error;
        recordId = row.id;
      } else {
        const { data: inserted, error } = await supabase.from("warranties").insert(payload).select("id").single();
        if (error) throw error;
        recordId = inserted?.id ?? null;
      }
      if (fileInfo && recordId) {
        try {
          await syncFileToGoogleDrive({
            data: {
              table: "warranties",
              recordId,
              gdriveColumn: "gdrive_file_id",
              folderKey: "warranty",
              filePath: fileInfo.path,
              fileName: fileInfo.name,
              mime: fileInfo.mime,
            },
          });
        } catch (err) {
          console.warn("[gdrive] warranty sync failed", err);
        }
      }
      try { await syncBackupCategory({ data: { category: "warranties", lang: currentBackupLang() } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      if (recordId) {
        try { await syncWarranty({ data: { warrantyId: recordId } }); } catch (e) { console.warn("[gcal] warranty sync failed", e); }
      }
      qc.invalidateQueries({ queryKey: ["warranties"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(row ? t("common.updated") : t("warranties.added"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden p-4 sm:w-full sm:max-w-lg sm:p-6">
        <DialogHeader><DialogTitle>{row ? t("warranties.editTitle") : t("warranties.addTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="w-full min-w-0 max-w-full space-y-4 overflow-hidden">
          <div className="flex justify-end">
            <VoiceInput
              context="warranty"
              onResult={(d) => setForm((f) => ({
                ...f,
                product_name: (d.product_name as string) || f.product_name,
                store: (d.store as string) || f.store,
                purchase_date: (d.purchase_date as string) || f.purchase_date,
                warranty_expiry: (d.warranty_expiry as string) || f.warranty_expiry,
                amount: d.amount != null ? String(d.amount) : f.amount,
                currency: (d.currency as string) || f.currency,
                notes: (d.notes as string) || f.notes,
              }))}
            />
          </div>
          <FileDrop file={file} onFile={setFile} onScan={scan} scanning={scanning} />
          <div><Label>{t("warranties.productName")} *</Label><Input required value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("warranties.store")}</Label><Input value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} /></div>
            <div><Label>{t("warranties.amount")}</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("warranties.purchaseDate")}</Label><Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
            <div><Label>{t("warranties.warrantyExpiry")}</Label><Input type="date" value={form.warranty_expiry} onChange={(e) => setForm({ ...form, warranty_expiry: e.target.value })} /></div>
          </div>
          <div><Label>{t("warranties.notes")}</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? t("common.saving") : t("common.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PageHeader({ title, desc, onAdd }: { title: string; desc: string; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-muted-foreground">{desc}</p>
      </div>
      <Button onClick={onAdd} className="shrink-0 brand-gradient-bg text-primary-foreground"><Plus className="mr-1.5 h-4 w-4" />{t("common.add")}</Button>
    </div>
  );
}

function EmptyCard({ icon: Icon, title, desc, onAdd }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="card-soft flex flex-col items-center p-12 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent"><Icon className="h-6 w-6 text-primary" /></div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <Button onClick={onAdd} className="mt-4 brand-gradient-bg text-primary-foreground"><Plus className="mr-1.5 h-4 w-4" />{t("common.add")}</Button>
    </div>
  );
}