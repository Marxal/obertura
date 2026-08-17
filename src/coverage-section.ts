// The coverage block, as ONE component with two homes: its own screen
// (coverage-screen.ts) and the builder's My lines panel. Same rows, same
// ranking, same wording — only the caps and the chrome differ, because a
// section that reads differently in two places is two features to keep in step.
//
// WHAT IT SHOWS, IN THIS ORDER, AND WHY:
//
//   1. COVERAGE FIRST, AS A POSITIVE. "82% answered · 9 of 11 replies" and a
//      bar per opening family. A list of holes with no denominator reads as a
//      verdict on your work; the same list under a figure that goes UP as you
//      close them reads as progress. The positive number is not decoration —
//      it is what makes the rest of the block usable.
//   2. THEN THE GAPS, each explaining itself in one short line: "faced 11
//      times", "played 34% at your level", "Erik plays this". A ranking the
//      user can't explain to themselves is noise, so the sentence that ranked
//      a row is the sentence printed on it.
//   3. THEN ONE QUIET NOTE about how far the live check reached — never a claim
//      that the numbers are "at your level" when they came from the bundled,
//      all-ratings set.
//
// A whole row is the button. Tapping it seeds the builder at that position, in
// the answering colour, through the existing Prepare mechanism — nobody has to
// build from move one.

import { Icons } from './icons';
import { formatMove } from './notation';
import { loadCoverage, cachedCoverage, liveReachNote, type CoverageLoad } from './coverage-data';
import { MAX_GAPS, MAX_GAPS_INLINE, type Gap, type GapSource } from './coverage-gaps';

/** How many family bars the block shows before it stops being a summary. */
const FAMILY_ROWS = 4;

export interface CoverageSectionDeps {
  colour: 'white' | 'black';
  /** Row cap. The builder passes the inline cap; the screen the full one. */
  limit?: number;
  /** The screen shows the family breakdown; the builder's inline copy doesn't. */
  showFamilies?: boolean;
  /** Section title. Null suppresses the header entirely (the screen has its own). */
  title?: string | null;
  /**
   * Seed the builder at this position in the answering colour — the existing
   * Prepare flow. `opponentName` is passed only for a scouted-opponent row, so
   * the line is tagged "vs <name>" exactly as preparing from their map is.
   */
  onPrepare: (ucis: string[], answeringColour: 'white' | 'black', opponentName?: string) => void;
  /** The builder's "See all" link. Omitted on the screen itself. */
  onSeeAll?: () => void;
}

export interface CoverageSection {
  /** Detach: any in-flight pass stops painting into a host that has gone. */
  dispose(): void;
}

export function renderCoverageSection(host: HTMLElement, deps: CoverageSectionDeps): CoverageSection {
  const limit = deps.limit ?? MAX_GAPS;
  let live = true;

  // Paint whatever was computed last (instant, and usually current), then run
  // the pass. The builder repaints this panel on every move, so the memo in
  // coverage-data.ts is what stops that costing anything.
  const cached = cachedCoverage(deps.colour);
  paint(cached, !cached);

  void loadCoverage(deps.colour, {
    stillHere: () => live,
    onPartial: load => { if (live) paint(load, false); },
  }).then(load => { if (live) paint(load, false); })
    .catch(() => { if (live) paint(cached, false); });

  function paint(load: CoverageLoad | null, loading: boolean): void {
    host.replaceChildren();

    if (deps.title !== null) {
      host.appendChild(header(load));
    }

    if (loading) {
      host.appendChild(note('Working out your coverage…'));
      return;
    }
    if (!load) {
      host.appendChild(note('Couldn’t read your lines just now.'));
      return;
    }

    const { report } = load;

    if (report.positions === 0) {
      host.appendChild(note(deps.colour === 'white'
        ? 'Save a White line and this fills in with the replies it doesn’t answer yet.'
        : 'Save a Black line and this fills in with the replies it doesn’t answer yet.'));
      return;
    }

    host.appendChild(summary(report.pct, report.answered, report.notable, report.totalGaps));
    if (deps.showFamilies && report.families.length) {
      host.appendChild(familyBlock(load));
    }

    // The report is computed ONCE per colour at the full cap and shared by both
    // homes (coverage-data.ts's memo), so the row cap is applied here, at paint
    // — the builder's three and the screen's twelve are two views of one list,
    // not two computations that could disagree.
    const shown = report.gaps.slice(0, limit);

    if (!shown.length) {
      host.appendChild(note(load.complete
        ? 'Nothing unanswered here — every reply worth preparing has an answer.'
        : 'Nothing unanswered so far…'));
    } else {
      const list = document.createElement('div');
      list.className = 'cvg-list';
      for (const gap of shown) list.appendChild(gapRow(gap));
      host.appendChild(list);

      const hidden = report.totalGaps - shown.length;
      if (hidden > 0 && deps.onSeeAll) {
        host.appendChild(moreLink(`${hidden} more to prepare`, deps.onSeeAll));
      } else if (hidden > 0) {
        host.appendChild(note(`${hidden} more below the top ${shown.length}.`));
      }
    }

    const reach = liveReachNote(load.live);
    if (reach) {
      const line = document.createElement('div');
      line.className = 'cvg-reach';
      line.textContent = load.complete ? reach : 'Checking these against real games…';
      host.appendChild(line);
    }
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  function header(load: CoverageLoad | null): HTMLElement {
    const head = document.createElement('div');
    head.className = 'mylines-head';
    const title = document.createElement('span');
    title.className = 'mylines-head-title';
    title.textContent = deps.title ?? 'Coverage gaps';
    head.appendChild(title);
    if (deps.onSeeAll) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'mylines-tree-link';
      link.appendChild(Icons.target(15));
      link.appendChild(document.createTextNode(
        load && load.report.totalGaps > 0 ? `See all ${load.report.totalGaps}` : 'See all'));
      link.addEventListener('click', deps.onSeeAll);
      head.appendChild(link);
    }
    return head;
  }

  // The positive figure. "9 of 11 replies answered" is the sentence; the bar is
  // the same number for people who read shapes faster than words.
  function summary(pct: number, answered: number, notable: number, gaps: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cvg-summary';

    const top = document.createElement('div');
    top.className = 'cvg-summary-top';
    const big = document.createElement('span');
    big.className = 'cvg-pct';
    big.textContent = `${pct}%`;
    top.appendChild(big);
    const words = document.createElement('span');
    words.className = 'cvg-summary-text';
    words.textContent = notable === 0
      ? 'nothing worth preparing has come up yet'
      : `${answered} of ${notable} replies answered${gaps ? ` · ${gaps} to prepare` : ''}`;
    top.appendChild(words);
    wrap.appendChild(top);
    wrap.appendChild(bar(pct));
    return wrap;
  }

  function familyBlock(load: CoverageLoad): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cvg-families';
    for (const fam of load.report.families.slice(0, FAMILY_ROWS)) {
      const row = document.createElement('div');
      row.className = 'cvg-fam';
      const name = document.createElement('span');
      name.className = 'cvg-fam-name';
      name.textContent = fam.family;
      row.appendChild(name);
      row.appendChild(bar(fam.pct));
      const count = document.createElement('span');
      count.className = 'cvg-fam-count';
      count.textContent = `${fam.answered}/${fam.notable}`;
      row.appendChild(count);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function bar(pct: number): HTMLElement {
    const track = document.createElement('span');
    track.className = 'cvg-bar';
    const fill = document.createElement('span');
    fill.className = 'cvg-bar-fill';
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    track.appendChild(fill);
    return track;
  }

  // One gap. The whole row is the button — "Build from here" is what tapping it
  // does, and a row whose only action is a small button on the right is a row
  // most thumbs miss.
  function gapRow(gap: Gap): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `cvg-row cvg-row--${gap.source}`;
    row.addEventListener('click', () => {
      // The seed is the path PLUS the unanswered move, so the builder opens
      // with the reply already on the board and your answer as the next move.
      deps.onPrepare([...gap.ucis, gap.uci], gap.colour, gap.opponentName);
    });

    const move = document.createElement('span');
    move.className = 'cvg-row-move';
    move.textContent = `${movePrefix(gap.ply)} ${formatMove(gap.san)}`;
    row.appendChild(move);

    const body = document.createElement('span');
    body.className = 'cvg-row-body';

    const why = document.createElement('span');
    why.className = 'cvg-row-why';
    why.appendChild(sourceIcon(gap.source, 12));
    why.appendChild(document.createTextNode(gap.reason));
    body.appendChild(why);

    const where = document.createElement('span');
    where.className = 'cvg-row-where';
    where.textContent = context(gap);
    body.appendChild(where);
    row.appendChild(body);

    const add = document.createElement('span');
    add.className = 'cvg-row-add';
    add.appendChild(Icons.plus(15));
    row.appendChild(add);

    row.setAttribute('aria-label',
      `Prepare an answer to ${gap.san} after ${gap.sans.join(' ') || 'the first move'} — ${gap.reason}`);
    return row;
  }

  // Where the gap sits, in the fewest words that still locate it: the line so
  // far, and the opening it belongs to when the book knows one.
  function context(gap: Gap): string {
    const moves = gap.sans.length ? formatSans(gap.sans) : 'the starting position';
    return gap.family && gap.family !== 'Unrecognised opening'
      ? `${gap.family} · after ${moves}`
      : `after ${moves}`;
  }

  function moreLink(label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cvg-more';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function note(text: string): HTMLElement {
    const d = document.createElement('div');
    d.className = 'bx-empty';
    d.textContent = text;
    return d;
  }

  return {
    dispose() { live = false; },
  };
}

/**
 * The one-row way in, for a list screen that has no room for the whole block:
 * the positive figure and how many gaps are behind it, as a button that opens
 * the screen. It reads the SAME report — no second computation, no second
 * ranking — so the number on the launcher and the number on the screen cannot
 * disagree.
 */
export function renderCoverageLauncher(
  host: HTMLElement,
  opts: { colour: 'white' | 'black'; onOpen: () => void },
): CoverageSection {
  let live = true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cvg-launch';
  btn.addEventListener('click', opts.onOpen);

  const ico = Icons.target(16);
  ico.classList.add('cvg-launch-ico');
  btn.appendChild(ico);

  const text = document.createElement('span');
  text.className = 'cvg-launch-text';
  btn.appendChild(text);

  const chev = Icons.chevronRight(16);
  chev.classList.add('cvg-launch-chev');
  btn.appendChild(chev);

  host.appendChild(btn);
  fill(cachedCoverage(opts.colour));

  void loadCoverage(opts.colour, {
    stillHere: () => live,
    onPartial: load => { if (live) fill(load); },
  }).then(load => { if (live) fill(load); }).catch(() => { /* the label just stays */ });

  function fill(load: CoverageLoad | null): void {
    text.replaceChildren();
    const label = document.createElement('span');
    label.className = 'cvg-launch-title';
    label.textContent = 'Coverage';
    text.appendChild(label);
    const sub = document.createElement('span');
    sub.className = 'cvg-launch-sub';
    sub.textContent = !load ? 'working it out…'
      : load.report.notable === 0 ? 'nothing to prepare yet'
      : `${load.report.pct}% answered · ${load.report.totalGaps || 'no'} ${load.report.totalGaps === 1 ? 'gap' : 'gaps'} to prepare`;
    text.appendChild(sub);
  }

  return { dispose() { live = false; } };
}

// ── small helpers ────────────────────────────────────────────────────────────

function sourceIcon(source: GapSource, size: number): SVGElement {
  return source === 'games' ? Icons.grid2x2(size)
    : source === 'library' ? Icons.book(size)
    : Icons.userCircle(size);
}

function movePrefix(ply: number): string {
  const num = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${num}.` : `${num}…`;
}

// "1.e4 e5 2.Nf3" from a flat SAN list — short enough for one line on a phone.
function formatSans(sans: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.${formatMove(sans[i])}`);
    else parts.push(formatMove(sans[i]));
  }
  return parts.join(' ');
}

/** The inline cap, re-exported so the builder doesn't import two modules. */
export { MAX_GAPS_INLINE };
