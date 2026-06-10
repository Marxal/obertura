// The Explore tab — a placeholder for v1.2's scouting tools.
//
// Opponent scouting, the opening library and engine sparring all land later in
// this round; for now this is a clean signpost so the tab exists in the bar
// without pretending to do anything yet. (Distinct from explore.ts, which is the
// in-board position explorer overlay.)

export function renderExploreScreen(container: HTMLElement): void {
  container.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'section';

  const head = document.createElement('div');
  head.className = 'section-head';
  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Explore';
  head.appendChild(heading);
  section.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'section-desc';
  desc.textContent =
    'Opponent scouting, the opening library and engine sparring arrive later in v1.2.';
  section.appendChild(desc);

  container.appendChild(section);
}
