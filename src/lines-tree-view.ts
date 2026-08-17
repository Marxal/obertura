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
import { mountRepertoireMap, type MapHandle, type NodeActionContext } from './repertoire-map';

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

  active = mountRepertoireMap(embed, lines, colour, onOpenLine, {
    merge: 'position',
    ...(nodeAction ? { nodeAction } : {}),
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

// One quiet line under the toggle explaining the two marks the position merge
// adds. Without it a dashed edge and a numbered dot are just decoration.
function buildLegend(): HTMLElement {
  const el = document.createElement('p');
  el.className = 'rmap-embed-legend';

  const dashed = document.createElement('span');
  dashed.className = 'rmap-legend-item';
  dashed.innerHTML = '<span class="rmap-legend-dash" aria-hidden="true"></span>';
  dashed.appendChild(document.createTextNode('another move order to the same position'));

  const answers = document.createElement('span');
  answers.className = 'rmap-legend-item';
  answers.innerHTML = '<span class="rmap-legend-dot" aria-hidden="true">2</span>';
  answers.appendChild(document.createTextNode('more than one answer saved here'));

  el.appendChild(dashed);
  el.appendChild(answers);
  return el;
}
