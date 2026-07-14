import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string }) => input)
  .handler(async ({ data, context }) => {
    const {
      buildCalendarAuthorizationUrl,
      signCalendarState,
      GOOGLE_CALENDAR_CALLBACK_PATH,
    } = await import("./google-calendar.server");
    const origin = new URL(data.origin).origin;
    const redirectUri = `${origin}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
    const state = signCalendarState({ userId: context.userId, origin });
    const authorizationUrl = buildCalendarAuthorizationUrl({ redirectUri, state });
    return { authorizationUrl };
  });

export const getGoogleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    const { data, error } = await db
      .from("google_calendar_connections")
      .select("google_email, calendar_id, calendar_name, sync_installments, reminder_minutes, connected_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { connected: false as const };
    return {
      connected: true as const,
      email: data.google_email as string,
      calendarId: data.calendar_id as string | null,
      calendarName: data.calendar_name as string,
      syncInstallments: (data.sync_installments as boolean) ?? true,
      reminderMinutes: (data.reminder_minutes as number[]) ?? [1440],
      connectedAt: data.connected_at as string,
    };
  });

export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    const { data: row } = await db
      .from("google_calendar_connections")
      .select("refresh_token_ciphertext")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (row?.refresh_token_ciphertext) {
      try {
        const { decryptToken } = await import("./google-drive.server");
        const refreshToken = decryptToken(row.refresh_token_ciphertext as string);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // ignore
      }
    }
    // Best-effort: leave the actual Google calendar in place (user may want to keep past events);
    // just drop the connection + local event tracking so we won't try to write to it.
    await db.from("calendar_events").delete().eq("user_id", context.userId);
    await db.from("google_calendar_connections").delete().eq("user_id", context.userId);
    return { ok: true };
  });

export const updateCalendarSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { syncInstallments?: boolean; reminderMinutes?: number[] }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof data.syncInstallments === "boolean") patch.sync_installments = data.syncInstallments;
    if (Array.isArray(data.reminderMinutes)) {
      const clean = data.reminderMinutes
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n));
      patch.reminder_minutes = clean.length > 0 ? clean : [1440];
    }
    const { error } = await db
      .from("google_calendar_connections")
      .update(patch)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Full re-sync of installment events. Recreates missing events, updates
 * changed ones, removes finished ones.
 */
export const syncCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncAllInstallmentsForUser } = await import("./google-calendar.server");
    const stats = await syncAllInstallmentsForUser(context.userId);
    return stats;
  });

/**
 * Sync a single installment agreement (create/update/remove its next-payment event).
 * Called from InstallmentsCard.markPaid and from the agreements save flow.
 * Safe to call when not connected — returns { status: "not-connected" }.
 */
export const syncInstallmentAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agreementId: string }) => input)
  .handler(async ({ data, context }) => {
    const { syncInstallmentForUser } = await import("./google-calendar.server");
    return syncInstallmentForUser({ userId: context.userId, agreementId: data.agreementId });
  });