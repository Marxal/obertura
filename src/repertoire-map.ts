// Repertoire Map — full-colour view, zoomable tree, arrow navigation.
//
// openRepertoireMap(lines, colour, onOpenLine)  — as a full-screen overlay
// mountRepertoireMap(host, …)                   — embedded in a page (My Lines)
//
// Shows all lines for one colour merged into a tree from the start position.
// Tap a node → position preview slides in at the top (two-column: board + info).
// Arrow buttons (bottom) navigate the tree; ± buttons zoom.
//
// The merge itself (path- or position-keyed, and the loop guards the latter
// needs) lives in map-merge.ts, DOM-free so it can be self-tested.

import type { Line } from './types';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Key } from 'chessground/types';
import { nameForFen } from './openings';
import { Icons } from './icons';
import { pushBack } from './back-nav';
import { statScorePct, topReply, type StatNode } from './move-stats';
import { wdlScoreRow } from './wdl-bar';
import type { ImportedGame } from './import-core';
import { getGamesSource } from './import-panel';
import { formatMove } from './notation';
import {
  allNodes, buildMergedTree, movedBy, type MapNode, type MergeMode,
} from './map-merge';

const NS = 'http://www.w3.org/2000/svg';

// The moves reaching the tapped node, handed to a custom node action so a caller
// (opponent scouting) can prepare a reply from exactly that position.
export interface NodeActionContext {
  fen: string;
  san: string;
  ucis: string[];   // uci path from the start to this node
  sans: string[];   // same path in SAN
  colour: 'white' | 'black';
}

export interface RepertoireMapOptions {
  // Header title — defaults to "White/Black repertoire".
  title?: string;
  // Header badge — defaults to "N lines".
  subtitle?: string;
  // Open already focused on this position (uci path from the start) instead of
  // the first move — so "Visualise your tree" from the builder lands on the
  // board's current position. Falls back to the first move if the path isn't in
  // the (possibly pruned) tree.
  initialPath?: string[];
  // Replaces the default "Open in builder" preview action. When set, the button
  // shows on EVERY node (not just nodes tied to a saved line); pass disabled to
  // surface it as a not-yet-live stub.
  nodeAction?: {
    label: string;
    disabled?: boolean;
    onAct?: (ctx: NodeActionContext) => void;
  };
  // Depth control — the "Go deeper" feature. When set, the map renders only the
  // first `startPlies` plies and offers a quiet "Go deeper" control that reveals
  // `stepPlies` more each click, rebuilding from data already on the phone.
  depth?: MapDepth;
  // Per-move statistics. When set, each node gets a win/draw/loss bar and the tap
  // preview gains games / W-D-L / most-played reply. The `tree` is a UCI-keyed
  // stats lookup (see move-stats.ts); `caption` names whose results these are
  // ("their results" / "your results").
  // `games` (optional) are the games behind the tree, in the same perspective;
  // the Line browser uses them to offer a "See full game" link when the walked
  // position pins down exactly one of them.
  stats?: { tree: StatNode; caption: string; games?: ImportedGame[] };
  // Colour toggle — when set, a White/Black segmented control sits at the top of
  // the tree (just under the header). The map shows one colour at a time; picking
  // the other colour closes this map and reopens it for that colour (so all the
  // colour-specific data — lines, stats, depth — is rebuilt by the caller).
  // `enabled` greys out a side with nothing to show; `onPick` runs AFTER this map
  // has closed itself.
  colourToggle?: {
    current: 'white' | 'black';
    enabled: { white: boolean; black: boolean };
    onPick: (colour: 'white' | 'black') => void;
  };
  // Source toggle — a discrete "Games / Repertoire" segmented control next to
  // the colour toggle. Picking the other source closes this map and reopens it
  // backed by that source (the caller rebuilds lines / stats / depth). Same
  // close-then-reopen contract as the colour toggle.
  sourceToggle?: {
    current: 'games' | 'repertoire';
    enabled: { games: boolean; repertoire: boolean };
    onPick: (source: 'games' | 'repertoire') => void;
  };
  // Opponent perspective. When set, the tap-preview board faces MY answering side
  // (`you`) and shows the opponent (avatar + name) above it and "You" below — so
  // a scouted position reads from the seat I'll play it from.
  perspective?: {
    you: 'white' | 'black';
    opponent?: { name: string; avatarUrl?: string };
  };
  // A way OUT of an embedded map and into a full-screen one. When set, a button
  // appears in the control bar; the caller reopens the same map as an overlay
  // (openRepertoireMap), standing where this one was standing — which is why it
  // receives the current path.
  //
  // It exists because an embedded map is a `touch-action: none` surface filling
  // most of a scrolling page: a vertical swipe that starts inside it pans the
  // tree rather than the page, so the card has to be small enough to scroll
  // past, and then it is too small to work in. Small card, full screen when you
  // mean it.
  onFullScreen?: (path: string[]) => void;
  // True for the full-screen overlay (openRepertoireMap sets it). The tap
  // preview's board starts UP there: the whole reason to go full screen is that
  // the embedded card is too small to work in, and arriving to a 44px strip you
  // then have to pull up spends the extra room on nothing. An embedded map keeps
  // the strip, where the room genuinely is the problem.
  fullScreen?: boolean;
  // How lines are merged into the tree (see map-merge.ts):
  //   'path'     — the default. Two lines share a node only while they have not
  //                parted, so a transposition draws as two separate branches.
  //   'position' — nodes are keyed by POSITION, so two lines that transpose into
  //                each other land on one node and continue once. Alternative
  //                routes into a node draw as dashed edges, and nodes where you
  //                have more than one answer are marked.
  merge?: MergeMode;
}

export interface MapDepth {
  startPlies: number;     // first render depth (10 = 5 moves)
  stepPlies: number;      // added per "Go deeper" click (10 = 5 moves)
  // How deep the underlying data truly reaches. Caps the stepping and drives the
  // shallow "imported at N moves" hint when the data can't deepen at all.
  maxPlies: number;
  // Re-supply the lines to draw at `plies` deep. For the repertoire map this is
  // just the full saved lines (the map truncates); for opponents it rebuilds the
  // pruned tree from stored games. Heavy work is fine — the map calls it behind
  // a spinner, off the paint frame.
  atDepth: (plies: number) => Line[];
  // Opponent maps set this: when the data is too shallow to deepen, the control
  // disables with an "imported at N moves" note instead of vanishing. Repertoire
  // maps leave it false and the control simply hides when there's nothing deeper.
  importHint?: boolean;
}

// Node box geometry. The tree flows LEFT → RIGHT: the root sits at the left,
// each generation of moves marches to the right, and sibling variations stack
// vertically. So the "sibling gap" is now vertical and the "generation gap" is
// horizontal (the reverse of a top-down tree).
const NW = 56;          // node width
const NH = 30;          // node height
// Vertical gap between stacked sibling subtrees. It has to clear the tap
// TARGET, not the box: the hit rect is NH + 14 = 44px tall (the minimum a thumb
// wants), so a pitch of NH + 12 left adjacent targets overlapping by 2px and a
// tap on the boundary landed on whichever was drawn last. NH + 16 = 46 clears it.
const SIBLING_GAP = 16;
const GEN_GAP = 36;     // horizontal gap: right of parent → left of child
const PAD = 20;         // outer padding

// ── How small the first paint may go ─────────────────────────────────────────
//
// The fit is a CSS transform, so shrinking the tree shrinks the TEXT with it: at
// the old 0.55 floor a 12px move label rendered at 6.6px, which is not a label
// any more. The floor is therefore derived from legibility rather than picked:
// the smallest the map will draw itself is the scale at which the move text is
// still readable, and anything wider than that is what panning is for.
//
// NODE_FONT_PX must match .rmap-node-text's font-size in the stylesheet. It is
// only ever used to work out this floor, so a drift costs a slightly wrong floor
// and nothing else.
const NODE_FONT_PX = 12;
const MIN_LEGIBLE_FONT_PX = 9.5;
const FIT_MIN_SCALE = MIN_LEGIBLE_FONT_PX / NODE_FONT_PX;

// Win/draw/loss bar, pinned to the bottom edge of the node box (below the SAN).
const BAR_M = 6;             // horizontal inset from the box edges
const BAR_H = 3.5;           // bar thickness
const BAR_GAP = 3;           // gap from the box bottom up to the bar

// ── Map node ──────────────────────────────────────────────────────────────────

// Stamp each MapNode with its W/D/L stats by descending both trees in lockstep
// (one pass, O(nodes)). A node whose move never appears in the games is left
// null — no bar, no preview stats. The root carries the colour totals.
function attachStats(node: MapNode, stat: StatNode | null): void {
  node.stats = stat;
  for (const c of node.children) {
    attachStats(c, stat ? stat.children.get(c.uci) ?? null : null);
  }
}

// "Frequent" view: trim the tree to the moves actually played often, by the
// per-move game counts already stamped by attachStats. At each node keep the
// busiest child (the spine, so lines never dead-end) plus any sibling at/above a
// sample-scaled threshold — the same rule scout uses for the opponent tree, but
// applied here so it works identically for both maps (opponent games / my games).
// Run AFTER attachStats and BEFORE buildSVG. Nodes with no stats count as 0.
function pruneByStats(root: MapNode): void {
  const total = root.stats?.games ?? 0;
  const minCount = total >= 8 ? Math.max(2, Math.ceil(total * 0.05)) : 1;
  const games = (n: MapNode): number => n.stats?.games ?? 0;
  const walk = (n: MapNode): void => {
    if (!n.children.length) return;
    let top = n.children[0];
    for (const c of n.children) if (games(c) > games(top)) top = c;
    n.children = n.children.filter(c => c === top || games(c) >= minCount);
    for (const c of n.children) walk(c);
  };
  walk(root);
}

// ── Layout ────────────────────────────────────────────────────────────────────

// The vertical extent a subtree needs — siblings stack along Y, so a node's
// "subtree height" is the sum of its children's heights (plus the gaps between
// them), floored at one node tall.
function subH(n: MapNode): number {
  if (!n.children.length) return NH;
  const tot = n.children.reduce((s, c, i) => s + subH(c) + (i ? SIBLING_GAP : 0), 0);
  return Math.max(NH, tot);
}

// Place a node and its descendants. `x` is the left edge of this node's column,
// `y`..`y+h` is the vertical band reserved for its whole subtree. The node is
// centred vertically in that band; children march one generation to the right.
// We keep n.x = horizontal centre and n.y = top edge (the SVG drawing code
// relies on that), so only the axis the maths walks has changed.
function placeNodes(n: MapNode, x: number, y: number, h: number): void {
  n.x = x + NW / 2;
  n.y = y + h / 2 - NH / 2;
  if (!n.children.length) return;
  const chs = n.children.map(subH);
  const tot = chs.reduce((s, v) => s + v, 0) + SIBLING_GAP * (chs.length - 1);
  let cy = y + (h - tot) / 2;
  const cx = x + NW + GEN_GAP;
  for (let i = 0; i < n.children.length; i++) {
    placeNodes(n.children[i], cx, cy, chs[i]);
    cy += chs[i] + SIBLING_GAP;
  }
}

/** Line ends under a node — what a fold is putting away, in the unit that means
 * something to the user. */
function countEnds(n: MapNode): number {
  if (!n.children.length) return 1;
  return n.children.reduce((sum, c) => sum + countEnds(c), 0);
}

// Rightmost edge reached by any node — drives the SVG width.
function treeMaxX(n: MapNode): number {
  let m = n.x + NW / 2;
  for (const c of n.children) m = Math.max(m, treeMaxX(c));
  return m;
}

// ── SVG ───────────────────────────────────────────────────────────────────────

function buildSVG(
  root: MapNode,
  onTap: (n: MapNode) => void,
  marks = false,
  onToggleFold?: (n: MapNode) => void,
): SVGSVGElement {
  const h = subH(root);
  placeNodes(root, PAD, PAD, h);
  const maxX = treeMaxX(root);
  const svgW = maxX + PAD;
  const svgH = h + 2 * PAD;

  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(svgW));
  svg.setAttribute('height', String(svgH));
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  // Root is the start position (no SAN) — skip it, draw its children.
  drawEdges(svg, root, true);
  if (marks) drawAltEdges(svg, root);
  drawNodes(svg, root, true, onTap, marks, onToggleFold);
  return svg;
}

// The position merge's second routes into a node: the dashed lines that say
// "these two roads are the same position". Drawn from the already-placed
// coordinates, so they cost no layout and — being outside `children` — no walk
// ever follows them. Edges touching the invisible root (a line that repeats back
// to the start) have nowhere to land, so they're left to the node's own marker.
function drawAltEdges(svg: SVGElement, root: MapNode): void {
  for (const n of allNodes(root)) {
    if (!n.san) continue;
    for (const e of n.altOut) {
      if (!e.to.san) continue;
      const x1 = n.x + NW / 2, y1 = n.y + NH / 2;
      const x2 = e.to.x - NW / 2, y2 = e.to.y + NH / 2;
      const mx = Math.max(Math.abs(x2 - x1) * 0.5, GEN_GAP);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x1},${y1} C${x1 + mx},${y1} ${x2 - mx},${y2} ${x2},${y2}`);
      p.setAttribute('class', `rmap-edge rmap-edge--alt${e.back ? ' rmap-edge--back' : ''}`);
      svg.appendChild(p);
    }
  }
}

// A thin three-segment win/draw/loss bar along the node's bottom edge. Colours
// mirror wdl-bar.ts (sage win, neutral draw, brick loss). Non-interactive so
// taps still land on the node.
function drawStatBar(g: SVGGElement, n: MapNode): void {
  const s = n.stats;
  if (!s) return;
  const total = s.wins + s.draws + s.losses;
  if (total === 0) return;

  const left = n.x - NW / 2 + BAR_M;
  const barW = NW - 2 * BAR_M;
  const top = n.y + NH - BAR_GAP - BAR_H;

  const track = document.createElementNS(NS, 'rect');
  track.setAttribute('x', String(left));
  track.setAttribute('y', String(top));
  track.setAttribute('width', String(barW));
  track.setAttribute('height', String(BAR_H));
  track.setAttribute('rx', '1.5');
  track.setAttribute('class', 'rmap-wdl-track');
  g.appendChild(track);

  let cx = left;
  const seg = (kind: 'win' | 'draw' | 'loss', val: number) => {
    if (val === 0) return;
    const w = (val / total) * barW;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(cx));
    r.setAttribute('y', String(top));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(BAR_H));
    r.setAttribute('class', `rmap-wdl-seg rmap-wdl-seg--${kind}`);
    g.appendChild(r);
    cx += w;
  };
  seg('win', s.wins);
  seg('draw', s.draws);
  seg('loss', s.losses);
}

function drawEdges(parent: SVGElement, n: MapNode, skip: boolean): void {
  for (const c of n.children) {
    if (!skip) {
      // Edges now run left → right: from the parent's right-centre to the
      // child's left-centre, with a horizontal S-curve.
      const x1 = n.x + NW / 2, y1 = n.y + NH / 2;
      const x2 = c.x - NW / 2, y2 = c.y + NH / 2;
      const mx = (x2 - x1) * 0.5;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x1},${y1} C${x1 + mx},${y1} ${x2 - mx},${y2} ${x2},${y2}`);
      p.setAttribute('class', 'rmap-edge');
      parent.appendChild(p);
    }
    drawEdges(parent, c, false);
  }
}

function drawNodes(
  parent: SVGElement,
  n: MapNode,
  skip: boolean,
  onTap: (n: MapNode) => void,
  marks = false,
  onToggleFold?: (n: MapNode) => void,
): void {
  if (!skip) {
    const isFork = n.children.length > 1 || !!n.collapsed;
    const mover = movedBy(n.fen);
    const g = document.createElementNS(NS, 'g') as SVGGElement;
    g.setAttribute('class', [
      'rmap-node',
      `rmap-node--${mover}`,
      isFork ? 'rmap-node--fork' : '',
      marks && n.altIn > 0 ? 'rmap-node--merged' : '',
    ].filter(Boolean).join(' '));

    // Enlarged transparent hit area (≈44px tall for reliable taps).
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', String(n.x - NW / 2 - 10));
    hit.setAttribute('y', String(n.y - 7));
    hit.setAttribute('width', String(NW + 20));
    hit.setAttribute('height', String(NH + 14));
    hit.setAttribute('rx', '10');
    hit.setAttribute('fill', 'transparent');
    g.appendChild(hit);

    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', String(n.x - NW / 2));
    bg.setAttribute('y', String(n.y));
    bg.setAttribute('width', String(NW));
    bg.setAttribute('height', String(NH));
    bg.setAttribute('rx', '7');
    bg.setAttribute('class', 'rmap-node-bg');
    g.appendChild(bg);

    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('x', String(n.x));
    txt.setAttribute('y', String(n.y + NH / 2 + 5));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('class', 'rmap-node-text');
    txt.textContent = formatMove(n.san);
    g.appendChild(txt);

    // No-ops when the node has no stats (e.g. repertoire moves never played).
    drawStatBar(g, n);

    // More than one answer of mine from this position — the one thing a
    // read-only tree can tell you that a list of lines can't.
    if (marks && n.answers > 1) drawAnswerBadge(g, n);

    // Fold control on every fork. Until now the only depth control was global —
    // everything, or the first N moves of everything — and on a phone the single
    // most useful thing you can do to a tree is put one branch away while you
    // read the other.
    if (onToggleFold && isFork) drawFoldToggle(g, n, onToggleFold);

    n.svgEl = g;
    g.addEventListener('click', e => {
      e.stopPropagation();
      onTap(n);
    });
    parent.appendChild(g);
  }
  for (const c of n.children) drawNodes(parent, c, false, onTap, marks, onToggleFold);
}

// The fold control: a small disc off the node's right edge, sitting in the gap
// between generations so it never lands on a neighbour. Open, it is a minus;
// folded, it is the number of LINE ENDS put away — which is the figure worth
// knowing ("six lines under here"), not the number of moves.
const FOLD_R = 8;

function drawFoldToggle(g: SVGGElement, n: MapNode, onToggle: (n: MapNode) => void): void {
  const cx = n.x + NW / 2 + FOLD_R + 2;
  const cy = n.y + NH / 2;
  const folded = !!n.collapsed;

  const wrap = document.createElementNS(NS, 'g');
  wrap.setAttribute('class', `rmap-fold${folded ? ' rmap-fold--on' : ''}`);

  // Its own tap target, comfortably bigger than the disc it draws.
  const hit = document.createElementNS(NS, 'rect');
  hit.setAttribute('x', String(cx - 14));
  hit.setAttribute('y', String(cy - 14));
  hit.setAttribute('width', '28');
  hit.setAttribute('height', '28');
  hit.setAttribute('fill', 'transparent');
  wrap.appendChild(hit);

  const disc = document.createElementNS(NS, 'circle');
  disc.setAttribute('cx', String(cx));
  disc.setAttribute('cy', String(cy));
  disc.setAttribute('r', String(FOLD_R));
  disc.setAttribute('class', 'rmap-fold-disc');
  wrap.appendChild(disc);

  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', String(cx));
  label.setAttribute('y', String(cy + 3.5));
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('class', 'rmap-fold-text');
  label.textContent = folded ? String(n.hiddenEnds ?? 0) : '−';
  wrap.appendChild(label);

  const ends = n.hiddenEnds ?? 0;
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('aria-label', folded
    ? `Unfold ${ends} line${ends === 1 ? '' : 's'} after ${n.san}`
    : `Fold away everything after ${n.san}`);
  wrap.addEventListener('click', e => {
    // The node under it must not select as well — this is its own control.
    e.stopPropagation();
    onToggle(n);
  });
  g.appendChild(wrap);
}

// A small count pill on the node's top-right corner: "you have N answers here".
function drawAnswerBadge(g: SVGGElement, n: MapNode): void {
  const cx = n.x + NW / 2 - 2;
  const cy = n.y + 1;
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', '7');
  c.setAttribute('class', 'rmap-answers-dot');
  g.appendChild(c);

  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', String(cx));
  t.setAttribute('y', String(cy + 3.5));
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('class', 'rmap-answers-text');
  t.textContent = String(n.answers);
  g.appendChild(t);
}

// ── Position preview panel ────────────────────────────────────────────────────

interface PreviewController {
  el: HTMLElement;
  show(n: MapNode, lines: Line[], open: (l: Line) => void): void;
}

// The uci/san path from the (invisible) root down to this node.
function nodePath(n: MapNode): { ucis: string[]; sans: string[] } {
  const ucis: string[] = [];
  const sans: string[] = [];
  let cur: MapNode | null = n;
  while (cur && cur.san) {
    ucis.unshift(cur.uci);
    sans.unshift(cur.san);
    cur = cur.parent;
  }
  return { ucis, sans };
}

// The tap-preview stats block: caption, [score% · W/D/L bar · counts], plus the
// most-played reply from this position.
function statsBlock(n: MapNode, caption: string): HTMLElement {
  const s = n.stats!;
  const wrap = document.createElement('div');
  wrap.className = 'rmap-pos-stats';

  const cap = document.createElement('div');
  cap.className = 'wdl-caption';
  cap.textContent = caption;
  wrap.appendChild(cap);

  wrap.appendChild(wdlScoreRow(
    { wins: s.wins, draws: s.draws, losses: s.losses, scorePct: statScorePct(s), games: s.games },
    `${s.games} game${s.games === 1 ? '' : 's'}`,
  ));

  const reply = topReply(s);
  if (reply) {
    const r = document.createElement('div');
    r.className = 'rmap-pos-meta';
    r.textContent = `Most common reply: ${formatMove(reply.san)} (${Math.round((reply.games / s.games) * 100)}%)`;
    wrap.appendChild(r);
  }

  return wrap;
}

// A compact player strip bracketing the preview board (opponent on top, "You"
// below). Mirrors the board browser's strips; a missing opponent shows a generic
// user icon + "Opponent".
function rmapPlayerStrip(who: { name: string; avatarUrl?: string } | undefined | 'you'): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'rmap-player' + (who === 'you' ? ' rmap-player--you' : '');

  const isYou = who === 'you';
  // "You" reads your connected identity (handle for either platform, picture for
  // Chess.com only) so the near strip matches the board browser.
  const me = isYou ? getGamesSource() : null;
  const name = isYou ? (me?.username ? `@${me.username}` : 'You') : (who?.name ?? 'Opponent');
  const url = isYou ? me?.avatarUrl : who?.avatarUrl;

  if (url) {
    const img = document.createElement('img');
    img.className = 'rmap-player-avatar';
    img.src = url;
    img.alt = '';
    img.width = 18;
    img.height = 18;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(rmapPlayerIcon()));
    strip.appendChild(img);
  } else {
    strip.appendChild(rmapPlayerIcon());
  }

  const label = document.createElement('span');
  label.className = 'rmap-player-name';
  label.textContent = name;
  strip.appendChild(label);
  return strip;
}

function rmapPlayerIcon(): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'rmap-player-avatar rmap-player-avatar--icon';
  wrap.appendChild(Icons.userCircle(13));
  return wrap;
}

// A BOTTOM SHEET, in two heights.
//
// It used to be a panel pinned to the TOP of the tree area, always at full
// height: 190px of a 512px tree box on a phone — 37% of the map — dropped over
// the part of the tree you had just been reading, and often over the very node
// you tapped. Half of that was a chessboard nobody had asked for yet.
//
// Now the answer to "what is this move?" is a 44px strip at the BOTTOM, where
// the thumb already is: the move, the opening it makes, and a chevron. Pull it
// up and you get the board and everything else, exactly as before. The open /
// closed choice sticks for the session, because someone who opened it once
// means it; a desktop starts open, since up there the room was never the
// problem.
function makePreview(
  colour: 'white' | 'black',
  opts: RepertoireMapOptions,
  requestClose: () => void,
): PreviewController {
  const panel = document.createElement('div');
  panel.className = 'rmap-pos-panel';
  panel.hidden = true;

  let expanded = opts.fullScreen
    || (window.matchMedia?.('(min-width: 960px)').matches ?? false);

  // ── The handle: always visible once a node is selected ──
  const handle = document.createElement('div');
  handle.className = 'rmap-pos-handle';

  const grab = document.createElement('button');
  grab.type = 'button';
  grab.className = 'rmap-pos-grab';
  const handleSan = document.createElement('span');
  handleSan.className = 'rmap-pos-handle-san';
  grab.appendChild(handleSan);
  const handleName = document.createElement('span');
  handleName.className = 'rmap-pos-handle-name';
  grab.appendChild(handleName);
  const chev = Icons.chevronDown(18);
  chev.classList.add('rmap-pos-handle-chev');
  grab.appendChild(chev);
  grab.addEventListener('click', () => setExpanded(!expanded));
  handle.appendChild(grab);

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'rmap-pos-collapse';
  collapseBtn.setAttribute('aria-label', 'Hide position');
  collapseBtn.textContent = '×';
  collapseBtn.addEventListener('click', () => { panel.hidden = true; });
  handle.appendChild(collapseBtn);
  panel.appendChild(handle);

  // ── The body: board + info, revealed when the sheet is up ──
  const body = document.createElement('div');
  body.className = 'rmap-pos-body';
  panel.appendChild(body);

  // Board column (left). For opponent maps it's bracketed by player strips
  // (opponent on top, "You" below) so the perspective reads at a glance.
  const boardCol = document.createElement('div');
  boardCol.className = 'rmap-pos-board-col';
  if (opts.perspective) boardCol.appendChild(rmapPlayerStrip(opts.perspective.opponent));
  const boardEl = document.createElement('div');
  boardEl.className = 'rmap-pos-board';
  boardCol.appendChild(boardEl);
  if (opts.perspective) boardCol.appendChild(rmapPlayerStrip('you'));
  body.appendChild(boardCol);

  // Info column (right).
  const infoCol = document.createElement('div');
  infoCol.className = 'rmap-pos-info-col';
  body.appendChild(infoCol);

  let cg: CgApi | null = null;
  // The node the sheet is describing, so expanding it later can mount the board
  // for a position that was selected while it was down.
  let current: MapNode | null = null;

  function setExpanded(open: boolean): void {
    expanded = open;
    panel.classList.toggle('rmap-pos-panel--open', open);
    body.hidden = !open;
    grab.setAttribute('aria-expanded', String(open));
    grab.setAttribute('aria-label', open ? 'Hide the board' : 'Show the board');
    // A board is only worth mounting once it can be seen — and chessground
    // measures its container, so mounting one inside a hidden box lays it out at
    // zero and it never recovers.
    if (open && current) paintBoard(current);
  }
  setExpanded(expanded);

  function paintBoard(n: MapNode): void {
    const from = n.uci.slice(0, 2) as Key;
    const to = n.uci.slice(2, 4) as Key;
    const orient = opts.perspective?.you ?? boardOrientation(n) ?? colour;
    if (!cg) {
      cg = Chessground(boardEl, {
        fen: n.fen, orientation: orient, viewOnly: true,
        coordinates: false,
        drawable: { enabled: false }, animation: { enabled: false },
        selectable: { enabled: false },
        highlight: { lastMove: true, check: false },
        lastMove: [from, to],
      });
    } else {
      cg.set({ fen: n.fen, orientation: orient, lastMove: [from, to] });
    }
  }

  // Which way up the board faces: an opponent map fixes it to my answering side,
  // otherwise follow the saved line this node belongs to. Held here so both the
  // mount and the later repaint agree.
  let boardLines: Line[] = [];
  function boardOrientation(n: MapNode): 'white' | 'black' | null {
    return boardLines.find(l => n.lineIds.includes(l.id))?.colour ?? null;
  }

  function show(n: MapNode, lines: Line[], open: (l: Line) => void): void {
    panel.hidden = false;
    current = n;
    boardLines = lines;

    // The handle says what you tapped, whether or not the board is up.
    handleSan.textContent = formatMove(n.san);
    handleName.textContent = nameForFen(n.fen) ?? '';

    const assoc = lines.find(l => n.lineIds.includes(l.id));
    // Only when the sheet is up: a board mounted into a hidden box measures zero
    // and never recovers (see setExpanded).
    if (expanded) paintBoard(n);

    infoCol.innerHTML = '';

    const opening = nameForFen(n.fen);
    if (opening) {
      const nm = document.createElement('div');
      nm.className = 'rmap-pos-opening';
      nm.textContent = opening;
      infoCol.appendChild(nm);
    }

    const san = document.createElement('div');
    san.className = 'rmap-pos-san';
    san.textContent = formatMove(n.san);
    infoCol.appendChild(san);

    if (opts.stats && n.stats && n.stats.games > 0) {
      infoCol.appendChild(statsBlock(n, opts.stats.caption));
    }

    if (n.children.length > 1) {
      const v = document.createElement('div');
      v.className = 'rmap-pos-meta';
      v.textContent = `${n.children.length} variations`;
      infoCol.appendChild(v);
    }

    // Position-merged maps: say what the merge did to this node, since the SAN
    // above is only the move that got here FIRST.
    if (opts.merge === 'position') {
      const meta = (text: string): void => {
        const el = document.createElement('div');
        el.className = 'rmap-pos-meta';
        el.textContent = text;
        infoCol.appendChild(el);
      };
      if (n.answers > 1) meta(`You have ${n.answers} answers here`);
      if (n.altIn > 0) {
        meta(n.altIn === 1
          ? 'Also reached by another move order'
          : `Also reached by ${n.altIn} other move orders`);
      }
      if (n.lineIds.length > 1) meta(`In ${n.lineIds.length} of your lines`);
    }

    if (opts.nodeAction) {
      // Custom action (e.g. scouting's "Prepare a reply"): on every node.
      const actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'rmap-pos-open-btn';
      actBtn.textContent = opts.nodeAction.label;
      actBtn.disabled = !!opts.nodeAction.disabled;
      const act = opts.nodeAction;
      actBtn.addEventListener('click', () => {
        const { ucis, sans } = nodePath(n);
        // The action leaves the map (e.g. into the builder), so close first to
        // keep the back-navigation stack tidy and the overlay out of the way.
        if (!act.disabled) requestClose();
        act.onAct?.({ fen: n.fen, san: n.san, ucis, sans, colour });
      });
      infoCol.appendChild(actBtn);
    } else if (assoc) {
      const titleEl = document.createElement('div');
      titleEl.className = 'rmap-pos-line-title';
      titleEl.textContent = assoc.name || assoc.openingName || '';
      if (titleEl.textContent) infoCol.appendChild(titleEl);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'rmap-pos-open-btn';
      openBtn.textContent = 'Open in builder';
      openBtn.addEventListener('click', () => open(assoc));
      infoCol.appendChild(openBtn);
    }
  }

  return { el: panel, show };
}

// ── Pan + zoom ─────────────────────────────────────────────────────────────────

interface TxState {
  scale: number;
  tx: number;
  ty: number;
}

function applyTx(inner: HTMLElement, state: TxState, animated = false): void {
  if (animated) {
    inner.style.transition = 'transform 0.22s ease-out';
    setTimeout(() => { inner.style.transition = ''; }, 260);
  } else {
    inner.style.transition = '';
  }
  inner.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
}

// Returns a disposer that detaches the window-level listeners. The pan/zoom
// handlers on `outer` go away with the overlay, but the mouse drag tracks moves
// across the whole window, so its `mousemove`/`mouseup` are on `window` and must
// be removed by hand on close — otherwise every open of the map leaks another
// pair that fires for the rest of the session.
function initPanZoom(
  outer: HTMLElement,
  inner: HTMLElement,
  state: TxState,
  onDoubleTap?: () => void,
): () => void {
  // Touch pan + pinch
  let t0: Touch | null = null;
  let startTx = 0, startTy = 0;
  let lastDist = 0;
  // Double-tap-to-centre: a tap is a single finger that didn't pinch or drag;
  // two within 300ms fire onDoubleTap.
  let lastTapAt = 0, tapX = 0, tapY = 0, tapMoved = false, multiTouch = false;

  // Scale around a screen point (client coords), keeping the world point under it
  // fixed — so zoom homes in where the gesture is, rather than the origin.
  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = outer.getBoundingClientRect();
    const ax = clientX - rect.left, ay = clientY - rect.top;
    const s0 = state.scale;
    const s1 = Math.max(0.15, Math.min(5, s0 * factor));
    if (s1 === s0) return;
    state.tx = ax - ((ax - state.tx) / s0) * s1;
    state.ty = ay - ((ay - state.ty) / s0) * s1;
    state.scale = s1;
    applyTx(inner, state);
  }

  outer.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      t0 = e.touches[0];
      startTx = state.tx; startTy = state.ty;
      tapX = t0.clientX; tapY = t0.clientY; tapMoved = false; multiTouch = false;
    } else {
      multiTouch = true;
    }
    lastDist = 0;
  }, { passive: true });

  outer.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (lastDist > 0) {
        zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, d / lastDist);
      }
      lastDist = d;
    } else if (e.touches.length === 1 && t0) {
      const tx = e.touches[0].clientX, ty = e.touches[0].clientY;
      if (Math.hypot(tx - tapX, ty - tapY) > 10) tapMoved = true;
      state.tx = startTx + (tx - t0.clientX);
      state.ty = startTy + (ty - t0.clientY);
      applyTx(inner, state);
    }
  }, { passive: true });

  outer.addEventListener('touchend', e => {
    lastDist = 0;
    if (e.touches.length === 0 && !multiTouch && !tapMoved) {
      const now = Date.now();
      if (now - lastTapAt < 300) { onDoubleTap?.(); lastTapAt = 0; }
      else lastTapAt = now;
    }
  }, { passive: true });

  // Mouse double-click also re-centres.
  outer.addEventListener('dblclick', () => onDoubleTap?.());

  // Mouse drag
  let md = false, mx = 0, my = 0, mtx = 0, mty = 0;
  outer.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    md = true; mx = e.clientX; my = e.clientY; mtx = state.tx; mty = state.ty;
    outer.style.cursor = 'grabbing';
  });
  const onMouseMove = (e: MouseEvent) => {
    if (!md) return;
    state.tx = mtx + (e.clientX - mx);
    state.ty = mty + (e.clientY - my);
    applyTx(inner, state);
  };
  const onMouseUp = () => {
    md = false;
    outer.style.cursor = '';
  };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // Wheel zoom — anchored on the pointer, faster multiplier for snappier feel.
  outer.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 0.85);
  }, { passive: false });

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}

// Centre a node in the visible area (with smooth animation).
function centreNode(node: MapNode, outer: HTMLElement, state: TxState, inner: HTMLElement): void {
  const rect = outer.getBoundingClientRect();
  // Bias slightly left of centre so the selected move's children (which extend
  // to the right in the horizontal layout) stay on screen; centre vertically.
  state.tx = rect.width / 3 - node.x * state.scale;
  state.ty = rect.height / 2 - (node.y + NH / 2) * state.scale;
  applyTx(inner, state, true);
}

// ── Navigation buttons ────────────────────────────────────────────────────────

interface NavControls {
  container: HTMLElement;   // the bottom bar (view-toggle slot + move arrows)
  zoom: HTMLElement;        // floating zoom group — caller drops it in the tree area
  viewSlot: HTMLElement;    // left slot in the bar for the All/Frequent toggle
  update(n: MapNode | null, forkChoice: Map<MapNode, number>): void;
}

// Single-chevron glyphs matching the builder's step arrows (same viewBox +
// stroke), so the map's MOVE arrows read as the same control the builder uses.
const CHEVRON: Record<'left' | 'right', string> = {
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
};

// Double-chevron glyphs for the VARIATION ("jump") arrows, so they're visibly
// distinct from the single-step move arrows.
const DBL_CHEVRON: Record<'up' | 'down', [string, string]> = {
  up: ['m17 11-5-5-5 5', 'm17 18-5-5-5 5'],
  down: ['m7 6 5 5 5-5', 'm7 13 5 5 5-5'],
};

function svgBtn(aria: string, paths: string[], handler: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  // Borrow the builder's step-button look (bar-btn--step) for an identical feel.
  b.className = 'rmap-nav-btn bar-btn bar-btn--step';
  b.setAttribute('aria-label', aria);
  b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none"
    stroke="currentColor" stroke-width="2.25" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
  b.disabled = true;
  b.addEventListener('click', handler);
  return b;
}

function makeControls(
  onLeft: () => void,
  onUp: () => void,
  onDown: () => void,
  onRight: () => void,
  onZoomIn: () => void,
  onZoomOut: () => void,
  onCentre: () => void,
): NavControls {
  const bar = document.createElement('div');
  bar.className = 'rmap-controls';

  // Left slot of the bar: the All/Frequent toggle drops in here when present.
  const viewSlot = document.createElement('div');
  viewSlot.className = 'rmap-controls-left';

  // Zoom + centre float OUTSIDE the bar (bottom-left of the tree area). Returned
  // for the caller to place; CSS positions the cluster.
  const zoom = document.createElement('div');
  zoom.className = 'rmap-controls-zoom';
  for (const [t, a, h] of [['−', 'Zoom out', onZoomOut], ['+', 'Zoom in', onZoomIn]]) {
    const b = document.createElement('button');
    b.type = 'button';
    // …and the ± pair goes the same way on a phone: pinch is the gesture
    // everyone already reaches for, and these two float ON the tree, covering
    // it. The crosshair stays — "bring it back" has no gesture anyone would
    // guess (it is a double-tap), so it needs a button.
    b.className = 'rmap-zoom-btn rmap-zoom-btn--zoom';
    b.setAttribute('aria-label', String(a));
    b.textContent = String(t);
    b.addEventListener('click', h as () => void);
    zoom.appendChild(b);
  }
  // Crosshair — recentres a drifted map (double-tapping the map does the same).
  const centreBtn = document.createElement('button');
  centreBtn.type = 'button';
  centreBtn.className = 'rmap-zoom-btn';
  centreBtn.setAttribute('aria-label', 'Centre map');
  centreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
  centreBtn.addEventListener('click', onCentre);
  zoom.appendChild(centreBtn);

  // Right group: the variation (jump) arrows, then the move arrows.
  const navGroup = document.createElement('div');
  navGroup.className = 'rmap-controls-nav';
  const upBtn = svgBtn('Prev variation', DBL_CHEVRON.up, onUp);
  const downBtn = svgBtn('Next variation', DBL_CHEVRON.down, onDown);
  const leftBtn = svgBtn('Previous move', [CHEVRON.left], onLeft);
  const rightBtn = svgBtn('Next move', [CHEVRON.right], onRight);
  // The variation arrows step between siblings at a fork — which on a phone is
  // what tapping the sibling does, since they are stacked in plain sight a
  // thumb's width apart. Two of the seven controls crowding a 380px bar to
  // duplicate a tap is a poor trade, so CSS drops them below the desktop
  // breakpoint (see .rmap-nav-btn--var).
  upBtn.classList.add('rmap-nav-btn--var');
  downBtn.classList.add('rmap-nav-btn--var');
  navGroup.append(upBtn, downBtn, leftBtn, rightBtn);

  bar.appendChild(viewSlot);
  bar.appendChild(navGroup);

  function update(n: MapNode | null, forkChoice: Map<MapNode, number>): void {
    if (!n) {
      leftBtn.disabled = upBtn.disabled = downBtn.disabled = rightBtn.disabled = true;
      return;
    }
    // ← available if parent exists (and parent has a san — not the invisible root).
    leftBtn.disabled = !n.parent || !n.parent.san;
    // → available if node has any children.
    rightBtn.disabled = n.children.length === 0;
    // ↑/↓ available if we have siblings (parent has multiple children).
    const siblings = n.parent?.children ?? [];
    const idx = siblings.indexOf(n);
    upBtn.disabled = idx <= 0;
    downBtn.disabled = idx >= siblings.length - 1;

    // Show a hint on the → button when there's a fork to navigate.
    if (n.children.length > 1) {
      const ci = forkChoice.get(n) ?? 0;
      rightBtn.title = `Into variation ${ci + 1} of ${n.children.length}`;
    } else {
      rightBtn.title = '';
    }
  }

  return { container: bar, zoom, viewSlot, update };
}

// ── Colour toggle (top-of-tree White/Black segmented control) ──────────────────

// A segmented White/Black control for the top of the tree. Picking the other
// colour closes this map first (keeping the back stack balanced), then hands off
// to the caller's onPick, which reopens the map for that colour.
function buildTopToggles(opts: RepertoireMapOptions, close: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'rmap-colour-toggle';

  if (opts.colourToggle) {
    const t = opts.colourToggle;
    bar.appendChild(buildSeg(
      [{ id: 'white', label: '○ White' }, { id: 'black', label: '● Black' }],
      t.current, t.enabled, close, t.onPick,
    ));
  }
  if (opts.sourceToggle) {
    const t = opts.sourceToggle;
    bar.appendChild(buildSeg(
      [{ id: 'games', label: 'Games' }, { id: 'repertoire', label: 'Repertoire' }],
      t.current, t.enabled, close, t.onPick, 'rmap-source-seg',
    ));
  }
  return bar;
}

// A generic segmented control, reused for the colour and source toggles. Picking
// a non-active, enabled option closes the map first, then hands off to onPick.
function buildSeg<T extends string>(
  options: { id: T; label: string }[],
  current: T,
  enabled: Record<T, boolean>,
  close: () => void,
  onPick: (id: T) => void,
  extraClass?: string,
): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'rmap-view-seg' + (extraClass ? ` ${extraClass}` : '');
  seg.setAttribute('role', 'group');
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rmap-view-btn';
    b.textContent = o.label;
    const on = o.id === current;
    b.classList.toggle('rmap-view-btn--on', on);
    b.setAttribute('aria-pressed', String(on));
    if (!enabled[o.id]) {
      b.disabled = true;
    } else if (!on) {
      b.addEventListener('click', () => { close(); onPick(o.id); });
    }
    seg.appendChild(b);
  }
  return seg;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function openRepertoireMap(
  lines: Line[],
  colour: 'white' | 'black',
  onOpenLine: (line: Line) => void,
  opts: RepertoireMapOptions = {},
): void {
  const filtered = lines.filter(l => l.colour === colour);
  if (!filtered.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'rmap-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  // Closing the map (back button, opening a line, or the system back gesture)
  // all route through here so the back-navigation stack stays in sync.
  let mounted: MapHandle | null = null;
  function close(): void {
    mounted?.dispose();
    overlay.remove();
    removeBack();
  }
  const removeBack = pushBack(close);

  // Header.
  const header = document.createElement('div');
  header.className = 'rmap-header';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rmap-back';
  back.setAttribute('aria-label', 'Close map');
  back.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7"/></svg>`;
  back.addEventListener('click', close);

  const titleEl = document.createElement('h2');
  titleEl.className = 'rmap-title';
  titleEl.textContent = opts.title ?? (colour === 'white' ? 'White repertoire' : 'Black repertoire');

  const count = document.createElement('span');
  count.className = 'rmap-title-count';
  count.textContent = opts.subtitle ?? `${filtered.length} line${filtered.length !== 1 ? 's' : ''}`;

  header.appendChild(back);
  header.appendChild(titleEl);
  header.appendChild(count);
  overlay.appendChild(header);

  // In the DOM before the mount: the initial centring measures the tree area.
  document.body.appendChild(overlay);
  mounted = mountRepertoireMap(overlay, filtered, colour, onOpenLine, { ...opts, fullScreen: true }, close);
}

/** What an embedded map hands back — call dispose() when the host goes away. */
export interface MapHandle {
  dispose(): void;
}

/**
 * The map itself, minus the overlay chrome: toggles, tree, controls, all
 * appended to `host` (which must already be in the DOM, since the first centring
 * measures it). `openRepertoireMap` wraps this in a full-screen overlay; My
 * Lines' tree view drops it straight into the page.
 *
 * `requestClose` is what the map calls when an action takes the user elsewhere —
 * the overlay closes itself; an embedded map just detaches its listeners.
 */
export function mountRepertoireMap(
  host: HTMLElement,
  lines: Line[],
  colour: 'white' | 'black',
  onOpenLine: (line: Line) => void,
  opts: RepertoireMapOptions = {},
  requestClose: () => void = () => { /* embedded: nothing to close */ },
): MapHandle {
  const filtered = lines.filter(l => l.colour === colour);
  const close = requestClose;
  let disposePanZoom: (() => void) | null = null;

  // Toggle bar (under the header): a prominent White/Black colour toggle plus,
  // when wired, a discrete Games/Repertoire source toggle. Picking any option
  // closes this map; the caller reopens it rebuilt for that choice.
  if (opts.colourToggle || opts.sourceToggle) {
    host.appendChild(buildTopToggles(opts, close));
  }

  // Tree area (relative-positioned so the preview panel can float inside it).
  const treeArea = document.createElement('div');
  treeArea.className = 'rmap-tree-area';

  // Pan/zoom container.
  const treeWrap = document.createElement('div');
  treeWrap.className = 'rmap-tree-wrap';

  const inner = document.createElement('div');
  inner.className = 'rmap-zoom-inner';

  // Depth control. When set, render only `currentPlies` deep and let "Go deeper"
  // step it 5 moves at a time. The lines are (re)supplied at the current depth by
  // the control: opponents rebuild their pruned tree from stored games, the
  // repertoire hands back its saved lines (the merge truncates). Building from
  // games at the shallow start depth is cheap, so this is fine on first render.
  const depth = opts.depth ?? null;
  // Render deep enough for the requested initial position to exist on first paint.
  let currentPlies = depth
    ? Math.min(Math.max(depth.startPlies, opts.initialPath?.length ?? 0), depth.maxPlies)
    : Infinity;

  const currentLines = (): Line[] => (depth ? depth.atDepth(currentPlies) : filtered);

  // Per-move stats. Built once by the caller (UCI-keyed lookup); stamped onto the
  // tree on every (re)build, and always shown when present.
  const statsTree = opts.stats?.tree ?? null;

  // View mode. "all" shows every branch; "frequent" prunes by the stats counts.
  // The toggle only appears when we have stats to prune by; default is "frequent"
  // so the map opens clean (the user can expand to "all replies").
  let viewMode: 'all' | 'frequent' = 'frequent';

  // Position-keyed merge (the tree view) also gets the extra marks: dashed
  // alternative routes and the "you have N answers here" badge.
  const mergeMode: MergeMode = opts.merge ?? 'path';
  const marks = mergeMode === 'position';
  const makeTree = (): MapNode =>
    buildMergedTree(currentLines(), currentPlies, mergeMode, colour);

  // ── Folding ────────────────────────────────────────────────────────────────
  //
  // Which forks are folded away, by their uci path from the start. A PATH rather
  // than a node, because every rebuild ("Go deeper", All/Frequent, a colour
  // switch) throws the node objects away and builds fresh ones — and the fold
  // has to survive that, or every reveal would silently unfold everything.
  const folded = new Set<string>();

  const foldKey = (n: MapNode): string => nodePath(n).ucis.join(' ');

  // Fold the marked forks out of a freshly built tree. Emptying `children` is
  // all it takes: the layout, the width measure and every walk follow that one
  // list, so a folded subtree costs nothing anywhere downstream.
  function applyFolds(node: MapNode): void {
    node.collapsed = false;
    node.hiddenEnds = 0;
    if (node.san && node.children.length > 1 && folded.has(foldKey(node))) {
      node.hiddenEnds = countEnds(node);
      node.collapsed = true;
      node.children = [];
      return;
    }
    for (const c of node.children) applyFolds(c);
  }

  function toggleFold(n: MapNode): void {
    const key = foldKey(n);
    if (folded.has(key)) folded.delete(key);
    else folded.add(key);
    rebuild();
  }

  const makeDrawn = (): MapNode => {
    const built = makeTree();
    attachStats(built, statsTree);
    if (statsTree && viewMode === 'frequent') pruneByStats(built);
    // After the stats prune, so a fold hides what is actually on screen.
    applyFolds(built);
    return built;
  };

  let root = makeDrawn();

  if (!root.children.length) {
    const empty = document.createElement('p');
    empty.className = 'rmap-empty';
    empty.textContent = 'No lines saved yet.';
    treeArea.appendChild(empty);
    host.appendChild(treeArea);
    return { dispose: () => { /* nothing was wired up */ } };
  }

  // Navigation state.
  let selected: MapNode | null = null;
  const forkChoice = new Map<MapNode, number>();
  const state: TxState = { scale: 1, tx: 0, ty: 0 };

  // Preview panel.
  const preview = makePreview(colour, opts, close);
  treeArea.appendChild(preview.el);

  // A tiny spinner shown while a "Go deeper" rebuild runs off the paint frame.
  const spinner = document.createElement('div');
  spinner.className = 'rmap-spinner';
  spinner.hidden = true;
  spinner.innerHTML = '<div class="rmap-spinner-ring" aria-label="Building deeper map"></div>';
  treeArea.appendChild(spinner);

  function selectNode(n: MapNode): void {
    selected = n;

    // Update SVG highlight.
    svg.querySelectorAll('.rmap-node--selected')
      .forEach(el => el.classList.remove('rmap-node--selected'));
    n.svgEl?.classList.add('rmap-node--selected');

    // Show preview.
    preview.show(n, filtered, line => {
      close();
      onOpenLine(line);
    });

    // Centre node (with animation).
    centreNode(n, treeWrap, state, inner);

    // Update nav buttons.
    controls.update(n, forkChoice);
  }

  let svg = buildSVG(root, selectNode, marks, toggleFold);
  inner.appendChild(svg);
  treeWrap.appendChild(inner);
  treeArea.appendChild(treeWrap);
  host.appendChild(treeArea);

  // Re-centre the view on the first move of the (possibly rebuilt) tree. With
  // the left → right layout we pin the first move near the left edge and centre
  // it vertically, so the tree reads outward to the right like a game.
  //
  // It also picks the opening SCALE, which it used to leave at 1 whatever the
  // tree measured. On a phone that meant a ten-line book opened 1100px wide in a
  // 380px window: three moves showed and the other fifty nodes were somewhere
  // off to the right, with nothing on screen to say so. Now the first paint
  // shrinks to fit what has been drawn — but never below FIT_MIN_SCALE, because
  // a tree you cannot read is no better than one you cannot see. Anything still
  // too wide at that floor is what "Go deeper" is the other half of: draw fewer
  // moves rather than smaller ones.
  function fitScale(): number {
    const rect = treeWrap.getBoundingClientRect();
    if (rect.width === 0) return 1;
    const treeW = treeMaxX(root) + PAD;
    const treeH = subH(root) + 2 * PAD;
    const fit = Math.min(rect.width / treeW, rect.height / treeH, 1);
    return Math.max(FIT_MIN_SCALE, fit);
  }

  function centreOnFirst(): void {
    requestAnimationFrame(() => {
      if (root.children[0]) {
        const rect = treeWrap.getBoundingClientRect();
        state.scale = fitScale();
        const c0 = root.children[0];
        // A shrunk tree is pinned nearer the left edge than a full-size one, so
        // the gap in front of the first move doesn't grow with the zoom-out.
        state.tx = 40 * state.scale - (c0.x - NW / 2) * state.scale;
        state.ty = rect.height / 2 - (c0.y + NH / 2) * state.scale;
        applyTx(inner, state);
      }
    });
  }

  // Find a node by its uci-path from the root, or null if the path doesn't exist.
  function findByUcis(ucis: string[]): MapNode | null {
    let cur: MapNode | null = root;
    for (const u of ucis) {
      cur = cur ? cur.children.find(c => c.uci === u) ?? null : null;
      if (!cur) return null;
    }
    return cur;
  }

  // Swap in a freshly built tree at the current depth (after "Go deeper").
  // Going deeper only adds nodes, so we keep the user's place: re-select the
  // same move (by path) when one was selected, else re-centre on the first move.
  function rebuild(): void {
    const keepPath = selected ? nodePath(selected).ucis : null;
    root = makeDrawn();
    const newSvg = buildSVG(root, selectNode, marks, toggleFold);
    svg.replaceWith(newSvg);
    svg = newSvg;
    forkChoice.clear();
    const restored = keepPath ? findByUcis(keepPath) : null;
    if (restored) {
      selectNode(restored);
    } else {
      selected = null;
      controls.update(null, forkChoice);
      preview.el.hidden = true;
      centreOnFirst();
    }
  }

  function goDeeper(): void {
    if (!depth) return;
    const next = Math.min(currentPlies + depth.stepPlies, depth.maxPlies);
    if (next <= currentPlies) return;  // already at the data's full depth
    currentPlies = next;
    spinner.hidden = false;
    updateDeeper();
    // Let the spinner paint before the (possibly heavy) opponent rebuild.
    requestAnimationFrame(() => setTimeout(() => {
      rebuild();
      spinner.hidden = true;
    }, 0));
  }

  // Arrow + zoom controls.
  const controls = makeControls(
    // ← previous move
    () => {
      if (selected?.parent?.san) selectNode(selected.parent);
    },
    // ↑ previous sibling
    () => {
      if (!selected?.parent) return;
      const siblings = selected.parent.children;
      const idx = siblings.indexOf(selected);
      if (idx > 0) {
        forkChoice.set(selected.parent, idx - 1);
        selectNode(siblings[idx - 1]);
      }
    },
    // ↓ next sibling
    () => {
      if (!selected?.parent) return;
      const siblings = selected.parent.children;
      const idx = siblings.indexOf(selected);
      if (idx < siblings.length - 1) {
        forkChoice.set(selected.parent, idx + 1);
        selectNode(siblings[idx + 1]);
      }
    },
    // → next move
    () => {
      if (!selected?.children.length) return;
      const idx = forkChoice.get(selected) ?? 0;
      const target = selected.children[Math.min(idx, selected.children.length - 1)];
      selectNode(target);
    },
    // zoom in
    () => zoomBy(1.35),
    // zoom out
    () => zoomBy(1 / 1.35),
    // centre — bring a drifted map back to the current move (or the start)
    () => recentre(),
  );

  // Zoom the +/- buttons around the selected move (so zoom "guides through" it),
  // or the viewport centre when nothing's selected.
  function zoomBy(factor: number): void {
    const s0 = state.scale;
    const s1 = Math.max(0.15, Math.min(5, s0 * factor));
    if (s1 === s0) return;
    if (selected) {
      state.tx += selected.x * (s0 - s1);
      state.ty += selected.y * (s0 - s1);
    } else {
      const rect = treeWrap.getBoundingClientRect();
      state.tx = rect.width / 2 - ((rect.width / 2 - state.tx) / s0) * s1;
      state.ty = rect.height / 2 - ((rect.height / 2 - state.ty) / s0) * s1;
    }
    state.scale = s1;
    applyTx(inner, state, true);
  }

  // Re-centre on the selected move if there is one, else on the first move. Used
  // by the centre button and by double-tapping the map.
  function recentre(): void {
    if (selected) centreNode(selected, treeWrap, state, inner);
    else centreOnFirst();
  }

  // View toggle (All replies / Frequent) — only when we have stats to prune by.
  // Lives in the bar's left slot. Switching rebuilds at the current depth (which
  // keeps the selected move) behind the same spinner as "Go deeper".
  if (statsTree) {
    const seg = document.createElement('div');
    seg.className = 'rmap-view-seg';
    const modes: { id: 'all' | 'frequent'; label: string }[] = [
      { id: 'all', label: 'All replies' },
      { id: 'frequent', label: 'Frequent' },
    ];
    const btns = modes.map(m => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rmap-view-btn';
      b.textContent = m.label;
      b.setAttribute('aria-pressed', String(m.id === viewMode));
      b.classList.toggle('rmap-view-btn--on', m.id === viewMode);
      b.addEventListener('click', () => {
        if (m.id === viewMode) return;
        viewMode = m.id;
        btns.forEach((bb, i) => {
          const on = modes[i].id === viewMode;
          bb.classList.toggle('rmap-view-btn--on', on);
          bb.setAttribute('aria-pressed', String(on));
        });
        spinner.hidden = false;
        requestAnimationFrame(() => setTimeout(() => {
          rebuild();
          spinner.hidden = true;
        }, 0));
      });
      seg.appendChild(b);
      return b;
    });
    controls.viewSlot.appendChild(seg);
  }

  // "Full screen" — the embedded map's way into the overlay one, standing on the
  // move you were looking at.
  if (opts.onFullScreen) {
    const full = document.createElement('button');
    full.type = 'button';
    full.className = 'rmap-full-btn';
    full.appendChild(Icons.expand(16));
    const label = document.createElement('span');
    label.textContent = 'Full screen';
    full.appendChild(label);
    full.addEventListener('click', () => {
      opts.onFullScreen?.(selected ? nodePath(selected).ucis : []);
    });
    controls.viewSlot.appendChild(full);
  }

  // The quiet "Go deeper" control sits in the left group of the control bar. It
  // steps 5 moves at a time and retires once the data's full depth is on screen.
  let deeperBtn: HTMLButtonElement | null = null;
  function updateDeeper(): void {
    if (!depth || !deeperBtn) return;
    if (currentPlies >= depth.maxPlies) {
      if (depth.importHint && depth.maxPlies <= depth.startPlies) {
        // Too shallow to deepen at all (an old, shallow import): show the reach.
        deeperBtn.hidden = false;
        deeperBtn.disabled = true;
        deeperBtn.classList.add('rmap-deeper-btn--hint');
        deeperBtn.textContent = `Imported at ${Math.floor(depth.maxPlies / 2)} moves`;
      } else {
        deeperBtn.hidden = true;  // the full depth is already on screen
      }
      return;
    }
    deeperBtn.hidden = false;
    deeperBtn.disabled = false;
    deeperBtn.classList.remove('rmap-deeper-btn--hint');
    const movesLeft = Math.ceil((depth.maxPlies - currentPlies) / 2);
    const step = Math.min(depth.stepPlies / 2, movesLeft);
    deeperBtn.textContent = `Go ${step} move${step === 1 ? '' : 's'} deeper`;
  }
  if (depth) {
    deeperBtn = document.createElement('button');
    deeperBtn.type = 'button';
    deeperBtn.className = 'rmap-deeper-btn';
    deeperBtn.addEventListener('click', goDeeper);
    // A quiet floating pill, top-left of the tree area — out of the way of both
    // the move arrows and the preview panel.
    treeArea.appendChild(deeperBtn);
    updateDeeper();
  }

  // (The Board browser — formerly a "Line browser" pill here — now lives as its
  // own entry in the Explore tab's "Visualize your play" section, so it's no
  // longer launched from inside the map.)

  // Zoom floats bottom-left of the tree area (outside the bar).
  treeArea.appendChild(controls.zoom);

  host.appendChild(controls.container);

  disposePanZoom = initPanZoom(treeWrap, inner, state, recentre);

  // Open focused on the requested position when it's in the tree (selectNode
  // highlights, centres, and shows its preview); otherwise centre on the first.
  const target = opts.initialPath?.length ? findByUcis(opts.initialPath) : null;
  if (target) selectNode(target);
  else centreOnFirst();

  return { dispose: () => disposePanZoom?.() };
}
