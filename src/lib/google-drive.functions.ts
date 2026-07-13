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