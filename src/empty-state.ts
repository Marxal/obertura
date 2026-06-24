// One shared "nothing here yet" pattern, used by every screen's empty state.
//
// The shape is deliberately small: an optional icon, one short line, a primary
// CTA button that gets you started, and a quieter secondary text link for the
// alternative route. Both actions must actually navigate — an empty state that
// only explains is a dead end. Keep the copy concrete; the wording lives at the
// call sites, this file only lays it out.

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateOptions {
  // Optional decorative glyph above the line (pass an Icons.* element).
  icon?: SVGElement;
  // The single short line of copy.
  line: string;
  // An optional short paragraph under the line, for states that need a sentence
  // of explanation before the buttons.
  body?: string;
  // The primary button — the obvious first step.
  cta: EmptyStateAction;
  // Optional secondary buttons, rendered full-width beneath the primary CTA (for
  // states with more than one real route in).
  secondaryActions?: EmptyStateAction[];
  // The quieter alternative, rendered as a text link beneath the buttons.
  link?: EmptyStateAction;
}

export function buildEmptyState(opts: EmptyStateOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  if (opts.icon) {
    const iconWrap = document.createElement('div');
    iconWrap.className = 'empty-state-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.appendChild(opts.icon);
    wrap.appendChild(iconWrap);
  }

  const line = document.createElement('p');
  line.className = 'empty-state-line';
  line.textContent = opts.line;
  wrap.appendChild(line);

  if (opts.body) {
    const body = document.createElement('p');
    body.className = 'empty-state-body';
    body.textContent = opts.body;
    wrap.appendChild(body);
  }

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn-primary empty-state-cta';
  cta.textContent = opts.cta.label;
  cta.addEventListener('click', opts.cta.onClick);
  wrap.appendChild(cta);

  for (const action of opts.secondaryActions ?? []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary empty-state-cta empty-state-cta--secondary';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    wrap.appendChild(btn);
  }

  if (opts.link) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'empty-state-link';
    link.textContent = opts.link.label;
    link.addEventListener('click', opts.link.onClick);
    wrap.appendChild(link);
  }

  return wrap;
}
