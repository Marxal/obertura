// Shared "group a list of lines into collapsible opening families" renderer.
// Used by My Lines (Saved), the Train in-training list, and Scout prep — anywhere
// a flat list of lines can also be read grouped by opening (Italian Game (3) ▸).
//
// Families appear in the order their first line does, so the caller's existing
// sort is preserved. `expanded` is a caller-owned Set so open/closed state
// survives re-renders. Each family's cards are built lazily the first time it
// opens (like the opening-library tree), so collapsed miniatures never render at
// the wrong size and long lists stay cheap.

import type { Line } from './types';
import { openingFamily } from './analysis';
import { Icons } from './icons';

export function renderFamilyGroups(
  host: HTMLElement,
  lines: Line[],
  card: (line: Line) => HTMLElement,
  expanded: Set<string>,
): void {
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const fam = openingFamily(line.openingName);
    let bucket = groups.get(fam);
    if (!bucket) { bucket = []; groups.set(fam, bucket); }
    bucket.push(line);
  }
  for (const [family, flines] of groups) {
    host.appendChild(buildFamilyGroup(family, flines, card, expanded));
  }
}

function buildFamilyGroup(
  family: string,
  flines: Line[],
  card: (line: Line) => HTMLElement,
  expanded: Set<string>,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'lines-fam';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'lines-fam-head';

  const chev = document.createElement('span');
  chev.className = 'lines-fam-chev';
  chev.setAttribute('aria-hidden', 'true');
  chev.appendChild(Icons.chevronRight(18));
  head.appendChild(chev);

  const name = document.createElement('span');
  name.className = 'lines-fam-name';
  name.textContent = family;
  head.appendChild(name);

  const count = document.createElement('span');
  count.className = 'lines-fam-count';
  count.textContent = String(flines.length);
  head.appendChild(count);

  const body = document.createElement('div');
  body.className = 'lines-fam-body';
  body.hidden = true;

  // Fill the cards the first time this family opens.
  const fill = (): void => {
    if (body.childElementCount) return;
    for (const line of flines) body.appendChild(card(line));
  };

  const setOpen = (open: boolean): void => {
    head.classList.toggle('lines-fam-head--open', open);
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) fill();
  };
  setOpen(expanded.has(family));

  head.addEventListener('click', () => {
    const open = !expanded.has(family);
    if (open) expanded.add(family); else expanded.delete(family);
    setOpen(open);
  });

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}
