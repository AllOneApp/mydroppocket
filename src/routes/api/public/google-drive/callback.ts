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
            ensureMyDropPocketStructure,
            GOOGLE_OAUTH_CALLBACK_PATH,
          } = await import("@/lib/google-drive.server");

          const state = verifyState(stateParam);
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

          const folders = await ensureMyDropPocketStructure(tokens.access_token);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          const { error } = await supabaseAdmin.from("google_drive_connections").upsert(
            {
              user_id: state.userId,
              google_email: email,
              google_sub: sub,
              access_token_ciphertext: encryptToken(tokens.access_token),
              refresh_token_ciphertext: encryptToken(tokens.refresh_token),
              access_token_expires_at: expiresAt,
              scope: tokens.scope,
              root_folder_id: folders.rootId,
              root_folder_name: folders.rootName,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          if (error) throw error;

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