import { createFileRoute } from "@tanstack/react-router";

/**
 * Google Calendar OAuth callback. Public route (Google redirects here).
 * Uses the same underlying OAuth client as Google Drive but stores tokens in
 * a separate google_calendar_connections row, so the two integrations are
 * independent.
 */
function renderResult(opts: {
  origin: string;
  ok: boolean;
  email?: string;
  error?: string;
}): Response {
  const payload = JSON.stringify({
    type: "mydroppocket:google-calendar:oauth",
    ok: opts.ok,
    email: opts.email ?? null,
    error: opts.error ?? null,
  });
  const targetOrigin = JSON.stringify(opts.origin);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;padding:24px;color:#111}</style>
</head><body>
<p>${opts.ok ? "Google Calendar ühendatud. Võid selle akna sulgeda." : "Ühendus ebaõnnestus: " + (opts.error ?? "tundmatu viga")}</p>
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

export const Route = createFileRoute("/api/public/google-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const stateParam = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        const currentOrigin = url.origin;

        if (errorParam) return renderResult({ origin: currentOrigin, ok: false, error: errorParam });
        if (!code || !stateParam) {
          return renderResult({ origin: currentOrigin, ok: false, error: "Missing code or state" });
        }

        try {
          const {
            verifyCalendarState,
            exchangeCodeForTokens,
            decodeIdToken,
            ensureMyDropPocketCalendar,
            GOOGLE_CALENDAR_CALLBACK_PATH,
            MY_DROPPOCKET_CALENDAR_NAME,
          } = await import("@/lib/google-calendar.server");
          const { encryptToken } = await import("@/lib/google-drive.server");

          const state = verifyCalendarState(stateParam);
          const redirectUri = `${state.origin}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
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

          const calendarId = await ensureMyDropPocketCalendar(
            tokens.access_token,
            MY_DROPPOCKET_CALENDAR_NAME,
          );

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          const db = supabaseAdmin as unknown as { from: (t: string) => any };
          const profileId = state.profileId ?? null;
          // Upsert: onConflict differs by profile scope because uniqueness is a
          // partial index (user_id where profile_id IS NULL, or user_id+profile_id).
          // Do a manual find-or-insert to avoid dealing with partial-index conflict targets.
          let existQ = db
            .from("google_calendar_connections")
            .select("id")
            .eq("user_id", state.userId);
          if (profileId) existQ = existQ.eq("profile_id", profileId);
          else existQ = existQ.is("profile_id", null);
          const { data: existing } = await existQ.maybeSingle();
          const payload: Record<string, unknown> = {
            user_id: state.userId,
            profile_id: profileId,
            google_email: email,
            google_sub: sub,
            access_token_ciphertext: encryptToken(tokens.access_token),
            refresh_token_ciphertext: encryptToken(tokens.refresh_token),
            access_token_expires_at: expiresAt,
            scope: tokens.scope,
            calendar_id: calendarId,
            calendar_name: MY_DROPPOCKET_CALENDAR_NAME,
            updated_at: new Date().toISOString(),
          };
          const { error } = existing
            ? await db
                .from("google_calendar_connections")
                .update(payload)
                .eq("id", (existing as { id: string }).id)
            : await db.from("google_calendar_connections").insert(payload);
          if (error) throw error;

          return renderResult({ origin: state.origin, ok: true, email });
        } catch (e) {
          console.error("Google Calendar OAuth callback error", e);
          const message = e instanceof Error ? e.message : "Unknown error";
          return renderResult({ origin: currentOrigin, ok: false, error: message });
        }
      },
    },
  },
});