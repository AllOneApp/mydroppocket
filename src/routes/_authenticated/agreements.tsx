import { formatDate } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, FileText, Copy } from "lucide-react";
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
import { RecordDetailView, RecordActionRow, type DetailAttachment, type DetailField } from "@/components/RecordDetailView";
import { VoiceInput } from "@/components/VoiceInput";
import { ConfirmDeleteDialog } from "@/components/ConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { deleteFile, fileToBase64, formatCurrency, uploadFile } from "@/lib/records";
import { syncAgreementAttachments, syncBackupCategory, deleteGoogleDriveFile, deleteAgreementDriveFolder, currentBackupLang } from "@/lib/google-drive.functions";
import { syncInstallmentAgreement, removeCalendarSource } from "@/lib/google-calendar.functions";
import { extractDocument } from "@/lib/ocr.functions";
import { useTranslation } from "react-i18next";
import { useActiveProfile } from "@/hooks/useActiveProfile";

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
  iban: string | null; bank: string | null; reference_number: string | null;
  payee_name: string | null;
  payment_day_of_month: number | null;
  file_path: string | null; file_name: string | null;
};

const BANK_OPTIONS = ["Swedbank", "SEB", "LHV", "Coop Pank", "Luminor", "Inbank", "Bigbank", "Holm Bank", "TF Bank"];

function CopyableValue({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  if (!value) return <>—</>;
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value as string);
      toast.success(t("agreements.copied", { defaultValue: "Copied" }));
    } catch {
      toast.error(t("common.failed"));
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{value}</span>
      <button
        type="button"
        onClick={() => { void onCopy(); }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent"
        aria-label={t("agreements.copy", { defaultValue: "Copy" })}
        title={t("agreements.copy", { defaultValue: "Copy" })}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function AgreementsPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { activeProfileId } = useActiveProfile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [detailAtts, setDetailAtts] = useState<DetailAttachment[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);

  async function openDetail(r: Row) {
    const { data } = await supabase
      .from("agreement_attachments")
      .select("id, file_path, file_name, file_mime, sort_order")
      .eq("agreement_id", r.id)
      .order("sort_order", { ascending: true });
    const list: DetailAttachment[] = ((data ?? []) as Array<{ id: string; file_path: string; file_name: string; file_mime: string | null }>).map(
      (a) => ({ id: a.id, name: a.file_name, filePath: a.file_path, mime: a.file_mime }),
    );
    if (r.file_path && !list.some((a) => a.filePath === r.file_path)) {
      list.unshift({ id: "__legacy__", name: r.file_name ?? "Fail", filePath: r.file_path, mime: null });
    }
    setDetailAtts(list);
    setDetail(r);
  }

  const { data } = useQuery({
    queryKey: ["agreements", activeProfileId],
    enabled: !!activeProfileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreements")
        .select("*")
        .eq("profile_id", activeProfileId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  async function performDelete(r: Row) {
    const prev = qc.getQueryData<Row[]>(["agreements"]);
    qc.setQueryData<Row[]>(["agreements"], (current = []) => current.filter((e) => e.id !== r.id));
    try {
      const { error } = await supabase.from("agreements").delete().eq("id", r.id);
      if (error) throw error;
      // storage attachments cleanup (best-effort)
      const { data: atts } = await supabase
        .from("agreement_attachments")
        .select("file_path")
        .eq("agreement_id", r.id);
      for (const a of (atts ?? []) as Array<{ file_path: string }>) {
        try { await deleteFile(a.file_path); } catch (e) { console.warn("[storage] delete failed", e); }
      }
      if (r.file_path) { try { await deleteFile(r.file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      try { await removeCalendarSource({ data: { sourceType: "installment", sourceId: r.id } }); } catch (e) { console.warn("[gcal] installment remove failed", e); }
      try { await removeCalendarSource({ data: { sourceType: "agreement_end", sourceId: r.id } }); } catch (e) { console.warn("[gcal] agreement remove failed", e); }
      const gdriveFolderId = (r as unknown as { gdrive_folder_id?: string | null }).gdrive_folder_id;
      if (gdriveFolderId) {
        try { await deleteAgreementDriveFolder({ data: { folderId: gdriveFolderId } }); } catch (e) { console.warn("[gdrive] folder delete failed", e); }
      } else {
        const gdid = (r as unknown as { gdrive_file_id?: string | null }).gdrive_file_id;
        if (gdid) { try { await deleteGoogleDriveFile({ data: { fileId: gdid } }); } catch (e) { console.warn("[gdrive] delete file failed", e); } }
      }
      try { await syncBackupCategory({ data: { category: "agreements", lang: currentBackupLang() } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["agreements"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      toast.success(t("common.deleted"));
    } catch (e) {
      if (prev) qc.setQueryData(["agreements"], prev);
      toast.error(e instanceof Error ? e.message : t("common.deleteFailed"));
    }
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
                <button onClick={() => { void openDetail(r); }} className="min-w-0 text-left">
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
              <div className="mt-3">
                <RecordActionRow
                  onView={() => { void openDetail(r); }}
                  onEdit={() => { setEditing(r); setOpen(true); }}
                  onDelete={() => setPendingDelete(r)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <AgreementDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} row={editing} />
      <AgreementDetail
        row={detail}
        attachments={detailAtts}
        onOpenChange={(o) => { if (!o) setDetail(null); }}
        onEdit={() => { if (detail) { setEditing(detail); setDetail(null); setOpen(true); } }}
        onDelete={() => { if (detail) { const r = detail; setDetail(null); setPendingDelete(r); } }}
      />
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const r = pendingDelete; setPendingDelete(null); if (r) void performDelete(r); }}
      />
    </AppShell>
  );
}

function AgreementDetail({
  row,
  attachments,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  row: Row | null;
  attachments: DetailAttachment[];
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const currency = row?.currency ?? "EUR";
  const isInstallment = row?.agreement_type === "installment";
  const monthly = Number(row?.monthly_payment ?? 0);
  let totalPayments: number | null = null;
  if (isInstallment && row?.start_date && monthly > 0) {
    if (row.total_amount) {
      totalPayments = Math.max(1, Math.round(Number(row.total_amount) / monthly));
    } else if (row.end_date) {
      const a = new Date(row.start_date + "T00:00:00");
      const b = new Date(row.end_date + "T00:00:00");
      let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
      if (b.getDate() < a.getDate()) m -= 1;
      totalPayments = Math.max(1, m + 1);
    }
  }
  let paidCount = 0;
  let isPaidOff = false;
  if (isInstallment && row && totalPayments) {
    const raw = Number((row as unknown as { payments_made?: number | null }).payments_made ?? 0);
    paidCount = Math.min(Math.max(0, raw), totalPayments);
    isPaidOff = paidCount >= totalPayments;
  }

  const statusField: DetailField | null = isInstallment
    ? {
        label: t("agreements.status", { defaultValue: "Staatus" }),
        value: isPaidOff ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-sm font-semibold text-green-600">
            ✅ {t("agreements.statusClosed", { defaultValue: "Leping lõpetatud" })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-sm font-semibold text-blue-600">
            {t("agreements.statusActive", { defaultValue: "Aktiivne" })}
            {totalPayments ? ` · ${paidCount}/${totalPayments}` : ""}
          </span>
        ),
      }
    : null;

  const fields: DetailField[] = row
    ? [
        ...(statusField ? [statusField] : []),
        { label: t("agreements.type"), value: t(`agreements.types.${row.agreement_type}` as const, { defaultValue: row.agreement_type }) },
        { label: t("agreements.company"), value: row.company || "—" },
        { label: t("agreements.number"), value: row.agreement_number || "—" },
        { label: t("agreements.startDate"), value: formatDate(row.start_date) },
        { label: t("agreements.endDate"), value: formatDate(row.end_date) },
        { label: t("agreements.monthly"), value: row.monthly_payment != null ? formatCurrency(Number(row.monthly_payment), currency) : "—" },
        { label: t("agreements.total"), value: row.total_amount != null ? formatCurrency(Number(row.total_amount), currency) : "—" },
        { label: t("agreements.paymentDay", { defaultValue: "Igakuine maksetähtaeg" }), value: row.payment_day_of_month != null ? t("agreements.paymentDayValue", { defaultValue: "kuu {{day}}. päev", day: row.payment_day_of_month }) : "—" },
        { label: t("agreements.bank"), value: row.bank || "—" },
        { label: t("agreements.payeeName", { defaultValue: "Saaja nimi" }), value: <CopyableValue value={row.payee_name} /> },
        { label: t("agreements.iban"), value: <CopyableValue value={row.iban} /> },
        { label: t("agreements.referenceNumber"), value: <CopyableValue value={row.reference_number} /> },
        { label: t("agreements.notes"), value: row.notes || "—", full: true },
      ]
    : [];
  return (
    <RecordDetailView
      open={!!row}
      onOpenChange={onOpenChange}
      title={row?.title ?? ""}
      fields={fields}
      attachments={attachments}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function AgreementDialog({ open, onOpenChange, row }: { open: boolean; onOpenChange: (b: boolean) => void; row: Row | null }) {
  const qc = useQueryClient();
  const { activeProfileId } = useActiveProfile();
  const { t, i18n } = useTranslation();
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
    iban: row?.iban ?? "",
    bank: row?.bank ?? "",
    reference_number: row?.reference_number ?? "",
    payee_name: row?.payee_name ?? "",
    payment_day_of_month: row?.payment_day_of_month != null ? String(row.payment_day_of_month) : "",
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
      const locale = (i18n.language?.toLowerCase().startsWith("et") ? "et" : "en") as "et" | "en";
      const res = await extract({ data: { kind: "agreement", files, locale } });
      console.info("[scan] agreement response", res);
      if (res.ok) {
        const d = res.data;
        const filled = [d.title, d.agreement_type, d.company, d.agreement_number, d.start_date, d.end_date, d.monthly_payment, d.total_amount, d.currency, d.notes, d.iban, d.bank, d.reference_number, d.payee_name, d.payment_day_of_month]
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
          iban: (d.iban as string) || f.iban,
          bank: (d.bank as string) || f.bank,
          reference_number: (d.reference_number as string) || f.reference_number,
          payee_name: (d.payee_name as string) || f.payee_name,
          payment_day_of_month: d.payment_day_of_month != null ? String(d.payment_day_of_month) : f.payment_day_of_month,
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
        profile_id: activeProfileId,
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
        iban: form.iban ? form.iban.replace(/\s+/g, "").toUpperCase() : null,
        bank: form.bank || null,
        reference_number: form.reference_number ? form.reference_number.replace(/\s+/g, "") : null,
        payee_name: form.payee_name || null,
        payment_day_of_month: form.payment_day_of_month ? Number(form.payment_day_of_month) : null,
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
      // Best-effort: if this is an installment, refresh its Google Calendar event.
      // Also refresh agreement-end events for non-installment types with an end date.
      if (recordId) {
        try { await syncInstallmentAgreement({ data: { agreementId: recordId } }); } catch (e) { console.warn("[gcal] installment sync failed", e); }
      }
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
            <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { void scan(); }}
              disabled={scanning}
              className="w-full"
            >
              {scanning ? t("file.scanning") : t("file.autoFill")}
            </Button>
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
              {t("file.aiWarning")}
            </p>
            </>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("agreements.bank")}</Label>
              <Select value={form.bank || "__none__"} onValueChange={(v) => setForm({ ...form, bank: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {BANK_OPTIONS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  {form.bank && !BANK_OPTIONS.includes(form.bank) && (
                    <SelectItem value={form.bank}>{form.bank}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div><Label>{t("agreements.referenceNumber")}</Label><Input inputMode="numeric" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} /></div>
          </div>
          <div><Label>{t("agreements.iban")}</Label><Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="EE00 0000 0000 0000 0000" /></div>
          <div><Label>{t("agreements.payeeName", { defaultValue: "Saaja nimi" })}</Label><Input value={form.payee_name} onChange={(e) => setForm({ ...form, payee_name: e.target.value })} placeholder="AS Inbank Finance" /></div>
          <div>
            <Label>📅 {t("agreements.paymentDay", { defaultValue: "Igakuine maksetähtaeg" })}</Label>
            <Select
              value={form.payment_day_of_month || "__none__"}
              onValueChange={(v) => setForm({ ...form, payment_day_of_month: v === "__none__" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <SelectItem key={day} value={String(day)}>
                    {t("agreements.paymentDayValue", { defaultValue: "kuu {{day}}. päev", day })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>{t("agreements.notes")}</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? t("common.saving") : t("common.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}