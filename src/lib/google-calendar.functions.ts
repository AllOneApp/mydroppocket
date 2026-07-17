import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string; profileId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const {
      buildCalendarAuthorizationUrl,
      signCalendarState,
      GOOGLE_CALENDAR_CALLBACK_PATH,
    } = await import("./google-calendar.server");
    const origin = new URL(data.origin).origin;
    const redirectUri = `${origin}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
    const state = signCalendarState({ userId: context.userId, origin, profileId: data.profileId ?? null });
    const authorizationUrl = buildCalendarAuthorizationUrl({ redirectUri, state });
    return { authorizationUrl };
  });

export const getGoogleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { profileId?: string | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    let q = db
      .from("google_calendar_connections")
      .select("google_email, calendar_id, calendar_name, sync_installments, reminder_minutes, connected_at")
      .eq("user_id", context.userId);
    if (data?.profileId) q = q.eq("profile_id", data.profileId);
    else q = q.is("profile_id", null);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw error;
    if (!row) return { connected: false as const };
    return {
      connected: true as const,
      email: row.google_email as string,
      calendarId: row.calendar_id as string | null,
      calendarName: row.calendar_name as string,
      syncInstallments: (row.sync_installments as boolean) ?? true,
      reminderMinutes: (row.reminder_minutes as number[]) ?? [1440],
      connectedAt: row.connected_at as string,
    };
  });

export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { profileId?: string | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    let selQ = db
      .from("google_calendar_connections")
      .select("refresh_token_ciphertext")
      .eq("user_id", context.userId);
    if (data?.profileId) selQ = selQ.eq("profile_id", data.profileId);
    else selQ = selQ.is("profile_id", null);
    const { data: row } = await selQ.maybeSingle();
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
    // just drop the connection + local event tracking for this profile scope.
    if (data?.profileId) {
      await db.from("calendar_events").delete().eq("user_id", context.userId).eq("profile_id", data.profileId);
      await db.from("google_calendar_connections").delete().eq("user_id", context.userId).eq("profile_id", data.profileId);
    } else {
      await db.from("calendar_events").delete().eq("user_id", context.userId).is("profile_id", null);
      await db.from("google_calendar_connections").delete().eq("user_id", context.userId).is("profile_id", null);
    }
    return { ok: true };
  });

export const updateCalendarSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    profileId?: string | null;
    syncInstallments?: boolean;
    syncRecurring?: boolean;
    syncWarranties?: boolean;
    syncAgreements?: boolean;
    reminderMinutes?: number[];
    warrantyReminderDays?: number[];
    agreementReminderDays?: number[];
  }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as { from: (t: string) => any };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof data.syncInstallments === "boolean") patch.sync_installments = data.syncInstallments;
    if (typeof data.syncRecurring === "boolean") patch.sync_recurring = data.syncRecurring;
    if (typeof data.syncWarranties === "boolean") patch.sync_warranties = data.syncWarranties;
    if (typeof data.syncAgreements === "boolean") patch.sync_agreements = data.syncAgreements;
    if (Array.isArray(data.reminderMinutes)) {
      const clean = data.reminderMinutes
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n));
      patch.reminder_minutes = clean.length > 0 ? clean : [1440];
    }
    if (Array.isArray(data.warrantyReminderDays)) {
      const clean = data.warrantyReminderDays
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n));
      patch.warranty_reminder_days = clean.length > 0 ? clean : [30, 7, 0];
    }
    if (Array.isArray(data.agreementReminderDays)) {
      const clean = data.agreementReminderDays
        .map((n) => Math.max(0, Math.floor(Number(n))))
        .filter((n) => Number.isFinite(n));
      patch.agreement_reminder_days = clean.length > 0 ? clean : [30, 7, 0];
    }
    let upQ = db.from("google_calendar_connections").update(patch).eq("user_id", context.userId);
    if (data.profileId) upQ = upQ.eq("profile_id", data.profileId);
    else upQ = upQ.is("profile_id", null);
    const { error } = await upQ;
    if (error) throw error;
    return { ok: true };
  });

/**
 * Full re-sync of installment events. Recreates missing events, updates
 * changed ones, removes finished ones.
 */
export const syncCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { profileId?: string | null }) => input ?? {})
  .handler(async ({ data, context }) => {
    const { syncEverythingForUser } = await import("./google-calendar.server");
    const stats = await syncEverythingForUser(context.userId, data?.profileId ?? null);
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
    const { syncInstallmentForUser, syncAgreementEndForUser } = await import("./google-calendar.server");
    // Non-installment agreements handled via syncAgreementEnd; installments handled here.
    // We call both so a type change (installment↔other) reconciles automatically.
    const inst = await syncInstallmentForUser({ userId: context.userId, agreementId: data.agreementId });
    const end = await syncAgreementEndForUser({ userId: context.userId, agreementId: data.agreementId });
    return { installment: inst, agreementEnd: end };
  });

export const syncRecurringPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { recurringId: string }) => input)
  .handler(async ({ data, context }) => {
    const { syncRecurringForUser } = await import("./google-calendar.server");
    return syncRecurringForUser({ userId: context.userId, recurringId: data.recurringId });
  });

export const syncWarranty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { warrantyId: string }) => input)
  .handler(async ({ data, context }) => {
    const { syncWarrantyForUser } = await import("./google-calendar.server");
    return syncWarrantyForUser({ userId: context.userId, warrantyId: data.warrantyId });
  });

export const removeCalendarSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    sourceType: "installment" | "recurring" | "warranty" | "agreement_end";
    sourceId: string;
  }) => input)
  .handler(async ({ data, context }) => {
    const { removeSourceEventsForUser } = await import("./google-calendar.server");
    return removeSourceEventsForUser({
      userId: context.userId,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
    });
  });