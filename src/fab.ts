// The floating action button (FAB) shown on the four main tabs (Train, My Lines,
// Explore, Statistics). Tap to expand a speed-dial of quick "create / import"
// actions stacked above it; tap the X, the backdrop, an action, or the system
// back gesture to close. The router (main.ts) hides it on the full-screen views
// (builder, settings) via setVisible().
//
// The action list is rebuilt every time the menu opens (buildActions), so items
// that depend on state — "Import last game" only with a connected account,
// "Browse my games" vs "Import my games" depending on whether games exist —
// reflect the live situation each time.

import { Icons } from './icons';
import { pushBack } from './back-nav';

// A plain row: a label (+ optional sublabel) and an icon; tapping runs onClick.
export interface FabAction {
  kind?: 'action';
  icon: SVGElement;
  // When set, the icon sits inside a coloured circle — used by the New line rows
  // to show a white / black pawn token.
  iconFrame?: 'white' | 'black';
  label: string;
  sublabel?: string;
  onClick: () => void;
}

// The "New line" row: one label with a split White | Black control, so the
// colour IS the action and it costs a single slot.
export interface FabSplit {
  kind: 'split';
  label: string;
  left: { label: string; onClick: () => void };
  right: { label: string; onClick: () => void };
}

export type FabItem = FabAction | FabSplit;

export interface FabController {
  setVisible(visible: boolean): void;
}

export function mountFab(buildActions: () => FabItem[] | Promise<FabItem[]>): FabController {
  const root = document.createElement('div');
  root.className = 'fab-root';
  root.hidden = true;

  // Full-viewport catch for outside taps (only present/clickable when open).
  const backdrop = document.createElement('div');
  backdrop.className = 'fab-backdrop';

  const menu = document.createElement('div');
  menu.className = 'fab-menu';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fab-btn';
  button.setAttribute('aria-label', 'Quick actions');
  button.setAttribute('aria-expanded', 'false');
  button.appendChild(Icons.plus(28));

  root.append(backdrop, menu, button);
  document.body.appendChild(root);

  let open = false;
  let removeBack: (() => void) | null = null;

  function actionRow(item: FabAction): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'fab-item';
    row.append(textBlock(item.label, item.sublabel));
    const ic = document.createElement('span');
    ic.className = 'fab-item-icon' + (item.iconFrame ? ` fab-item-icon--token fab-item-icon--token-${item.iconFrame}` : '');
    ic.appendChild(item.icon);
    row.appendChild(ic);
    row.addEventListener('click', () => { close(); item.onClick(); });
    return row;
  }

  function splitRow(item: FabSplit): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fab-item fab-item--split';
    row.appendChild(textBlock(item.label));
    const split = document.createElement('span');
    split.className = 'fab-split';
    split.append(
      splitBtn(item.left, 'fab-split-white'),
      splitBtn(item.right, 'fab-split-black'),
    );
    row.appendChild(split);
    return row;
  }

  function splitBtn(side: { label: string; onClick: () => void }, cls: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fab-split-btn ' + cls;
    b.textContent = side.label;
    b.addEventListener('click', () => { close(); side.onClick(); });
    return b;
  }

  function textBlock(label: string, sublabel?: string): HTMLElement {
    const text = document.createElement('span');
    text.className = 'fab-item-text';
    const main = document.createElement('span');
    main.className = 'fab-item-label';
    main.textContent = label;
    text.appendChild(main);
    if (sublabel) {
      const sub = document.createElement('span');
      sub.className = 'fab-item-sub';
      sub.textContent = sublabel;
      text.appendChild(sub);
    }
    return text;
  }

  async function openMenu(): Promise<void> {
    if (open) return;
    open = true;
    root.classList.add('fab-root--open');
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Close quick actions');
    const items = await buildActions();
    menu.innerHTML = '';
    for (const item of items) {
      menu.appendChild(item.kind === 'split' ? splitRow(item) : actionRow(item));
    }
    removeBack = pushBack(close);
  }

  function close(): void {
    if (!open) return;
    open = false;
    root.classList.remove('fab-root--open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Quick actions');
    removeBack?.();
    removeBack = null;
  }

  button.addEventListener('click', () => { if (open) close(); else void openMenu(); });
  backdrop.addEventListener('click', close);

  return {
    setVisible(visible: boolean): void {
      if (!visible) close();
      root.hidden = !visible;
    },
  };
}
