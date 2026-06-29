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

// The line-list flavour (My Lines / Train / Scout): families come from each
// line's opening name.
export function renderFamilyGroups(
  host: HTMLElement,
  lines: Line[],
  card: (line: Line) => HTMLElement,
  expanded: Set<string>,
): void {
  renderGroups(host, lines, l => openingFamily(l.openingName), card, expanded);
}

// The generic flavour: group ANY item list into collapsible families. Families
// appear in first-appearance order (so the caller's sort is preserved) and each
// family's cards are built lazily the first time it opens.
export function renderGroups<T>(
  host: HTMLElement,
  items: T[],
  familyOf: (item: T) => string,
  card: (item: T) => HTMLElement,
  expanded: Set<string>,
): void {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const fam = familyOf(item);
    let bucket = groups.get(fam);
    if (!bucket) { bucket = []; groups.set(fam, bucket); }
    bucket.push(item);
  }
  for (const [family, fitems] of groups) {
    host.appendChild(buildFamilyGroup(family, fitems, card, expanded));
  }
}

function buildFamilyGroup<T>(
  family: string,
  flines: T[],
  card: (line: T) => HTMLElement,
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
