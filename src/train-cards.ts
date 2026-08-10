// The three contextual cards on Train — what the setup wizard used to ask up
// front, asked instead at the point it means something.
//
// The wizard's problem was its timing, not its content: notation, theme and
// Lichess are all reasonable things to offer, but offering them BEFORE the user
// has a single line is asking someone to furnish a house they haven't walked
// into. So the same three offers appear here, once the first line exists, as
// cards that can each be dismissed for good.
//
// Every control inside them is settings-screen.ts's own — buildThemeRow,
// boardSwatches, segmented — so there is no second copy of the appearance
// settings to keep in step. "Make it yours" is genuinely the Settings controls,
// inlined.

import { Icons } from './icons';
import { boardSwatches, buildThemeRow, segmented } from './settings-screen';
import { getBoardColour, setBoardColour, type BoardColour } from './appearance';
import { getMoveNotation, setMoveNotation, type MoveNotation } from './notation';
import { isConnected as lichessIsConnected } from './lichess-auth';

type CardId = 'import' | 'lichess' | 'appearance';

const DISMISS_KEY = 'obertura.trainCardsDismissed';

function dismissed(): Set<CardId> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(list) ? (list as CardId[]) : []);
  } catch {
    return new Set();
  }
}

function dismiss(id: CardId): void {
  const set = dismissed();
  set.add(id);
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch { /* storage off */ }
}

export interface TrainCardDeps {
  onImportGames: () => void;
  onConnectLichess: () => void;
  // Re-render the Train screen after a card is dismissed, so the gap closes.
  onChanged: () => void;
}

// Append whichever cards are still wanted. Renders nothing at all when they've
// all been dismissed, which is the steady state for a long-time user.
export function renderTrainCards(host: HTMLElement, deps: TrainCardDeps): void {
  const gone = dismissed();

  const cards: HTMLElement[] = [];

  if (!gone.has('import')) {
    cards.push(card({
      id: 'import',
      icon: Icons.download(18),
      title: 'Import your games',
      body: 'Pull in your games from Lichess or Chess.com and build lines from what you actually play.',
      action: { label: 'Import games', onClick: deps.onImportGames },
      onChanged: deps.onChanged,
    }));
  }

  // Nothing to offer once they're already connected — drop it silently rather
  // than showing a card whose button does nothing.
  if (!gone.has('lichess') && !lichessIsConnected()) {
    cards.push(card({
      id: 'lichess',
      icon: Icons.link(18),
      title: 'Connect Lichess',
      body: 'Sync your games automatically, and unlock the opening explorer for every position.',
      action: { label: 'Connect', onClick: deps.onConnectLichess },
      onChanged: deps.onChanged,
    }));
  }

  if (!gone.has('appearance')) {
    cards.push(card({
      id: 'appearance',
      icon: Icons.eye(18),
      title: 'Make it yours',
      body: 'Theme, board colours and how moves are written.',
      expand: appearanceControls,
      onChanged: deps.onChanged,
    }));
  }

  if (cards.length === 0) return;

  const wrap = document.createElement('div');
  wrap.className = 'train-cards';
  for (const c of cards) wrap.appendChild(c);
  host.appendChild(wrap);
}

interface CardSpec {
  id: CardId;
  icon: SVGElement;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  // An in-card panel that opens instead of running an action.
  expand?: () => HTMLElement;
  onChanged: () => void;
}

function card(spec: CardSpec): HTMLElement {
  const el = document.createElement('div');
  el.className = 'train-card';

  const head = document.createElement('div');
  head.className = 'train-card-head';

  const badge = document.createElement('span');
  badge.className = 'train-card-icon';
  badge.appendChild(spec.icon);
  head.appendChild(badge);

  const title = document.createElement('span');
  title.className = 'train-card-title';
  title.textContent = spec.title;
  head.appendChild(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'train-card-close';
  close.setAttribute('aria-label', `Dismiss “${spec.title}”`);
  close.appendChild(Icons.close(15));
  close.addEventListener('click', () => {
    dismiss(spec.id);
    spec.onChanged();
  });
  head.appendChild(close);

  el.appendChild(head);

  const body = document.createElement('p');
  body.className = 'train-card-body';
  body.textContent = spec.body;
  el.appendChild(body);

  if (spec.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary train-card-btn';
    btn.textContent = spec.action.label;
    btn.addEventListener('click', spec.action.onClick);
    el.appendChild(btn);
  }

  if (spec.expand) {
    const panel = document.createElement('div');
    panel.className = 'train-card-panel';
    panel.hidden = true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary train-card-btn';
    btn.textContent = 'Customise';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      // Built on first open, so a dismissed card never pays for its controls.
      if (open && !panel.hasChildNodes()) panel.appendChild(spec.expand!());
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Done' : 'Customise';
    });
    el.appendChild(btn);
    el.appendChild(panel);
  }

  return el;
}

// Theme, board and notation — the Settings controls themselves, not copies.
function appearanceControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'train-card-settings';

  wrap.appendChild(buildThemeRow());

  const boardRow = document.createElement('div');
  boardRow.className = 'pref-row';
  const boardTitle = document.createElement('div');
  boardTitle.className = 'pref-row-title';
  boardTitle.textContent = 'Board';
  boardRow.appendChild(boardTitle);
  const swatches = boardSwatches(getBoardColour(), (v: BoardColour) => {
    setBoardColour(v);
    swatches.reflect(v);
  });
  boardRow.appendChild(swatches.element);
  wrap.appendChild(boardRow);

  const notationRow = document.createElement('div');
  notationRow.className = 'pref-row';
  const notationTitle = document.createElement('div');
  notationTitle.className = 'pref-row-title';
  notationTitle.textContent = 'Move notation';
  notationRow.appendChild(notationTitle);
  notationRow.appendChild(segmented<MoveNotation>(
    [{ value: 'standard', label: 'Nf3' }, { value: 'figurine', label: '♞f3' }],
    getMoveNotation(),
    (v) => setMoveNotation(v),
  ));
  wrap.appendChild(notationRow);

  return wrap;
}
