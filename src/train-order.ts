// The order of the four Train tabs — the one Train preference you set by hand.
//
// Long-press a tab in the Train switch and drag it (main.ts, renderTrainRoom);
// the first tab is where Train opens on launch. Settings → Training has the
// reset. It is a plain `obertura.` key, so it rides the account sync with the
// rest of the preferences (local-keys.ts): a second phone gets the same order.
//
// No imports beyond the domain type, so Settings can read and reset it without
// pulling in the Train screen.

import type { DomainId } from './train-doors';

const ORDER_KEY = 'obertura.trainOrder';
// Set once the "long-press to reorder" hint has been shown. Synced too: someone
// who has seen it on one phone has learnt it.
const HINT_KEY = 'obertura.trainOrderHintSeen';

export const DEFAULT_TRAIN_ORDER: readonly DomainId[] = ['openings', 'middlegame', 'tactics', 'endgames'];

/** The saved order, or the default. A stored value that isn't exactly the four domains is ignored. */
export function getTrainOrder(): DomainId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null') as unknown;
    if (Array.isArray(raw) && raw.length === DEFAULT_TRAIN_ORDER.length
      && DEFAULT_TRAIN_ORDER.every((d) => raw.includes(d))) {
      return raw as DomainId[];
    }
  } catch { /* unreadable: fall through to the default */ }
  return [...DEFAULT_TRAIN_ORDER];
}

export function setTrainOrder(order: DomainId[]): void {
  try {
    if (order.every((d, i) => d === DEFAULT_TRAIN_ORDER[i])) localStorage.removeItem(ORDER_KEY);
    else localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch { /* storage refused: the order just won't persist */ }
}

export function resetTrainOrder(): void {
  setTrainOrder([...DEFAULT_TRAIN_ORDER]);
}

export function isCustomTrainOrder(): boolean {
  return getTrainOrder().some((d, i) => d !== DEFAULT_TRAIN_ORDER[i]);
}

export function trainOrderHintSeen(): boolean {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; }
}

export function markTrainOrderHintSeen(): void {
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* fine */ }
}
