// The three controls every preference row is made of, on their own so more than
// one screen can use them.
//
// They lived in settings-screen.ts, which was fine while Settings was the only
// place a preference could be changed. The daily challenge broke that: its
// options are wanted from the card itself (a gear in the corner of the Daily
// challenge box), and a settings SCREEN that imports the daily card while the
// daily card imports the settings screen is a cycle waiting to bite. So the
// pieces both of them need moved down here, where neither owns the other.
//
// Nothing about the markup or the classes changed in the move — .pref-row,
// .seg-control and .switch are the same components with the same CSS.

// One preference, using the shared .pref-row component. Two layouts, chosen by
// the control:
//   • a SWITCH sits right-aligned on the title line, with the description below
//     spanning the full width (a compact, scannable on/off row).
//   • every other control (segmented pickers, swatches, buttons, fields) keeps
//     the stacked layout: title + optional description, then the control below.
// We tell them apart by the control's own class, so callers pass the same args.
export function row(label: string, control: HTMLElement, opts: { sub?: string } = {}): HTMLElement {
  const isSwitch = control.classList.contains('switch');

  const r = document.createElement('div');
  r.className = isSwitch ? 'pref-row pref-row--switch' : 'pref-row';

  const title = document.createElement('div');
  title.className = 'pref-row-title';
  title.textContent = label;

  const sub = opts.sub ? document.createElement('div') : null;
  if (sub) {
    sub.className = 'pref-row-desc';
    sub.textContent = opts.sub!;
  }

  const ctrl = document.createElement('div');
  ctrl.className = 'pref-row-control';
  ctrl.appendChild(control);

  if (isSwitch) {
    // Title and switch share the top line; the description (if any) spans below.
    const head = document.createElement('div');
    head.className = 'pref-row-head';
    head.appendChild(title);
    head.appendChild(ctrl);
    r.appendChild(head);
    if (sub) r.appendChild(sub);
    return r;
  }

  // Stacked: title + description in a text column, control on its own line below.
  const text = document.createElement('div');
  text.className = 'pref-row-text';
  text.appendChild(title);
  if (sub) text.appendChild(sub);
  r.appendChild(text);
  r.appendChild(ctrl);

  return r;
}

// ── Reusable controls ────────────────────────────────────────────────────────

export function segmented<T extends string>(
  options: { value: T; label: string; sublabel?: string }[],
  current: T,
  onChange: (v: T) => void,
  opts: { fullWidth?: boolean } = {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = opts.fullWidth ? 'seg-control seg-control--full' : 'seg-control';
  wrap.setAttribute('role', 'group');

  const buttons: HTMLButtonElement[] = [];
  const reflect = (active: T) => {
    for (const b of buttons) {
      const on = b.dataset.value === active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-btn';
    btn.dataset.value = opt.value;
    btn.textContent = opt.label;
    if (opt.sublabel) {
      const sub = document.createElement('span');
      sub.className = 'seg-btn-sublabel';
      sub.textContent = opt.sublabel;
      btn.appendChild(sub);
    }
    btn.addEventListener('click', () => {
      reflect(opt.value);
      onChange(opt.value);
    });
    buttons.push(btn);
    wrap.appendChild(btn);
  }
  reflect(current);
  return wrap;
}

export function toggle(current: boolean, onChange: (v: boolean) => void): HTMLElement {
  const label = document.createElement('label');
  label.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = current;
  input.addEventListener('change', () => onChange(input.checked));
  const track = document.createElement('span');
  track.className = 'switch-track';
  label.appendChild(input);
  label.appendChild(track);
  return label;
}
