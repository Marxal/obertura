// A slim three-segment win/draw/loss bar — sage wins, neutral draws, brick
// losses — flanked by a score percentage on the left and a games count on the
// right, under one quiet caption that fixes the colour perspective ("their
// results"). Built as a small reusable component: the opponent cards use it in
// the Explore list, and the opponent detail screen (task 4.3) reuses it.

export interface WdlCounts {
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;   // already from the perspective the caption names
  games: number;      // games analysed, shown at the bar's right
}

// Build the labelled block: caption, then [score% · bar · count].
export function wdlBlock(counts: WdlCounts, caption = 'their results'): HTMLElement {
  const block = document.createElement('div');
  block.className = 'wdl-block';

  const cap = document.createElement('div');
  cap.className = 'wdl-caption';
  cap.textContent = caption;
  block.appendChild(cap);

  const row = document.createElement('div');
  row.className = 'wdl-row';

  const score = document.createElement('span');
  score.className = 'wdl-score';
  score.textContent = `${counts.scorePct}%`;
  row.appendChild(score);

  row.appendChild(wdlBar(counts));

  const count = document.createElement('span');
  count.className = 'wdl-count';
  count.textContent = `${counts.games} game${counts.games === 1 ? '' : 's'}`;
  row.appendChild(count);

  block.appendChild(row);
  return block;
}

// Just the three-segment bar, widths proportional to the W/D/L split. An empty
// sample renders a flat neutral track so the bar never collapses to nothing.
export function wdlBar(counts: WdlCounts): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'wdl-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label',
    `${counts.wins} wins, ${counts.draws} draws, ${counts.losses} losses`);

  const total = counts.wins + counts.draws + counts.losses;
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'wdl-seg wdl-seg--empty';
    empty.style.width = '100%';
    bar.appendChild(empty);
    return bar;
  }

  const seg = (kind: 'win' | 'draw' | 'loss', n: number) => {
    if (n === 0) return;
    const s = document.createElement('div');
    s.className = `wdl-seg wdl-seg--${kind}`;
    s.style.width = `${(n / total) * 100}%`;
    bar.appendChild(s);
  };
  seg('win', counts.wins);
  seg('draw', counts.draws);
  seg('loss', counts.losses);
  return bar;
}
