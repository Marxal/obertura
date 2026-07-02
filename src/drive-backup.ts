// Google Drive cloud backup — the repertoire's off-device safety net.
//
// Everything runs in the browser, no server anywhere: Google Identity Services
// hands us a short-lived access token (an OAuth popup; client IDs are public by
// design, no secret involved), and the Drive REST API stores ONE file — the
// same JSON that "Export backup" downloads — in the app's hidden appDataFolder.
// That folder never shows up in the user's Drive and only this app can read it,
// so the narrowest Drive scope is enough and their real files are untouchable.
//
// Until a Google OAuth client ID is pasted below (see DRIVE-SETUP.md) the
// feature reports "not set up" and everything here stays inert.

import { exportBackup, parseBackup, onLinesChanged, type BackupFile } from './storage';

// The OAuth client ID from Google Cloud — see DRIVE-SETUP.md for the
// click-by-click setup. Empty string = cloud backup not set up in this build.
export const DRIVE_CLIENT_ID = '156412696655-6k13gspbu9t76ek9r2iq8cdnk077tp3j.apps.googleusercontent.com';

// Only the hidden per-app folder — the narrowest Drive scope Google offers.
// The consent popup describes it as the app's "own configuration data".
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const BACKUP_NAME = 'obertura-backup.json';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

// All state keys sit under the `obertura.` prefix so the Settings "erase
// everything" sweep (wipeOberturaLocalStorage) clears them with the rest.
const CONNECTED_KEY = 'obertura.drive.connected';
const AUTO_KEY = 'obertura.drive.autoBackup';
const LAST_KEY = 'obertura.drive.lastBackup';
const PENDING_KEY = 'obertura.drive.pending';
const FILE_ID_KEY = 'obertura.drive.fileId';

// Fired on window whenever connection / backup state changes, so an open
// Settings screen can refresh its cloud section without polling.
export const DRIVE_CHANGE_EVENT = 'obertura:drivechange';

// ── Minimal Google Identity Services types ────────────────────────────────────
// Hand-written from the documented shape (no @types dependency): we use only
// the token client and revoke().

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}

interface GisOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOauth2 } };
  }
}

// ── State readers / writers ───────────────────────────────────────────────────

export function isDriveConfigured(): boolean {
  return DRIVE_CLIENT_ID.length > 0;
}

export function isDriveConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === '1';
}

// Auto-backup defaults ON once connected; the Settings switch can turn it off.
export function getDriveAutoBackup(): boolean {
  return localStorage.getItem(AUTO_KEY) !== 'off';
}

export function setDriveAutoBackup(on: boolean): void {
  localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  notifyChange();
}

// ISO timestamp of the last successful upload, or null before the first one.
export function getLastDriveBackup(): string | null {
  return localStorage.getItem(LAST_KEY);
}

// True when an auto-backup attempt failed (offline, expired session…) and the
// repertoire has changed since the last successful upload.
export function isDriveBackupPending(): boolean {
  return localStorage.getItem(PENDING_KEY) === '1';
}

function notifyChange(): void {
  window.dispatchEvent(new Event(DRIVE_CHANGE_EVENT));
}

// ── Google Identity Services + token handling ────────────────────────────────

let gisPromise: Promise<GisOauth2> | null = null;

// Inject the GIS script once and resolve with its oauth2 namespace. Kept lazy
// so the app never loads Google code unless the user actually uses Drive.
function loadGis(): Promise<GisOauth2> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const ready = window.google?.accounts?.oauth2;
    if (ready) return resolve(ready);
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('Google sign-in didn’t initialise.'));
    };
    script.onerror = () => {
      gisPromise = null; // allow a retry after a flaky network
      reject(new Error('Couldn’t load Google sign-in — check your connection.'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

// Access tokens live ~1 hour; cache in memory with a safety margin. There are
// no refresh tokens in browser OAuth — when this expires we ask GIS again,
// which is silent while the user's Google session is alive.
let cachedToken: { token: string; expiresAt: number } | null = null;

function requestToken(): Promise<string> {
  return loadGis().then(
    (oauth2) =>
      new Promise<string>((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id: DRIVE_CLIENT_ID,
          scope: SCOPE,
          callback: (res) => {
            if (res.error || !res.access_token) {
              reject(new Error(res.error_description || res.error || 'Google didn’t grant access.'));
              return;
            }
            const lifetime = Number(res.expires_in) || 3600;
            cachedToken = {
              token: res.access_token,
              expiresAt: Date.now() + (lifetime - 60) * 1000,
            };
            resolve(res.access_token);
          },
          error_callback: (err) => {
            reject(
              new Error(
                err.type === 'popup_closed'
                  ? 'Sign-in was cancelled.'
                  : err.message || 'The Google sign-in popup couldn’t open.',
              ),
            );
          },
        });
        client.requestAccessToken();
      }),
  );
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  return requestToken();
}

// ── Connect / disconnect ──────────────────────────────────────────────────────

// Run the OAuth popup and remember the connection. Deliberately does NOT
// upload anything: on a fresh device the user usually wants to RESTORE first,
// and an eager upload of an empty repertoire would clobber the cloud copy.
// The Settings UI drives the found-a-backup / first-upload flow after this.
export async function connectDrive(): Promise<void> {
  if (!isDriveConfigured()) throw new Error('Cloud backup isn’t set up in this build.');
  await requestToken();
  localStorage.setItem(CONNECTED_KEY, '1');
  notifyChange();
}

// Forget the connection on this device. Revokes the grant when we still hold a
// live token; either way the app stops touching Drive until reconnected. The
// backup file itself stays in Drive (harmless, invisible, and welcome back).
export function disconnectDrive(): void {
  const token = cachedToken?.token;
  cachedToken = null;
  if (token) void loadGis().then((oauth2) => oauth2.revoke(token)).catch(() => {});
  localStorage.removeItem(CONNECTED_KEY);
  localStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(FILE_ID_KEY);
  notifyChange();
}

// ── Drive REST helpers ────────────────────────────────────────────────────────

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  // A 401 means the token died early (revoked, password change): drop the
  // cache so the next call re-asks GIS instead of failing forever.
  if (res.status === 401) cachedToken = null;
  return res;
}

interface DriveFileMeta {
  id: string;
  name?: string;
  modifiedTime?: string;
}

// Pick the newest obertura backup out of a files.list response. Pure and
// exported for the self-test: filters strictly by name (defensive — the query
// already filters) and sorts by modifiedTime, newest first.
export function pickNewestBackup(files: DriveFileMeta[]): DriveFileMeta | null {
  const candidates = files
    .filter((f) => f.name === BACKUP_NAME && typeof f.id === 'string' && f.id)
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
  return candidates[0] ?? null;
}

// Build the multipart/related body for a Drive create-with-content upload.
// Pure and exported for the self-test.
export function buildMultipartBody(metadata: object, content: string, boundary: string): string {
  return (
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${content}\r\n` +
    `--${boundary}--`
  );
}

async function findBackupFile(token: string): Promise<DriveFileMeta | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${BACKUP_NAME}'`,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '10',
  });
  const res = await driveFetch(token, `${API}/files?${params}`);
  if (!res.ok) throw new Error(`Drive said ${res.status} while looking for the backup.`);
  const data = (await res.json()) as { files?: DriveFileMeta[] };
  return pickNewestBackup(data.files ?? []);
}

// Create the backup file (with content) in one multipart request; returns its id.
async function createBackupFile(token: string, json: string): Promise<string> {
  const boundary = `obertura-${Date.now().toString(36)}`;
  const body = buildMultipartBody({ name: BACKUP_NAME, parents: ['appDataFolder'] }, json, boundary);
  const res = await driveFetch(token, `${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive said ${res.status} while creating the backup.`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error('Drive didn’t return the new file’s id.');
  return data.id;
}

// Overwrite an existing file's content (media upload — no metadata changes).
async function updateBackupFile(token: string, id: string, json: string): Promise<Response> {
  return driveFetch(token, `${UPLOAD_API}/files/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: json,
  });
}

// ── The three public operations ───────────────────────────────────────────────

// Upload the current repertoire, creating or overwriting the single backup
// file. Returns how many lines it held. The file id is cached so the steady
// state is one HTTP request per backup.
export async function uploadBackupToDrive(): Promise<number> {
  const data = await exportBackup();
  const json = JSON.stringify(data);
  const token = await getToken();

  let id = localStorage.getItem(FILE_ID_KEY);
  if (id) {
    const res = await updateBackupFile(token, id, json);
    // The cached id can go stale (file deleted via Drive settings): fall
    // through to a fresh find-or-create instead of failing.
    if (res.status === 404) id = null;
    else if (!res.ok) throw new Error(`Drive said ${res.status} while saving the backup.`);
  }
  if (!id) {
    const existing = await findBackupFile(token);
    if (existing) {
      const res = await updateBackupFile(token, existing.id, json);
      if (!res.ok) throw new Error(`Drive said ${res.status} while saving the backup.`);
      id = existing.id;
    } else {
      id = await createBackupFile(token, json);
    }
    localStorage.setItem(FILE_ID_KEY, id);
  }

  localStorage.setItem(LAST_KEY, new Date().toISOString());
  localStorage.removeItem(PENDING_KEY);
  notifyChange();
  return data.lines.length;
}

// Fetch and parse the backup stored in Drive, or null when there isn't one.
// Validation happens in parseBackup, so callers get the same guarantees as a
// file import; writing it to the repertoire stays the caller's decision
// (Settings runs the usual merge-vs-replace chooser).
export async function downloadBackupFromDrive(): Promise<BackupFile | null> {
  const token = await getToken();
  const file = await findBackupFile(token);
  if (!file) return null;
  const res = await driveFetch(token, `${API}/files/${file.id}?alt=media`);
  if (!res.ok) throw new Error(`Drive said ${res.status} while downloading the backup.`);
  localStorage.setItem(FILE_ID_KEY, file.id);
  return parseBackup(await res.text());
}

// ── Auto-backup ───────────────────────────────────────────────────────────────
//
// Called once at boot. Every repertoire write (save/delete/merge/reset — see
// storage.ts) schedules a debounced upload, so an editing burst becomes one
// request ~30s after the last change. Failures never interrupt the user: we
// just mark the backup pending, and the next change (or a manual "Back up
// now") retries. If the cached token has expired GIS may need a popup, which
// browsers block outside a tap — that also lands in the pending state.

const AUTO_BACKUP_DELAY_MS = 30_000;
let autoTimer: number | undefined;
let autoBusy = false;
let autoDirty = false;

export function initDriveAutoBackup(): void {
  onLinesChanged(() => {
    if (!isDriveConfigured() || !isDriveConnected() || !getDriveAutoBackup()) return;
    localStorage.setItem(PENDING_KEY, '1');
    window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(runAutoBackup, AUTO_BACKUP_DELAY_MS);
  });
}

async function runAutoBackup(): Promise<void> {
  if (autoBusy) {
    autoDirty = true; // an upload is in flight; redo once it finishes
    return;
  }
  autoBusy = true;
  try {
    await uploadBackupToDrive();
  } catch {
    // Stay quiet: PENDING_KEY is already set, Settings shows "backup pending".
  } finally {
    autoBusy = false;
    if (autoDirty) {
      autoDirty = false;
      void runAutoBackup();
    }
  }
}
