// The Home "Today" screen — the action-first landing dashboard.
//
// It answers one question on open: "what should I do right now?" That's a due
// count and a big Start-training button. Around it sit a daily streak, quick
// links to My Lines (with per-colour Add buttons), and warm empty states so the
// screen is never just a blank shelf.

import type { Line } from './types';
import { getAllLines } from './storage';
import { dueLines, userMoveNodes, isReviewDue } from './scheduler';
import { currentStreak, trainedToday } from './streak';
import { Icons } from './icons';

export interface HomeCallbacks {
  // Launch a due-driven training session straight away.
  onStartTraining: () => void;
  // Open the My Lines tab.
  onGoToLines: () => void;
  // Open the builder on a fresh line of the given colour.
  onAddLine: (colour: 'white' | 'black') => void;
}

export function renderHomeScreen(container: HTMLElement, cb: HomeCallbacks): void {
  void doRender(container, cb);
}

async function doRender(container: HTMLElement, cb: HomeCallbacks): Promise<void> {
  container.innerHTML = '<p class="lines-loading">Loading…</p>';
  const allLines = await getAllLines();
  container.innerHTML = '';

  // No lines at all → a warm "create your first line" prompt and nothing else.
  if (allLines.length === 0) {
    renderFirstLine(container, cb);
    return;
  }

  renderHeader(container);
  renderTodayCard(container, allLines, cb);
  renderQuickLinks(container, allLines, cb);
}

// ── Header (title + streak) ──────────────────────────────────────────────────

function renderHeader(container: HTMLElement): void {
  const head = document.createElement('div');
  head.className = 'home-head';

  const title = document.createElement('div');
  title.className = 'home-greeting';
  title.textContent = 'Today';
  head.appendChild(title);

  head.appendChild(buildStreakPill());
  container.appendChild(head);
}

function buildStreakPill(): HTMLElement {
  const streak = currentStreak();
  const pill = document.createElement('div');
  pill.className = 'home-streak' + (streak === 0 ? ' home-streak--cold' : '');

  const flame = document.createElement('span');
  flame.className = 'home-streak-flame';
  flame.setAttribute('aria-hidden', 'true');
  flame.textContent = '🔥';
  pill.appendChild(flame);

  const label = document.createElement('span');
  label.className = 'home-streak-label';
  if (streak === 0) {
    label.textContent = 'Start a streak';
    pill.setAttribute('aria-label', 'No training streak yet — train today to start one');
  } else {
    label.textContent = `${streak}-day streak`;
    const todayNote = trainedToday() ? ' Trained today.' : ' Train today to keep it going.';
    pill.setAttribute('aria-label', `${streak}-day training streak.${todayNote}`);
  }
  pill.appendChild(label);

  return pill;
}

// ── The "Today" card (due count + Start training) ────────────────────────────

function renderTodayCard(container: HTMLElement, allLines: Line[], cb: HomeCallbacks): void {
  const trainingLines = allLines.filter(l => l.inTraining);
  const card = document.createElement('div');
  card.className = 'home-card';

  // Nothing is in training yet — you can't have a due session, so point the way
  // rather than claim "all caught up".
  if (trainingLines.length === 0) {
    card.classList.add('home-card--empty');
    addCardLine(card, 'home-card-headline', 'Nothing in training yet');
    addCardLine(
      card,
      'home-card-sub',
      'Add a line to your training set and it’ll show up here when it’s due.',
    );
    card.appendChild(linkButton('Go to My Lines', () => cb.onGoToLines()));
    container.appendChild(card);
    return;
  }

  const now = new Date();
  const due = dueLines(trainingLines, now);
  let duePositions = 0;
  for (const line of trainingLines) {
    duePositions += userMoveNodes(line.tree, line.colour)
      .filter(n => isReviewDue(n.review, now)).length;
  }

  if (due.length === 0) {
    // Encouraging "all caught up" state.
    card.classList.add('home-card--rested');
    addCardLine(card, 'home-card-headline', 'All caught up ✓');
    addCardLine(
      card,
      'home-card-sub',
      'No lines due right now. Come back later, or drill any line from My Lines to stay sharp.',
    );
    container.appendChild(card);
    return;
  }

  // The main event: due count + a big Start training button.
  const count = document.createElement('div');
  count.className = 'home-card-count';
  const big = document.createElement('span');
  big.className = 'home-card-count-num';
  big.textContent = String(due.length);
  count.appendChild(big);
  count.appendChild(
    document.createTextNode(` line${due.length === 1 ? '' : 's'} due today`),
  );
  card.appendChild(count);

  addCardLine(
    card,
    'home-card-sub',
    `${duePositions} position${duePositions === 1 ? '' : 's'} to review.`,
  );

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'session-start-btn home-start-btn';
  startBtn.appendChild(Icons.play(17));
  startBtn.appendChild(document.createTextNode('Start training'));
  startBtn.addEventListener('click', () => cb.onStartTraining());
  card.appendChild(startBtn);

  container.appendChild(card);
}

// ── Quick links to My Lines (with per-colour Add) ────────────────────────────

function renderQuickLinks(container: HTMLElement, allLines: Line[], cb: HomeCallbacks): void {
  const heading = document.createElement('h2');
  heading.className = 'home-section-title';
  heading.textContent = 'My Lines';
  container.appendChild(heading);

  const whiteCount = allLines.filter(l => l.colour === 'white').length;
  const blackCount = allLines.filter(l => l.colour === 'black').length;

  const summary = document.createElement('div');
  summary.className = 'home-lines-summary';
  summary.textContent =
    `${whiteCount} White · ${blackCount} Black`;
  container.appendChild(summary);

  // View-all link.
  container.appendChild(linkButton('View all lines', () => cb.onGoToLines()));

  // Per-colour Add buttons.
  const addRow = document.createElement('div');
  addRow.className = 'home-add-row';
  addRow.appendChild(addButton('white', () => cb.onAddLine('white')));
  addRow.appendChild(addButton('black', () => cb.onAddLine('black')));
  container.appendChild(addRow);
}

// ── First-line empty state (no lines at all) ─────────────────────────────────

function renderFirstLine(container: HTMLElement, cb: HomeCallbacks): void {
  const wrap = document.createElement('div');
  wrap.className = 'train-empty home-first';

  const title = document.createElement('p');
  title.className = 'train-empty-title';
  title.textContent = 'Welcome to Obertura';
  wrap.appendChild(title);

  const body = document.createElement('p');
  body.className = 'train-empty-body';
  body.textContent =
    'Build your first opening line, then train it until it sticks. Pick a side to begin.';
  wrap.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'home-add-row home-first-actions';
  actions.appendChild(addButton('white', () => cb.onAddLine('white')));
  actions.appendChild(addButton('black', () => cb.onAddLine('black')));
  wrap.appendChild(actions);

  container.appendChild(wrap);
}

// ── Small builders ───────────────────────────────────────────────────────────

function addCardLine(card: HTMLElement, cls: string, text: string): void {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  card.appendChild(el);
}

function linkButton(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'home-link-btn';
  btn.appendChild(Icons.list(17));
  btn.appendChild(document.createTextNode(label));
  btn.addEventListener('click', onClick);
  return btn;
}

function addButton(colour: 'white' | 'black', onClick: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `home-add-btn home-add-btn--${colour}`;
  btn.appendChild(Icons.plus(16));
  btn.appendChild(
    document.createTextNode(colour === 'white' ? 'Add White line' : 'Add Black line'),
  );
  btn.addEventListener('click', onClick);
  return btn;
}
