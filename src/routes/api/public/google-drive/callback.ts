import { createFileRoute } from "@tanstack/react-router";

/**
 * Google OAuth callback. Public route (Google redirects here — no bearer token).
 * Verifies the signed state to identify the app user, exchanges the code for
 * tokens, creates the MyDropPocket folder tree, persists encrypted tokens,
 * then renders a small HTML page that postMessages the opener and closes.
 */
function renderResult(opts: {
  origin: string;
  ok: boolean;
  email?: string;
  error?: string;
}): Response {
  const payload = JSON.stringify({
    type: "mydroppocket:google-drive:oauth",
    ok: opts.ok,
    email: opts.email ?? null,
    error: opts.error ?? null,
  });
  const targetOrigin = JSON.stringify(opts.origin);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Google Drive</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;padding:24px;color:#111}</style>
</head><body>
<p>${opts.ok ? "Google Drive ühendatud. Võid selle akna sulgeda." : "Ühendus ebaõnnestus: " + (opts.error ?? "tundmatu viga")}</p>
<script>
(function(){
  try {
    if (window.opener) {
      window.opener.postMessage(${payload}, ${targetOrigin});
    }
  } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch(e){} }, 400);
})();
</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/google-drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const stateParam = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        const currentOrigin = url.origin;

        if (errorParam) {
          return renderResult({ origin: currentOrigin, ok: false, error: errorParam });
        }
        if (!code || !stateParam) {
          return renderResult({ origin: currentOrigin, ok: false, error: "Missing code or state" });
        }

        try {
          const {
            verifyState,
            exchangeCodeForTokens,
            decodeIdToken,
            encryptToken,
            findOrCreateFolder,
            GOOGLE_OAUTH_CALLBACK_PATH,
          } = await import("@/lib/google-drive.server");

          const state = verifyState(stateParam);
          if (!state.profileId) {
            return renderResult({
              origin: state.origin,
              ok: false,
              error: "Google Drive ühendus peab olema seotud profiiliga. Alusta ühendamist uuesti.",
            });
          }
          const redirectUri = `${state.origin}${GOOGLE_OAUTH_CALLBACK_PATH}`;
          const tokens = await exchangeCodeForTokens({ code, redirectUri });
          if (!tokens.refresh_token) {
            return renderResult({
              origin: state.origin,
              ok: false,
              error: "Google ei tagastanud refresh tokenit. Proovi uuesti ja anna kõik load.",
            });
          }
          const identity = tokens.id_token ? decodeIdToken(tokens.id_token) : {};
          const email = identity.email ?? "unknown";
          const sub = identity.sub ?? "unknown";

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: profile, error: profileError } = await supabaseAdmin
            .from("user_profiles")
            .select("id, name, is_default")
            .eq("id", state.profileId)
            .eq("user_id", state.userId)
            .maybeSingle();
          if (profileError) throw profileError;
          if (!profile) throw new Error("Profiili ei leitud");
          const profileRow = profile as { id: string; name: string; is_default: boolean };
          const rootName = profileRow.is_default ? "MyDropPocket" : `MyDropPocket – ${profileRow.name}`;
          const root = await findOrCreateFolder({ accessToken: tokens.access_token, name: rootName });
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

          const { data: previous } = await supabaseAdmin
            .from("google_drive_connections")
            .select("google_sub, root_folder_id, backup_format")
            .eq("user_id", state.userId)
            .eq("profile_id", state.profileId)
            .maybeSingle();
          const previousRow = previous as { google_sub: string; root_folder_id: string | null; backup_format?: string } | null;
          const accountChanged = !!previousRow && (previousRow.google_sub !== sub || previousRow.root_folder_id !== root.id);

          // Kustuta olemasolev sama (user_id, profile_id) rida — unikaalsed indeksid on osalised, mistõttu onConflict pole stabiilne.
          let deleteQ = supabaseAdmin
            .from("google_drive_connections")
            .delete()
            .eq("user_id", state.userId);
          if (state.profileId) deleteQ = deleteQ.eq("profile_id", state.profileId);
          else deleteQ = deleteQ.is("profile_id", null);
          await deleteQ;

          const { error } = await supabaseAdmin.from("google_drive_connections").insert({
            user_id: state.userId,
            profile_id: state.profileId,
            google_email: email,
            google_sub: sub,
            access_token_ciphertext: encryptToken(tokens.access_token),
            refresh_token_ciphertext: encryptToken(tokens.refresh_token),
            access_token_expires_at: expiresAt,
            scope: tokens.scope,
            root_folder_id: root.id,
            root_folder_name: root.name,
            backup_format: previousRow?.backup_format ?? "excel_pdf",
            subfolders_json: null,
            updated_at: new Date().toISOString(),
          });
          if (error) throw error;

          if (accountChanged) {
            const tables = ["warranties", "expenses", "agreements"] as const;
            for (const table of tables) {
              await supabaseAdmin
                .from(table)
                .update({ gdrive_file_id: null, ...(table === "agreements" ? { gdrive_folder_id: null } : {}) })
                .eq("user_id", state.userId)
                .eq("profile_id", state.profileId);
            }
            await supabaseAdmin
              .from("recurring_payments")
              .update({ contract_gdrive_file_id: null })
              .eq("user_id", state.userId)
              .eq("profile_id", state.profileId);
            await supabaseAdmin
              .from("recurring_payment_instances")
              .update({ receipt_gdrive_file_id: null, invoice_gdrive_file_id: null })
              .eq("user_id", state.userId)
              .eq("profile_id", state.profileId);
            const { data: agreements } = await supabaseAdmin
              .from("agreements")
              .select("id")
              .eq("user_id", state.userId)
              .eq("profile_id", state.profileId);
            const agreementIds = ((agreements ?? []) as Array<{ id: string }>).map((row) => row.id);
            if (agreementIds.length > 0) {
              await supabaseAdmin
                .from("agreement_attachments")
                .update({ gdrive_file_id: null })
                .eq("user_id", state.userId)
                .in("agreement_id", agreementIds);
            }
          }

          return renderResult({ origin: state.origin, ok: true, email });
        } catch (e) {
          console.error("Google Drive OAuth callback error", e);
          const message = e instanceof Error ? e.message : "Unknown error";
          return renderResult({ origin: currentOrigin, ok: false, error: message });
        }
      },
    },
  },
});