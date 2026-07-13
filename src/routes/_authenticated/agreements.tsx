import { formatDate } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { MultiFileDrop, type ExistingAttachment } from "@/components/MultiFileDrop";
import { RecordActions } from "@/components/RecordActions";
import { VoiceInput } from "@/components/VoiceInput";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, uploadFile } from "@/lib/records";
import { syncAgreementAttachments, syncBackupCategory, deleteGoogleDriveFile, deleteAgreementDriveFolder, currentBackupLang } from "@/lib/google-drive.functions";
import { extractDocument } from "@/lib/ocr.functions";
import { useTranslation } from "react-i18next";

const MAX_AGREEMENT_ATTACHMENTS = 20;

type AttachmentRow = {
  id: string;
  agreement_id: string;
  file_path: string;
  file_name: string;
  file_mime: string | null;
  gdrive_file_id: string | null;
  sort_order: number;
};

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
    // Remove any attachments' storage files.
    const { data: atts } = await supabase
      .from("agreement_attachments")
      .select("file_path")
      .eq("agreement_id", r.id);
    for (const a of (atts ?? []) as Array<{ file_path: string }>) {
      try { await deleteFile(a.file_path); } catch (e) { console.warn("[storage] delete failed", e); }
    }
    if (r.file_path) { try { await deleteFile(r.file_path); } catch (e) { console.warn("[storage] delete failed", e); } }

    // Drive: prefer removing the whole per-agreement folder if we have it.
    const gdriveFolderId = (r as unknown as { gdrive_folder_id?: string | null }).gdrive_folder_id;
    if (gdriveFolderId) {
      try { await deleteAgreementDriveFolder({ data: { folderId: gdriveFolderId } }); } catch (e) { console.warn("[gdrive] folder delete failed", e); }
    } else {
      const gdid = (r as unknown as { gdrive_file_id?: string | null }).gdrive_file_id;
      if (gdid) { try { await deleteGoogleDriveFile({ data: { fileId: gdid } }); } catch (e) { console.warn("[gdrive] delete file failed", e); } }
    }

    await supabase.from("agreements").delete().eq("id", r.id);
    try { await syncBackupCategory({ data: { category: "agreements", lang: currentBackupLang() } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
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
                    {formatDate(r.start_date)} → {formatDate(r.end_date)}
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existing, setExisting] = useState<ExistingAttachment[]>([]);
  // IDs of attachments the user removed in the dialog — deleted on save.
  const [removedExistingIds, setRemovedExistingIds] = useState<string[]>([]);
  // Track legacy single-file removal (agreements.file_path).
  const [legacyRemoved, setLegacyRemoved] = useState(false);
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

  // Load existing attachments when editing.
  useEffect(() => {
    if (!open) return;
    setPendingFiles([]);
    setRemovedExistingIds([]);
    setLegacyRemoved(false);
    if (!row) { setExisting([]); return; }
    (async () => {
      const { data } = await supabase
        .from("agreement_attachments")
        .select("id, file_path, file_name, sort_order")
        .eq("agreement_id", row.id)
        .order("sort_order", { ascending: true });
      const list: ExistingAttachment[] = ((data ?? []) as Array<{ id: string; file_path: string; file_name: string }>).map(
        (a) => ({ id: a.id, name: a.file_name, filePath: a.file_path }),
      );
      // Include legacy single file if present and not already mirrored as an attachment.
      if (row.file_path && !list.some((a) => a.filePath === row.file_path)) {
        list.unshift({ id: "__legacy__", name: row.file_name ?? "Fail", filePath: row.file_path });
      }
      setExisting(list);
    })();
  }, [open, row]);

  async function scan() {
    if (pendingFiles.length === 0) {
      toast.error(t("file.pickFirst", { defaultValue: "Please add a file first" }));
      return;
    }
    const emptyFile = pendingFiles.find((file) => file.size === 0);
    if (emptyFile) {
      console.error("[scan] agreement file is empty", { name: emptyFile.name });
      toast.error(t("file.empty", { defaultValue: "The selected file is empty." }));
      return;
    }
    console.info("[scan] agreement starting", {
      fileCount: pendingFiles.length,
      files: pendingFiles.map((file, index) => ({ index, name: file.name, type: file.type, size: file.size })),
    });
    setScanning(true);
    try {
      const files = await Promise.all(pendingFiles.map(async (file, index) => {
        const base64 = await fileToBase64(file);
        if (!base64) throw new Error(t("file.readFailedAt", { defaultValue: "Could not read file {{index}}.", index: index + 1 }));
        return { name: file.name, mime: file.type || "application/octet-stream", base64 };
      }));
      const res = await extract({ data: { kind: "agreement", files } });
      console.info("[scan] agreement response", res);
      if (res.ok) {
        const d = res.data;
        const filled = [d.title, d.agreement_type, d.company, d.agreement_number, d.start_date, d.end_date, d.monthly_payment, d.total_amount, d.currency, d.notes]
          .some((v) => v !== null && v !== undefined && v !== "");
        if (!filled) {
          toast.error(t("agreements.analysisNoData"));
          return;
        }
        const agreementType = typeof d.agreement_type === "string" && TYPES.some((type) => type.value === d.agreement_type)
          ? d.agreement_type
          : null;
        setForm((f) => ({
          ...f,
          title: (d.title as string) || f.title || (d.company as string) || "",
          agreement_type: agreementType || f.agreement_type,
          company: (d.company as string) || f.company,
          agreement_number: (d.agreement_number as string) || f.agreement_number,
          start_date: (d.start_date as string) || f.start_date,
          end_date: (d.end_date as string) || f.end_date,
          monthly_payment: d.monthly_payment != null ? String(d.monthly_payment) : f.monthly_payment,
          total_amount: d.total_amount != null ? String(d.total_amount) : f.total_amount,
          currency: (d.currency as string) || f.currency,
          notes: (d.notes as string) || f.notes,
        }));
        toast.success(t("common.autoFilled"));
      } else {
        console.error("[scan] extract returned error", res.error);
        toast.error(t("agreements.analysisFailed"));
      }
    } catch (e) {
      console.error("[scan] failed", e);
      toast.error(e instanceof Error ? e.message : t("common.scanFailed"));
    }
    finally { setScanning(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;

      const basePayload = {
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
        ...(legacyRemoved ? { file_path: null, file_name: null, file_mime: null } : {}),
      };

      let recordId: string | null = null;
      if (row) {
        const { error } = await supabase.from("agreements").update(basePayload).eq("id", row.id);
        if (error) throw error;
        recordId = row.id;
      } else {
        const { data: inserted, error } = await supabase.from("agreements").insert(basePayload as never).select("id").single();
        if (error) throw error;
        recordId = inserted?.id ?? null;
      }

      // Remove any attachments the user unchecked (excluding legacy pseudo-id).
      for (const attId of removedExistingIds) {
        if (attId === "__legacy__") continue;
        const { data: att } = await supabase
          .from("agreement_attachments")
          .select("file_path, gdrive_file_id")
          .eq("id", attId)
          .maybeSingle();
        if (att) {
          const a = att as { file_path: string; gdrive_file_id: string | null };
          try { await deleteFile(a.file_path); } catch (err) { console.warn("[storage] delete failed", err); }
          if (a.gdrive_file_id) {
            try { await deleteGoogleDriveFile({ data: { fileId: a.gdrive_file_id } }); } catch (err) { console.warn("[gdrive] delete failed", err); }
          }
        }
        await supabase.from("agreement_attachments").delete().eq("id", attId);
      }
      // If legacy file was removed, drop it from storage + Drive.
      if (legacyRemoved && row?.file_path) {
        try { await deleteFile(row.file_path); } catch (err) { console.warn("[storage] delete legacy failed", err); }
        const gdid = (row as unknown as { gdrive_file_id?: string | null }).gdrive_file_id;
        if (gdid) { try { await deleteGoogleDriveFile({ data: { fileId: gdid } }); } catch (err) { console.warn("[gdrive] delete legacy failed", err); } }
      }

      // Upload each new pending file → insert attachment row.
      if (recordId) {
        let order = existing.length; // rough starting position
        for (const f of pendingFiles) {
          const info = await uploadFile(uid, "agreement", f);
          const { error: attErr } = await supabase.from("agreement_attachments").insert({
            agreement_id: recordId,
            user_id: uid,
            file_path: info.path,
            file_name: info.name,
            file_mime: info.mime,
            file_size: f.size,
            sort_order: order++,
          });
          if (attErr) throw attErr;
        }

        // Sync all attachments to per-agreement Drive folder.
        try {
          await syncAgreementAttachments({ data: { agreementId: recordId } });
        } catch (err) {
          console.warn("[gdrive] agreement attachments sync failed", err);
        }
      }

      try { await syncBackupCategory({ data: { category: "agreements", lang: currentBackupLang() } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      qc.invalidateQueries({ queryKey: ["agreements"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(row ? t("common.updated") : t("agreements.added"));
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : t("common.failed")); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden p-4 sm:w-full sm:max-w-lg sm:p-6">
        <DialogHeader><DialogTitle>{row ? t("agreements.editTitle") : t("agreements.addTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="w-full min-w-0 max-w-full space-y-4 overflow-hidden">
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
          <MultiFileDrop
            existing={existing.filter((a) => !removedExistingIds.includes(a.id))}
            pending={pendingFiles}
            maxFiles={MAX_AGREEMENT_ATTACHMENTS}
            onAddFiles={(files) => setPendingFiles((prev) => [...prev, ...files])}
            onRemovePending={(idx) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
            onRemoveExisting={(id) => {
              setRemovedExistingIds((prev) => [...prev, id]);
              if (id === "__legacy__") setLegacyRemoved(true);
            }}
          />
          {pendingFiles.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => { void scan(); }}
              disabled={scanning}
              className="w-full"
            >
              {scanning ? t("file.scanning") : t("file.autoFill")}
            </Button>
          )}
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