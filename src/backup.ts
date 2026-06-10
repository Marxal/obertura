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
  mergeLines,
  replaceAllLines,
  getAllLines,
  type BackupFile,
} from './storage';
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
    'Your lines live only on this device. Export a backup file to keep in Drive ' +
    'or email — it’s the only way to get your repertoire back if this browser is ' +
    'cleared or you switch phones.';
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
      const data = await exportBackup();
      downloadBackup(data);
      const n = data.lines.length;
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
        if (mode === 'replace') await replaceAllLines(backup.lines);
        else await mergeLines(backup.lines);
        const n = backup.lines.length;
        setStatus(
          mode === 'replace'
            ? `Restored ${n} line${n === 1 ? '' : 's'} ✓`
            : `Merged in ${n} line${n === 1 ? '' : 's'} ✓`,
          'ok',
        );
        onRestored();
      } catch (err) {
        setStatus(`Import failed — ${(err as Error).message}`, 'error');
      }
    });
  });

  return section;
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
  summary.textContent =
    `This file has ${n} line${n === 1 ? '' : 's'}${when}. ` +
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
