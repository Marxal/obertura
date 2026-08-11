// The builder walkthrough — three cards, shown once, before the first line
// opens.
//
// WHY IT EXISTS. The first-run picker hands a line straight to the builder, and
// the builder is a dense screen: a board, a move list, a five-tab carousel and a
// dock full of controls. Someone seeing it for the first time reads it as "a
// chess board with some stuff around it" and never finds the tabs — which are
// where the app's actual library lives. The coach strip inside the builder can't
// fix that on its own: it's one line at the bottom of a screen the user is
// already lost in, and it can only talk about the line, not the furniture.
//
// So the furniture gets named first, on an empty screen with nothing else to
// look at, and THEN the line opens. Three cards, a dot per card, Skip always
// available. It runs once ever (prefs' builderTourSeen) — including for someone
// who arrives via a starter pack long after their first run.
//
// It deliberately does NOT point at live elements in the builder (a coach-mark
// overlay with cut-outs): the builder isn't mounted yet at this point, the
// carousel's tabs move with the layout, and anchored callouts on a phone are a
// maintenance tax we don't need for three sentences.

import { Icons } from './icons';
import { isBuilderTourSeen, setBuilderTourSeen } from './prefs';
import { pushBack } from './back-nav';

interface TourStep {
  icon: SVGElement;
  title: string;
  body: string;
}

function steps(): TourStep[] {
  return [
    {
      icon: Icons.build(26),
      title: 'The board is the line',
      body: 'Play moves on the board and they become your line, move by move. '
        + 'Change your mind and just play a different move — the line follows you.',
    },
    {
      icon: Icons.list(26),
      title: 'Line · Library · My lines · Learn',
      body: 'The tabs under the board are the app. Line is the moves so far, '
        + 'Library shows what strong players actually play from this position, '
        + 'My lines is your own repertoire, and Learn holds notes and videos.',
    },
    {
      icon: Icons.save(26),
      title: 'Save when it looks right',
      body: 'Save turns what’s on the board into a line you own. Nothing is '
        + 'saved until you press it, so there’s nothing to break.',
    },
  ];
}

// Run the walkthrough, then call `onDone`. If it has already been seen (or
// skipping is the user's choice) `onDone` fires immediately — so callers can
// always wrap the thing that comes next in this, with no branching of their own.
export function runBuilderTour(onDone: () => void): void {
  if (isBuilderTourSeen()) { onDone(); return; }
  setBuilderTourSeen();
  openTour(onDone);
}

function openTour(onDone: () => void): void {
  const all = steps();
  let index = 0;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'How the builder works');

  let finished = false;
  // Every exit — Skip, the last card's button, the back gesture — lands here, so
  // the line always opens. A walkthrough that can strand the user on an empty
  // screen is worse than no walkthrough.
  function finish(): void {
    if (finished) return;
    finished = true;
    overlay.remove();
    removeBack();
    onDone();
  }
  const removeBack = pushBack(finish);

  const card = document.createElement('div');
  card.className = 'tour-card';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'tour-icon';
  card.appendChild(iconWrap);

  const title = document.createElement('h2');
  title.className = 'tour-title';
  card.appendChild(title);

  const body = document.createElement('p');
  body.className = 'tour-body';
  card.appendChild(body);

  const dots = document.createElement('div');
  dots.className = 'tour-dots';
  const dotEls = all.map(() => {
    const d = document.createElement('span');
    d.className = 'tour-dot';
    dots.appendChild(d);
    return d;
  });
  card.appendChild(dots);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn-primary tour-next';
  next.addEventListener('click', () => {
    if (index >= all.length - 1) { finish(); return; }
    index++;
    paint();
  });
  card.appendChild(next);

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'tour-skip';
  skip.textContent = 'Skip';
  skip.addEventListener('click', finish);
  card.appendChild(skip);

  function paint(): void {
    const step = all[index];
    iconWrap.replaceChildren(step.icon);
    title.textContent = step.title;
    body.textContent = step.body;
    dotEls.forEach((d, i) => d.classList.toggle('tour-dot--on', i === index));
    next.textContent = index >= all.length - 1 ? 'Show me my line' : 'Next';
    // Re-run the entry animation so each card arrives rather than swapping text
    // under a static frame.
    card.classList.remove('tour-card--in');
    void card.offsetWidth;
    card.classList.add('tour-card--in');
  }

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  paint();
}
