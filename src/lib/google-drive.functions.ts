import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .inputValidator((input: { origin: string }) => input)
  .handler(async ({ data, context }) => {
    const { buildAuthorizationUrl, signState, GOOGLE_OAUTH_CALLBACK_PATH } = await import("./google-drive.server");
    // Use the browser's current origin so the redirect returns to the same host
    // that opened the popup (preview / staging / prod / custom domain).
    const origin = new URL(data.origin).origin;
    const redirectUri = `${origin}${GOOGLE_OAUTH_CALLBACK_PATH}`;
    const state = signState({ userId: context.userId, origin });
    const authorizationUrl = buildAuthorizationUrl({ redirectUri, state });
    return { authorizationUrl };
  });

export const getGoogleDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("google_drive_connections")
      .select("google_email, root_folder_id, root_folder_name, connected_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { connected: false as const };
    return {
      connected: true as const,
      email: data.google_email,
      folderId: data.root_folder_id,
      folderName: data.root_folder_name,
      connectedAt: data.connected_at,
    };
  });

export const disconnectGoogleDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Best-effort token revoke.
    const { data: row } = await supabaseAdmin
      .from("google_drive_connections")
      .select("refresh_token_ciphertext")
      .eq("user_id", context.userId)
      .maybeSingle();
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
    await supabaseAdmin.from("google_drive_connections").delete().eq("user_id", context.userId);
    return { ok: true };
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
    const { getValidAccessTokenForUser, uploadBytesToDriveFolder, FOLDER_KEY_TO_NAME } =
      await import("./google-drive.server");

    // Verify the record belongs to this user (RLS-scoped client).
    const { data: ownRow, error: ownErr } = await context.supabase
      .from(data.table)
      .select("id, user_id")
      .eq("id", data.recordId)
      .maybeSingle();
    if (ownErr) throw ownErr;
    if (!ownRow || (ownRow as { user_id: string }).user_id !== context.userId) {
      throw new Error("Record not found");
    }

    const conn = await getValidAccessTokenForUser(context.userId);
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

async function writeCategoryXlsx(params: {
  userId: string;
  supabase: import("@supabase/supabase-js").SupabaseClient;
  accessToken: string;
  rootId: string;
  subfolders: Record<string, string>;
  category: BackupCategory;
  lang: BackupLang;
}): Promise<{ count: number }> {
  const { ensureSubfolderId, upsertBytesInFolder, deleteFilesByNameInFolder } =
    await import("./google-drive.server");
  const { data, error } = await params.supabase
    .from(params.category)
    .select("*")
    .eq("user_id", params.userId);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const folderName = CATEGORY_TO_FOLDER[params.category];
  const parentId = await ensureSubfolderId({
    userId: params.userId,
    accessToken: params.accessToken,
    rootId: params.rootId,
    subfolders: params.subfolders,
    name: folderName,
  });
  const projected = projectRows(params.category, rows, params.lang);
  const sheetName = params.lang === "et" ? folderName : (CATEGORY_XLSX_NAME.en[params.category].replace(/\.xlsx$/, ""));
  const bytes = await rowsToXlsxBytes(projected, sheetName);
  await upsertBytesInFolder({
    accessToken: params.accessToken,
    parentId,
    name: CATEGORY_XLSX_NAME[params.lang][params.category],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
  });
  // Legacy cleanup: remove technical entries.json + xlsx from the other language.
  const otherLang: BackupLang = params.lang === "et" ? "en" : "et";
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId, name: "entries.json" });
  await deleteFilesByNameInFolder({
    accessToken: params.accessToken,
    parentId,
    name: CATEGORY_XLSX_NAME[otherLang][params.category],
  });
  return { count: rows.length };
}

async function writeBackupInfo(params: {
  accessToken: string;
  rootId: string;
  totals: { entries: number; files: number };
  lang: BackupLang;
}) {
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
  ];
  const sheetName = et ? "Varunduse info" : "Backup info";
  const bytes = await rowsToXlsxBytes(info, sheetName);
  const fileName = et ? "Varunduse info.xlsx" : "Backup info.xlsx";
  const otherName = et ? "Backup info.xlsx" : "Varunduse info.xlsx";
  await upsertBytesInFolder({
    accessToken: params.accessToken,
    parentId: params.rootId,
    name: fileName,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
  });
  // Legacy + other-language cleanup at root.
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: "backup-info.json" });
  await deleteFilesByNameInFolder({ accessToken: params.accessToken, parentId: params.rootId, name: otherName });
}

async function countFilesForUser(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<number> {
  let total = 0;
  const tables: Array<{ table: BackupCategory; cols: string[] }> = [
    { table: "warranties", cols: ["file_path"] },
    { table: "expenses", cols: ["file_path"] },
    { table: "agreements", cols: ["file_path"] },
    { table: "recurring_payment_instances", cols: ["receipt_file_path", "invoice_file_path"] },
  ];
  for (const t of tables) {
    const { data, error } = await supabase.from(t.table).select(t.cols.join(",")).eq("user_id", userId);
    if (error) throw error;
    for (const row of ((data ?? []) as unknown) as Array<Record<string, unknown>>) {
      for (const c of t.cols) if (row[c]) total++;
    }
  }
  return total;
}

async function totalEntriesForUser(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<number> {
  let total = 0;
  for (const c of ALL_CATEGORIES) {
    const { count, error } = await supabase
      .from(c)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
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
  .inputValidator((input: { category: BackupCategory; lang?: BackupLang }) => input)
  .handler(async ({ data, context }) => {
    const { getValidAccessTokenForUser } = await import("./google-drive.server");
    const conn = await getValidAccessTokenForUser(context.userId);
    if (!conn) return { skipped: true as const, reason: "not_connected" };
    const lang: BackupLang = data.lang === "en" ? "en" : "et";
    await writeCategoryXlsx({
      userId: context.userId,
      supabase: context.supabase,
      accessToken: conn.accessToken,
      rootId: conn.rootId,
      subfolders: conn.subfolders,
      category: data.category,
      lang,
    });
    const entries = await totalEntriesForUser(context.supabase, context.userId);
    const files = await countFilesForUser(context.supabase, context.userId);
    await writeBackupInfo({ accessToken: conn.accessToken, rootId: conn.rootId, totals: { entries, files }, lang });
    return { ok: true as const };
  });

/**
 * Full backup — writes every category's entries.json plus backup-info.json.
 */
export const syncBackupAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { lang?: BackupLang }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { getValidAccessTokenForUser } = await import("./google-drive.server");
    const conn = await getValidAccessTokenForUser(context.userId);
    if (!conn) return { skipped: true as const, reason: "not_connected" };
    const lang: BackupLang = data?.lang === "en" ? "en" : "et";
    let entries = 0;
    for (const c of ALL_CATEGORIES) {
      const r = await writeCategoryXlsx({
        userId: context.userId,
        supabase: context.supabase,
        accessToken: conn.accessToken,
        rootId: conn.rootId,
        subfolders: conn.subfolders,
        category: c,
        lang,
      });
      entries += r.count;
    }
    const files = await countFilesForUser(context.supabase, context.userId);
    await writeBackupInfo({ accessToken: conn.accessToken, rootId: conn.rootId, totals: { entries, files }, lang });
    return { ok: true as const, entries, files };
  });

/**
 * Delete a previously uploaded original file from the user's Drive.
 * Best-effort; used when a record with a synced file is removed.
 */
export const deleteGoogleDriveFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fileId: string }) => input)
  .handler(async ({ data, context }) => {
    const { getValidAccessTokenForUser, deleteDriveFile } = await import("./google-drive.server");
    const conn = await getValidAccessTokenForUser(context.userId);
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
  .inputValidator((input: { agreementId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getValidAccessTokenForUser, findOrCreateFolder, uploadBytesToDriveFolder } =
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

    const conn = await getValidAccessTokenForUser(context.userId);
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
  .inputValidator((input: { folderId: string }) => input)
  .handler(async ({ data, context }) => {
    const { getValidAccessTokenForUser, deleteDriveFile } = await import("./google-drive.server");
    const conn = await getValidAccessTokenForUser(context.userId);
    if (!conn) return { skipped: true as const };
    await deleteDriveFile({ accessToken: conn.accessToken, fileId: data.folderId });
    return { ok: true as const };
  });