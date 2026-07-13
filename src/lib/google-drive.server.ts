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
  const names = ["Garantiid", "Tšekid", "Lepingud", "Järelmaksulepingud", "Tulud ja kulud", "Pildid", "PDF failid"];
  const subfolders: { name: string; id: string }[] = [];
  for (const name of names) {
    const f = await findOrCreateFolder({ accessToken, name, parentId: root.id });
    subfolders.push({ name, id: f.id });
  }
  return { rootId: root.id, rootName: root.name, subfolders };
}