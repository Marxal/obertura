// My Lines → tree view: the whole (filtered) repertoire drawn as ONE map,
// merged by position rather than by path, embedded in the Saved-lines list.
//
// It is the fourth stop on the same grouping toggle as flat / by family /
// compact, it reads the same filter bar, and it persists the same way — this
// module only decides which colour to draw and hands the rest to
// mountRepertoireMap. Read-only by design: tapping a node previews the position
// and offers the existing "Open in builder"; nothing here edits, moves or
// deletes a line.

import type { Line } from './types';
import type { ColourFilter } from './filters';
import { mainlineNodes } from './scheduler';
import {
  mountRepertoireMap, openRepertoireMap, type MapHandle, type NodeActionContext,
  type RepertoireMapOptions,
} from './repertoire-map';

// How deep the tree draws before "Go deeper" is offered, and how much each tap
// reveals. Four moves is what fits a phone at a readable size: a whole book
// drawn at once is a thousand pixels wide in a 380px window, so nine nodes in
// ten opened off screen and the view read as broken rather than big. Stepping
// two moves at a time keeps every reveal small enough to follow.
const TREE_START_PLIES = 8;
const TREE_STEP_PLIES = 4;

// Which colour the tree is showing while the filter says "All". Module-level so
// it survives the re-render a filter change causes.
let treeColour: 'white' | 'black' | null = null;

// The live map, so its window-level drag listeners can be detached when the list
// is rebuilt (a filter change, a tab switch, a refresh after a save).
let active: MapHandle | null = null;

export function disposeLinesTree(): void {
  active?.dispose();
  active = null;
}

/**
 * Draw the tree into `host` (which the caller has already cleared and which must
 * be in the DOM — the first centring measures it). `lines` are the lines the
 * filter bar has already selected; `colourSel` is that bar's colour choice.
 *
 * `nodeAction`, when given, replaces the preview's "Open in builder" with the
 * caller's own control on EVERY node — which is how the branch actions (pause,
 * name, tag, remove a whole part of the book) reach the tree without this module
 * or the map knowing anything about repertoires.
 */
export function renderLinesTree(
  host: HTMLElement,
  lines: Line[],
  colourSel: ColourFilter,
  onOpenLine: (line: Line) => void,
  nodeAction?: { label: string; onAct: (ctx: NodeActionContext) => void },
): void {
  disposeLinesTree();

  const counts = {
    white: lines.filter(l => l.colour === 'white').length,
    black: lines.filter(l => l.colour === 'black').length,
  };

  // The map draws one book at a time. When the filter has already picked a
  // colour, follow it; when it says "All", show the bigger book and offer a
  // White/Black toggle inside the map rather than a second colour control on
  // the page.
  const colour: 'white' | 'black' =
    colourSel !== 'all' ? colourSel
    : treeColour && counts[treeColour] > 0 ? treeColour
    : counts.black > counts.white ? 'black' : 'white';

  if (counts[colour] === 0) {
    const empty = document.createElement('p');
    empty.className = 'lines-empty';
    empty.textContent = 'No lines here yet.';
    host.appendChild(empty);
    return;
  }

  host.appendChild(buildLegend());

  const embed = document.createElement('div');
  embed.className = 'rmap-embed';
  host.appendChild(embed);

  const showBoth = colourSel === 'all' && counts.white > 0 && counts.black > 0;

  // The deepest line in the book decides how far "Go deeper" can go. The merge
  // truncates, so every depth is served from the same lines — nothing is rebuilt
  // and `atDepth` can simply hand them back.
  const maxPlies = lines.reduce(
    (deepest, l) => Math.max(deepest, mainlineNodes(l.tree).length), 0);

  // Shared by the card and the full-screen copy, so the two are the same map
  // rather than two maps that resemble each other.
  const shared: RepertoireMapOptions = {
    merge: 'position',
    depth: {
      startPlies: TREE_START_PLIES,
      stepPlies: TREE_STEP_PLIES,
      maxPlies,
      atDepth: () => lines,
    },
    ...(nodeAction ? { nodeAction } : {}),
  };

  active = mountRepertoireMap(embed, lines, colour, onOpenLine, {
    ...shared,
    // The card is a preview you can scroll past; the real work happens here.
    // The path keeps your place across the hand-off.
    onFullScreen: (path) => openRepertoireMap(lines, colour, onOpenLine, {
      ...shared,
      ...(path.length ? { initialPath: path } : {}),
    }),
    ...(showBoth ? {
      colourToggle: {
        current: colour,
        enabled: { white: counts.white > 0, black: counts.black > 0 },
        onPick: (c) => {
          treeColour = c;
          host.innerHTML = '';
          renderLinesTree(host, lines, colourSel, onOpenLine, nodeAction);
        },
      },
    } : {}),
  }, () => disposeLinesTree());
}

// One quiet line under the toggle explaining the mark the position merge adds.
// Without it a numbered dot is just decoration.
//
// The dashed-edge entry ("another move order to the same position") is gone. It
// explained a line most people never see, in a sentence that reads as jargon on
// a phone, and it cost a whole row above a view that is already short of
// vertical room. The edges still draw; the tap-preview still says "Also reached
// by another move order" on a node where it matters, which is where the
// explanation belongs — on the thing, when you ask about it.
function buildLegend(): HTMLElement {
  const el = document.createElement('p');
  el.className = 'rmap-embed-legend';

  const answers = document.createElement('span');
  answers.className = 'rmap-legend-item';
  answers.innerHTML = '<span class="rmap-legend-dot" aria-hidden="true">2</span>';
  answers.appendChild(document.createTextNode('more than one answer saved here'));

  el.appendChild(answers);
  return el;
}
