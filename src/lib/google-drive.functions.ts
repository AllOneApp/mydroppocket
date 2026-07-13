import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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