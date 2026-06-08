// The "Review" tab: a coaching report over your imported Chess.com games.
//
// It answers three things, top to bottom:
//   • Most played   — the openings you actually reach for, by volume.
//   • Scoring badly  — where the results are below even (enough games to trust).
//   • Lines to add   — openings you play often but have no prep for. Build them.
//   • Left your prep — exact moves where a game stepped off your repertoire.
//
// Every actionable row has a "Build" button that jumps to the builder with the
// board already seeded — either the opening's representative line, or the exact
// position where you left book — so a finding turns into prep in one tap.

import { getAllGames } from './storage';
import { getAllLines } from './storage';
import {
  analyseGames,
  type Analysis,
  type OpeningStat,
  type Deviation,
} from './analysis';
import { runAnalysisSelfTest } from './analysis.selftest';

export interface ReviewCallbacks {
  // Seed the builder with these UCI moves for the given colour, then switch to it.
  onBuildLine: (ucis: string[], colour: 'white' | 'black') => void;
}

export function renderReviewScreen(container: HTMLElement, cb: ReviewCallbacks): void {
  void doRender(container, cb);
}

async function doRender(container: HTMLElement, cb: ReviewCallbacks): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const [games, lines] = await Promise.all([getAllGames(), getAllLines()]);
  container.innerHTML = '';

  if (games.length === 0) {
    renderEmpty(container);
    appendSelfTestLink(container);
    return;
  }

  const analysis = analyseGames(games, lines);

  renderIntro(container, analysis);
  renderMostPlayed(container, analysis, cb);
  renderWeakest(container, analysis, cb);
  renderSuggestions(container, analysis, cb);
  renderDeviations(container, analysis, cb);
  appendSelfTestLink(container);
}

// ── Empty state ───────────────────────────────────────────────────────────────

function renderEmpty(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'train-empty';

  const title = document.createElement('p');
  title.className = 'train-empty-title';
  title.textContent = 'No games to review yet';
  wrap.appendChild(title);

  const body = document.createElement('p');
  body.className = 'train-empty-body';
  body.textContent =
    'Open Build → Settings and import your Chess.com games. Then come back here to see which openings you play, where you score badly, and where you leave your prep.';
  wrap.appendChild(body);

  container.appendChild(wrap);
}

// ── Intro line ─────────────────────────────────────────────────────────────────

function renderIntro(container: HTMLElement, a: Analysis): void {
  const intro = document.createElement('div');
  intro.className = 'review-intro';
  const families = a.stats.length;
  intro.textContent =
    `${a.totalGames} game${a.totalGames === 1 ? '' : 's'} across ` +
    `${families} opening${families === 1 ? '' : 's'} analysed.`;
  container.appendChild(intro);
}

// ── Section scaffolding ──────────────────────────────────────────────────────────

function sectionHeading(container: HTMLElement, text: string, hint?: string): void {
  const heading = document.createElement('h2');
  heading.className = 'lines-heading review-heading';
  heading.textContent = text;
  container.appendChild(heading);
  if (hint) {
    const sub = document.createElement('p');
    sub.className = 'review-hint';
    sub.textContent = hint;
    container.appendChild(sub);
  }
}

function colourChip(colour: 'white' | 'black'): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.textContent = colour === 'white' ? '○ White' : '● Black';
  return chip;
}

// A win/draw/loss score bar, green→amber→red by how good the score is.
function scoreBar(pct: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'review-score-bar';
  const fill = document.createElement('div');
  fill.className = 'review-score-fill';
  fill.style.width = `${Math.max(4, Math.min(100, pct))}%`;
  // Above even = green, around even = amber, sinking = red.
  fill.style.background = pct >= 55 ? '#2a6b3a' : pct >= 45 ? '#d8961f' : '#c0531f';
  wrap.appendChild(fill);
  return wrap;
}

function buildButton(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'review-build-btn';
  btn.textContent = label;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// "1.e4" for a White move, "1...c5" for a Black move, from a 0-based ply.
function moveLabel(ply: number, san: string): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.${san}` : `${num}…${san}`;
}

// ── Most played ──────────────────────────────────────────────────────────────────

function renderMostPlayed(container: HTMLElement, a: Analysis, cb: ReviewCallbacks): void {
  if (a.mostPlayed.length === 0) return;
  sectionHeading(container, 'Most played');
  for (const stat of a.mostPlayed) {
    container.appendChild(openingCard(stat, cb, 'volume'));
  }
}

// ── Scoring badly ────────────────────────────────────────────────────────────────

function renderWeakest(container: HTMLElement, a: Analysis, cb: ReviewCallbacks): void {
  sectionHeading(container, 'Where you score badly', 'Below an even score, with enough games to be real.');
  if (a.weakest.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'lines-empty';
    ok.textContent = 'Nothing scoring under even right now — nice.';
    container.appendChild(ok);
    return;
  }
  for (const stat of a.weakest) {
    container.appendChild(openingCard(stat, cb, 'score'));
  }
}

// ── Lines to add ─────────────────────────────────────────────────────────────────

function renderSuggestions(container: HTMLElement, a: Analysis, cb: ReviewCallbacks): void {
  if (a.suggestions.length === 0) return;
  sectionHeading(container, 'Lines to add', 'You play these often but have no prep saved. Build one.');
  for (const stat of a.suggestions) {
    container.appendChild(openingCard(stat, cb, 'suggest'));
  }
}

// A single opening row. `emphasis` tweaks the headline stat shown first.
function openingCard(
  stat: OpeningStat,
  cb: ReviewCallbacks,
  emphasis: 'volume' | 'score' | 'suggest',
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = stat.family;
  body.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'line-card-meta';
  meta.appendChild(colourChip(stat.colour));

  const gamesChip = document.createElement('span');
  gamesChip.className = 'review-stat-chip';
  gamesChip.textContent = `${stat.games} game${stat.games === 1 ? '' : 's'}`;
  meta.appendChild(gamesChip);

  if (stat.hasRepertoire) {
    const prep = document.createElement('span');
    prep.className = 'review-stat-chip review-stat-chip--prepped';
    prep.textContent = '✓ in prep';
    meta.appendChild(prep);
  }
  body.appendChild(meta);

  // Score line: bar + "67% · W-D-L".
  const scoreRow = document.createElement('div');
  scoreRow.className = 'review-score-row';
  scoreRow.appendChild(scoreBar(stat.scorePct));
  const scoreText = document.createElement('span');
  scoreText.className = 'review-score-text';
  scoreText.textContent =
    `${stat.scorePct}% · ${stat.wins}-${stat.draws}-${stat.losses} W-D-L`;
  scoreRow.appendChild(scoreText);
  body.appendChild(scoreRow);

  // The representative line, so you recognise which variation this is.
  if (stat.repSans.length > 0) {
    const lineEl = document.createElement('div');
    lineEl.className = 'review-moves';
    lineEl.textContent = formatSanLine(stat.repSans);
    body.appendChild(lineEl);
  }

  card.appendChild(body);

  if (stat.repUcis.length > 0) {
    const label = emphasis === 'suggest' ? 'Build line' : stat.hasRepertoire ? 'Open' : 'Build';
    card.appendChild(buildButton(label, () => cb.onBuildLine(stat.repUcis, stat.colour)));
  }

  return card;
}

// "1.e4 e5 2.Nf3 Nc6 3.Bc4" from a flat SAN list.
function formatSanLine(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) out += `${i / 2 + 1}.${sans[i]} `;
    else out += `${sans[i]} `;
  }
  return out.trim();
}

// ── Left your prep ───────────────────────────────────────────────────────────────

function renderDeviations(container: HTMLElement, a: Analysis, cb: ReviewCallbacks): void {
  if (a.deviations.length === 0) return;
  sectionHeading(
    container,
    'Where you left your prep',
    'Moves where a game stepped off your saved lines. Build from that exact spot to fix it.',
  );
  for (const dev of a.deviations) {
    container.appendChild(deviationCard(dev, cb));
  }
}

function deviationCard(dev: Deviation, cb: ReviewCallbacks): HTMLElement {
  const card = document.createElement('div');
  card.className = 'line-card review-card';

  const body = document.createElement('div');
  body.className = 'line-card-body review-card-body';

  const nameEl = document.createElement('div');
  nameEl.className = 'line-card-name';
  nameEl.textContent = dev.family;
  body.appendChild(nameEl);

  const meta = document.createElement('div');
  meta.className = 'line-card-meta';
  meta.appendChild(colourChip(dev.colour));
  const timesChip = document.createElement('span');
  timesChip.className = 'review-stat-chip';
  timesChip.textContent = `${dev.count}×`;
  meta.appendChild(timesChip);
  body.appendChild(meta);

  // The sentence: who left, what they played, what the prep wanted.
  const sentence = document.createElement('div');
  sentence.className = 'review-dev-text';
  const who = dev.side === 'you' ? 'You played' : 'Opponent played';
  const played = document.createElement('strong');
  played.textContent = moveLabel(dev.ply, dev.actual);
  sentence.append(`${who} `, played);
  if (dev.expected.length > 0) {
    const expected = dev.expected.slice(0, 3).join(', ');
    sentence.append(
      dev.side === 'you'
        ? ` — your prep is ${expected}.`
        : ` — not in your prep (you cover ${expected}).`,
    );
  } else {
    sentence.append(' — past your prep here.');
  }
  body.appendChild(sentence);

  // How those games went, if it's a recurring spot.
  if (dev.count > 1) {
    const score = document.createElement('div');
    score.className = 'review-dev-score';
    score.textContent = `In these games: ${dev.wins}-${dev.draws}-${dev.losses} W-D-L`;
    body.appendChild(score);
  }

  card.appendChild(body);

  // Build from the in-book position right before the deviation.
  card.appendChild(
    buildButton('Build', () => cb.onBuildLine(dev.prefixUcis, dev.colour)),
  );

  return card;
}

// ── Analysis self-test (verify the maths on the phone, offline) ──────────────────

function appendSelfTestLink(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'selftest-wrap';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'selftest-link';
  link.textContent = 'Run analysis self-test';

  const out = document.createElement('div');
  out.className = 'selftest-output';
  out.hidden = true;

  link.addEventListener('click', () => {
    const results = runAnalysisSelfTest();
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
    console.log('[analysis self-test]', results);
  });

  wrap.appendChild(link);
  wrap.appendChild(out);
  container.appendChild(wrap);
}
