// "Fixed" — the list behind the Middle-game pane's middle figure.
//
// The pane counted the mistakes you had put right and then had nowhere to put
// them: a number that only ever goes up, with no way to see WHAT it counted.
// That is the wrong shape for the one figure on that screen you should be proud
// of — and it is also the only record of which of your games have been worked
// through, which is a thing people want to look at.
//
// So the figure opens this: every fixed spot, newest first, grouped under the
// game it came from, each row a way back into the position. Nothing here is
// destructive and nothing is a new exercise — it is a record, with a door.

import type { SpotRef } from './mistake-scan';
import { CATEGORY_LABEL } from './mistake-run';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { formatMove, numberedMove } from './notation';

/** How many the "train these again" button deals. Same as a category session. */
export const REVISIT_SESSION = 5;

export interface FixedSheetOptions {
  /** Every spot marked fixed, in any order — this sorts them. */
  refs: SpotRef[];
  /** Drill these again. The sheet closes first. */
  onTrain: (refs: SpotRef[]) => void;
}

/** Fixed spots, most recently fixed first. */
export function orderFixed(refs: SpotRef[]): SpotRef[] {
  return refs
    .filter(r => r.spot.fixed)
    .slice()
    .sort((a, b) =>
      (b.spot.lastTrained ?? 0) - (a.spot.lastTrained ?? 0)
      || b.game.endTime - a.game.endTime);
}

/** The same spots grouped under their game, keeping that order. */
export function groupByGame(refs: SpotRef[]): { game: SpotRef['game']; spots: SpotRef[] }[] {
  const out: { game: SpotRef['game']; spots: SpotRef[] }[] = [];
  const index = new Map<string, { game: SpotRef['game']; spots: SpotRef[] }>();
  for (const ref of refs) {
    let group = index.get(ref.game.id);
    if (!group) {
      group = { game: ref.game, spots: [] };
      index.set(ref.game.id, group);
      out.push(group);
    }
    group.spots.push(ref);
  }
  return out;
}

/** The oldest fixes first — what "train these again" should deal. */
export function revisitOrder(refs: SpotRef[]): SpotRef[] {
  return orderFixed(refs).slice().reverse();
}

export function openFixedSheet(opts: FixedSheetOptions): void {
  const fixed = orderFixed(opts.refs);

  const overlay = document.createElement('div');
  overlay.className = 'edit-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'edit-sheet fixed-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const h = document.createElement('h3');
  h.className = 'edit-sheet-title';
  h.textContent = 'Mistakes you have fixed';
  sheet.appendChild(h);

  const groups = groupByGame(fixed);
  const blurb = document.createElement('p');
  blurb.className = 'section-desc';
  blurb.textContent = fixed.length === 0
    ? 'Nothing yet. A position you get right first time is marked fixed, and it lands here.'
    : `${fixed.length} ${fixed.length === 1 ? 'position' : 'positions'} you got right first time, `
      + `from ${groups.length} ${groups.length === 1 ? 'game' : 'games'}.`;
  sheet.appendChild(blurb);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    removeBack();
  };

  if (fixed.length > 0) {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn-secondary fixed-sheet-again';
    again.appendChild(Icons.reset(16));
    again.appendChild(document.createTextNode('Train these again'));
    again.addEventListener('click', () => {
      const deal = revisitOrder(fixed).slice(0, REVISIT_SESSION);
      close();
      opts.onTrain(deal);
    });
    sheet.appendChild(again);

    const list = document.createElement('div');
    list.className = 'fixed-sheet-list';
    for (const group of groups) list.appendChild(buildGroup(group, ref => {
      close();
      opts.onTrain([ref]);
    }));
    sheet.appendChild(list);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'dialog-btn-row';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'dialog-btn btn-primary';
  done.textContent = 'Done';
  done.addEventListener('click', close);
  btnRow.appendChild(done);
  sheet.appendChild(btnRow);

  const removeBack = pushBack(close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

// One game: its header (opponent, opening, how many fixed) and a row per spot.
function buildGroup(
  group: { game: SpotRef['game']; spots: SpotRef[] },
  onTrain: (ref: SpotRef) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fixed-game';

  const head = document.createElement('div');
  head.className = 'fixed-game-head';
  const name = document.createElement('span');
  name.className = 'fixed-game-name';
  name.textContent = `vs ${group.game.opponent}`;
  head.appendChild(name);
  const count = document.createElement('span');
  count.className = 'fixed-game-count';
  count.textContent = String(group.spots.length);
  head.appendChild(count);
  wrap.appendChild(head);

  if (group.game.opening) {
    const opening = document.createElement('div');
    opening.className = 'fixed-game-opening';
    opening.textContent = group.game.opening;
    wrap.appendChild(opening);
  }

  for (const ref of group.spots) wrap.appendChild(buildRow(ref, onTrain));
  return wrap;
}

// One fixed spot: what you played, what the engine wanted, and when you put it
// right. The whole row trains it again — there is nothing else it could do.
function buildRow(ref: SpotRef, onTrain: (ref: SpotRef) => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'fixed-row';
  row.addEventListener('click', () => onTrain(ref));

  const tick = document.createElement('span');
  tick.className = 'fixed-row-tick';
  tick.appendChild(Icons.checkCircle(15));
  row.appendChild(tick);

  const main = document.createElement('span');
  main.className = 'fixed-row-main';
  const moves = document.createElement('span');
  moves.className = 'fixed-row-moves';
  moves.textContent = `${numberedMove(ref.spot.playedSan, ref.spot.ply + 1)} → `
    + `${formatMove(ref.spot.best[0]?.san ?? '?')}`;
  main.appendChild(moves);
  const meta = document.createElement('span');
  meta.className = 'fixed-row-meta';
  meta.textContent = `${CATEGORY_LABEL[ref.spot.category]} · ${agoLabel(ref.spot.lastTrained)}`;
  main.appendChild(meta);
  row.appendChild(main);

  row.appendChild(Icons.chevronRight(15));
  return row;
}

// "today" / "3 days ago" — day-grained, because that is how often this list is
// worth looking at.
export function agoLabel(at: number | undefined, now: number = Date.now()): string {
  if (!at) return 'fixed';
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return 'fixed today';
  if (days === 1) return 'fixed yesterday';
  if (days < 30) return `fixed ${days} days ago`;
  const months = Math.round(days / 30);
  return `fixed ${months} month${months === 1 ? '' : 's'} ago`;
}
