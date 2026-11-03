// The one "this is made by one person" note: after real use, once, on Home. It's
// the part of the offer that isn't about a limit, so it waits until someone has
// trained on many separate days, and it never interrupts training.
//
// The key travels with the account, so dismissing it here dismisses it everywhere.

import { isSupabaseConfigured } from './supabase';
import { isEntitled, buildCapNotice, showGoProDialog } from './entitlement';
import { getTrainingDays } from './streak';

const KEY = 'obertura.supportNoteDone';
export const SUPPORT_NOTE_DAYS = 14;

/** Pure, so the self-test can hold the rule. */
export function supportNoteDue(o: {
  configured: boolean; entitled: boolean; trainingDays: number; done: boolean;
}): boolean {
  return o.configured && !o.entitled && !o.done && o.trainingDays >= SUPPORT_NOTE_DAYS;
}

function markDone(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* storage off: it may come back */ }
}

export function buildSupportNote(): HTMLElement | null {
  let done = false;
  try { done = localStorage.getItem(KEY) === '1'; } catch { /* treat as not done */ }
  const trainingDays = getTrainingDays().length;
  if (!supportNoteDue({ configured: isSupabaseConfigured, entitled: isEntitled(), trainingDays, done })) {
    return null;
  }

  const note = buildCapNotice(`${trainingDays} days of training`, {
    detail: 'Bito Chess is made by one person. No ads, no investors.',
    label: 'Become a founding member',
    onOpen: () => {
      markDone();
      note.remove();
      showGoProDialog();
    },
  });
  note.classList.add('support-note');

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'support-note-later';
  later.textContent = 'Not now';
  later.addEventListener('click', () => {
    markDone();
    note.remove();
  });
  note.appendChild(later);
  return note;
}
