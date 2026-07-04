// Per-board arrow brushes with collision-proof marker ids.
//
// Chessground draws each arrow's head as an SVG <marker> whose id is
// `arrowhead-<brush.key>`, and every arrow references that head by its
// document-global id (`marker-end: url(#arrowhead-<key>)`). When several boards
// register a brush under the SAME key (e.g. every board that uses 'accent'),
// their markers all end up with the SAME id. A <line> then resolves to whichever
// identical marker sits FIRST in the document — and if that first marker's board
// happens to live in a hidden (`display:none`) view, browsers paint the arrow's
// shaft but NOT its head. That's the intermittent "arrow shows as a line with no
// pointer" bug: it depends on which board registered first and whether its view
// is currently hidden.
//
// The app keeps many boards alive at once (the builder, the trainer, review
// boards, mini-boards), so key collisions are the rule, not the exception.
// Giving every board instance its own brush keys makes each arrow reference its
// own marker, so a hidden sibling board can never steal its head.
//
// Callers still address the brush by its plain NAME on a shape (`brush: 'accent'`)
// — only the brush's internal `.key` (and hence its marker id) is made unique.

import type { Api as CgApi } from 'chessground/api';
import type { DrawBrush } from 'chessground/draw';

let boardSeq = 0;

// Register a set of arrow brushes on `cg`, each keyed uniquely to this board
// instance. `defs` maps the brush NAME (what shapes reference) to its look.
export function registerBrushes(
  cg: CgApi,
  defs: Record<string, Omit<DrawBrush, 'key'>>,
): void {
  const uid = ++boardSeq;
  for (const name in defs) {
    cg.state.drawable.brushes[name] = { ...defs[name], key: `${name}-${uid}` };
  }
}
