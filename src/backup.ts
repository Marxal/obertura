// Backup & restore UI — the repertoire's safety net.
//
// All the data lives only in this browser's IndexedDB, so this is how it leaves
// the device: Export writes the whole repertoire to one JSON file you keep in
// Drive or email; Import reads such a file back. The storage layer does the
// real work (export/parse/restore); this module is just the buttons, the file
// download/pick plumbing, and the merge-vs-replace chooser.

import {
  exportBackup,
  parseBackup,
  restoreBackup,
  backupHasExtras,
  getAllLines,
  type BackupFile,
} from './storage';
import {
  DRIVE_CHANGE_EVENT,
  isDriveConfigured,
  isDriveConnected,
  connectDrive,
  disconnectDrive,
  uploadBackupToDrive,
  downloadBackupFromDrive,
  getDriveAutoBackup,
  setDriveAutoBackup,
  getLastDriveBackup,
  isDriveBackupPending,
} from './drive-backup';
import { Icons } from './icons';
import { pushBack } from './back-nav';

// Build the "Backup & restore" section. `onRestored` is called after a
// successful import so the caller can re-render the lines it just changed.
export function renderBackupSection(onRestored: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'backup-section';

  const heading = document.createElement('h2');
  heading.className = 'backup-title';
  heading.textContent = 'Backup & restore';
  section.appendChild(heading);

  const blurb = document.createElement('p');
  blurb.className = 'backup-blurb';
  blurb.textContent =
    'Everything lives only on this device. A backup file carries your lines, ' +
    'imported games, statistics and streaks — restore it and the app picks up ' +
    'exactly where you left it, on this phone or a new one.';
  section.appendChild(blurb);

  const row = document.createElement('div');
  row.className = 'backup-row';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'backup-btn';
  exportBtn.appendChild(Icons.download(16));
  exportBtn.appendChild(document.createTextNode('Export backup'));

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'backup-btn';
  importBtn.appendChild(Icons.upload(16));
  importBtn.appendChild(document.createTextNode('Import backup'));

  // The actual file picker, kept off-screen and triggered by the Import button.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  row.appendChild(exportBtn);
  row.appendChild(importBtn);
  section.appendChild(row);
  section.appendChild(fileInput);

  const status = document.createElement('p');
  status.className = 'backup-status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  section.appendChild(status);

  const setStatus = (msg: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    status.textContent = msg;
    status.hidden = false;
    status.className = `backup-status backup-status--${kind}`;
  };

  exportBtn.addEventListener('click', async () => {
    try {
      const n = await exportBackupNow();
      setStatus(`Exported ${n} line${n === 1 ? '' : 's'} ✓`, 'ok');
    } catch (err) {
      setStatus(`Export failed — ${(err as Error).message}`, 'error');
    }
  });

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    // Reset so picking the same file again still fires a change event.
    fileInput.value = '';
    if (!file) return;

    let backup: BackupFile;
    try {
      const text = await file.text();
      backup = parseBackup(text);
    } catch (err) {
      setStatus(`Couldn’t read that file — ${(err as Error).message}`, 'error');
      return;
    }

    const existing = (await getAllLines()).length;
    openImportChooser(backup, existing, async (mode) => {
      try {
        await restoreBackup(backup, mode);
        const n = backup.lines.length;
        setStatus(
          mode === 'replace'
            ? `Restored ${n} line${n === 1 ? '' : 's'} ✓`
            : `Merged in ${n} line${n === 1 ? '' : 's'} ✓`,
          'ok',
        );
        onRestored();
        reloadAfterRestore(backup, setStatus);
      } catch (err) {
        setStatus(`Import failed — ${(err as Error).message}`, 'error');
      }
    });
  });

  return section;
}

// A backup that carries stats/streaks/games needs a reload to take everywhere —
// several modules cache their localStorage state in memory at boot. Give the
// status line a beat to be read, then refresh into the restored state.
function reloadAfterRestore(
  backup: BackupFile,
  setStatus: (msg: string, kind?: 'ok' | 'error' | 'info') => void,
): void {
  if (!backupHasExtras(backup)) return;
  setStatus('Everything restored ✓ — reloading…', 'ok');
  setTimeout(() => window.location.reload(), 1200);
}

// Run the export immediately: gather the whole repertoire and hand the browser
// a dated download file, returning how many lines it held. Exposed so other
// screens — notably the "Erase everything" dialog's "export a backup first"
// step — can offer a one-tap backup without rebuilding the whole section.
export async function exportBackupNow(): Promise<number> {
  const data = await exportBackup();
  downloadBackup(data);
  return data.lines.length;
}

// Serialise the backup and hand it to the browser as a dated download. Object
// URLs are revoked after the click so we don't leak them.
function downloadBackup(data: BackupFile): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `obertura-backup-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Cloud backup (Google Drive) ───────────────────────────────────────────────
//
// The same backup file, kept in the app's hidden folder in the user's Google
// Drive instead of a manual download. Connect once; from then on every change
// is backed up automatically (~30s after the last edit — see drive-backup.ts),
// and any device that connects to the same Google account can restore. All the
// Drive plumbing lives in drive-backup.ts; this is just the Settings section.
export function renderCloudBackupSection(onRestored: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'backup-section backup-section--cloud';

  const render = (): void => {
    section.replaceChildren();

    const heading = document.createElement('h2');
    heading.className = 'backup-title';
    heading.textContent = 'Cloud backup — Google Drive';
    section.appendChild(heading);

    // Not wired to a Google project yet: say so honestly instead of showing
    // buttons that can't work. The setup steps live in DRIVE-SETUP.md.
    if (!isDriveConfigured()) {
      const note = document.createElement('p');
      note.className = 'backup-blurb';
      note.textContent =
        'Almost ready — this build isn’t linked to a Google project yet, so ' +
        'cloud backup is switched off. Manual export/import above works as always.';
      section.appendChild(note);
      return;
    }

    if (!isDriveConnected()) {
      renderDisconnected();
      return;
    }
    renderConnected();
  };

  // Shared status line, rebuilt with the section on every render.
  let setStatus: (msg: string, kind?: 'ok' | 'error' | 'info') => void = () => {};
  const addStatusLine = (): void => {
    const status = document.createElement('p');
    status.className = 'backup-status';
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    section.appendChild(status);
    setStatus = (msg, kind = 'info') => {
      status.textContent = msg;
      status.hidden = false;
      status.className = `backup-status backup-status--${kind}`;
    };
  };

  function renderDisconnected(): void {
    const blurb = document.createElement('p');
    blurb.className = 'backup-blurb';
    blurb.textContent =
      'Keep a copy of your repertoire in your own Google Drive, updated ' +
      'automatically. It’s stored in a hidden app folder — Obertura can never ' +
      'see your files — and any device signed into the same account can restore it.';
    section.appendChild(blurb);

    const row = document.createElement('div');
    row.className = 'backup-row';
    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'backup-btn';
    connectBtn.appendChild(Icons.link(16));
    connectBtn.appendChild(document.createTextNode('Connect Google Drive'));
    row.appendChild(connectBtn);
    section.appendChild(row);
    addStatusLine();

    connectBtn.addEventListener('click', async () => {
      connectBtn.disabled = true;
      setStatus('Opening Google sign-in…');
      try {
        await connectDrive();
        await afterConnect();
      } catch (err) {
        setStatus((err as Error).message, 'error');
        connectBtn.disabled = false;
        return;
      }
      render();
    });
  }

  // First moments after connecting. Order matters: on a fresh device the user
  // wants their old backup BACK, so we look before we ever upload — an eager
  // first upload would overwrite the cloud copy with an empty repertoire.
  async function afterConnect(): Promise<void> {
    const remote = await downloadBackupFromDrive();
    if (remote && remote.lines.length > 0) {
      const existing = (await getAllLines()).length;
      openImportChooser(remote, existing, async (mode) => {
        await restoreBackup(remote, mode);
        onRestored();
        // The restore itself re-uploads via auto-backup; nothing else to do.
        reloadAfterRestore(remote, setStatus);
      });
      return;
    }
    // No backup in Drive yet (or an empty one): seed it with what's here.
    await uploadBackupToDrive();
  }

  function renderConnected(): void {
    const caption = document.createElement('p');
    caption.className = 'backup-blurb';
    caption.textContent = lastBackupCaption();
    section.appendChild(caption);

    const row = document.createElement('div');
    row.className = 'backup-row';

    const backupBtn = document.createElement('button');
    backupBtn.type = 'button';
    backupBtn.className = 'backup-btn';
    backupBtn.appendChild(Icons.upload(16));
    backupBtn.appendChild(document.createTextNode('Back up now'));

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'backup-btn';
    restoreBtn.appendChild(Icons.download(16));
    restoreBtn.appendChild(document.createTextNode('Restore from Drive'));

    row.appendChild(backupBtn);
    row.appendChild(restoreBtn);
    section.appendChild(row);

    // Auto-backup switch, in the shared .pref-row style used across Settings.
    const autoRow = document.createElement('div');
    autoRow.className = 'pref-row pref-row--switch';
    const head = document.createElement('div');
    head.className = 'pref-row-head';
    const title = document.createElement('div');
    title.className = 'pref-row-title';
    title.textContent = 'Back up automatically';
    const ctrl = document.createElement('div');
    ctrl.className = 'pref-row-control';
    ctrl.appendChild(switchControl(getDriveAutoBackup(), (on) => setDriveAutoBackup(on)));
    head.appendChild(title);
    head.appendChild(ctrl);
    autoRow.appendChild(head);
    const desc = document.createElement('div');
    desc.className = 'pref-row-desc';
    desc.textContent = 'Uploads a fresh backup about half a minute after you change your lines.';
    autoRow.appendChild(desc);
    section.appendChild(autoRow);

    const disconnectBtn = document.createElement('button');
    disconnectBtn.type = 'button';
    disconnectBtn.className = 'backup-disconnect';
    disconnectBtn.textContent = 'Disconnect Google Drive';
    section.appendChild(disconnectBtn);

    addStatusLine();

    backupBtn.addEventListener('click', async () => {
      backupBtn.disabled = true;
      setStatus('Backing up…');
      try {
        const n = await uploadBackupToDrive();
        setStatus(`Backed up ${n} line${n === 1 ? '' : 's'} to Drive ✓`, 'ok');
      } catch (err) {
        setStatus(`Backup failed — ${(err as Error).message}`, 'error');
      } finally {
        backupBtn.disabled = false;
      }
    });

    restoreBtn.addEventListener('click', async () => {
      restoreBtn.disabled = true;
      setStatus('Fetching your backup…');
      let remote: BackupFile | null;
      try {
        remote = await downloadBackupFromDrive();
      } catch (err) {
        setStatus(`Couldn’t fetch the backup — ${(err as Error).message}`, 'error');
        restoreBtn.disabled = false;
        return;
      }
      restoreBtn.disabled = false;
      if (!remote) {
        setStatus('No backup in Drive yet — tap “Back up now” first.', 'info');
        return;
      }
      const existing = (await getAllLines()).length;
      openImportChooser(remote, existing, async (mode) => {
        try {
          await restoreBackup(remote, mode);
          const n = remote.lines.length;
          setStatus(
            mode === 'replace'
              ? `Restored ${n} line${n === 1 ? '' : 's'} from Drive ✓`
              : `Merged in ${n} line${n === 1 ? '' : 's'} from Drive ✓`,
            'ok',
          );
          onRestored();
          reloadAfterRestore(remote, setStatus);
        } catch (err) {
          setStatus(`Restore failed — ${(err as Error).message}`, 'error');
        }
      });
    });

    disconnectBtn.addEventListener('click', () => {
      disconnectDrive();
      render();
    });
  }

  // Keep the caption honest while the section is on screen (auto-backups land
  // in the background); the listener detaches itself once the section is gone.
  const onChange = (): void => {
    if (!section.isConnected) {
      window.removeEventListener(DRIVE_CHANGE_EVENT, onChange);
      return;
    }
    render();
  };
  window.addEventListener(DRIVE_CHANGE_EVENT, onChange);

  render();
  return section;
}

// "Last backed up: …" with the pending state taking priority — pending means
// the repertoire changed but the upload hasn't succeeded yet.
function lastBackupCaption(): string {
  if (isDriveBackupPending()) return 'Backup pending — it’ll upload automatically, or tap “Back up now”.';
  const iso = getLastDriveBackup();
  if (!iso) return 'Not backed up yet.';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(days) || days <= 0) return 'Last backed up: today.';
  if (days === 1) return 'Last backed up: yesterday.';
  return `Last backed up: ${days} days ago.`;
}

// The same .switch markup Settings uses for its toggles (settings-screen.ts),
// rebuilt here so this module stays free of a settings-screen import.
function switchControl(current: boolean, onChange: (v: boolean) => void): HTMLElement {
  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = current;
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span');
  track.className = 'switch-track';
  label.appendChild(input);
  label.appendChild(track);
  return label;
}

type ImportMode = 'merge' | 'replace';

// Ask how to bring the file in. Merge is the safe default — it never deletes
// anything (same-id lines update, new ones are added). Replace wipes the
// current repertoire and restores exactly the file, for a clean restore onto a
// cleared or fresh browser. The chooser shows the counts so the choice is
// informed.
function openImportChooser(
  backup: BackupFile,
  existingCount: number,
  onChoose: (mode: ImportMode) => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet';

  const title = document.createElement('h3');
  title.className = 'edit-sheet-title';
  title.textContent = 'Import backup';
  sheet.appendChild(title);

  const n = backup.lines.length;
  const summary = document.createElement('p');
  summary.className = 'backup-import-summary';
  const when = backup.exportedAt ? ` from ${backup.exportedAt.slice(0, 10)}` : '';
  const parts = [`${n} line${n === 1 ? '' : 's'}`];
  const g = backup.games?.length ?? 0;
  if (g > 0) parts.push(`${g} game${g === 1 ? '' : 's'}`);
  if (backup.local) parts.push('your stats & settings');
  const has = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
  summary.textContent =
    `This backup${when} has ${has}. ` +
    `You currently have ${existingCount} line${existingCount === 1 ? '' : 's'} on this device.`;
  sheet.appendChild(summary);

  // Merge — recommended/safe. Listed first.
  const mergeBtn = document.createElement('button');
  mergeBtn.type = 'button';
  mergeBtn.className = 'backup-choice-btn';
  mergeBtn.innerHTML =
    '<strong>Merge (recommended)</strong>' +
    '<span>Add the file’s lines and update matching ones. Nothing is deleted.</span>';
  mergeBtn.addEventListener('click', () => {
    close();
    onChoose('merge');
  });
  sheet.appendChild(mergeBtn);

  // Replace — clean restore, destructive when the device already has lines.
  const replaceBtn = document.createElement('button');
  replaceBtn.type = 'button';
  replaceBtn.className = 'backup-choice-btn backup-choice-btn--danger';
  replaceBtn.innerHTML =
    '<strong>Replace everything</strong>' +
    '<span>Delete what’s here and restore exactly this file. Best for a fresh or cleared browser.</span>';
  replaceBtn.addEventListener('click', () => {
    close();
    onChoose('replace');
  });
  sheet.appendChild(replaceBtn);

  const btnRow = document.createElement('div');
  btnRow.className = 'edit-btn-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  btnRow.appendChild(cancelBtn);
  sheet.appendChild(btnRow);

  function close() {
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}
