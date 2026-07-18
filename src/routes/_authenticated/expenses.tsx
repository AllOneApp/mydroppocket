import { formatDate, formatDateShort, formatCategory } from "@/lib/format";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Wallet, TrendingUp, TrendingDown, Upload, Pencil } from "lucide-react";
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
import { ConfirmDeleteDialog } from "@/components/ConfirmDialog";
import { DateRangeFilter, computeRange, localDateString, type DateRange } from "@/components/DateRangeFilter";
import { WarrantyCandidatesBlock, makeWarrantyItem, computeExpiry, type WarrantyItem } from "@/components/WarrantyCandidatesBlock";
import { supabase } from "@/integrations/supabase/client";
import { expensesQueryKey, expensesQueryOptions, type ExpenseEntryType, type ExpenseRow } from "@/lib/expenses";
import { deleteFile, fileToBase64, formatCurrency, uploadFile } from "@/lib/records";
import { syncFileToGoogleDrive, syncBackupCategory, deleteGoogleDriveFile, currentBackupLang } from "@/lib/google-drive.functions";
import { syncWarranty } from "@/lib/google-calendar.functions";
import { extractDocument } from "@/lib/ocr.functions";
import { useTranslation } from "react-i18next";
import { useActiveProfile } from "@/hooks/useActiveProfile";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Income & expenses — MyDropPocket" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    open: typeof s.open === "string" ? s.open : undefined,
  }),
  component: ExpensesPage,
});

const EXPENSE_CATEGORIES = ["Groceries", "Fuel", "Restaurant", "Coffee", "Hairdresser", "Nails", "Shopping", "Healthcare", "Travel", "Pets", "Other"];
const INCOME_CATEGORIES = ["Salary", "Sale", "Gift", "Investment", "Refund", "OtherIncome"];

type EntryType = ExpenseEntryType;
type Row = ExpenseRow;

function ExpensesPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { activeProfileId } = useActiveProfile();
  const navigate = useNavigate();
  const { open: openId } = Route.useSearch();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [prefill, setPrefill] = useState<Partial<Row> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [range, setRange] = useState<DateRange>(() => {
    const r = computeRange("thisMonth");
    return { preset: "thisMonth", from: r.from, to: r.to };
  });
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data } = useQuery(expensesQueryOptions(activeProfileId));

  useEffect(() => {
    if (!openId || !data) return;
    const found = data.find((r) => r.id === openId);
    if (!found) return; // wait for refetch to bring in freshly-created row
    if (found) {
      // If the target expense sits outside the current date range, widen the
      // range so it becomes visible in the list. Prefer the smallest preset
      // that still contains both today and the target date.
      if (found.expense_date < range.from || found.expense_date > range.to) {
        const candidates: DateRange["preset"][] = ["thisMonth", "thisYear", "all"];
        let chosen: DateRange["preset"] = "all";
        for (const p of candidates) {
          const r = computeRange(p);
          if (found.expense_date >= r.from && found.expense_date <= r.to) { chosen = p; break; }
        }
        const r = computeRange(chosen);
        setRange({ preset: chosen, from: r.from, to: r.to });
      }
      setHighlightId(found.id);
    }
    void navigate({ to: "/expenses", search: {}, replace: true });
  }, [openId, data, navigate, range.from, range.to]);

  useEffect(() => {
    if (!highlightId) return;
    const el = rowRefs.current[highlightId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(timer);
  }, [highlightId, data]);

  const filtered = useMemo(() => (data ?? []).filter((r) => r.expense_date >= range.from && r.expense_date <= range.to), [data, range]);
  const income = filtered.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
  const expense = filtered.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
  const balance = income - expense;

  async function performDelete(r: Row) {
    const prev = qc.getQueryData<Row[]>(expensesQueryKey);
    qc.setQueryData<Row[]>(expensesQueryKey, (current = []) => current.filter((entry) => entry.id !== r.id));
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", r.id);
      if (error) throw error;
      if (r.file_path) { try { await deleteFile(r.file_path); } catch (e) { console.warn("[storage] delete failed", e); } }
      const gdid = (r as unknown as { gdrive_file_id?: string | null }).gdrive_file_id;
      if (gdid) { try { await deleteGoogleDriveFile({ data: { fileId: gdid, profileId: activeProfileId } }); } catch (e) { console.warn("[gdrive] delete file failed", e); } }
      try { await syncBackupCategory({ data: { category: "expenses", lang: currentBackupLang(), profileId: activeProfileId } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: expensesQueryKey, refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      toast.success(t("common.deleted"));
    } catch (error) {
      if (prev) qc.setQueryData(expensesQueryKey, prev);
      toast.error(error instanceof Error ? error.message : t("common.deleteFailed"));
    }
  }

  function openAdd(type: EntryType) {
    setEditing(null);
    setPrefill({ type });
    setOpen(true);
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{t("expenses.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{t("expenses.desc")}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button
            onClick={() => openAdd("income")}
            className="h-11 w-full justify-center bg-sky-500 text-white hover:bg-sky-500/90 sm:w-auto"
          >
            <TrendingUp className="mr-1.5 h-4 w-4" />{t("expenses.addIncome")}
          </Button>
          <Button
            onClick={() => openAdd("expense")}
            className="brand-gradient-bg h-11 w-full justify-center text-primary-foreground sm:w-auto"
          >
            <Plus className="mr-1.5 h-4 w-4" />{t("expenses.addExpense")}
          </Button>
        </div>
      </div>

      <div className="card-soft mb-6 p-4"><DateRangeFilter value={range} onChange={setRange} /></div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card-soft p-6"><p className="text-sm text-muted-foreground">{t("expenses.income")}</p><p className="mt-1 text-2xl font-bold text-green-600">{formatCurrency(income)}</p></div>
        <div className="card-soft p-6"><p className="text-sm text-muted-foreground">{t("expenses.expense")}</p><p className="mt-1 text-2xl font-bold text-red-600">{formatCurrency(expense)}</p></div>
        <div className="card-soft p-6"><p className="text-sm text-muted-foreground">{t("expenses.balance")}</p><p className={`mt-1 text-2xl font-bold ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(balance)}</p></div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-soft flex flex-col items-center p-12 text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent"><Wallet className="h-6 w-6 text-primary" /></div>
          <h3 className="text-lg font-semibold">{t("expenses.empty.title")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("expenses.empty.desc")}</p>
        </div>
      ) : (
        <div className="card-soft divide-y divide-border">
          {filtered.map((r) => {
            const isIncome = r.type === "income";
            const isHighlighted = highlightId === r.id;
            return (
              <div
                key={r.id}
                ref={(el) => { rowRefs.current[r.id] = el; }}
                className={`p-5 transition-colors ${isHighlighted ? "bg-primary/10 ring-2 ring-primary/40 ring-inset" : ""}`}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                  <button onClick={() => { setEditing(r); setPrefill(null); setOpen(true); }} className="min-w-0 text-left">
                    <p className="flex items-center gap-2 truncate font-medium hover:text-primary">
                      {isIncome ? <TrendingUp className="h-3.5 w-3.5 text-green-600" /> : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                      {r.description || t(`expenses.categories.${r.category}` as const, { defaultValue: r.category })}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{formatDate(r.expense_date)} · {t(`expenses.categories.${r.category}` as const, { defaultValue: r.category })}{r.store ? ` · ${r.store}` : ""}</p>
                  </button>
                  <p className={`shrink-0 text-lg font-semibold ${isIncome ? "text-green-600" : "text-red-600"}`}>{isIncome ? "+" : "−"}{formatCurrency(Number(r.amount), r.currency ?? "EUR")}</p>
                </div>
                <div className="mt-3"><RecordActions filePath={r.file_path} fileName={r.file_name} onDelete={() => setPendingDelete(r)} /></div>
              </div>
            );
          })}
        </div>
      )}

      <ExpenseDialog
        key={`${activeProfileId ?? "no-profile"}:${editing?.id ?? "new"}`}
        open={open}
        onOpenChange={setOpen}
        row={editing}
        prefill={prefill}
      />
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const r = pendingDelete; setPendingDelete(null); if (r) void performDelete(r); }}
      />
    </AppShell>
  );
}

export function ExpenseDialog({ open, onOpenChange, row, prefill, initialMode }: { open: boolean; onOpenChange: (b: boolean) => void; row: Row | null; prefill: Partial<Row> | null; initialMode?: "voice" | "upload" | "manual" }) {
  const { activeProfileId } = useActiveProfile();
  const qc = useQueryClient();
  const { t, i18n } = useTranslation();
  const extract = useServerFn(extractDocument);
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const scanRequestRef = useRef(0);
  const [form, setForm] = useState(() => makeForm(row, prefill));
  const [inputMode, setInputMode] = useState<"voice" | "upload" | "manual" | null>(null);
  const [autoVoice, setAutoVoice] = useState(false);
  const [warrantyItems, setWarrantyItems] = useState<WarrantyItem[]>([]);

  useEffect(() => {
    if (open) {
      scanRequestRef.current += 1;
      setForm(makeForm(row, prefill));
      setFile(null);
      setInputMode(initialMode ?? null);
      setAutoVoice(initialMode === "voice");
      setWarrantyItems([]);
    }
    return () => { scanRequestRef.current += 1; };
  }, [open, row, prefill, initialMode]);

  const showUpload = inputMode === "upload";

  const isIncome = form.type === "income";
  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  async function scan() {
    if (!file) return;
    const requestId = ++scanRequestRef.current;
    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const locale = (i18n.language?.toLowerCase().startsWith("et") ? "et" : "en") as "et" | "en";
      const res = await extract({ data: { kind: "expense", mime: file.type || "application/octet-stream", base64, locale } });
      if (scanRequestRef.current !== requestId) return;
      if (res.ok) {
        const d = res.data;
        const purchasedItems = Array.isArray(d.purchased_items)
          ? d.purchased_items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
        const store = typeof d.store === "string" ? d.store.trim() : "";
        const candidatesRaw = Array.isArray((d as unknown as { warranty_candidates?: unknown[] }).warranty_candidates)
          ? ((d as unknown as { warranty_candidates: Array<Record<string, unknown>> }).warranty_candidates ?? [])
          : [];
        const filled = [d.amount, d.currency, store, d.expense_date, d.category, d.description, d.vat, ...purchasedItems]
          .some((v) => v !== null && v !== undefined && v !== "");
        if (!filled) {
          toast.error(t("common.noDataFound", { defaultValue: "Dokumendist ei õnnestunud vajalikke andmeid leida." }));
        } else {
          const normalizedDate = normalizeDateString(d.expense_date as string | null);
          const purchaseDate = normalizedDate || form.expense_date;
          const nextStore = store || form.store;
          setForm((f) => ({
            ...f,
            amount: d.amount != null ? String(d.amount) : f.amount,
            currency: (d.currency as string) || f.currency,
            store: store || f.store,
            expense_date: normalizedDate || f.expense_date,
            category: (d.category as string) && EXPENSE_CATEGORIES.includes(d.category as string) ? (d.category as string) : f.category,
            description: (d.description as string) || (store ? `${store} ost` : f.description),
            notes: purchasedItems.length > 0 ? purchasedItems.join("\n") : f.notes,
          }));
          // Seed warranty candidates from AI
          const aiItems: WarrantyItem[] = candidatesRaw
            .filter((c) => c && typeof c === "object")
            .map((c) => {
              const name = typeof c.name === "string" ? c.name.trim() : "";
              const flagged = c.is_warranty_candidate !== false;
              const monthsRaw = typeof c.suggested_warranty_months === "number" ? c.suggested_warranty_months : null;
              const priceRaw = typeof c.estimated_price === "number" ? c.estimated_price : null;
              const preset = monthsRaw != null && [6, 12, 24, 36, 60].includes(monthsRaw) ? monthsRaw : 24;
              return makeWarrantyItem(
                {
                  product_name: name,
                  store: nextStore,
                  warranty_months: preset,
                  amount: priceRaw != null ? String(priceRaw) : "",
                  selected: flagged,
                  source: "ai",
                },
                { store: nextStore, purchase_date: purchaseDate },
              );
            })
            .filter((it) => it.product_name.length > 0);
          setWarrantyItems(aiItems);
          toast.success(t("common.autoFilled"));
        }
      } else toast.error(res.error);
    } catch (e) { toast.error(e instanceof Error ? e.message : t("common.scanFailed")); }
    finally {
      if (scanRequestRef.current === requestId) setScanning(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProfileId) {
      toast.error(t("profiles.notReady", { defaultValue: "Aktiivne profiil pole veel laaditud. Palun proovi mõne hetke pärast uuesti." }));
      return;
    }
    setSaving(true);
    try {
      const { data: userRes, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userRes.user) throw new Error("Kasutaja sessiooni ei leitud.");
      const uid = userRes.user.id;
      let fileInfo: { path: string; name: string; mime: string } | null = null;
      if (file) fileInfo = await uploadFile(uid, "expense", file);
      const normalizedExpenseDate = normalizeDateString(form.expense_date) ?? localDateString();
      const payload = {
        user_id: uid,
        profile_id: activeProfileId,
        type: form.type,
        amount: Number(form.amount),
        currency: form.currency,
        category: form.category,
        expense_date: normalizedExpenseDate,
        description: form.description || null,
        store: form.store || null,
        notes: form.notes || null,
        ...(fileInfo ? { file_path: fileInfo.path, file_name: fileInfo.name, file_mime: fileInfo.mime } : {}),
      };
      let savedRow: Row;
      if (row) {
        const { error } = await supabase.from("expenses").update(payload).eq("id", row.id).eq("user_id", uid);
        if (error) throw error;
        const { data: verifiedRow, error: verifyError } = await supabase
          .from("expenses")
          .select("*")
          .eq("id", row.id)
          .eq("user_id", uid)
          .maybeSingle();
        if (verifyError) throw verifyError;
        if (!verifiedRow) throw new Error("Kirje muutmist ei saanud andmebaasis kinnitada.");
        savedRow = verifiedRow as Row;
      } else {
        const { data: insertedRow, error: insertError } = await supabase
          .from("expenses")
          .insert(payload)
          .select("id")
          .single();
        if (insertError) throw insertError;
        if (!insertedRow?.id) throw new Error("Andmebaas ei tagastanud salvestatud kirje ID-d.");

        const { data: verifiedRow, error: verifyError } = await supabase
          .from("expenses")
          .select("*")
          .eq("id", insertedRow.id)
          .eq("user_id", uid)
          .maybeSingle();
        if (verifyError) throw verifyError;
        if (!verifiedRow) throw new Error("Kirjet ei leitud pärast salvestamist andmebaasist.");
        savedRow = verifiedRow as Row;
      }
      qc.setQueryData<Row[]>(expensesQueryKey, (current = []) => {
        const withoutSaved = current.filter((entry) => entry.id !== savedRow.id);
        return [savedRow, ...withoutSaved].sort((a, b) =>
          b.expense_date.localeCompare(a.expense_date),
        );
      });
      // Create warranty records — one file, many usages.
      const selectedWarranties = !row
        ? warrantyItems.filter(
            (w) =>
              w.selected &&
              w.product_name.trim().length > 0 &&
              (w.warranty_expiry || (typeof w.warranty_months === "number") || (w.warranty_months === "custom" && Number(w.custom_months) > 0)),
          )
        : [];
      let warrantiesCreated = 0;
      const createdWarrantyIds: string[] = [];
      for (const w of selectedWarranties) {
        const months =
          typeof w.warranty_months === "number"
            ? w.warranty_months
            : Number(w.custom_months);
        const expiry = w.warranty_expiry || (Number.isFinite(months) && months > 0 ? computeExpiry(normalizedExpenseDate, months) : null);
        const wPayload = {
          user_id: uid,
          profile_id: activeProfileId,
          product_name: w.product_name.trim(),
          store: w.store || savedRow.store || null,
          purchase_date: w.purchase_date || normalizedExpenseDate,
          warranty_expiry: expiry || null,
          amount: w.amount ? Number(w.amount) : null,
          currency: savedRow.currency || "EUR",
          notes: null,
          ...(fileInfo ? { file_path: fileInfo.path, file_name: fileInfo.name, file_mime: fileInfo.mime } : {}),
        };
        try {
          const { data: inserted, error: wErr } = await supabase
            .from("warranties")
            .insert(wPayload)
            .select("id")
            .single();
          if (wErr) throw wErr;
          if (inserted?.id) {
            warrantiesCreated += 1;
            createdWarrantyIds.push(inserted.id);
          }
        } catch (err) {
          console.warn("[warranty] auto-create failed", err);
        }
      }
      // Best-effort calendar sync for created warranties
      for (const wid of createdWarrantyIds) {
        try { await syncWarranty({ data: { warrantyId: wid } }); } catch (err) { console.warn("[gcal] warranty sync failed", err); }
      }
      if (fileInfo && savedRow?.id) {
        try {
          await syncFileToGoogleDrive({
            data: {
              table: "expenses",
              recordId: savedRow.id,
              gdriveColumn: "gdrive_file_id",
              folderKey: "expense",
              filePath: fileInfo.path,
              fileName: fileInfo.name,
              mime: fileInfo.mime,
              profileId: activeProfileId,
            },
          });
        } catch (err) {
          console.warn("[gdrive] expense sync failed", err);
        }
      }
      try { await syncBackupCategory({ data: { category: "expenses", lang: currentBackupLang(), profileId: activeProfileId } }); } catch (e) { console.warn("[gdrive] backup sync failed", e); }
      await Promise.all([
        qc.invalidateQueries({ queryKey: expensesQueryKey, refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["warranties"], refetchType: "active" }),
        qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }),
      ]);
      if (!row && warrantiesCreated > 0) {
        toast.success(
          `✅ Salvestamine õnnestus! Loodi automaatselt: 💶 1 kulukanne, 🛡️ ${warrantiesCreated} garantiikirje${warrantiesCreated === 1 ? "" : "t"}`,
          { duration: 6000 },
        );
      } else {
        toast.success(row ? t("common.updated") : t("expenses.added"));
      }
      onOpenChange(false);
    } catch (e) { toast.error(getErrorMessage(e, t("common.failed"))); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] min-w-0 max-w-full overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{row ? t("expenses.editTitle") : t("expenses.addTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="w-full min-w-0 max-w-full space-y-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex rounded-lg border border-border p-0.5">
              <button type="button" onClick={() => setForm({ ...form, type: "expense", category: EXPENSE_CATEGORIES.includes(form.category) ? form.category : "Other" })} className={`rounded-md px-3 py-1.5 text-sm ${!isIncome ? "bg-red-500 text-white" : "text-muted-foreground"}`}>{t("expenses.typeExpense")}</button>
              <button type="button" onClick={() => setForm({ ...form, type: "income", category: INCOME_CATEGORIES.includes(form.category) ? form.category : "Salary" })} className={`rounded-md px-3 py-1.5 text-sm ${isIncome ? "bg-green-500 text-white" : "text-muted-foreground"}`}>{t("expenses.typeIncome")}</button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <span onClickCapture={() => setInputMode("voice")} className="contents">
            <VoiceInput
              context="expense_or_income"
              variant={inputMode === "voice" ? "secondary" : "outline"}
              className="h-11 w-full justify-center whitespace-nowrap"
              autoStart={autoVoice}
              onResult={(d) => {
                const aiType = d.type === "income" || d.type === "expense" ? d.type : null;
                if (!aiType) {
                  toast(t("voice.pickType", { defaultValue: "Kas soovid lisada selle tuluna või kuluna?" }));
                }
                setForm((f) => {
                  const nextType: EntryType = aiType ?? f.type;
                  const allowed = nextType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
                  const rawCat = d.category as string | undefined;
                  const nextCat = rawCat && allowed.includes(rawCat)
                    ? rawCat
                    : (nextType !== f.type
                        ? (nextType === "income" ? "Salary" : "Other")
                        : f.category);
                  return {
                    ...f,
                    type: nextType,
                    amount: d.amount != null ? String(d.amount) : f.amount,
                    currency: (d.currency as string) || f.currency,
                    store: (d.store as string) || f.store,
                    expense_date: normalizeDateString(d.expense_date as string | null) || f.expense_date,
                    category: nextCat,
                    description: (d.description as string) || f.description,
                  };
                });
              }}
            />
            </span>
            <Button type="button" variant={inputMode === "upload" ? "secondary" : "outline"} onClick={() => setInputMode("upload")} className="h-11 w-full justify-center whitespace-nowrap">
              <Upload className="mr-1.5 h-4 w-4" />{t("expenses.uploadReceipt")}
            </Button>
            <Button type="button" variant={inputMode === "manual" ? "secondary" : "outline"} onClick={() => setInputMode("manual")} className="h-11 w-full justify-center whitespace-nowrap">
              <Pencil className="mr-1.5 h-4 w-4" />{t("expenses.fillManually")}
            </Button>
          </div>
          {(showUpload || file) && (
            <div className="w-full min-w-0 max-w-full overflow-hidden">
              <FileDrop file={file} onFile={setFile} onScan={scan} scanning={scanning} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("expenses.amount")} *</Label><Input type="number" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><Label>{t("expenses.date")} *</Label><Input type="date" required value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
          </div>
          <div><Label>{t("expenses.category")} *</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{t(`expenses.categories.${c}` as const, { defaultValue: c })}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>{t("expenses.store")}</Label><Input value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} /></div>
          <div><Label>{t("expenses.description")}</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><Label>{t("expenses.notes")}</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          {!row && form.type === "expense" && (
            <WarrantyCandidatesBlock
              items={warrantyItems}
              onChange={setWarrantyItems}
              defaultStore={form.store}
              defaultPurchaseDate={form.expense_date}
            />
          )}
          <Button type="submit" disabled={saving} className="w-full brand-gradient-bg text-primary-foreground">{saving ? t("common.saving") : t("common.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint, value.code ? `(${String(value.code)})` : null]
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" · ");
  }
  return fallback;
}

function makeForm(row: Row | null, prefill: Partial<Row> | null) {
  const type = (row?.type ?? prefill?.type ?? "expense") as EntryType;
  return {
    type,
    amount: row?.amount?.toString() ?? (prefill?.amount != null ? String(prefill.amount) : ""),
    currency: row?.currency ?? prefill?.currency ?? "EUR",
    category: row?.category ?? prefill?.category ?? (type === "income" ? "Salary" : "Other"),
    expense_date: row?.expense_date ?? prefill?.expense_date ?? localDateString(),
    description: row?.description ?? prefill?.description ?? "",
    store: row?.store ?? prefill?.store ?? "",
    notes: row?.notes ?? "",
  };
}

// Normalize any date-ish string coming from OCR/AI to YYYY-MM-DD (local).
// Supports: "YYYY-MM-DD", "DD.MM.YYYY", "DD/MM/YYYY", "DD-MM-YYYY", ISO timestamps.
// Returns null when input cannot be parsed.
function normalizeDateString(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${mo}-${d}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}