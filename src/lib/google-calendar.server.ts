/**
 * Server-only Google Calendar OAuth + API helpers.
 * Modular sync engine: today wired for installments; adding recurring payments /
 * warranties / agreement end dates later means adding a new source_type handler,
 * not touching this file's core.
 *
 * Reuses encryption + OAuth env config from google-drive.server.ts. Uses the same
 * Google OAuth client (GOOGLE_OAUTH_CLIENT_ID/SECRET/STATE_SECRET/TOKEN_ENC_KEY)
 * but with different scopes and a separate connection row per user.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { encryptToken, decryptToken } from "@/lib/google-drive.server";

export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
];

export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/public/google-calendar/callback";
export const MY_DROPPOCKET_CALENDAR_NAME = "MyDropPocket";

// ---------- config ----------

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function stateSecret(): Buffer {
  return Buffer.from(reqEnv("GOOGLE_OAUTH_STATE_SECRET"), "utf8");
}

// ---------- signed OAuth state (namespaced to calendar, so drive state can't be replayed here) ----------

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signCalendarState(payload: { userId: string; origin: string }): string {
  const body = {
    ...payload,
    kind: "calendar",
    n: randomBytes(8).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  };
  const bodyStr = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64url(createHmac("sha256", stateSecret()).update(bodyStr).digest());
  return `${bodyStr}.${sig}`;
}

export function verifyCalendarState(token: string): { userId: string; origin: string } {
  const [bodyStr, sig] = token.split(".");
  if (!bodyStr || !sig) throw new Error("Invalid state format");
  const expected = b64url(createHmac("sha256", stateSecret()).update(bodyStr).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid state signature");
  const parsed = JSON.parse(b64urlDecode(bodyStr).toString("utf8")) as {
    userId: string;
    origin: string;
    kind?: string;
    exp: number;
  };
  if (parsed.kind !== "calendar") throw new Error("Wrong state kind");
  if (Math.floor(Date.now() / 1000) > parsed.exp) throw new Error("State expired");
  return { userId: parsed.userId, origin: parsed.origin };
}

// ---------- OAuth URL + token exchange ----------

export function buildCalendarAuthorizationUrl(opts: {
  redirectUri: string;
  state: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: reqEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: opts.state,
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: reqEnv("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: reqEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  return JSON.parse(text) as GoogleTokenResponse;
}

async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: reqEnv("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: reqEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google refresh failed (${res.status}): ${text}`);
  return JSON.parse(text) as { access_token: string; expires_in: number; scope: string; token_type: string };
}

export function decodeIdToken(idToken: string): { email?: string; sub?: string; name?: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3) return {};
  try {
    return JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
  } catch {
    return {};
  }
}

// ---------- connection + calendar bootstrap ----------

export interface CalendarConnection {
  accessToken: string;
  calendarId: string;
  reminderMinutes: number[];
  syncInstallments: boolean;
}

export async function getValidCalendarAccessTokenForUser(
  userId: string,
): Promise<CalendarConnection | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Cast: new tables from this migration may not yet appear in the generated types file.
  const db = supabaseAdmin as unknown as {
    from: (t: string) => any;
  };
  const { data, error } = await db
    .from("google_calendar_connections")
    .select("access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, calendar_id, calendar_name, reminder_minutes, sync_installments")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let accessToken = decryptToken(data.access_token_ciphertext as string);
  const expiresAt = new Date(data.access_token_expires_at as string).getTime();
  const now = Date.now();
  if (expiresAt - now < 60_000) {
    const refreshToken = decryptToken(data.refresh_token_ciphertext as string);
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    const newExpiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();
    await db
      .from("google_calendar_connections")
      .update({
        access_token_ciphertext: encryptToken(accessToken),
        access_token_expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  let calendarId = (data.calendar_id as string | null) ?? null;
  const calendarName = (data.calendar_name as string | null) ?? MY_DROPPOCKET_CALENDAR_NAME;
  if (!calendarId) {
    calendarId = await ensureMyDropPocketCalendar(accessToken, calendarName);
    await db
      .from("google_calendar_connections")
      .update({ calendar_id: calendarId, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return {
    accessToken,
    calendarId,
    reminderMinutes: (data.reminder_minutes as number[]) ?? [1440],
    syncInstallments: (data.sync_installments as boolean) ?? true,
  };
}

export async function ensureMyDropPocketCalendar(accessToken: string, name: string): Promise<string> {
  // Look up existing calendars owned by the user with a matching name.
  const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listText = await listRes.text();
  if (!listRes.ok) throw new Error(`Calendar list failed (${listRes.status}): ${listText}`);
  const list = JSON.parse(listText) as { items?: { id: string; summary: string; accessRole?: string }[] };
  const existing = list.items?.find((c) => c.summary === name && c.accessRole === "owner");
  if (existing) return existing.id;

  const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: name,
      description: "MyDropPocketi automaatselt loodud kalender – maksed, garantiid, lepingud.",
      timeZone: "Europe/Tallinn",
    }),
  });
  const createText = await createRes.text();
  if (!createRes.ok) throw new Error(`Calendar create failed (${createRes.status}): ${createText}`);
  const created = JSON.parse(createText) as { id: string };
  return created.id;
}

// ---------- Google Calendar event CRUD ----------

export interface EventInput {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD, all-day
  reminderMinutes: number[];
}

function nextDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventBody(input: EventInput) {
  return {
    summary: input.title,
    description: input.description,
    start: { date: input.date },
    end: { date: nextDay(input.date) },
    reminders: {
      useDefault: false,
      overrides: input.reminderMinutes.map((m) => ({ method: "popup", minutes: m })),
    },
  };
}

export async function createEvent(opts: {
  accessToken: string;
  calendarId: string;
  event: EventInput;
}): Promise<{ id: string }> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody(opts.event)),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Calendar event create failed (${res.status}): ${text}`);
  return JSON.parse(text) as { id: string };
}

export async function patchEvent(opts: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  event: EventInput;
}): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}/events/${encodeURIComponent(opts.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody(opts.event)),
    },
  );
  const text = await res.text();
  if (!res.ok && res.status !== 404) {
    throw new Error(`Calendar event patch failed (${res.status}): ${text}`);
  }
}

export async function deleteEvent(opts: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}/events/${encodeURIComponent(opts.eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${opts.accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text();
    throw new Error(`Calendar event delete failed (${res.status}): ${text}`);
  }
}

// ---------- installment sync (modular: one handler per source_type) ----------

type AgreementRow = {
  id: string;
  title: string;
  agreement_type: string;
  start_date: string | null;
  end_date: string | null;
  monthly_payment: number | null;
  total_amount: number | null;
  currency: string | null;
  iban: string | null;
  bank: string | null;
  reference_number: string | null;
  payments_made: number | null;
  agreement_number: string | null;
  payee_name: string | null;
};

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return m;
}

interface InstallmentPlan {
  nextDue: string;
  paid: number;
  totalPayments: number | null;
  amount: number;
  finished: boolean;
}

function planInstallment(row: AgreementRow): InstallmentPlan | null {
  const monthly = Number(row.monthly_payment ?? 0);
  if (row.agreement_type !== "installment") return null;
  if (!row.start_date || !monthly || monthly <= 0) return null;

  let totalPayments: number | null = null;
  if (row.total_amount && monthly > 0) {
    totalPayments = Math.max(1, Math.round(Number(row.total_amount) / monthly));
  } else if (row.end_date) {
    totalPayments = Math.max(1, monthsBetween(row.start_date, row.end_date) + 1);
  }
  const paid = Math.max(0, Number(row.payments_made ?? 0));
  const finished = totalPayments !== null && paid >= totalPayments;
  const nextDue = addMonths(row.start_date, paid);
  return { nextDue, paid, totalPayments, amount: monthly, finished };
}

function formatAmount(n: number, currency: string): string {
  return `${n.toFixed(2).replace(".", ",")} ${currency}`;
}

function buildInstallmentEvent(row: AgreementRow, plan: InstallmentPlan, reminderMinutes: number[]): EventInput {
  const currency = row.currency ?? "EUR";
  const lines: string[] = [];
  if (row.bank) lines.push(`Pank: ${row.bank}`);
  if (row.payee_name) lines.push(`Saaja: ${row.payee_name}`);
  if (row.iban) lines.push(`IBAN: ${row.iban}`);
  if (row.reference_number) lines.push(`Viitenumber: ${row.reference_number}`);
  lines.push(`Summa: ${formatAmount(plan.amount, currency)}`);
  if (row.agreement_number) lines.push(`Lepingu nr: ${row.agreement_number}`);
  if (plan.totalPayments !== null) {
    lines.push(`Makse ${plan.paid + 1}/${plan.totalPayments}`);
  }
  return {
    title: `💳 ${row.title} – järelmaks`,
    description: lines.join("\n"),
    date: plan.nextDue,
    reminderMinutes,
  };
}

/**
 * Idempotently sync one installment agreement to Google Calendar.
 * - fetches agreement row
 * - if fully paid or plan invalid → remove tracked event
 * - else upserts a single tracked event by (user_id, source_type='installment', source_id=agreementId)
 */
export async function syncInstallmentForUser(opts: {
  userId: string;
  agreementId: string;
}): Promise<{ status: "created" | "updated" | "removed" | "skipped" | "not-connected" }> {
  const conn = await getValidCalendarAccessTokenForUser(opts.userId);
  if (!conn) return { status: "not-connected" };
  if (!conn.syncInstallments) return { status: "skipped" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dbAny = supabaseAdmin as unknown as { from: (t: string) => any };

  const { data: agRow, error: agErr } = await dbAny
    .from("agreements")
    .select(
      "id, title, agreement_type, start_date, end_date, monthly_payment, total_amount, currency, iban, bank, reference_number, payments_made, agreement_number, payee_name, user_id",
    )
    .eq("id", opts.agreementId)
    .maybeSingle();
  if (agErr) throw agErr;
  if (!agRow || (agRow.user_id as string) !== opts.userId) {
    return { status: "skipped" };
  }
  const row = agRow as unknown as AgreementRow;
  const plan = planInstallment(row);

  // Look up existing tracked event
  const { data: trackedData } = await dbAny
    .from("calendar_events")
    .select("id, google_event_id, calendar_id, event_date, status")
    .eq("user_id", opts.userId)
    .eq("source_type", "installment")
    .eq("source_id", opts.agreementId)
    .maybeSingle();
  const tracked = trackedData as null | {
    id: string;
    google_event_id: string;
    calendar_id: string;
    event_date: string;
    status: string;
  };

  // If plan invalid or finished, remove any existing tracked event.
  if (!plan || plan.finished) {
    if (tracked) {
      try {
        await deleteEvent({
          accessToken: conn.accessToken,
          calendarId: tracked.calendar_id,
          eventId: tracked.google_event_id,
        });
      } catch (e) {
        console.warn("[gcal] delete failed", e);
      }
      await dbAny.from("calendar_events").delete().eq("id", tracked.id);
      return { status: "removed" };
    }
    return { status: "skipped" };
  }

  const desired = buildInstallmentEvent(row, plan, conn.reminderMinutes);

  if (!tracked) {
    const created = await createEvent({
      accessToken: conn.accessToken,
      calendarId: conn.calendarId,
      event: desired,
    });
    await dbAny.from("calendar_events").insert({
      user_id: opts.userId,
      source_type: "installment",
      source_id: opts.agreementId,
      sequence: plan.paid,
      google_event_id: created.id,
      calendar_id: conn.calendarId,
      event_date: plan.nextDue,
      status: "active",
    });
    return { status: "created" };
  }

  // Update in place (whether date changed or content changed).
  try {
    await patchEvent({
      accessToken: conn.accessToken,
      calendarId: tracked.calendar_id,
      eventId: tracked.google_event_id,
      event: desired,
    });
    await dbAny
      .from("calendar_events")
      .update({
        event_date: plan.nextDue,
        sequence: plan.paid,
        calendar_id: conn.calendarId,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tracked.id);
    return { status: "updated" };
  } catch (e) {
    // If the event was deleted in Google, recreate.
    console.warn("[gcal] patch failed, recreating", e);
    const created = await createEvent({
      accessToken: conn.accessToken,
      calendarId: conn.calendarId,
      event: desired,
    });
    await dbAny
      .from("calendar_events")
      .update({
        google_event_id: created.id,
        calendar_id: conn.calendarId,
        event_date: plan.nextDue,
        sequence: plan.paid,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tracked.id);
    return { status: "created" };
  }
}

export async function syncAllInstallmentsForUser(userId: string): Promise<{
  created: number;
  updated: number;
  removed: number;
  skipped: number;
}> {
  const conn = await getValidCalendarAccessTokenForUser(userId);
  if (!conn) return { created: 0, updated: 0, removed: 0, skipped: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dbAny = supabaseAdmin as unknown as { from: (t: string) => any };
  const { data, error } = await dbAny
    .from("agreements")
    .select("id")
    .eq("user_id", userId)
    .eq("agreement_type", "installment");
  if (error) throw error;
  const rows = (data ?? []) as { id: string }[];
  let created = 0,
    updated = 0,
    removed = 0,
    skipped = 0;
  for (const r of rows) {
    try {
      const res = await syncInstallmentForUser({ userId, agreementId: r.id });
      if (res.status === "created") created++;
      else if (res.status === "updated") updated++;
      else if (res.status === "removed") removed++;
      else skipped++;
    } catch (e) {
      console.warn("[gcal] sync installment failed", r.id, e);
      skipped++;
    }
  }
  return { created, updated, removed, skipped };
}