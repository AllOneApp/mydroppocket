import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BackupFormat = "excel_pdf" | "excel_only" | "pdf_only";

type BackupPartResult = {
  requested: boolean;
  success: boolean;
  errors: string[];
};

type OriginalFilesResult = {
  scanned: number;
  uploaded: number;
  alreadySynced: number;
  failed: number;
  errors: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBackupFormat(v: unknown): BackupFormat {
  return v === "excel_only" || v === "pdf_only" ? v : "excel_pdf";
}

/**
 * Read the app's current language from the browser (i18next persists it in
 * localStorage under `dp_lang`). Falls back to Estonian — the app default.
 * Safe to call in SSR: returns "et" when window is absent.
 */
export function currentBackupLang(): "et" | "en" {
  if (typeof window === "undefined") return "et";
  try {
    const v = window.localStorage.getItem("dp_lang");
    return v === "en" ? "en" : "et";
  } catch {
    return "et";
  }
}

/**
 * Start Google Drive OAuth. Returns the authorization URL to open in a popup.
 * Signed state carries the app user id back through Google.
 */
export const startGoogleDriveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string; profileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { buildAuthorizationUrl, signState, GOOGLE_OAUTH_CALLBACK_PATH } = await import("./google-drive.server");
    const { data: profile, error } = await context.supabase
      .from("user_profiles")
      .select("id")
      .eq("id", data.profileId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) throw new Error("Profiili ei leitud");
    // Use the browser's current origin so the redirect returns to the same host
    // that opened the popup (preview / staging / prod / custom domain).
    const origin = new URL(data.origin).origin;
    const redirectUri = `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`;
    const state = signState({ userId: context.userId, origin, profileId: data.profileId });
    const authorizationUrl = buildAuthorizationUrl({ redirectUri, state });
    return { authorizationUrl };
  });

export const getGoogleDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("google_drive_connections")
      .select("google_email, root_folder_id, root_folder_name, connected_at, backup_format")
      .eq("user_id", context.userId);
    q = q.eq("profile_id", data.profileId);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw error;
    if (!row) return { connected: false as const };
    return {
      connected: true as const,
      email: row.google_email,
      folderId: row.root_folder_id,
      folderName: row.root_folder_name,
      connectedAt: row.connected_at,
      backupFormat: (row.backup_format ?? "excel_pdf") as BackupFormat,
    };
  });

export const disconnectGoogleDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Best-effort token revoke.
    let selectQ = supabaseAdmin
      .from("google_drive_connections")
      .select("refresh_token_ciphertext")
      .eq("user_id", context.userId);
    selectQ = selectQ.eq("profile_id", data.profileId);
    const { data: row } = await selectQ.maybeSingle();
    if (row?.refresh_token_ciphertext) {
      try {
        const { decryptToken } = await import("./google-drive.server");
        const refreshToken = decryptToken(row.refresh_token_ciphertext);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // ignore; still delete the local row
      }
    }
    let delQ = supabaseAdmin.from("google_drive_connections").delete().eq("user_id", context.userId);
    delQ = delQ.eq("profile_id", data.profileId);
    await delQ;
    return { ok: true };
  });

/**
 * Profiili-teadlik Drive'i staatus: milline režiim (jagatud/eraldi), kas ühendus
 * on olemas, mis on salvestuskoht (kaustatee).
 */
export const getProfileDriveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Load profile + drive mode.
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, name, drive_mode, is_default")
      .eq("id", data.profileId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!profile) throw new Error("Profiili ei leitud");
    const p = profile as { name: string; drive_mode: string; is_default: boolean };
    const { data: own } = await supabaseAdmin
      .from("google_drive_connections")
      .select("google_email, backup_format")
      .eq("user_id", context.userId)
      .eq("profile_id", data.profileId)
      .maybeSingle();
    return {
      mode: "separate" as const,
      connected: !!own,
      email: own ? (own as { google_email: string }).google_email : null,
      storagePath: `MyDropPocket`,
      backupFormat: parseBackupFormat((own as { backup_format?: string } | null)?.backup_format),
    };
  });

/**
 * Loe profiili varunduse formaat. Shared režiim → põhikonto ühenduse formaat;
 * separate režiim → selle profiili enda ühenduse formaat.
 */
export const getBackupFormat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ data, context }): Promise<{ format: BackupFormat }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("google_drive_connections")
      .select("backup_format")
      .eq("user_id", context.userId)
      .eq("profile_id", data.profileId)
      .maybeSingle();
    return { format: parseBackupFormat((row as { backup_format?: string } | null)?.backup_format) };
  });

/**
 * Muuda profiili varunduse formaati (Excel + PDF / Excel only / PDF only).
 * Kirjutab õigesse ühenduse ritta vastavalt profiili drive_mode'ile.
 */
export const setBackupFormat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; format: BackupFormat }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const format = parseBackupFormat(data.format);
    const { error } = await supabaseAdmin
      .from("google_drive_connections")
      .update({ backup_format: format, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("profile_id", data.profileId);
    if (error) throw error;
    return { ok: true as const, format };
  });

/**
 * Muuda profiili Drive režiimi. Kui vahetatakse `separate` → `shared`, siis
 * eraldi konto ühendus jääb alles (kasutaja saab hiljem uuesti sisse lülitada).
 */
export const setProfileDriveMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; mode: "shared" | "separate" }) => input)
  .handler(async ({ data, context }) => {
    if (data.mode !== "separate") {
      throw new Error("Google Drive'i jagatud ühendused ei ole enam toetatud");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({ drive_mode: "separate" })
      .eq("id", data.profileId)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true as const };
  });

/**
 * Nimeta profiili alamkaust põhikonto Drive'is ümber (jagatud režiimis).
 * Kui uue nimega kaust juba eksisteerib → { ok: false, reason: 'conflict' }.
 */
export const renameProfileDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; newName: string }) => input)
  .handler(async ({ data, context }) => {
    const { renameProfileFolderInDrive } = await import("./google-drive.server");
    return renameProfileFolderInDrive({ userId: context.userId, profileId: data.profileId, newName: data.newName });
  });

/**
 * Kontrolli, kas kuvada legacy migreerimisdialoog.
 */
export const checkLegacyDriveLayout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { detectLegacyDriveLayout } = await import("./google-drive.server");
    return detectLegacyDriveLayout(context.userId);
  });

/**
 * Liiguta legacy struktuur (MyDropPocket/{kategooria}/…) vaikeprofiili kausta alla.
 */
export const runLegacyDriveMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { migrateLegacyDriveToProfile } = await import("./google-drive.server");
    return migrateLegacyDriveToProfile(context.userId);
  });

/** Peida legacy migreerimisdialoog seniks — ilmub uuesti järgmisel korral. */
export const dismissLegacyDriveMigration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("user_profiles")
      .update({ legacy_drive_migration_dismissed_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("is_default", true);
    return { ok: true as const };
  });

type SyncTable =
  | "warranties"
  | "expenses"
  | "agreements"
  | "recurring_payments"
  | "recurring_payment_instances";

type SyncFolderKey = "warranty" | "expense" | "agreement" | "recurring" | "receipt" | "invoice";

interface SyncInput {
  table: SyncTable;
  recordId: string;
  gdriveColumn: string;
  folderKey: SyncFolderKey;
  filePath: string;
  fileName: string;
  mime: string;
  profileId?: string | null;
}

/**
 * Download the file from Supabase storage (server-side) and upload it to the
 * matching subfolder in the connected user's Google Drive. Persists the Drive
 * file id back onto the record row. Best-effort: returns {skipped:true} when
 * the user has no Drive connection yet.
 */
export const syncFileToGoogleDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SyncInput) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveProfileDriveTarget, uploadBytesToDriveFolder, FOLDER_KEY_TO_NAME } =
      await import("./google-drive.server");

    // Verify the record belongs to this user (RLS-scoped client).
    const { data: ownRow, error: ownErr } = await context.supabase
      .from(data.table)
      .select("id, user_id, profile_id")
      .eq("id", data.recordId)
      .maybeSingle();
    if (ownErr) throw ownErr;
    if (
      !ownRow ||
      (ownRow as { user_id: string }).user_id !== context.userId ||
      (ownRow as { profile_id: string | null }).profile_id !== data.profileId
    ) {
      throw new Error("Record not found");
    }

    const conn = await resolveProfileDriveTarget(context.userId, data.profileId ?? null);
    if (!conn) return { skipped: true as const, reason: "not_connected" };

    const folderName = FOLDER_KEY_TO_NAME[data.folderKey];
    const parentId = conn.subfolders[folderName];
    if (!parentId) throw new Error(`Missing Drive subfolder: ${folderName}`);

    // Download from storage using admin (path already scoped to userId/kind/uuid).
    if (!data.filePath.startsWith(`${context.userId}/`)) {
      throw new Error("File does not belong to this user");
    }
    const dl = await supabaseAdmin.storage.from("documents").download(data.filePath);
    if (dl.error || !dl.data) throw dl.error ?? new Error("Storage download failed");
    const bytes = new Uint8Array(await dl.data.arrayBuffer());

    const uploaded = await uploadBytesToDriveFolder({
      accessToken: conn.accessToken,
      parentId,
      name: data.fileName,
      mime: data.mime,
      bytes,
    });

    // Persist the drive file id on the record using the admin client to avoid
    // fighting the generated types for the new column.
    const patch: Record<string, string> = { [data.gdriveColumn]: uploaded.id };
    const { error: updErr } = await (supabaseAdmin.from(data.table) as unknown as {
      update: (v: Record<string, string>) => {
        eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
      };
    })
      .update(patch)
      .eq("id", data.recordId)
      .eq("user_id", context.userId);
    if (updErr) throw updErr as Error;

    return { ok: true as const, fileId: uploaded.id };
  });

// =========================================================
// ETAPP 3 — Full MyDropPocket backup to user's Google Drive.
// Per-category entries.json + root backup-info.json.
// =========================================================

export type BackupCategory =
  | "warranties"
  | "expenses"
  | "agreements"
  | "recurring_payments"
  | "recurring_payment_instances";

export type BackupLang = "et" | "en";

const CATEGORY_TO_FOLDER: Record<BackupCategory, string> = {
  warranties: "Garantiid",
  expenses: "Tulud ja kulud",
  agreements: "Lepingud",
  recurring_payments: "Püsimaksed",
  recurring_payment_instances: "Järelmaksulepingud",
};

// Kasutajale nähtav Exceli faili nimi kategooria kaustas — lokaliseeritud.
const CATEGORY_XLSX_NAME: Record<BackupLang, Record<BackupCategory, string>> = {
  et: {
    warranties: "Garantiid.xlsx",
    expenses: "Tulud ja kulud.xlsx",
    agreements: "Lepingud.xlsx",
    recurring_payments: "Püsimaksed.xlsx",
    recurring_payment_instances: "Järelmaksulepingud.xlsx",
  },
  en: {
    warranties: "Warranties.xlsx",
    expenses: "Income and expenses.xlsx",
    agreements: "Contracts.xlsx",
    recurring_payments: "Recurring payments.xlsx",
    recurring_payment_instances: "Installment contracts.xlsx",
  },
};

// PDF-i failinimed kategooriate jaoks (samas kaustas kui Exceli fail).
const CATEGORY_PDF_NAME: Record<BackupLang, Record<BackupCategory, string>> = {
  et: {
    warranties: "Garantiid.pdf",
    expenses: "Tulud ja kulud.pdf",
    agreements: "Lepingud.pdf",
    recurring_payments: "Püsimaksed.pdf",
    recurring_payment_instances: "Järelmaksulepingud.pdf",
  },
  en: {
    warranties: "Warranties.pdf",
    expenses: "Income and expenses.pdf",
    agreements: "Contracts.pdf",
    recurring_payments: "Recurring payments.pdf",
    recurring_payment_instances: "Installment contracts.pdf",
  },
};

const ALL_CATEGORIES: BackupCategory[] = [
  "warranties",
  "expenses",
  "agreements",
  "recurring_payments",
  "recurring_payment_instances",
];

// -----------------------------------------------------------------------------
// Localised, user-friendly column projections. Technical fields (id, user_id,
// file_path, file_mime, ocr_raw, gdrive_file_id, timestamps) are intentionally
// omitted — the app keeps identifiers server-side.
// -----------------------------------------------------------------------------

function fmtAmount(v: unknown): string | number {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
}

function tExpenseType(v: unknown, lang: BackupLang): string {
  const s = String(v ?? "").toLowerCase();
  if (s === "income") return lang === "et" ? "Tulu" : "Income";
  if (s === "expense") return lang === "et" ? "Kulu" : "Expense";
  return String(v ?? "");
}

function tStatus(v: unknown, lang: BackupLang): string {
  const s = String(v ?? "").toLowerCase();
  const map: Record<string, [string, string]> = {
    paid: ["Makstud", "Paid"],
    pending: ["Ootel", "Pending"],
    overdue: ["Tähtaeg möödas", "Overdue"],
    cancelled: ["Tühistatud", "Cancelled"],
  };
  return map[s]?.[lang === "et" ? 0 : 1] ?? String(v ?? "");
}

function tFrequency(v: unknown, lang: BackupLang): string {
  const s = String(v ?? "").toLowerCase();
  const map: Record<string, [string, string]> = {
    monthly: ["Kuine", "Monthly"],
    bimonthly: ["Iga 2 kuu tagant", "Every 2 months"],
    quarterly: ["Kvartaalne", "Quarterly"],
    semiannual: ["Poolaastane", "Semi-annual"],
    annual: ["Aastane", "Annual"],
  };
  return map[s]?.[lang === "et" ? 0 : 1] ?? String(v ?? "");
}

type Row = Record<string, unknown>;

function projectRows(category: BackupCategory, rows: Row[], lang: BackupLang): Row[] {
  const et = lang === "et";
  switch (category) {
    case "expenses":
      return rows.map((r) => ({
        [et ? "Kuupäev" : "Date"]: r.expense_date ?? "",
        [et ? "Tüüp" : "Type"]: tExpenseType(r.type, lang),
        [et ? "Kategooria" : "Category"]: r.category ?? "",
        [et ? "Summa" : "Amount"]: fmtAmount(r.amount),
        [et ? "Valuuta" : "Currency"]: r.currency ?? "",
        [et ? "Kirjeldus" : "Description"]: r.description ?? "",
        [et ? "Pood" : "Store"]: r.store ?? "",
        [et ? "Märkused" : "Notes"]: r.notes ?? "",
        [et ? "Manus" : "Attachment"]: r.file_name ?? "",
      }));
    case "warranties":
      return rows.map((r) => ({
        [et ? "Toode" : "Product"]: r.product_name ?? "",
        [et ? "Pood" : "Store"]: r.store ?? "",
        [et ? "Ostukuupäev" : "Purchase date"]: r.purchase_date ?? "",
        [et ? "Garantii lõpp" : "Warranty expiry"]: r.warranty_expiry ?? "",
        [et ? "Summa" : "Amount"]: fmtAmount(r.amount),
        [et ? "Valuuta" : "Currency"]: r.currency ?? "",
        [et ? "Märkused" : "Notes"]: r.notes ?? "",
        [et ? "Manus" : "Attachment"]: r.file_name ?? "",
      }));
    case "agreements":
      return rows.map((r) => ({
        [et ? "Pealkiri" : "Title"]: r.title ?? "",
        [et ? "Tüüp" : "Type"]: r.agreement_type ?? "",
        [et ? "Ettevõte" : "Company"]: r.company ?? "",
        [et ? "Lepingu nr" : "Agreement no."]: r.agreement_number ?? "",
        [et ? "Algus" : "Start date"]: r.start_date ?? "",
        [et ? "Lõpp" : "End date"]: r.end_date ?? "",
        [et ? "Kuumakse" : "Monthly payment"]: fmtAmount(r.monthly_payment),
        [et ? "Kogusumma" : "Total amount"]: fmtAmount(r.total_amount),
        [et ? "Valuuta" : "Currency"]: r.currency ?? "",
        [et ? "Pank" : "Bank"]: r.bank ?? "",
        [et ? "Saaja nimi" : "Payee name"]: r.payee_name ?? "",
        [et ? "Pangakonto (IBAN)" : "Bank account (IBAN)"]: r.iban ?? "",
        [et ? "Viitenumber" : "Reference number"]: r.reference_number ?? "",
        [et ? "Igakuine maksetähtaeg" : "Monthly due day"]: r.payment_day_of_month ?? "",
        [et ? "Märkused" : "Notes"]: r.notes ?? "",
        [et ? "Manus" : "Attachment"]: r.file_name ?? "",
      }));
    case "recurring_payments":
      return rows.map((r) => ({
        [et ? "Teenus" : "Service"]: r.service_name ?? "",
        [et ? "Pakkuja" : "Provider"]: r.provider ?? "",
        [et ? "Kategooria" : "Category"]: r.category ?? "",
        [et ? "Summa" : "Amount"]: fmtAmount(r.amount),
        [et ? "Valuuta" : "Currency"]: r.currency ?? "",
        [et ? "Sagedus" : "Frequency"]: tFrequency(r.frequency, lang),
        [et ? "Järgmine maksekuupäev" : "Next due date"]: r.next_due_date ?? "",
        [et ? "Algus" : "Start date"]: r.start_date ?? "",
        [et ? "Lõpp" : "End date"]: r.end_date ?? "",
        [et ? "Meeldetuletus (päeva enne)" : "Reminder (days before)"]: r.reminder_days_before ?? "",
        [et ? "Märkused" : "Notes"]: r.notes ?? "",
        [et ? "Lepingu fail" : "Contract file"]: r.contract_file_name ?? "",
      }));
    case "recurring_payment_instances":
      return rows.map((r) => ({
        [et ? "Maksekuupäev" : "Due date"]: r.due_date ?? "",
        [et ? "Summa" : "Amount"]: fmtAmount(r.amount),
        [et ? "Valuuta" : "Currency"]: r.currency ?? "",
        [et ? "Staatus" : "Status"]: tStatus(r.status, lang),
        [et ? "Makstud" : "Paid at"]: r.paid_at ?? "",
        [et ? "Märkused" : "Notes"]: r.notes ?? "",
        [et ? "Tšekk" : "Receipt"]: r.receipt_file_name ?? "",
        [et ? "Arve" : "Invoice"]: r.invoice_file_name ?? "",
      }));
  }
}

async function rowsToXlsxBytes(
  rows: Array<Record<string, unknown>>,
  sheetName: string,
): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const flat = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) out[k] = "";
      else if (typeof v === "object") out[k] = JSON.stringify(v);
      else out[k] = v;
    }
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(flat);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Andmed");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(buf);
}

async function writeCategoryBackup(params: {
  userId: string;
  profileId: string;
  supabase: import("@supabase/supabase-js").SupabaseClient;
  accessToken: string;
  rootId: string;
  subfolders: Record<string, string>;
  category: BackupCategory;
  lang: BackupLang;
  format: BackupFormat;
}): Promise<{ count: number; excel: BackupPartResult; pdf: BackupPartResult }> {
  const { ensureSubfolderId, upsertBytesInFolder, deleteFilesByNameInFolder } =
    await import("./google-drive.server");
  const { data, error } = await params.supabase
    .from(params.category)
    .select("*")
    .eq("user_id", params.userId)
    .eq("profile_id", params.profileId);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const folderName = CATEGORY_TO_FOLDER[params.category];
  const parentId = await ensureSubfolderId({
    userId: params.userId,
    connectionId: params.connectionId,
    accessToken: params.accessToken,
    rootId: params.rootId,
    subfolders: params.subfolders,
    name: folderName,
  });
  const projected = projectRows(params.category, rows, params.lang);
  const sheetName = params.lang === "et" ? folderName : (CATEGORY_XLSX_NAME.en[params.category].replace(/\.xlsx$/, ""));

  const wantExcel = params.format !== "pdf_only";
  const wantPdf = params.format !== "excel_only";
  const xlsxName = CATEGORY_XLSX_NAME[params.lang][params.category];
  const pdfName = CATEGORY_PDF_NAME[params.lang][params.category];
  const excel: BackupPartResult = { requested: wantExcel, success: !wantExcel, errors: [] };
  const pdf: BackupPartResult = { requested: wantPdf, success: !wantPdf, errors: [] };

  if (wantExcel) {
    try {
      const bytes = await rowsToXlsxBytes(projected, sheetName);
      await upsertBytesInFolder({
        accessToken: params.accessToken,
        parentId,
        name: xlsxName,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      });
      excel.success = true;
    } catch (error) {
      const message = `${params.category}: ${errorMessage(error)}`;
      console.error(`[backup-excel] ${message}`);
      excel.errors.push(message);
    }
  } else {
    // Formaat on pdf_only — eemalda vana Exceli fail, kui on.
    await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId, name: xlsxName });
  }

  if (wantPdf) {
    try {
      const { renderBackupPdf } = await import("./google-drive-pdf.server");
      const columns = projected.length > 0 ? Object.keys(projected[0]) : [];
      const summary = buildCategorySummary(params.category, rows, params.lang);
      const bytes = await renderBackupPdf({
        title: sheetName,
        columns,
        rows: projected,
        summary,
        lang: params.lang,
      });
      await upsertBytesInFolder({
        accessToken: params.accessToken,
        parentId,
        name: pdfName,
        mime: "application/pdf",
        bytes,
      });
    } catch (e) {
      console.error(`[backup-pdf] ${params.category} failed`, e);
      pdf.errors.push(`${params.category}: ${errorMessage(e)}`);
    }
    pdf.success = pdf.errors.length === 0;
  } else {
    // Formaat on excel_only — eemalda vana PDF fail, kui on.
    await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId, name: pdfName });
  }

  // Legacy cleanup: remove technical entries.json + xlsx from the other language.
  const otherLang: BackupLang = params.lang === "et" ? "en" : "et";
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId, name: "entries.json" });
  await deleteFilesByNameInFolder({
    accessToken: params.accessToken,
    parentId,
    name: CATEGORY_XLSX_NAME[otherLang][params.category],
  });
  await deleteFilesByNameInFolder({
    accessToken: params.accessToken,
    parentId,
    name: CATEGORY_PDF_NAME[otherLang][params.category],
  });
  return { count: rows.length, excel, pdf };
}

function buildCategorySummary(
  category: BackupCategory,
  rows: Array<Record<string, unknown>>,
  lang: BackupLang,
): Array<{ label: string; value: string | number }> {
  const et = lang === "et";
  const total = rows.length;
  const summary: Array<{ label: string; value: string | number }> = [
    { label: et ? "Kirjeid kokku" : "Total entries", value: total },
  ];
  if (category === "expenses") {
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      const amt = Number(r.amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      if (String(r.type ?? "").toLowerCase() === "income") income += amt;
      else expense += amt;
    }
    summary.push({ label: et ? "Tulud kokku" : "Total income", value: income.toFixed(2) });
    summary.push({ label: et ? "Kulud kokku" : "Total expenses", value: expense.toFixed(2) });
    summary.push({ label: et ? "Saldo" : "Balance", value: (income - expense).toFixed(2) });
  }
  return summary;
}

async function writeBackupInfo(params: {
  accessToken: string;
  rootId: string;
  totals: { entries: number; files: number };
  lang: BackupLang;
  format: BackupFormat;
}): Promise<{ excel: BackupPartResult; pdf: BackupPartResult }> {
  const { upsertBytesInFolder, deleteFilesByNameInFolder } = await import("./google-drive.server");
  const et = params.lang === "et";
  const keyLabel = et ? "Väli" : "Field";
  const valLabel = et ? "Väärtus" : "Value";
  const info = [
    { [keyLabel]: et ? "Viimane varundus" : "Last backup", [valLabel]: new Date().toLocaleString(et ? "et-EE" : "en-GB") },
    { [keyLabel]: et ? "Kirjeid kokku" : "Total entries", [valLabel]: params.totals.entries },
    { [keyLabel]: et ? "Faile kokku" : "Total files", [valLabel]: params.totals.files },
    { [keyLabel]: et ? "Varunduse versioon" : "Backup version", [valLabel]: 1 },
    { [keyLabel]: et ? "Rakenduse versioon" : "App version", [valLabel]: "1.0.0" },
    { [keyLabel]: et ? "Varunduse formaat" : "Backup format", [valLabel]: params.format },
  ];
  const sheetName = et ? "Varunduse info" : "Backup info";
  const fileName = et ? "Varunduse info.xlsx" : "Backup info.xlsx";
  const otherName = et ? "Backup info.xlsx" : "Varunduse info.xlsx";
  const pdfName = et ? "Varunduse info.pdf" : "Backup info.pdf";
  const otherPdfName = et ? "Backup info.pdf" : "Varunduse info.pdf";

  const wantExcel = params.format !== "pdf_only";
  const wantPdf = params.format !== "excel_only";
  const excel: BackupPartResult = { requested: wantExcel, success: !wantExcel, errors: [] };
  const pdf: BackupPartResult = { requested: wantPdf, success: !wantPdf, errors: [] };

  if (wantExcel) {
    try {
      const bytes = await rowsToXlsxBytes(info, sheetName);
      await upsertBytesInFolder({
        accessToken: params.accessToken,
        parentId: params.rootId,
        name: fileName,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
      });
      excel.success = true;
    } catch (error) {
      const message = `backup-info: ${errorMessage(error)}`;
      console.error(`[backup-excel] ${message}`);
      excel.errors.push(message);
    }
  } else {
    await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: fileName });
  }
  if (wantPdf) {
    try {
      const { renderBackupPdf } = await import("./google-drive-pdf.server");
      const columns = info.length > 0 ? Object.keys(info[0]) : [];
      const bytes = await renderBackupPdf({
        title: sheetName,
        columns,
        rows: info,
        lang: params.lang,
      });
      await upsertBytesInFolder({
        accessToken: params.accessToken,
        parentId: params.rootId,
        name: pdfName,
        mime: "application/pdf",
        bytes,
      });
    } catch (e) {
      console.error("[backup-pdf] backup-info failed", e);
      pdf.errors.push(`backup-info: ${errorMessage(e)}`);
    }
    pdf.success = pdf.errors.length === 0;
  } else {
    await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: pdfName });
  }

  // Legacy + other-language cleanup at root.
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: "backup-info.json" });
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: otherName });
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: otherPdfName });
  return { excel, pdf };
}

async function countFilesForProfile(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  profileId: string,
): Promise<number> {
  let total = 0;
  const tables: Array<{ table: BackupCategory; cols: string[] }> = [
    { table: "warranties", cols: ["file_path"] },
    { table: "expenses", cols: ["file_path"] },
    { table: "agreements", cols: ["file_path"] },
    { table: "recurring_payment_instances", cols: ["receipt_file_path", "invoice_file_path"] },
  ];
  for (const t of tables) {
    const { data, error } = await supabase
      .from(t.table)
      .select(t.cols.join(","))
      .eq("user_id", userId)
      .eq("profile_id", profileId);
    if (error) throw error;
    for (const row of ((data ?? []) as unknown) as Array<Record<string, unknown>>) {
      for (const c of t.cols) if (row[c]) total++;
    }
  }
  return total;
}

async function totalEntriesForProfile(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  profileId: string,
): Promise<number> {
  let total = 0;
  for (const c of ALL_CATEGORIES) {
    const { count, error } = await supabase
      .from(c)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("profile_id", profileId);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

/**
 * Sync one category's entries.json to Google Drive, then refresh backup-info.json.
 * Best-effort: silently skips when the user has no Drive connection.
 */
export const syncBackupCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { category: BackupCategory; lang?: BackupLang; profileId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    if (!data.profileId) return { skipped: true as const, reason: "profile_required" as const };
    const { resolveProfileDriveTarget } = await import("./google-drive.server");
    const conn = await resolveProfileDriveTarget(context.userId, data.profileId);
    if (!conn) return { skipped: true as const, reason: "not_connected" };
    const lang: BackupLang = data.lang === "en" ? "en" : "et";
    const format = await resolveConnectionBackupFormat(conn.connectionId);
    const categoryResult = await writeCategoryBackup({
      userId: context.userId,
      profileId: data.profileId,
      supabase: context.supabase,
      accessToken: conn.accessToken,
      rootId: conn.rootId,
      subfolders: conn.subfolders,
      category: data.category,
      lang,
      format,
    });
    const entries = await totalEntriesForProfile(context.supabase, context.userId, data.profileId);
    const files = await countFilesForProfile(context.supabase, context.userId, data.profileId);
    const infoResult = await writeBackupInfo({ accessToken: conn.accessToken, rootId: conn.rootId, totals: { entries, files }, lang, format });
    const errors = [...categoryResult.excel.errors, ...categoryResult.pdf.errors, ...infoResult.excel.errors, ...infoResult.pdf.errors];
    return { ok: errors.length === 0, errors, excel: categoryResult.excel, pdf: categoryResult.pdf };
  });

async function syncAllOriginalFiles(params: {
  userId: string;
  profileId: string;
  accessToken: string;
  subfolders: Record<string, string>;
  connectionId: string;
}): Promise<OriginalFilesResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { uploadBytesToDriveFolder, findOrCreateFolder } = await import("./google-drive.server");
  const admin = supabaseAdmin as unknown as { from: (table: string) => any };
  const result: OriginalFilesResult = { scanned: 0, uploaded: 0, alreadySynced: 0, failed: 0, errors: [] };

  async function uploadRow(opts: {
    table: string;
    row: Record<string, unknown>;
    pathCol: string;
    idCol: string;
    nameCol: string;
    mimeCol: string;
    parentId: string;
  }) {
    const path = opts.row[opts.pathCol] as string | null;
    if (!path) return;
    result.scanned++;
    if (opts.row[opts.idCol]) { result.alreadySynced++; return; }
    if (!path.startsWith(`${params.userId}/`)) {
      result.failed++;
      result.errors.push(`${opts.table}#${String(opts.row.id)}: faili omanik ei klapi profiiliga`);
      return;
    }
    try {
      const download = await supabaseAdmin.storage.from("documents").download(path);
      if (download.error || !download.data) throw download.error ?? new Error("Faili allalaadimine ebaõnnestus");
      const uploaded = await uploadBytesToDriveFolder({
        accessToken: params.accessToken,
        parentId: opts.parentId,
        name: (opts.row[opts.nameCol] as string | null) || path.split("/").pop() || "fail",
        mime: (opts.row[opts.mimeCol] as string | null) || "application/octet-stream",
        bytes: new Uint8Array(await download.data.arrayBuffer()),
      });
      const { error } = await admin.from(opts.table).update({ [opts.idCol]: uploaded.id }).eq("id", opts.row.id);
      if (error) throw error;
      result.uploaded++;
    } catch (error) {
      const message = `${opts.table}#${String(opts.row.id)}: ${errorMessage(error)}`;
      console.error(`[backup-original] ${message}`);
      result.failed++;
      result.errors.push(message);
    }
  }

  const sources = [
    { table: "warranties", fields: "id,file_path,file_name,file_mime,gdrive_file_id", folder: "Garantiid", path: "file_path", id: "gdrive_file_id", name: "file_name", mime: "file_mime" },
    { table: "expenses", fields: "id,file_path,file_name,file_mime,gdrive_file_id", folder: "Tšekid", path: "file_path", id: "gdrive_file_id", name: "file_name", mime: "file_mime" },
    { table: "agreements", fields: "id,file_path,file_name,file_mime,gdrive_file_id", folder: "Lepingud", path: "file_path", id: "gdrive_file_id", name: "file_name", mime: "file_mime" },
    { table: "recurring_payments", fields: "id,contract_file_path,contract_file_name,contract_file_mime,contract_gdrive_file_id", folder: "Püsimaksed", path: "contract_file_path", id: "contract_gdrive_file_id", name: "contract_file_name", mime: "contract_file_mime" },
    { table: "recurring_payment_instances", fields: "id,receipt_file_path,receipt_file_name,receipt_file_mime,receipt_gdrive_file_id", folder: "Tšekid", path: "receipt_file_path", id: "receipt_gdrive_file_id", name: "receipt_file_name", mime: "receipt_file_mime" },
    { table: "recurring_payment_instances", fields: "id,invoice_file_path,invoice_file_name,invoice_file_mime,invoice_gdrive_file_id", folder: "Püsimaksed", path: "invoice_file_path", id: "invoice_gdrive_file_id", name: "invoice_file_name", mime: "invoice_file_mime" },
  ];
  for (const source of sources) {
    const parentId = params.subfolders[source.folder];
    if (!parentId) {
      result.failed++;
      result.errors.push(`${source.table}: Google Drive'i kaust ${source.folder} puudub`);
      continue;
    }
    const { data, error } = await admin
      .from(source.table)
      .select(source.fields)
      .eq("user_id", params.userId)
      .eq("profile_id", params.profileId)
      .not(source.path, "is", null);
    if (error) {
      result.failed++;
      result.errors.push(`${source.table}: ${errorMessage(error)}`);
      continue;
    }
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      await uploadRow({ table: source.table, row, pathCol: source.path, idCol: source.id, nameCol: source.name, mimeCol: source.mime, parentId });
    }
  }

  const { data: agreements, error: agreementError } = await admin
    .from("agreements")
    .select("id,title,gdrive_folder_id")
    .eq("user_id", params.userId)
    .eq("profile_id", params.profileId);
  if (agreementError) {
    result.failed++;
    result.errors.push(`agreement_attachments: ${errorMessage(agreementError)}`);
    return result;
  }
  const agreementRows = (agreements ?? []) as Array<{ id: string; title: string | null; gdrive_folder_id: string | null }>;
  if (agreementRows.length > 0) {
    const { data: attachments, error } = await admin
      .from("agreement_attachments")
      .select("id,agreement_id,file_path,file_name,file_mime,gdrive_file_id")
      .eq("user_id", params.userId)
      .in("agreement_id", agreementRows.map((row) => row.id));
    if (error) {
      result.failed++;
      result.errors.push(`agreement_attachments: ${errorMessage(error)}`);
    } else {
      const root = params.subfolders["Lepingud"];
      const folderCache = new Map<string, string>();
      for (const agreement of agreementRows) if (agreement.gdrive_folder_id) folderCache.set(agreement.id, agreement.gdrive_folder_id);
      for (const row of (attachments ?? []) as Record<string, unknown>[]) {
        const agreement = agreementRows.find((item) => item.id === row.agreement_id);
        if (!agreement || !root) { result.failed++; result.errors.push(`agreement_attachments#${String(row.id)}: lepingu kaust puudub`); continue; }
        let parentId = folderCache.get(agreement.id);
        if (!parentId) {
          const folder = await findOrCreateFolder({ accessToken: params.accessToken, parentId: root, name: sanitizeFolderName(agreement.title || "Leping") });
          parentId = folder.id;
          folderCache.set(agreement.id, parentId);
          await admin.from("agreements").update({ gdrive_folder_id: parentId }).eq("id", agreement.id);
        }
        await uploadRow({ table: "agreement_attachments", row, pathCol: "file_path", idCol: "gdrive_file_id", nameCol: "file_name", mimeCol: "file_mime", parentId });
      }
    }
  }
  return result;
}

/**
 * Full backup — writes every category's entries.json plus backup-info.json.
 */
export const syncBackupAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lang?: BackupLang; profileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { resolveProfileDriveTarget } = await import("./google-drive.server");
    const conn = await resolveProfileDriveTarget(context.userId, data.profileId);
    if (!conn) return { skipped: true as const, reason: "not_connected" };
    const lang: BackupLang = data?.lang === "en" ? "en" : "et";
    const format = await resolveConnectionBackupFormat(conn.connectionId);
    let entries = 0;
    const excel: BackupPartResult = { requested: format !== "pdf_only", success: true, errors: [] };
    const pdf: BackupPartResult = { requested: format !== "excel_only", success: true, errors: [] };
    for (const c of ALL_CATEGORIES) {
      const r = await writeCategoryBackup({
        userId: context.userId,
        profileId: data.profileId,
        supabase: context.supabase,
        accessToken: conn.accessToken,
        rootId: conn.rootId,
        subfolders: conn.subfolders,
        category: c,
        lang,
        format,
      });
      entries += r.count;
      excel.errors.push(...r.excel.errors);
      pdf.errors.push(...r.pdf.errors);
    }
    const files = await countFilesForProfile(context.supabase, context.userId, data.profileId);
    const info = await writeBackupInfo({ accessToken: conn.accessToken, rootId: conn.rootId, totals: { entries, files }, lang, format });
    excel.errors.push(...info.excel.errors);
    pdf.errors.push(...info.pdf.errors);
    excel.success = !excel.requested || excel.errors.length === 0;
    pdf.success = !pdf.requested || pdf.errors.length === 0;
    const originalFiles = await syncAllOriginalFiles({
      userId: context.userId,
      profileId: data.profileId,
      accessToken: conn.accessToken,
      subfolders: conn.subfolders,
      connectionId: conn.connectionId,
    });
    const ok = excel.success && pdf.success && originalFiles.failed === 0;
    return { ok, entries, files, excel, pdf, originalFiles };
  });

async function resolveConnectionBackupFormat(connectionId: string): Promise<BackupFormat> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("google_drive_connections")
    .select("backup_format")
    .eq("id", connectionId)
    .maybeSingle();
  return parseBackupFormat((data as { backup_format?: string } | null)?.backup_format);
}

/**
 * Delete a previously uploaded original file from the user's Drive.
 * Best-effort; used when a record with a synced file is removed.
 */
export const deleteGoogleDriveFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fileId: string; profileId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { resolveProfileDriveTarget, deleteDriveFile } = await import("./google-drive.server");
    const conn = await resolveProfileDriveTarget(context.userId, data.profileId ?? null);
    if (!conn) return { skipped: true as const };
    await deleteDriveFile({ accessToken: conn.accessToken, fileId: data.fileId });
    return { ok: true as const };
  });

// -----------------------------------------------------------------------------
// Multi-attachment sync: mirror all attachments of one agreement to a
// per-agreement subfolder under "Lepingud". Uploads only attachments that
// don't yet have a gdrive_file_id and persists the id back on each row.
// Files are stored in original quality / original format — never merged.
// -----------------------------------------------------------------------------

function sanitizeFolderName(s: string): string {
  const cleaned = (s || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || "Leping";
}

export const syncAgreementAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agreementId: string; profileId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveProfileDriveTarget, findOrCreateFolder, uploadBytesToDriveFolder } =
      await import("./google-drive.server");

    // Load agreement (RLS-scoped).
    const { data: agreement, error: agErr } = await context.supabase
      .from("agreements")
      .select("id, title, user_id")
      .eq("id", data.agreementId)
      .maybeSingle();
    if (agErr) throw agErr;
    if (!agreement || (agreement as { user_id: string }).user_id !== context.userId) {
      throw new Error("Agreement not found");
    }
    // Read cached folder id via admin (bypasses type gaps for new column).
    const { data: extra } = await supabaseAdmin
      .from("agreements")
      .select("gdrive_folder_id, title")
      .eq("id", data.agreementId)
      .maybeSingle();
    const cachedFolderId = (extra as { gdrive_folder_id?: string | null } | null)?.gdrive_folder_id ?? null;

    const conn = await resolveProfileDriveTarget(context.userId, data.profileId ?? null);
    if (!conn) return { skipped: true as const, reason: "not_connected" };
    const lepingudId = conn.subfolders["Lepingud"];
    if (!lepingudId) throw new Error("Missing Drive subfolder: Lepingud");

    // Ensure per-agreement subfolder.
    let folderId = cachedFolderId;
    if (!folderId) {
      const name = sanitizeFolderName((agreement as { title: string }).title || "Leping");
      const f = await findOrCreateFolder({ accessToken: conn.accessToken, name, parentId: lepingudId });
      folderId = f.id;
      await supabaseAdmin.from("agreements").update({ gdrive_folder_id: folderId }).eq("id", data.agreementId);
    }

    // Fetch attachments needing sync.
    const { data: attRaw, error: attErr } = await context.supabase
      .from("agreement_attachments")
      .select("id, file_path, file_name, file_mime, gdrive_file_id")
      .eq("agreement_id", data.agreementId);
    if (attErr) throw attErr;
    const attachments = (attRaw ?? []) as Array<{
      id: string;
      file_path: string;
      file_name: string;
      file_mime: string | null;
      gdrive_file_id: string | null;
    }>;

    let uploaded = 0;
    for (const a of attachments) {
      if (a.gdrive_file_id) continue;
      if (!a.file_path.startsWith(`${context.userId}/`)) continue;
      const dl = await supabaseAdmin.storage.from("documents").download(a.file_path);
      if (dl.error || !dl.data) continue;
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const up = await uploadBytesToDriveFolder({
        accessToken: conn.accessToken,
        parentId: folderId,
        name: a.file_name,
        mime: a.file_mime ?? "application/octet-stream",
        bytes,
      });
      await supabaseAdmin
        .from("agreement_attachments")
        .update({ gdrive_file_id: up.id })
        .eq("id", a.id);
      uploaded++;
    }

    return { ok: true as const, uploaded, folderId };
  });

/**
 * Delete the per-agreement Drive folder (and everything under it).
 * Best-effort — used when an agreement is deleted from the app.
 */
export const deleteAgreementDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { folderId: string; profileId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { resolveProfileDriveTarget, deleteDriveFile } = await import("./google-drive.server");
    const conn = await resolveProfileDriveTarget(context.userId, data.profileId ?? null);
    if (!conn) return { skipped: true as const };
    await deleteDriveFile({ accessToken: conn.accessToken, fileId: data.folderId });
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Bulk-sünkroonimine: leiab profiilis kõik varem lisatud dokumendid, millel
// pole veel Drive'i faili viidet, ja laeb need üles paketikaupa. Kasutaja
// näeb reaalajas edenemisriba (klient kutsub batch-i tsüklis, kuni done=true).
// ---------------------------------------------------------------------------

type BulkSyncCursor = {
  stage:
    | "warranties"
    | "expenses"
    | "agreements"
    | "recurring_payments_contract"
    | "recurring_instances_receipt"
    | "recurring_instances_invoice"
    | "agreement_attachments"
    | "done";
  offset: number;
};

const INITIAL_CURSOR: BulkSyncCursor = { stage: "warranties", offset: 0 };

/** Loenda profiili sünkroonimata failid + kas kalendri jaoks üldse on kirjeid. */
export const getProfilePendingCloudCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const uid = context.userId;
    const pid = data.profileId;

    async function countUnsynced(table: string, pathCol: string, idCol: string): Promise<number> {
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("profile_id", pid)
        .not(pathCol, "is", null)
        .is(idCol, null);
      return (count as number) ?? 0;
    }
    async function countRows(table: string): Promise<number> {
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("profile_id", pid);
      return (count as number) ?? 0;
    }

    async function countAttachmentsUnsynced(): Promise<number> {
      // agreement_attachments has no profile_id column; scope via parent agreement.
      const { data: ags } = await admin
        .from("agreements")
        .select("id")
        .eq("user_id", uid)
        .eq("profile_id", pid);
      const ids = ((ags as { id: string }[] | null) ?? []).map((r) => r.id);
      if (ids.length === 0) return 0;
      const { count } = await admin
        .from("agreement_attachments")
        .select("id", { count: "exact", head: true })
        .in("agreement_id", ids)
        .not("file_path", "is", null)
        .is("gdrive_file_id", null);
      return (count as number) ?? 0;
    }

    const [w, e, a, rpc, ri, ri2, aa] = await Promise.all([
      countUnsynced("warranties", "file_path", "gdrive_file_id"),
      countUnsynced("expenses", "file_path", "gdrive_file_id"),
      countUnsynced("agreements", "file_path", "gdrive_file_id"),
      countUnsynced("recurring_payments", "contract_file_path", "contract_gdrive_file_id"),
      countUnsynced("recurring_payment_instances", "receipt_file_path", "receipt_gdrive_file_id"),
      countUnsynced("recurring_payment_instances", "invoice_file_path", "invoice_gdrive_file_id"),
      countAttachmentsUnsynced(),
    ]);
    const driveUnsynced = w + e + a + rpc + ri + ri2 + aa;

    const [wc, ac, rc] = await Promise.all([
      countRows("warranties"),
      countRows("agreements"),
      countRows("recurring_payments"),
    ]);
    const calendarItems = wc + ac + rc;

    return { driveUnsynced, calendarItems };
  });

/**
 * Sünkrooni üks pakett (kuni ~5 faili) profiili sünkroonimata failidest.
 * Klient kutsub selle korduvalt cursor-iga, kuni tagastatakse done=true.
 */
export const syncDriveExistingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { profileId: string; cursor?: BulkSyncCursor; batchSize?: number }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveProfileDriveTarget, uploadBytesToDriveFolder, findOrCreateFolder, FOLDER_KEY_TO_NAME } =
      await import("./google-drive.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const uid = context.userId;
    const pid = data.profileId;
    const batchSize = Math.max(1, Math.min(10, data.batchSize ?? 5));
    let cursor: BulkSyncCursor = data.cursor ?? INITIAL_CURSOR;

    if (cursor.stage === "done") return { done: true as const, cursor, uploaded: 0, failed: 0, skipped: 0 };

    const conn = await resolveProfileDriveTarget(uid, pid);
    if (!conn) return { done: true as const, cursor: { stage: "done", offset: 0 } as BulkSyncCursor, uploaded: 0, failed: 0, skipped: 0, reason: "not_connected" as const };

    let uploaded = 0;
    let failed = 0;
    let skipped = 0;

    // Helper to process one table stage. Uses offset-based paging so failed
    // rows don't cause infinite loops (a row that failed once will be
    // skipped past on the next batch instead of re-queried forever).
    async function runTable(
      table: string,
      pathCol: string,
      idCol: string,
      folderKey: string,
      nameCol = "file_name",
      mimeCol = "file_mime",
      extraFilter?: (q: any) => any,
    ): Promise<{ stageDone: boolean; consumed: number }> {
      let q = admin
        .from(table)
        .select(`id, ${pathCol}, ${nameCol}, ${mimeCol}`)
        .eq("user_id", uid)
        .eq("profile_id", pid)
        .not(pathCol, "is", null)
        .is(idCol, null)
        .order("created_at", { ascending: true })
        .range(cursor.offset, cursor.offset + batchSize - 1);
      if (extraFilter) q = extraFilter(q);
      const { data: rows } = await q;
      const list = (rows as any[]) ?? [];
      if (list.length === 0) return { stageDone: true, consumed: 0 };
      const folderName = FOLDER_KEY_TO_NAME[folderKey as keyof typeof FOLDER_KEY_TO_NAME];
      const parentId = conn!.subfolders[folderName];
      for (const r of list) {
        if (!parentId) { failed++; continue; }
        const filePath = r[pathCol] as string;
        if (!filePath?.startsWith(`${uid}/`)) { skipped++; continue; }
        try {
          const dl = await supabaseAdmin.storage.from("documents").download(filePath);
          if (dl.error || !dl.data) { failed++; continue; }
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          const up = await uploadBytesToDriveFolder({
            accessToken: conn!.accessToken,
            parentId,
            name: (r[nameCol] as string) || filePath.split("/").pop() || "fail",
            mime: (r[mimeCol] as string) || "application/octet-stream",
            bytes,
          });
          await admin.from(table).update({ [idCol]: up.id }).eq("id", r.id);
          uploaded++;
        } catch (e) {
          console.error(`[bulk-sync] ${table}#${r.id} failed`, e);
          failed++;
        }
      }
      // Advance past whatever we saw. Successful uploads clear the filter for
      // future queries; failed rows stay past the offset so we skip them.
      return { stageDone: list.length < batchSize, consumed: list.length };
    }

    // agreement_attachments has no profile_id column; scope through agreements.
    async function runAgreementAttachments(): Promise<{ stageDone: boolean; consumed: number }> {
      const { data: ags } = await admin
        .from("agreements")
        .select("id, title, gdrive_folder_id")
        .eq("user_id", uid)
        .eq("profile_id", pid);
      const agreementList = ((ags as { id: string; title: string | null; gdrive_folder_id: string | null }[] | null) ?? []);
      if (agreementList.length === 0) return { stageDone: true, consumed: 0 };
      const agreementIds = agreementList.map((a) => a.id);
      const { data: rows } = await admin
        .from("agreement_attachments")
        .select("id, agreement_id, file_path, file_name, file_mime")
        .in("agreement_id", agreementIds)
        .not("file_path", "is", null)
        .is("gdrive_file_id", null)
        .order("created_at", { ascending: true })
        .range(cursor.offset, cursor.offset + batchSize - 1);
      const list = (rows as any[]) ?? [];
      if (list.length === 0) return { stageDone: true, consumed: 0 };
      const lepingudId = conn!.subfolders["Lepingud"];
      // Per-agreement subfolder cache within this batch.
      const folderCache = new Map<string, string>();
      for (const a of agreementList) if (a.gdrive_folder_id) folderCache.set(a.id, a.gdrive_folder_id);
      for (const r of list) {
        if (!lepingudId) { failed++; continue; }
        const filePath = r.file_path as string;
        if (!filePath?.startsWith(`${uid}/`)) { skipped++; continue; }
        try {
          let folderId = folderCache.get(r.agreement_id);
          if (!folderId) {
            const parent = agreementList.find((a) => a.id === r.agreement_id);
            const rawTitle = parent?.title || "Leping";
            const name = (rawTitle.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim() || "Leping").slice(0, 80);
            const f = await findOrCreateFolder({ accessToken: conn!.accessToken, name, parentId: lepingudId });
            folderId = f.id;
            folderCache.set(r.agreement_id, folderId);
            await admin.from("agreements").update({ gdrive_folder_id: folderId }).eq("id", r.agreement_id);
          }
          const dl = await supabaseAdmin.storage.from("documents").download(filePath);
          if (dl.error || !dl.data) { failed++; continue; }
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          const up = await uploadBytesToDriveFolder({
            accessToken: conn!.accessToken,
            parentId: folderId,
            name: (r.file_name as string) || filePath.split("/").pop() || "fail",
            mime: (r.file_mime as string) || "application/octet-stream",
            bytes,
          });
          await admin.from("agreement_attachments").update({ gdrive_file_id: up.id }).eq("id", r.id);
          uploaded++;
        } catch (e) {
          console.error(`[bulk-sync] agreement_attachments#${r.id} failed`, e);
          failed++;
        }
      }
      return { stageDone: list.length < batchSize, consumed: list.length };
    }

    const stageOrder: BulkSyncCursor["stage"][] = [
      "warranties",
      "expenses",
      "agreements",
      "recurring_payments_contract",
      "recurring_instances_receipt",
      "recurring_instances_invoice",
      "agreement_attachments",
      "done",
    ];
    let result: { stageDone: boolean; consumed: number } = { stageDone: true, consumed: 0 };
    switch (cursor.stage) {
      case "warranties":
        result = await runTable("warranties", "file_path", "gdrive_file_id", "warranty");
        break;
      case "expenses":
        result = await runTable("expenses", "file_path", "gdrive_file_id", "expense");
        break;
      case "agreements":
        result = await runTable("agreements", "file_path", "gdrive_file_id", "agreement");
        break;
      case "recurring_payments_contract":
        result = await runTable(
          "recurring_payments",
          "contract_file_path",
          "contract_gdrive_file_id",
          "recurring",
          "contract_file_name",
          "contract_file_mime",
        );
        break;
      case "recurring_instances_receipt":
        result = await runTable(
          "recurring_payment_instances",
          "receipt_file_path",
          "receipt_gdrive_file_id",
          "receipt",
          "receipt_file_name",
          "receipt_file_mime",
        );
        break;
      case "recurring_instances_invoice":
        result = await runTable(
          "recurring_payment_instances",
          "invoice_file_path",
          "invoice_gdrive_file_id",
          "invoice",
          "invoice_file_name",
          "invoice_file_mime",
        );
        break;
      case "agreement_attachments":
        result = await runAgreementAttachments();
        break;
    }
    if (result.stageDone) {
      const idx = stageOrder.indexOf(cursor.stage);
      const next = stageOrder[Math.min(idx + 1, stageOrder.length - 1)] ?? "done";
      cursor = { stage: next, offset: 0 };
    } else {
      // Advance offset past all rows we saw (successes vanish from the filter;
      // failures stay behind the offset and are not retried this run).
      cursor = { stage: cursor.stage, offset: cursor.offset + result.consumed };
    }

    return { done: cursor.stage === "done", cursor, uploaded, failed, skipped };
  });
