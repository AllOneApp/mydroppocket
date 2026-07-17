/**
 * Server-only Google Drive OAuth + API helpers.
 * Multi-user: one MyDropPocket OAuth client, each user connects their own Google account.
 * Never import this from browser code — it reads GOOGLE_OAUTH_CLIENT_SECRET etc.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
];

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/public/google-drive/callback";

// ---------- Config ----------

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function encKey(): Buffer {
  // GOOGLE_TOKEN_ENC_KEY is 64 random chars; hash it to a fixed 32-byte key.
  const raw = reqEnv("GOOGLE_TOKEN_ENC_KEY");
  return createHmac("sha256", "mydroppocket:gd:v1").update(raw).digest();
}

function stateSecret(): Buffer {
  return Buffer.from(reqEnv("GOOGLE_OAUTH_STATE_SECRET"), "utf8");
}

// ---------- Symmetric encryption for stored tokens ----------

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ---------- Signed OAuth state (carries the app user id through Google) ----------

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signState(payload: { userId: string; origin: string; profileId?: string | null }): string {
  const body = {
    ...payload,
    n: randomBytes(8).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + 10 * 60, // 10 min
  };
  const bodyStr = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64url(createHmac("sha256", stateSecret()).update(bodyStr).digest());
  return `${bodyStr}.${sig}`;
}

export function verifyState(token: string): { userId: string; origin: string; profileId?: string | null } {
  const [bodyStr, sig] = token.split(".");
  if (!bodyStr || !sig) throw new Error("Invalid state format");
  const expected = b64url(createHmac("sha256", stateSecret()).update(bodyStr).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid state signature");
  const parsed = JSON.parse(b64urlDecode(bodyStr).toString("utf8")) as {
    userId: string;
    origin: string;
    profileId?: string | null;
    exp: number;
  };
  if (Math.floor(Date.now() / 1000) > parsed.exp) throw new Error("State expired");
  return { userId: parsed.userId, origin: parsed.origin, profileId: parsed.profileId ?? null };
}

// ---------- OAuth URL builders + token exchange ----------

export function buildAuthorizationUrl(opts: {
  redirectUri: string;
  state: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: reqEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
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

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}> {
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
  return JSON.parse(text);
}

// Decode id_token to read email + sub without verifying signature (we trust the direct token endpoint response).
export function decodeIdToken(idToken: string): { email?: string; sub?: string; name?: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3) return {};
  try {
    return JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
  } catch {
    return {};
  }
}

// ---------- Drive API: MyDropPocket folder ----------

export async function findOrCreateFolder(opts: {
  accessToken: string;
  name: string;
  parentId?: string;
}): Promise<{ id: string; name: string }> {
  const parentClause = opts.parentId ? ` and '${opts.parentId}' in parents` : " and 'root' in parents";
  const q =
    `mimeType='application/vnd.google-apps.folder' and name='${opts.name.replace(/'/g, "\\'")}'` +
    parentClause +
    ` and trashed=false`;
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  );
  const searchText = await searchRes.text();
  if (!searchRes.ok) throw new Error(`Drive folder search failed (${searchRes.status}): ${searchText}`);
  const search = JSON.parse(searchText) as { files: { id: string; name: string }[] };
  if (search.files.length > 0) return search.files[0];

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      mimeType: "application/vnd.google-apps.folder",
      parents: opts.parentId ? [opts.parentId] : undefined,
    }),
  });
  const createText = await createRes.text();
  if (!createRes.ok) throw new Error(`Drive folder create failed (${createRes.status}): ${createText}`);
  return JSON.parse(createText);
}

export async function ensureMyDropPocketStructure(accessToken: string): Promise<{
  rootId: string;
  rootName: string;
  subfolders: { name: string; id: string }[];
}> {
  const root = await findOrCreateFolder({ accessToken, name: "MyDropPocket" });
  const names = ["Garantiid", "Tšekid", "Lepingud", "Järelmaksulepingud", "Püsimaksed", "Tulud ja kulud", "Pildid", "PDF failid"];
  const subfolders: { name: string; id: string }[] = [];
  for (const name of names) {
    const f = await findOrCreateFolder({ accessToken, name, parentId: root.id });
    subfolders.push({ name, id: f.id });
  }
  return { rootId: root.id, rootName: root.name, subfolders };
}

// ---------- Token lifecycle + upload ----------

export type FolderKey = "warranty" | "expense" | "agreement" | "recurring" | "receipt" | "invoice";

export const FOLDER_KEY_TO_NAME: Record<FolderKey, string> = {
  warranty: "Garantiid",
  expense: "Tšekid",
  agreement: "Lepingud",
  recurring: "Järelmaksulepingud",
  receipt: "Tšekid",
  invoice: "Järelmaksulepingud",
};

// -----------------------------------------------------------------------------
// PROFIILIPÕHINE DRIVE RESOLVER
//
// Iga profiil võib olla kas 'shared' (kasutab põhikonto Drive'i profiili alam-
// kaustaga) või 'separate' (eraldi Google konto, ilma profiili alamkaustata).
//
// resolveProfileDriveTarget = üks tõesus kõigile moodulitele:
// tagastab access-token'i + kausta ID-d juba ÕIGES kontekstis, nii et üleslaadija
// ei pea profiilirežiimi kohta midagi teadma.
// -----------------------------------------------------------------------------

type DriveMode = "shared" | "separate";

/** Lae profiili info (nimi + drive_mode + is_default). */
async function loadProfileInfo(
  profileId: string,
): Promise<{ id: string; user_id: string; name: string; drive_mode: DriveMode; is_default: boolean } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, user_id, name, drive_mode, is_default")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = data as { id: string; user_id: string; name: string; drive_mode: string; is_default: boolean };
  return { ...d, drive_mode: (d.drive_mode === "separate" ? "separate" : "shared") as DriveMode };
}

/**
 * Lae Drive'i ühenduse rida vastavalt profiili režiimile.
 * - shared → kasutaja põhikonto ühendus (profile_id IS NULL)
 * - separate → selle profiili enda ühendus (profile_id = <id>)
 */
async function loadConnectionRow(
  userId: string,
  profileConnectionId: string | null,
): Promise<
  | {
      id: string;
      access_token_ciphertext: string;
      refresh_token_ciphertext: string;
      access_token_expires_at: string;
      root_folder_id: string | null;
      root_folder_name: string;
      google_email: string;
      subfolders_json: Record<string, string> | null;
    }
  | null
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("google_drive_connections")
    .select(
      "id, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, root_folder_id, root_folder_name, google_email, subfolders_json",
    )
    .eq("user_id", userId);
  if (profileConnectionId === null) q = q.is("profile_id", null);
  else q = q.eq("profile_id", profileConnectionId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as {
    id: string;
    access_token_ciphertext: string;
    refresh_token_ciphertext: string;
    access_token_expires_at: string;
    root_folder_id: string | null;
    root_folder_name: string;
    google_email: string;
    subfolders_json: Record<string, string> | null;
  } | null) ?? null;
}

/** Refresh + persist access token if expiring within 60s. */
async function ensureFreshAccessToken(row: {
  id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_token_expires_at: string;
}): Promise<string> {
  let accessToken = decryptToken(row.access_token_ciphertext);
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  const now = Date.now();
  if (expiresAt - now < 60_000) {
    const refreshToken = decryptToken(row.refresh_token_ciphertext);
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    const newExpiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("google_drive_connections")
      .update({
        access_token_ciphertext: encryptToken(accessToken),
        access_token_expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
  return accessToken;
}

/** Loe kausta ID vahemälust `google_drive_folders`. */
async function readFolderCache(opts: {
  connectionId: string;
  profileId: string | null;
  category: string;
}): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("google_drive_folders")
    .select("folder_id")
    .eq("connection_id", opts.connectionId)
    .eq("category", opts.category);
  if (opts.profileId === null) q = q.is("profile_id", null);
  else q = q.eq("profile_id", opts.profileId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as { folder_id: string } | null)?.folder_id ?? null;
}

/** Kirjuta kausta ID vahemällu. */
async function writeFolderCache(opts: {
  connectionId: string;
  profileId: string | null;
  category: string;
  folderId: string;
  folderName: string;
  parentFolderId: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Emulate upsert; unique indexes are partial (NULL vs NOT NULL) so onConflict target isn't stable.
  const existing = await readFolderCache(opts);
  if (existing) {
    let q = supabaseAdmin
      .from("google_drive_folders")
      .update({
        folder_id: opts.folderId,
        folder_name: opts.folderName,
        parent_folder_id: opts.parentFolderId,
        updated_at: new Date().toISOString(),
      })
      .eq("connection_id", opts.connectionId)
      .eq("category", opts.category);
    if (opts.profileId === null) q = q.is("profile_id", null);
    else q = q.eq("profile_id", opts.profileId);
    await q;
    return;
  }
  await supabaseAdmin.from("google_drive_folders").insert({
    connection_id: opts.connectionId,
    profile_id: opts.profileId,
    category: opts.category,
    folder_id: opts.folderId,
    folder_name: opts.folderName,
    parent_folder_id: opts.parentFolderId,
  });
}

const STANDARD_CATEGORIES = [
  "Garantiid",
  "Tšekid",
  "Lepingud",
  "Järelmaksulepingud",
  "Püsimaksed",
  "Tulud ja kulud",
  "Pildid",
  "PDF failid",
];

/**
 * Peafunktsioon — kõik moodulid kasutavad seda.
 *
 * Käivitab õige Drive'i ühenduse (jagatud vs eraldi) + tagastab tuntud
 * kategooriate juba resolveeritud kausta ID-d, mis on selles kontekstis
 * KOHE üleslaadimiseks kasutatavad.
 *
 * Reeglid:
 * - shared režiim: MyDropPocket / {profiili nimi} / {kategooria}
 * - separate režiim: MyDropPocket / {kategooria}
 * - profileId === null: legacy käitumine (MyDropPocket / {kategooria} otse põhikontos)
 */
export async function resolveProfileDriveTarget(
  userId: string,
  profileId: string | null,
): Promise<
  | {
      accessToken: string;
      rootId: string;
      /** kategooria nimi → kausta id, juba õige parent'i all */
      subfolders: Record<string, string>;
      connectionId: string;
      profileId: string | null;
      mode: DriveMode | "legacy";
      profileFolderId: string | null;
      googleEmail: string;
    }
  | null
> {
  // 1. Otsusta, milline ühendus + režiim.
  let mode: DriveMode | "legacy" = "legacy";
  let profileInfo: Awaited<ReturnType<typeof loadProfileInfo>> = null;
  let connProfileId: string | null = null;

  if (profileId) {
    profileInfo = await loadProfileInfo(profileId);
    if (profileInfo) {
      mode = profileInfo.drive_mode;
      if (mode === "separate") connProfileId = profileId;
    }
  }

  const row = await loadConnectionRow(userId, connProfileId);
  if (!row) return null; // Not connected in this context.

  const accessToken = await ensureFreshAccessToken(row);

  // 2. Veendu, et root ("MyDropPocket") kaust on olemas.
  let rootId = row.root_folder_id;
  if (!rootId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const root = await findOrCreateFolder({ accessToken, name: "MyDropPocket" });
    rootId = root.id;
    await supabaseAdmin
      .from("google_drive_connections")
      .update({ root_folder_id: rootId, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  // 3. shared → veendu, et profiili alamkaust on olemas.
  let profileFolderId: string | null = null;
  if (mode === "shared" && profileInfo) {
    const cached = await readFolderCache({
      connectionId: row.id,
      profileId,
      category: "__profile_root__",
    });
    if (cached) profileFolderId = cached;
    else {
      const f = await findOrCreateFolder({
        accessToken,
        name: profileInfo.name,
        parentId: rootId,
      });
      profileFolderId = f.id;
      await writeFolderCache({
        connectionId: row.id,
        profileId,
        category: "__profile_root__",
        folderId: profileFolderId,
        folderName: profileInfo.name,
        parentFolderId: rootId,
      });
    }
  }

  const targetParent = profileFolderId ?? rootId;
  const cacheProfileId = mode === "shared" ? profileId : null;

  // 4. Ehita subfolders map — cache'ist esimesena, siis loo puuduvad.
  const subfolders: Record<string, string> = {};
  for (const category of STANDARD_CATEGORIES) {
    let folderId = await readFolderCache({
      connectionId: row.id,
      profileId: cacheProfileId,
      category,
    });
    if (!folderId) {
      // For legacy mode we may already have the folder id in subfolders_json.
      if (mode === "legacy" && row.subfolders_json && row.subfolders_json[category]) {
        folderId = row.subfolders_json[category];
        await writeFolderCache({
          connectionId: row.id,
          profileId: null,
          category,
          folderId,
          folderName: category,
          parentFolderId: rootId,
        });
      } else {
        const f = await findOrCreateFolder({ accessToken, name: category, parentId: targetParent });
        folderId = f.id;
        await writeFolderCache({
          connectionId: row.id,
          profileId: cacheProfileId,
          category,
          folderId,
          folderName: category,
          parentFolderId: targetParent,
        });
      }
    }
    subfolders[category] = folderId;
  }

  return {
    accessToken,
    rootId,
    subfolders,
    connectionId: row.id,
    profileId: cacheProfileId,
    mode,
    profileFolderId,
    googleEmail: row.google_email,
  };
}

/**
 * Nimeta jagatud režiimis profiili alamkaust Drive'is ümber. Kui uue nimega
 * kaust juba eksisteerib MyDropPocketi all, tagastab `{ ok: false, reason: 'conflict' }`
 * ja midagi ei muudeta.
 */
export async function renameProfileFolderInDrive(opts: {
  userId: string;
  profileId: string;
  newName: string;
}): Promise<{ ok: true; folderId: string } | { ok: false; reason: "not_connected" | "conflict" | "separate_mode" }> {
  const info = await loadProfileInfo(opts.profileId);
  if (!info) return { ok: false, reason: "not_connected" };
  if (info.drive_mode !== "shared") return { ok: false, reason: "separate_mode" };
  const row = await loadConnectionRow(opts.userId, null);
  if (!row) return { ok: false, reason: "not_connected" };
  const accessToken = await ensureFreshAccessToken(row);
  const rootId = row.root_folder_id;
  if (!rootId) return { ok: false, reason: "not_connected" };

  // Konflikt: kas MyDropPocketi all on juba selle nimega kaust?
  const conflictQ = `mimeType='application/vnd.google-apps.folder' and name='${opts.newName.replace(/'/g, "\\'")}' and '${rootId}' in parents and trashed=false`;
  const conflictRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(conflictQ)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const conflictJson = await conflictRes.json();

  // Loe praegune profiili kaust cache'ist
  const currentFolderId = await readFolderCache({
    connectionId: row.id,
    profileId: opts.profileId,
    category: "__profile_root__",
  });

  const conflicts = (conflictJson.files ?? []) as { id: string }[];
  const otherConflict = conflicts.find((f) => f.id !== currentFolderId);
  if (otherConflict) return { ok: false, reason: "conflict" };

  if (!currentFolderId) {
    // Pole veel loodud — loo lihtsalt uue nimega.
    const f = await findOrCreateFolder({ accessToken, name: opts.newName, parentId: rootId });
    await writeFolderCache({
      connectionId: row.id,
      profileId: opts.profileId,
      category: "__profile_root__",
      folderId: f.id,
      folderName: opts.newName,
      parentFolderId: rootId,
    });
    return { ok: true, folderId: f.id };
  }

  // Nimeta ümber Drive'is.
  const renameRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${currentFolderId}?fields=id,name`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: opts.newName }),
    },
  );
  const renameText = await renameRes.text();
  if (!renameRes.ok) throw new Error(`Drive rename failed (${renameRes.status}): ${renameText}`);

  // Uuenda cache.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("google_drive_folders")
    .update({ folder_name: opts.newName, updated_at: new Date().toISOString() })
    .eq("connection_id", row.id)
    .eq("profile_id", opts.profileId)
    .eq("category", "__profile_root__");

  return { ok: true, folderId: currentFolderId };
}

/**
 * Kontrolli, kas kasutajal on „legacy" struktuur (failid otse MyDropPocket/{kategooria} all)
 * ja teisi profiile ei ole. Kui on, näidatakse UI-s ühekordne migreerimisdialoog.
 */
export async function detectLegacyDriveLayout(userId: string): Promise<{
  eligible: boolean;
  reason?: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Profiil peab olema ainult üks (vaikeprofiil).
  const { data: profiles, error: pErr } = await supabaseAdmin
    .from("user_profiles")
    .select("id, name, is_default, legacy_drive_migration_dismissed_at, legacy_drive_migration_done_at")
    .eq("user_id", userId);
  if (pErr) throw pErr;
  const rows = (profiles ?? []) as Array<{
    id: string;
    name: string;
    is_default: boolean;
    legacy_drive_migration_dismissed_at: string | null;
    legacy_drive_migration_done_at: string | null;
  }>;
  if (rows.length === 0) return { eligible: false, reason: "no_profiles" };
  const defaultProfile = rows.find((r) => r.is_default);
  if (!defaultProfile) return { eligible: false, reason: "no_default" };
  if (defaultProfile.legacy_drive_migration_done_at) return { eligible: false, reason: "already_done" };
  if (defaultProfile.legacy_drive_migration_dismissed_at) {
    // Näita uuesti kui hilinemise ajast on möödas 1 päev.
    const dismissedAt = new Date(defaultProfile.legacy_drive_migration_dismissed_at).getTime();
    if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return { eligible: false, reason: "recently_dismissed" };
  }

  // Peab olema põhikonto Drive ühendus.
  const row = await loadConnectionRow(userId, null);
  if (!row) return { eligible: false, reason: "no_drive" };
  if (!row.root_folder_id) return { eligible: false, reason: "no_root" };

  // Drive'is peab olema vähemalt üks kategooria otse root'i all.
  const accessToken = await ensureFreshAccessToken(row);
  const q = `'${row.root_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = await res.json();
  const names = new Set(((json.files ?? []) as { name: string }[]).map((f) => f.name));
  const legacyPresent = STANDARD_CATEGORIES.some((c) => names.has(c));
  // Profiili alamkaust juba olemas → mitte legacy.
  if (names.has(defaultProfile.name)) return { eligible: false, reason: "already_migrated" };
  if (!legacyPresent) return { eligible: false, reason: "no_legacy_folders" };
  return { eligible: true };
}

/**
 * Liiguta legacy struktuur (MyDropPocket/{kategooria}/*) uude MyDropPocket/{profiili nimi}/
 * alla, muutes iga kategooria kausta parent'iks profiili kausta.
 */
export async function migrateLegacyDriveToProfile(userId: string): Promise<{ moved: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id, name")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (!profile) throw new Error("Vaikeprofiili ei leitud");
  const row = await loadConnectionRow(userId, null);
  if (!row || !row.root_folder_id) throw new Error("Drive ei ole ühendatud");
  const accessToken = await ensureFreshAccessToken(row);

  // Loo/leia profiili kaust.
  const profileFolder = await findOrCreateFolder({
    accessToken,
    name: (profile as { name: string }).name,
    parentId: row.root_folder_id,
  });
  await writeFolderCache({
    connectionId: row.id,
    profileId: (profile as { id: string }).id,
    category: "__profile_root__",
    folderId: profileFolder.id,
    folderName: (profile as { name: string }).name,
    parentFolderId: row.root_folder_id,
  });

  // Leia legacy kaustad root'i all ja liiguta.
  const q = `'${row.root_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = await res.json();
  const folders = ((json.files ?? []) as { id: string; name: string; parents?: string[] }[]).filter((f) =>
    STANDARD_CATEGORIES.includes(f.name),
  );

  let moved = 0;
  for (const f of folders) {
    // Move: PATCH with addParents & removeParents.
    const parents = f.parents ?? [row.root_folder_id];
    const removeParents = parents.join(",");
    const patchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${f.id}?addParents=${profileFolder.id}&removeParents=${removeParents}&fields=id,parents`,
      { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!patchRes.ok) continue;
    // Migreeri ka folder cache: kirjuta üle profileId'ga.
    await writeFolderCache({
      connectionId: row.id,
      profileId: (profile as { id: string }).id,
      category: f.name,
      folderId: f.id,
      folderName: f.name,
      parentFolderId: profileFolder.id,
    });
    moved++;
  }

  // Märgi kasutajal migreerimine tehtuks.
  await supabaseAdmin
    .from("user_profiles")
    .update({ legacy_drive_migration_done_at: new Date().toISOString() })
    .eq("id", (profile as { id: string }).id);

  return { moved };
}

/**
 * Get a valid access token for a user, refreshing (and persisting) it if the
 * stored one is expired or about to expire. Also returns the cached subfolder
 * map, rebuilding it if missing.
 */
export async function getValidAccessTokenForUser(userId: string): Promise<{
  accessToken: string;
  rootId: string;
  subfolders: Record<string, string>;
} | null> {
  // Backwards-compatible wrapper — kutsub uut profiiliteadlikku resolveri
  // legacy režiimis (profileId = null → põhikonto, MyDropPocket/{kategooria}).
  const resolved = await resolveProfileDriveTarget(userId, null);
  if (!resolved) return null;
  return { accessToken: resolved.accessToken, rootId: resolved.rootId, subfolders: resolved.subfolders };
}

/**
 * Multipart upload of a file's bytes to a specific folder in the user's Drive.
 * Uses only the drive.file scope: MyDropPocket can access only files it created.
 */
export async function uploadBytesToDriveFolder(opts: {
  accessToken: string;
  parentId: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<{ id: string; name: string }> {
  const boundary = "mdp_" + Math.random().toString(16).slice(2);
  const metadata = {
    name: opts.name,
    parents: [opts.parentId],
    mimeType: opts.mime || "application/octet-stream",
  };
  const enc = new TextEncoder();
  const preamble = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
  );
  const closing = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(preamble.length + opts.bytes.length + closing.length);
  body.set(preamble, 0);
  body.set(opts.bytes, preamble.length);
  body.set(closing, preamble.length + opts.bytes.length);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

// ---------- Upsert / delete helpers used by JSON backup ----------

async function findFileInFolder(opts: {
  accessToken: string;
  parentId: string;
  name: string;
}): Promise<{ id: string } | null> {
  const q = `name='${opts.name.replace(/'/g, "\\'")}' and '${opts.parentId}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive file lookup failed (${res.status}): ${text}`);
  const j = JSON.parse(text) as { files: { id: string }[] };
  return j.files[0] ?? null;
}

/**
 * Upsert a JSON file by name inside a folder. If it exists → PATCH body,
 * otherwise create via multipart upload.
 */
export async function upsertJsonInFolder(opts: {
  accessToken: string;
  parentId: string;
  name: string;
  json: unknown;
}): Promise<{ id: string; name: string }> {
  const bytes = new TextEncoder().encode(JSON.stringify(opts.json, null, 2));
  const existing = await findFileInFolder({
    accessToken: opts.accessToken,
    parentId: opts.parentId,
    name: opts.name,
  });
  if (existing) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,name`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: bytes,
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`Drive JSON update failed (${res.status}): ${text}`);
    return JSON.parse(text);
  }
  return uploadBytesToDriveFolder({
    accessToken: opts.accessToken,
    parentId: opts.parentId,
    name: opts.name,
    mime: "application/json",
    bytes,
  });
}

export async function deleteDriveFile(opts: { accessToken: string; fileId: string }): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${opts.fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Drive delete failed (${res.status}): ${text}`);
  }
}

/**
 * Upsert raw bytes as a file by name inside a folder. If it exists → PATCH
 * body, otherwise create via multipart upload.
 */
export async function upsertBytesInFolder(opts: {
  accessToken: string;
  parentId: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<{ id: string; name: string }> {
  const existing = await findFileInFolder({
    accessToken: opts.accessToken,
    parentId: opts.parentId,
    name: opts.name,
  });
  if (existing) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&fields=id,name`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": opts.mime,
        },
        body: opts.bytes as BodyInit,
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`Drive file update failed (${res.status}): ${text}`);
    return JSON.parse(text);
  }
  return uploadBytesToDriveFolder({
    accessToken: opts.accessToken,
    parentId: opts.parentId,
    name: opts.name,
    mime: opts.mime,
    bytes: opts.bytes,
  });
}

/**
 * Delete any files matching a name inside a folder (trashes technical
 * artifacts users shouldn't see, e.g. legacy *.json backup files).
 */
export async function deleteFilesByNameInFolder(opts: {
  accessToken: string;
  parentId: string;
  name: string;
}): Promise<number> {
  const q = `name='${opts.name.replace(/'/g, "\\'")}' and '${opts.parentId}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Drive lookup failed (${res.status}): ${text}`);
  const j = JSON.parse(text) as { files: { id: string }[] };
  for (const f of j.files) {
    await deleteDriveFile({ accessToken: opts.accessToken, fileId: f.id });
  }
  return j.files.length;
}

/**
 * Ensure a specific named subfolder exists under MyDropPocket. Updates the
 * cached subfolders_json map when it has to create it. Returns the folder id.
 */
export async function ensureSubfolderId(opts: {
  userId: string;
  accessToken: string;
  rootId: string;
  subfolders: Record<string, string>;
  name: string;
}): Promise<string> {
  if (opts.subfolders[opts.name]) return opts.subfolders[opts.name];
  const created = await findOrCreateFolder({
    accessToken: opts.accessToken,
    name: opts.name,
    parentId: opts.rootId,
  });
  const next = { ...opts.subfolders, [opts.name]: created.id };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("google_drive_connections")
    .update({ subfolders_json: next, updated_at: new Date().toISOString() })
    .eq("user_id", opts.userId);
  return created.id;
}