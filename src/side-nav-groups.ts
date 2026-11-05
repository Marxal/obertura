// The desktop sidebar's expanding sections: Train, Openings and Statistics.
//
// WHY THEY ARE IN THE SIDEBAR. On a phone these sections are a switch at the top
// of the screen, because the thumb is there and the tab bar has no room. On a
// desktop the sidebar is already the list of where you can go, so it holds them
// and the screen shows one section at a time, as a phone does.
//
// WHAT OPENS. The section of the screen you are on is open and the others are
// closed, every time you navigate. The chevron overrides that until the next
// navigation, and so does clicking the row of the screen you are already on.
// Nothing is stored: there is no setting to get wrong, and no key to sync.

import { Icons } from './icons';
import { t } from './i18n';

export interface SideSub {
  id: string;
  label: string;
  icon: () => SVGElement;
}

export interface SideGroupDef {
  view: string;
  label: string;
  subs: SideSub[];
  onPick: (id: string) => void;
}

export interface SideGroups {
  /** Wraps a destination's row, when that destination has sections. */
  mount: (view: string, row: HTMLButtonElement) => HTMLElement;
  /** The screen changed: its section opens and the others close. */
  sync: (view: string) => void;
  has: (view: string) => boolean;
  toggle: (view: string) => void;
  setSubs: (view: string, subs: SideSub[]) => void;
  setActive: (view: string, id: string | null) => void;
  /** The small figure at the end of a row: "10 new", a rating, a padlock. */
  setFigure: (view: string, id: string, figure: string | SVGElement | null) => void;
}

interface Live {
  def: SideGroupDef;
  group: HTMLElement;
  caret: HTMLButtonElement;
  list: HTMLElement;
  active: string | null;
  figures: Map<string, string | SVGElement | null>;
}

export function createSideGroups(defs: SideGroupDef[]): SideGroups {
  const live = new Map<string, Live>();

  const setOpen = (g: Live, open: boolean): void => {
    g.list.hidden = !open;
    g.group.classList.toggle('side-group--open', open);
    g.caret.setAttribute('aria-expanded', String(open));
    g.caret.setAttribute('aria-label', t(open ? 'last.hideSections' : 'last.showSections', { label: g.def.label }));
    g.caret.title = g.caret.getAttribute('aria-label')!;
  };

  const paintFigure = (g: Live, row: HTMLElement, id: string): void => {
    const slot = row.querySelector<HTMLElement>('.side-sub-figure')!;
    const figure = g.figures.get(id);
    slot.replaceChildren();
    if (figure) slot.append(figure instanceof SVGElement ? figure.cloneNode(true) : figure);
  };

  const paintSubs = (g: Live): void => {
    g.list.replaceChildren();
    for (const sub of g.def.subs) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'side-sub-item';
      row.dataset.sub = sub.id;
      if (sub.id === g.active) row.setAttribute('aria-current', 'true');
      const icon = document.createElement('span');
      icon.className = 'side-sub-icon';
      icon.appendChild(sub.icon());
      const name = document.createElement('span');
      name.className = 'side-sub-name';
      name.textContent = sub.label;
      const figure = document.createElement('span');
      figure.className = 'side-sub-figure';
      row.append(icon, name, figure);
      paintFigure(g, row, sub.id);
      row.addEventListener('click', () => g.def.onPick(sub.id));
      g.list.appendChild(row);
    }
  };

  for (const def of defs) {
    const group = document.createElement('div');
    group.className = 'side-group';

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'side-caret';
    caret.setAttribute('aria-controls', `side-sub-${def.view}`);
    caret.appendChild(Icons.chevronDown(16));

    const list = document.createElement('div');
    list.className = 'side-sub';
    list.id = `side-sub-${def.view}`;

    const g: Live = { def, group, caret, list, active: null, figures: new Map() };
    live.set(def.view, g);
    caret.addEventListener('click', () => setOpen(g, list.hidden));
    setOpen(g, false);
    paintSubs(g);
  }

  return {
    mount(view, row) {
      const g = live.get(view);
      if (!g) return row;
      const head = document.createElement('div');
      head.className = 'side-group-head';
      head.append(row, g.caret);
      g.group.append(head, g.list);
      return g.group;
    },
    sync(view) {
      for (const [v, g] of live) setOpen(g, v === view);
    },
    has: (view) => live.has(view),
    toggle(view) {
      const g = live.get(view);
      if (g) setOpen(g, g.list.hidden);
    },
    setSubs(view, subs) {
      const g = live.get(view);
      if (!g) return;
      g.def.subs = subs;
      paintSubs(g);
    },
    setActive(view, id) {
      const g = live.get(view);
      if (!g) return;
      g.active = id;
      g.list.querySelectorAll<HTMLElement>('.side-sub-item').forEach((row) => {
        if (row.dataset.sub === id) row.setAttribute('aria-current', 'true');
        else row.removeAttribute('aria-current');
      });
    },
    setFigure(view, id, figure) {
      const g = live.get(view);
      if (!g) return;
      g.figures.set(id, figure);
      const row = g.list.querySelector<HTMLElement>(`.side-sub-item[data-sub="${id}"]`);
      if (row) paintFigure(g, row, id);
    },
  };
}
