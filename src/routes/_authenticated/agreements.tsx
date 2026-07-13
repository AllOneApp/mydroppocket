import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, FileText } from "lucide-react";
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
import { VoiceInput } from "@/components/VoiceInput";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, uploadFile } from "@/lib/records";
import { syncFileToGoogleDrive, syncBackupCategory, deleteGoogleDriveFile } from "@/lib/google-drive.functions";
import { extractDocument } from "@/lib/ocr.functions";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/agreements")({
  head: () => ({ meta: [{ title: "Agreements — DropPocket" }] }),
  component: AgreementsPage,
});

const TYPES = [
  { value: "installment", label: "Installment agreement" },
  { value: "warranty_extension", label: "Warranty extension" },
  { value: "purchase_contract", label: "Purchase contract" },
  { value: "service", label: "Service agreement" },
  { value: "contract", label: "Other contract" },
];

type Row = {
  id: string; title: string; agreement_type: string; company: string | null; agreement_number: string | null;
  start_date: string | null; end_date: string | null; monthly_payment: number | null; total_amount: number | null;
  currency: string | null; notes: string | null;
  file_path: string | null; file_name: string | null;
};

function AgreementsPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const { data } = useQuery({
    queryKey: ["agreements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  async function del(r: Row) {
    if (!confirm(t("agreements.confirmDelete"))) return;
    if (r.file_path) await deleteFile(r.file_path);
    await supabase.from("agreements").delete().eq("id", r.id);
    const gdid = (r as unknown as { gdrive_file_id?: string | null }).gdrive_file_id;
    if (gdid) { try { await deleteGoogleDriveFile({ data: { fileId: gdid } }); } catch (e) { console.warn("[gdrive] delete file failed", e); } }
    try { await syncBackupCategory({ data: { category: "agreements" } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
    qc.invalidateQueries({ queryKey: ["agreements"] });
    toast.success(t("common.deleted"));
  }

  return (
    <AppShell>
      <div className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{t("agreements.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("agreements.desc")}</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="shrink-0 brand-gradient-bg text-primary-foreground"><Plus className="mr-1.5 h-4 w-4" />{t("common.add")}</Button>
      </div>

      {data?.length === 0 ? (
        <div className="card-soft flex flex-col items-center p-12 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent"><FileText className="h-6 w-6 text-primary" /></div>
          <h3 className="text-lg font-semibold">{t("agreements.empty.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("agreements.empty.desc")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {data?.map((r) => (
            <div key={r.id} className="card-soft p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                <button onClick={() => { setEditing(r); setOpen(true); }} className="min-w-0 text-left">
                  <h3 className="truncate font-semibold hover:text-primary">{r.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.company ?? "—"} · {t(`agreements.types.${r.agreement_type}` as const, { defaultValue: r.agreement_type })}
                    {r.agreement_number ? ` · #${r.agreement_number}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.start_date ?? "—"} → {r.end_date ?? "—"}
                    {r.monthly_payment ? ` · ${formatCurrency(Number(r.monthly_payment), r.currency ?? "EUR")}${t("agreements.perMonth")}` : ""}
                    {r.total_amount ? ` · ${t("agreements.totalPrefix", { amount: formatCurrency(Number(r.total_amount), r.currency ?? "EUR") })}` : ""}
                  </p>
                </button>
              </div>
              <div className="mt-3"><RecordActions filePath={r.file_path} fileName={r.file_name} onDelete={() => del(r)} /></div>
            </div>
          ))}
        </div>
      )}

      <AgreementDialog open={open} onOpenChange={setOpen} row={editing} />
    </AppShell>
  );
}

function AgreementDialog({ open, onOpenChange, row }: { open: boolean; onOpenChange: (b: boolean) => void; row: Row | null }) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const extract = useServerFn(extractDocument);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    title: row?.title ?? "",
    agreement_type: row?.agreement_type ?? "contract",
    company: row?.company ?? "",
    agreement_number: row?.agreement_number ?? "",
    start_date: row?.start_date ?? "",
    end_date: row?.end_date ?? "",
    monthly_payment: row?.monthly_payment?.toString() ?? "",
    total_amount: row?.total_amount?.toString() ?? "",
    currency: row?.currency ?? "EUR",
    notes: row?.notes ?? "",
  }));

  async function scan() {
    if (!file) return;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await extract({ data: { kind: "agreement", mime: file.type || "application/octet-stream", base64 } });
      if (res.ok) {
        const d = res.data;
        setForm((f) => ({
          ...f,
          company: (d.company as string) || f.company,
          agreement_number: (d.agreement_number as string) || f.agreement_number,
          start_date: (d.start_date as string) || f.start_date,
          end_date: (d.end_date as string) || f.end_date,
          monthly_payment: d.monthly_payment != null ? String(d.monthly_payment) : f.monthly_payment,
          total_amount: d.total_amount != null ? String(d.total_amount) : f.total_amount,
          currency: (d.currency as string) || f.currency,
          title: f.title || (d.company as string) || "",
        }));
        toast.success(t("common.autoFilled"));
      } else toast.error(res.error);
    } catch (e) { toast.error(e instanceof Error ? e.message : t("common.scanFailed")); }
    finally { setScanning(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      let fileInfo: { path: string; name: string; mime: string } | null = null;
      if (file) fileInfo = await uploadFile(uid, "agreement", file);
      const payload = {
        user_id: uid,
        title: form.title,
        agreement_type: form.agreement_type,
        company: form.company || null,
        agreement_number: form.agreement_number || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        monthly_payment: form.monthly_payment ? Number(form.monthly_payment) : null,
        total_amount: form.total_amount ? Number(form.total_amount) : null,
        currency: form.currency,
        notes: form.notes || null,
        ...(fileInfo ? { file_path: fileInfo.path, file_name: fileInfo.name, file_mime: fileInfo.mime } : {}),
      };
      let recordId: string | null = null;
      if (row) {
        const { error } = await supabase.from("agreements").update(payload).eq("id", row.id);
        if (error) throw error;
        recordId = row.id;
      } else {
        const { data: inserted, error } = await supabase.from("agreements").insert(payload).select("id").single();
        if (error) throw error;
        recordId = inserted?.id ?? null;
      }
      if (fileInfo && recordId) {
        try {
          await syncFileToGoogleDrive({
            data: {
              table: "agreements",
              recordId,
              gdriveColumn: "gdrive_file_id",
              folderKey: "agreement",
              filePath: fileInfo.path,
              fileName: fileInfo.name,
              mime: fileInfo.mime,
            },
          });
        } catch (err) {
          console.warn("[gdrive] agreement sync failed", err);
        }
      }
      try { await syncBackupCategory({ data: { category: "agreements" } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      qc.invalidateQueries({ queryKey: ["agreements"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(row ? t("common.updated") : t("agreements.added"));
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : t("common.failed")); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? t("agreements.editTitle") : t("agreements.addTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex justify-end">
            <VoiceInput
              context="agreement"
              onResult={(d) => setForm((f) => ({
                ...f,
                title: (d.title as string) || f.title,
                company: (d.company as string) || f.company,
                agreement_number: (d.agreement_number as string) || f.agreement_number,
                start_date: (d.start_date as string) || f.start_date,
                end_date: (d.end_date as string) || f.end_date,
                monthly_payment: d.monthly_payment != null ? String(d.monthly_payment) : f.monthly_payment,
                total_amount: d.total_amount != null ? String(d.total_amount) : f.total_amount,
                currency: (d.currency as string) || f.currency,
                notes: (d.notes as string) || f.notes,
              }))}
            />
          </div>
          <FileDrop file={file} onFile={setFile} onScan={scan} scanning={scanning} />
          <div><Label>{t("agreements.titleField")} *</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><Label>{t("agreements.type")}</Label>
            <Select value={form.agreement_type} onValueChange={(v) => setForm({ ...form, agreement_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((ty) => <SelectItem key={ty.value} value={ty.value}>{t(`agreements.types.${ty.value}` as const, { defaultValue: ty.label })}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("agreements.company")}</Label><Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
            <div><Label>{t("agreements.number")}</Label><Input value={form.agreement_number} onChange={(e) => setForm({ ...form, agreement_number: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("agreements.startDate")}</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>{t("agreements.endDate")}</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("agreements.monthly")}</Label><Input type="number" step="0.01" value={form.monthly_payment} onChange={(e) => setForm({ ...form, monthly_payment: e.target.value })} /></div>
            <div><Label>{t("agreements.total")}</Label><Input type="number" step="0.01" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} /></div>
          </div>
          <div><Label>{t("agreements.notes")}</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? t("common.saving") : t("common.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}