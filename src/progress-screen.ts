// The "Progress" tab: is drilling actually helping?
//
// For every line you've drilled, it lines up your real game results from before
// you last drilled it against the games you've played since, so you can see at a
// glance whether the work is paying off — or whether a line needs another look.
//
// All of it comes from data already on the device (imported games + each line's
// last-drilled date); see progress.ts for the linking and the before/after split.

import { getAllGames, getAllLines } from './storage';
import {
  crossReference,
  type ProgressReport,
  type LineProgress,
  type ProgressWindow,
  type ProgressVerdict,
} from './progress';
import { runProgressSelfTest } from './progress.selftest';

export interface ProgressCallbacks {
  // Jump to the Train tab so a flagged line can be drilled right away.
  onOpenTrain: () => void;
}

export function renderProgressScreen(container: HTMLElement, cb: ProgressCallbacks): void {
  void doRender(container, cb);
}

async function doRender(container: HTMLElement, cb: ProgressCallbacks): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const [games, lines] = await Promise.all([getAllGames(), getAllLines()]);
  container.innerHTML = '';

  const report = crossReference(games, lines);

  if (games.length === 0) {
    renderEmpty(
      container,
      'No games to cross-reference yet',
      'Open Build → Settings and import your Chess.com games. Then drill a line or two and come back to see whether the work is moving your results.',
    );
    appendSelfTestLink(container);
    return;
  }

  if (report.items.length === 0) {
    renderEmpty(
      container,
      'Nothing to compare yet',
      'None of your imported games match a saved line. Build the openings you actually play (the Review tab shows which), add them to training, and this tab will start tracking whether drilling helps.',
    );
    appendSelfTestLink(container);
    return;
  }

  renderIntro(container, report);
  for (const item of report.items) {
    container.appendChild(progressCard(item, cb));
  }
  appendSelfTestLink(container);
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement, titleText: string, bodyText: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'train-empty';

  const title = document.createElement('p');
  title.className = 'train-empty-title';
  title.textContent = titleText;
  wrap.appendChild(title);

  const body = document.createElement('p');
  body.className = 'train-empty-body';
  body.textContent = bodyText;
  wrap.appendChild(body);

  container.appendChild(wrap);
}

// ── Intro line ─────────────────────────────────────────────────────────────────

function renderIntro(container: HTMLElement, r: ProgressReport): void {
  const intro = document.createElement('div');
  intro.className = 'review-intro';
  intro.textContent =
    `${r.totalLinkedGames} game${r.totalLinkedGames === 1 ? '' : 's'} matched to ` +
    `${r.linkedLines} of your line${r.linkedLines === 1 ? '' : 's'}. ` +
    `Before vs. since you last drilled each:`;
  container.appendChild(intro);
}

// ── Verdict badge ────────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<ProgressVerdict, string> = {
  improved: '↑ Improving',
  declined: '↓ Slipping',
  steady: '→ Holding steady',
  'too-soon': 'Too soon to tell',
  untrained: 'Not drilled yet',
};

function verdictBadge(item: LineProgress): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `progress-verdict progress-verdict--${item.verdict}`;
  let text = VERDICT_LABEL[item.verdict];
  if (item.delta !== null && (item.verdict === 'improved' || item.verdict === 'declined')) {
    const sign = item.delta > 0 ? '+' : '';
    text += ` ${sign}${item.delta} pts`;
  }
  badge.textContent = text;
  return badge;
}

// ── Card ───────────────────────────────────────────────────────────────────────

function colourChip(colour: 'white' | 'black'): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = colour === 'white' ? '○ White' : '● Black';
  return chip;
}

function confidenceDots(c: number): string {
  if (!c) return '—';
  const n = Math.min(Math.max(c, 0), 5);
  return '●'.repeat(n) + '○'.repeat(5 - n);
}

// One before/after row: label, score bar, "57% · 4-1-2 W-D-L".
function windowRow(label: string, w: ProgressWindow, muted: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'progress-window';

  const tag = document.createElement('span');
  tag.className = 'progress-window-label';
  tag.textContent = label;
  row.appendChild(tag);

  const bar = document.createElement('div');
  bar.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  if (w.games === 0) {
    fill.style.width = '0%';
  } else {
    fill.style.width = `${Math.max(4, Math.min(100, w.scorePct))}%`;
    fill.style.background = muted
      ? '#b8a17f'
      : w.scorePct >= 55 ? '#2a6b3a' : w.scorePct >= 45 ? '#d8961f' : '#c0531f';
  }
  bar.appendChild(fill);
  row.appendChild(bar);

  const text = document.createElement('span');
  text.className = 'review-score-text';
  text.textContent = w.games === 0
    ? 'no games'
    : `${w.scorePct}% · ${w.wins}-${w.draws}-${w.losses}`;
  row.appendChild(text);

  return row;
}

function progressCard(item: LineProgress, cb: ProgressCallbacks): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  // Heading + verdict.
  const head = document.createElement('div');
  head.className = 'progress-card-head';
  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = item.title;
  head.appendChild(nameEl);
  head.appendChild(verdictBadge(item));
  body.appendChild(head);

  // Meta chips: colour, family (if the title isn't already the family), prep state.
  const meta = document.createElement('div');
  meta.className = 'line-card-meta';
  meta.appendChild(colourChip(item.colour));
  if (item.family && item.family !== item.title) {
    const fam = document.createElement('span');
    fam.className = 'review-stat-chip';
    fam.textContent = item.family;
    meta.appendChild(fam);
  }
  const conf = document.createElement('span');
  conf.className = 'review-stat-chip';
  conf.textContent = `Confidence ${confidenceDots(item.confidence)}`;
  meta.appendChild(conf);
  if (item.inTraining) {
    const prep = document.createElement('span');
    prep.className = 'review-stat-chip review-stat-chip--prepped';
    prep.textContent = '✓ in training';
    meta.appendChild(prep);
  }
  body.appendChild(meta);

  // The comparison: before vs since the drill date.
  const compare = document.createElement('div');
  compare.className = 'progress-compare';
  if (item.verdict === 'untrained') {
    compare.appendChild(windowRow('So far', item.before, true));
  } else {
    compare.appendChild(windowRow('Before', item.before, false));
    compare.appendChild(windowRow('Since', item.after, false));
  }
  body.appendChild(compare);

  // A plain-language footer so the numbers tell a story.
  const note = document.createElement('div');
  note.className = 'review-dev-score';
  note.textContent = verdictSentence(item);
  body.appendChild(note);

  card.appendChild(body);

  // Action: drill the flagged lines. Most useful when slipping or not yet drilled.
  if (item.verdict === 'declined' || item.verdict === 'untrained' || !item.inTraining) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'review-build-btn';
    btn.textContent = 'Train';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      cb.onOpenTrain();
    });
    card.appendChild(btn);
  }

  return card;
}

// A one-line readout that says what the comparison means.
function verdictSentence(item: LineProgress): string {
  switch (item.verdict) {
    case 'improved':
      return `Up ${item.delta} points since you drilled it — keep it in rotation.`;
    case 'declined':
      return `Down ${Math.abs(item.delta ?? 0)} points since your last drill — worth a fresh look.`;
    case 'steady':
      return 'About the same before and after — holding, not moving.';
    case 'too-soon':
      return 'Not enough games on one side yet — play a few more, then check back.';
    case 'untrained':
      return item.inTraining
        ? "In training but not drilled yet — that's your baseline above."
        : 'Add this line to training to start tracking whether drilling helps.';
  }
}

// ── Progress self-test (verify the maths on the phone, offline) ──────────────────

function appendSelfTestLink(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'selftest-wrap';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'selftest-link';
  link.textContent = 'Run progress self-test';

  const out = document.createElement('div');
  out.className = 'selftest-output';
  out.hidden = true;

  link.addEventListener('click', () => {
    const results = runProgressSelfTest();
    out.hidden = false;
    out.innerHTML = '';

    const passed = results.filter(r => r.pass).length;
    const head = document.createElement('div');
    head.className = `selftest-head ${passed === results.length ? 'ok' : 'fail'}`;
    head.textContent = `${passed}/${results.length} checks passed`;
    out.appendChild(head);

    for (const r of results) {
      const row = document.createElement('div');
      row.className = `selftest-row ${r.pass ? 'ok' : 'fail'}`;
      row.textContent = `${r.pass ? '✓' : '✗'} ${r.name} — ${r.detail}`;
      out.appendChild(row);
    }
    console.log('[progress self-test]', results);
  });

  wrap.appendChild(link);
  wrap.appendChild(out);
  container.appendChild(wrap);
}
