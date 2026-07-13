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

export function signState(payload: { userId: string; origin: string }): string {
  const body = {
    ...payload,
    n: randomBytes(8).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + 10 * 60, // 10 min
  };
  const bodyStr = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64url(createHmac("sha256", stateSecret()).update(bodyStr).digest());
  return `${bodyStr}.${sig}`;
}

export function verifyState(token: string): { userId: string; origin: string } {
  const [bodyStr, sig] = token.split(".");
  if (!bodyStr || !sig) throw new Error("Invalid state format");
  const expected = b64url(createHmac("sha256", stateSecret()).update(bodyStr).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid state signature");
  const parsed = JSON.parse(b64urlDecode(bodyStr).toString("utf8")) as {
    userId: string;
    origin: string;
    exp: number;
  };
  if (Math.floor(Date.now() / 1000) > parsed.exp) throw new Error("State expired");
  return { userId: parsed.userId, origin: parsed.origin };
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("google_drive_connections")
    .select("access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, root_folder_id, subfolders_json")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  let accessToken = decryptToken(data.access_token_ciphertext);
  const expiresAt = new Date(data.access_token_expires_at).getTime();
  const now = Date.now();
  if (expiresAt - now < 60_000) {
    const refreshToken = decryptToken(data.refresh_token_ciphertext);
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    const newExpiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("google_drive_connections")
      .update({
        access_token_ciphertext: encryptToken(accessToken),
        access_token_expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  let subfolders = (data.subfolders_json as Record<string, string> | null) ?? null;
  let rootId = data.root_folder_id as string | null;
  if (!subfolders || !rootId) {
    const built = await ensureMyDropPocketStructure(accessToken);
    subfolders = Object.fromEntries(built.subfolders.map((s) => [s.name, s.id]));
    rootId = built.rootId;
    await supabaseAdmin
      .from("google_drive_connections")
      .update({
        root_folder_id: rootId,
        subfolders_json: subfolders,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  return { accessToken, rootId: rootId!, subfolders };
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