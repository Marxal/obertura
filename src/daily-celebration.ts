// The popup that lands when the whole daily challenge is cleared.
//
// Two faces, one module:
//
//  • The everyday one — the hopping pixel pawn, today's accuracy against the
//    last day you did this, and three overall figures (streak, challenges
//    cleared, lines mastered). Centred, one button, tap anywhere to dismiss.
//    Deliberately small: it's a pat on the back, not a report.
//
//  • The perfect day — every single move right, across a challenge worth
//    winning (see perfectDayEligible in daily-challenge.ts). The pawn walks all
//    the way and QUEENS: it hops, bursts, and comes back as a pixel queen in
//    brass. It's meant to be a surprise, so nothing anywhere else hints at it.
//
// It waits for the finishing task's own results screen to close before it shows
// (see showWhenClear) — two celebration screens stacked on top of each other is
// one too many.

import { celebratePawn, burstConfetti, starfall } from './confetti';
import { pixelQueenSvg } from './pixel-pawn';
import { pushBack } from './back-nav';
import { formatDayLabel, recapMessage, type Recap } from './daily-recap';

// How long the promoting pawn hops before it queens.
const PROMOTE_AT_MS = 1100;

// ── Waiting for a clear screen ───────────────────────────────────────────────
//
// The last task finishes on its own full-screen results panel (.pt-overlay), so
// the celebration holds until that's gone. Watching the DOM beats polling; the
// settle delay covers a results screen that closes straight into another overlay
// ("Try your mistakes again"), which would otherwise flash the popup in between.

const SETTLE_MS = 260;

export function showWhenClear(run: () => void): void {
  const blocked = (): boolean => document.querySelector('.pt-overlay') !== null;
  if (!blocked()) { run(); return; }

  let settle: number | null = null;
  const observer = new MutationObserver(() => {
    if (blocked()) {
      if (settle !== null) { window.clearTimeout(settle); settle = null; }
      return;
    }
    if (settle !== null) return;
    settle = window.setTimeout(() => {
      settle = null;
      if (blocked()) return;
      observer.disconnect();
      run();
    }, SETTLE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: false });
}

// ── The popup shell ──────────────────────────────────────────────────────────

function mountPopup(variant: 'daily' | 'perfect'): { pop: HTMLElement; close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'dc-overlay';

  const pop = document.createElement('div');
  pop.className = 'dc-pop' + (variant === 'perfect' ? ' dc-pop--perfect' : '');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  overlay.appendChild(pop);

  let closed = false;
  let removeBack: (() => void) | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    removeBack?.();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  // Easy to get rid of: the backdrop, the system back gesture and Escape all
  // dismiss it, as well as the button.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  removeBack = pushBack(close);
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  return { pop, close };
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dismissButton(label: string, close: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary dc-pop-btn';
  btn.textContent = label;
  btn.addEventListener('click', close);
  return btn;
}

// ── The everyday celebration ─────────────────────────────────────────────────

export function showDailyCelebration(recap: Recap): void {
  const { pop, close } = mountPopup('daily');
  pop.setAttribute('aria-label', 'Daily challenge complete');

  pop.appendChild(celebratePawn());
  pop.appendChild(el('div', 'dc-pop-title', 'Daily challenge done'));
  // A day reopened from the calendar says WHICH day, so nothing on the popup
  // can be misread as being about today.
  if (recap.replay) pop.appendChild(el('div', 'dc-pop-day', formatDayLabel(recap.day)));
  pop.appendChild(el('div', 'dc-pop-sub', subtitleFor(recap)));

  if (recap.total > 0) pop.appendChild(buildCompare(recap));
  pop.appendChild(el('p', 'dc-pop-msg', recapMessage(recap)));
  pop.appendChild(buildStrip(recap));
  pop.appendChild(dismissButton(recap.replay ? 'Close' : 'Nice', close));

  // A replay is a look back, not an event — no confetti for a day you already
  // celebrated once.
  if (!recap.replay) burstConfetti(pop);
}

// The one line under the title. It used to say "Every task cleared", which is
// both the wrong word (it is one challenge, in parts) and the least interesting
// fact available — the user had just cleared it, so they knew. The score is what
// they actually want: how many of the moves they played came back right.
function subtitleFor(recap: Recap): string {
  if (recap.total === 0) return 'Nothing to score today — the challenge is cleared';
  const right = `${recap.right} correct move${recap.right === 1 ? '' : 's'}`;
  const played = `${recap.total} played move${recap.total === 1 ? '' : 's'}`;
  return `${right} of ${played}`;
}

// The day's accuracy, big, with the previous day's underneath it as two thin
// bars — the whole "am I getting better" story in one glance. A reopened day
// names itself rather than borrowing the word "today".
function buildCompare(recap: Recap): HTMLElement {
  const wrap = el('div', 'dc-compare');
  const dayWord = recap.replay ? formatDayLabel(recap.day) : 'Today';

  const scoreRow = el('div', 'dc-score-row');
  scoreRow.appendChild(el('span', 'dc-score', `${recap.accuracy}%`));
  scoreRow.appendChild(el('span', 'dc-score-label',
    recap.replay ? `right that day` : 'right today'));
  if (recap.delta !== null && recap.delta !== 0) {
    const up = recap.delta > 0;
    const chip = el('span', `dc-delta ${up ? 'dc-delta--up' : 'dc-delta--down'}`,
      `${up ? '▲' : '▼'} ${Math.abs(recap.delta)}`);
    chip.setAttribute('aria-label',
      `${Math.abs(recap.delta)} points ${up ? 'up on' : 'down on'} last time`);
    scoreRow.appendChild(chip);
  }
  wrap.appendChild(scoreRow);

  if (recap.compare) {
    // "Yesterday" only means yesterday from today; on a replay the compare day
    // is the one before THAT day, so it reads as "the day before".
    const before = recap.compare.isYesterday
      ? (recap.replay ? 'The day before' : 'Yesterday')
      : 'Last time';
    wrap.appendChild(bar(before, recap.compare.accuracy, false));
  }
  wrap.appendChild(bar(dayWord, recap.accuracy, true));
  return wrap;
}

function bar(label: string, pct: number, now: boolean): HTMLElement {
  const row = el('div', 'dc-bar-row' + (now ? ' dc-bar-row--now' : ''));
  row.appendChild(el('span', 'dc-bar-label', label));

  const track = el('span', 'dc-bar-track');
  const fill = el('span', 'dc-bar-fill');
  // Animated from 0 on the next frame so the bars grow into place.
  fill.style.width = '0%';
  track.appendChild(fill);
  row.appendChild(track);
  requestAnimationFrame(() => { fill.style.width = `${Math.max(2, pct)}%`; });

  row.appendChild(el('span', 'dc-bar-pct', `${pct}%`));
  return row;
}

// The three figures that say "this is going somewhere": how long the run is, how
// many challenges are behind you, and how much of the repertoire is solid.
function buildStrip(recap: Recap): HTMLElement {
  const strip = el('div', 'dc-strip');
  strip.appendChild(tile(String(recap.streak), 'day streak', recap.streakIsBest ? 'best yet' : null));
  strip.appendChild(tile(String(recap.challengesDone), 'challenges', null));
  strip.appendChild(tile(
    `${recap.linesMastered}/${recap.linesInTraining}`,
    'lines solid',
    null,
  ));
  return strip;
}

function tile(value: string, label: string, flag: string | null): HTMLElement {
  const t = el('div', 'dc-tile');
  t.appendChild(el('span', 'dc-tile-value', value));
  t.appendChild(el('span', 'dc-tile-label', label));
  if (flag) t.appendChild(el('span', 'dc-tile-flag', flag));
  return t;
}

// ── The perfect day ──────────────────────────────────────────────────────────

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

function ordinal(n: number): string {
  if (n < ORDINALS.length) return ORDINALS[n];
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

export function showPerfectDayCelebration(recap: Recap): void {
  const { pop, close } = mountPopup('perfect');
  pop.setAttribute('aria-label', 'Perfect day — every move right');

  pop.appendChild(buildPromotion(recap.replay));
  pop.appendChild(el('div', 'dc-eyebrow', 'PERFECT DAY'));
  pop.appendChild(el('div', 'dc-pop-title', 'Your pawn just queened'));
  if (recap.replay) pop.appendChild(el('div', 'dc-pop-day', formatDayLabel(recap.day)));
  pop.appendChild(el('div', 'dc-pop-sub',
    `${recap.right} correct move${recap.right === 1 ? '' : 's'} of ${
      recap.total} played move${recap.total === 1 ? '' : 's'}. Not one missed.`));

  pop.appendChild(el('p', 'dc-pop-msg', perfectMessage(recap)));

  const strip = el('div', 'dc-strip dc-strip--perfect');
  strip.appendChild(tile('100%', 'clean sweep', null));
  strip.appendChild(tile(String(recap.perfectDays), recap.perfectDays === 1 ? 'perfect day' : 'perfect days', null));
  strip.appendChild(tile(String(recap.streak), 'day streak', recap.streakIsBest ? 'best yet' : null));
  pop.appendChild(strip);

  pop.appendChild(dismissButton(recap.replay ? 'Close' : 'Take a bow', close));

  // The full works: a burst on arrival, stars raining through, and a second
  // burst as the pawn promotes. A replay gets the queen and none of the theatre.
  if (recap.replay) return;
  burstConfetti(pop);
  starfall(pop);
  window.setTimeout(() => burstConfetti(pop), PROMOTE_AT_MS);
}

function perfectMessage(recap: Recap): string {
  if (recap.perfectDays <= 1) return 'A whole daily challenge without a single wrong move. That is rare — enjoy it.';
  return `Your ${ordinal(recap.perfectDays)} flawless day. You are making this look easy.`;
}

// The pawn hops, then promotes: it bursts and comes back as a queen. Reduced
// motion — and a day being looked back at — skip the theatre and show the queen
// straight away.
function buildPromotion(replay: boolean): HTMLElement {
  const stage = el('div', 'dc-promote');
  stage.setAttribute('aria-hidden', 'true');

  const reduce = replay || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    stage.appendChild(queenEl());
    return stage;
  }

  const pawn = celebratePawn();
  pawn.classList.add('dc-promote-pawn');
  stage.appendChild(pawn);

  window.setTimeout(() => {
    pawn.classList.add('dc-promote-pawn--gone');
    const queen = queenEl();
    queen.classList.add('dc-queen--pop');
    stage.appendChild(queen);
    window.setTimeout(() => pawn.remove(), 400);
  }, PROMOTE_AT_MS);

  return stage;
}

function queenEl(): HTMLElement {
  const wrap = el('div', 'dc-queen');
  wrap.innerHTML = pixelQueenSvg('dc-queen-svg');
  return wrap;
}
