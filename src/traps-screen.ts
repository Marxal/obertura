// Explore → "Lines to try" → Traps tab. Curated opening traps rendered as
// Recommended-style position cards. A trap's only action is "Build line" — it
// opens in the builder seeded with the trap's moves, exactly like a Recommended
// card — so nothing here touches the SM-2 scheduler until you save the line.
//
// A trap is just a famous line where the user plays the trapping side and the
// opponent walks into a tempting losing move. The curated data lives in
// src/traps.json (built by scripts/build-traps.mjs); we lazy-load it so it stays
// out of the initial bundle, like the starter packs and the opening library.

import { buildPositionCard, colourPip, fenFromUcis } from './card-position';
import type { Trap, TrapPack } from './traps';

type Colour = 'white' | 'black';

// Lazy-load the curated traps only when the Explore screen builds the block.
let packsPromise: Promise<TrapPack[]> | null = null;
export function loadTraps(): Promise<TrapPack[]> {
  if (!packsPromise) {
    packsPromise = import('./traps.json').then(m => (m.default ?? m) as unknown as TrapPack[]);
  }
  return packsPromise;
}

// One trap as a Recommended-style card: miniature (tap → build), colour pip,
// name + level chip, the family, the SAN line, and a "Build line" button. The
// bait/idea explanation is deliberately NOT on the card (it would crowd it) —
// it's carried into the builder as a description instead. `onBuild` seeds the
// builder with the trap's moves + that description (exploreDeps.onOpenInBuilder),
// so it behaves like a Recommended card with a hint attached.
export function trapCard(
  trap: Trap,
  colour: Colour,
  onBuild: (ucis: string[], colour: Colour, description: string) => void,
): HTMLElement {
  const description = `Bait: ${trap.bait}. ${trap.idea}`;
  const build = () => onBuild(trap.ucis, colour, description);

  const { card, titleRow, content } = buildPositionCard({
    fen: fenFromUcis(trap.ucis),
    orientation: colour,
    className: 'games-card',
    onMiniClick: build,
    miniLabel: 'Build this line',
  });

  titleRow.appendChild(colourPip(colour));
  const nameEl = document.createElement('span');
  nameEl.className = 'pcard-name';
  nameEl.textContent = trap.name;
  titleRow.appendChild(nameEl);
  const lvl = document.createElement('span');
  lvl.className = 'tag-chip trap-level-chip';
  lvl.textContent = trap.level;
  titleRow.appendChild(lvl);

  const fam = document.createElement('div');
  fam.className = 'stat-card-note';
  fam.textContent = trap.family;
  content.appendChild(fam);

  const movesEl = document.createElement('div');
  movesEl.className = 'review-moves stat-card-note';
  movesEl.textContent = formatSan(trap.sans);
  content.appendChild(movesEl);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary stat-card-btn';
  btn.textContent = 'Build line';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    build();
  });
  content.appendChild(btn);

  return card;
}

// "1.e4 e5 2.Nf3 Nc6" from a flat SAN list.
function formatSan(sans: string[]): string {
  let out = '';
  for (let i = 0; i < sans.length; i++) {
    out += i % 2 === 0 ? `${i / 2 + 1}.${sans[i]} ` : `${sans[i]} `;
  }
  return out.trim();
}
