// Backup & restore UI — the repertoire's safety net, and the way data leaves
// the device on purpose.
//
// Export writes a JSON file you keep wherever you like; Import reads one back.
// The storage layer does the real work (export/parse/restore); this module is
// the buttons, the file download/pick plumbing, and the merge-vs-replace
// chooser.
//
// ── EXPORTING PART OF IT ────────────────────────────────────────────────────
// The dropdown next to Export picks how much goes in the file: everything, or
// just the lines, the games, the statistics or the settings. It exists because
// those are four different things to want. Moving to a new phone wants
// everything; sharing a repertoire, or keeping a snapshot of it before a big
// rewrite, wants the lines alone and none of the megabytes of games; starting a
// season fresh but keeping your board colours wants the settings alone.
//
// The file says which parts it carries (`parts` in storage.ts), and that is what
// makes a partial import safe: "Replace everything" on a lines-only file
// replaces the LINES and leaves the games alone, because the file never claimed
// to speak for them.

import {
  exportBackup,
  parseBackup,
  restoreBackup,
  backupHasExtras,
  describeBackup,
  partsInBackup,
  getAllLines,
  ALL_BACKUP_PARTS,
  type BackupPart,
  type BackupFile,
} from './storage';
import { Icons } from './icons';
import { pushBack } from './back-nav';

// What the dropdown offers, in the order it offers it. "Everything" first
// because it is what most people want and what the erase dialog's one-tap
// backup uses.
const EXPORT_CHOICES: { value: 'everything' | BackupPart; label: string; hint: string }[] = [
  { value: 'everything', label: 'Everything', hint: 'Lines, games, statistics and settings.' },
  { value: 'lines', label: 'Lines', hint: 'Your repertoires and their move trees.' },
  { value: 'games', label: 'Games', hint: 'Your imported games.' },
  { value: 'stats', label: 'Statistics', hint: 'Training history, streaks, ratings and bests.' },
  { value: 'settings', label: 'Settings', hint: 'Board, pieces, notation and preferences.' },
];

function partsFor(choice: 'everything' | BackupPart): readonly BackupPart[] {
  return choice === 'everything' ? ALL_BACKUP_PARTS : [choice];
}

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
    'A backup file carries your lines, imported games, statistics and settings — ' +
    'restore it and the app picks up exactly where you left it, on this phone or ' +
    'a new one. Pick a smaller piece below if that’s all you want.';
  section.appendChild(blurb);

  // What to export. A plain <select>, so a phone gives it the native wheel.
  const choiceWrap = document.createElement('label');
  choiceWrap.className = 'backup-choice-field';
  const choiceLabel = document.createElement('span');
  choiceLabel.className = 'backup-choice-label';
  choiceLabel.textContent = 'Export';
  choiceWrap.appendChild(choiceLabel);

  const choice = document.createElement('select');
  choice.className = 'backup-choice-select';
  for (const option of EXPORT_CHOICES) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    choice.appendChild(el);
  }
  choiceWrap.appendChild(choice);
  section.appendChild(choiceWrap);

  const hint = document.createElement('p');
  hint.className = 'backup-choice-hint';
  const paintHint = (): void => {
    hint.textContent = EXPORT_CHOICES.find(c => c.value === choice.value)?.hint ?? '';
  };
  choice.addEventListener('change', paintHint);
  paintHint();
  section.appendChild(hint);

  const row = document.createElement('div');
  row.className = 'backup-row';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'backup-btn';
  exportBtn.appendChild(Icons.download(16));
  exportBtn.appendChild(document.createTextNode('Export'));

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'backup-btn';
  importBtn.appendChild(Icons.upload(16));
  importBtn.appendChild(document.createTextNode('Import'));

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
    const picked = choice.value as 'everything' | BackupPart;
    try {
      const summary = await exportBackupNow(partsFor(picked));
      setStatus(`Exported ${summary} ✓`, 'ok');
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
        setStatus(
          mode === 'replace'
            ? `Restored ${describeBackup(backup)} ✓`
            : `Merged in ${describeBackup(backup)} ✓`,
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

// Run the export immediately: gather the requested parts and hand the browser a
// dated download file, returning a human summary of what went in it. Exposed so
// other screens — notably the "Erase everything" and "Delete account" dialogs'
// "export a backup first" step — can offer a one-tap backup without rebuilding
// the whole section. Those callers pass nothing and get everything.
export async function exportBackupNow(
  parts: readonly BackupPart[] = ALL_BACKUP_PARTS,
): Promise<string> {
  const data = await exportBackup(parts);
  downloadBackup(data);
  return describeBackup(data);
}

// Serialise the backup and hand it to the browser as a dated download. The
// filename names the parts when it isn't a whole backup, so a folder of these
// can be told apart a year later without opening any of them. Object URLs are
// revoked after the click so we don't leak them.
function downloadBackup(data: BackupFile): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const parts = partsInBackup(data);
  const tag = parts.length === ALL_BACKUP_PARTS.length ? '' : `-${parts.join('-')}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `obertura-backup${tag}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ImportMode = 'merge' | 'replace';

const PART_LABELS: Record<BackupPart, string> = {
  lines: 'your lines',
  games: 'your games',
  stats: 'your statistics',
  settings: 'your settings',
};

function partLabels(parts: readonly BackupPart[]): string {
  const names = parts.map((p) => PART_LABELS[p]);
  if (names.length <= 1) return names[0] ?? 'nothing';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Ask how to bring the file in. Merge is the safe default — it never deletes
// anything (same-id lines update, new ones are added). Replace wipes the
// current repertoire and restores exactly the file, for a clean restore onto a
// cleared or fresh browser. The chooser shows the counts so the choice is
// informed.
//
// Exported so account sync (repertoire-sync.ts) asks the question the same way
// a manual import does — one chooser, whatever the copy arrived from.
export function openImportChooser(
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

  const parts = partsInBackup(backup);
  const summary = document.createElement('p');
  summary.className = 'backup-import-summary';
  const when = backup.exportedAt ? ` from ${backup.exportedAt.slice(0, 10)}` : '';
  summary.textContent =
    `This backup${when} has ${describeBackup(backup)}. ` +
    `You currently have ${existingCount} line${existingCount === 1 ? '' : 's'} on this device.`;
  sheet.appendChild(summary);

  // What "Replace everything" would actually touch. A partial file only ever
  // replaces the parts it carries, and saying which ones out loud is the
  // difference between an informed choice and a scary one.
  const scope = document.createElement('p');
  scope.className = 'backup-import-scope';
  scope.textContent = parts.length === ALL_BACKUP_PARTS.length
    ? 'It covers everything on this device.'
    : `It only covers ${partLabels(parts)} — the rest of your data is left alone either way.`;
  sheet.appendChild(scope);

  // Merge — recommended/safe. Listed first.
  const mergeBtn = document.createElement('button');
  mergeBtn.type = 'button';
  mergeBtn.className = 'backup-choice-btn';
  mergeBtn.innerHTML =
    '<strong>Merge (recommended)</strong>' +
    '<span>Add what the file has and update what matches. Nothing is deleted.</span>';
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
    '<strong>Replace</strong>' +
    '<span>Delete what the file covers and restore exactly what it holds. Best for a fresh or cleared browser.</span>';
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
