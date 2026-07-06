// Small shared DOM builders for the two Learn surfaces (the builder slide and
// Explore → Learn), so a video row, link pill, or "Show more" list looks the
// same in both. All external links open in a new tab with the app's usual
// noopener pattern — on the phone that hands off to the YouTube / Lichess app.

import { thumbUrl, watchUrl, youtubeSearchUrl, fetchPage, type VideoHit, type VideoPage } from './youtube';
import { Icons } from './icons';
import {
  isHidden, hideVideo, isFavourite, toggleFavourite, markSeen, removeSeen, type VideoLike,
} from './video-lib';

export function learnSection(title: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'learn-sec';
  el.textContent = title;
  return el;
}

export function learnNote(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'learn-note';
  el.textContent = text;
  return el;
}

/** A pill-shaped external link ("Search YouTube ↗"). */
export function extLink(label: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'learn-link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `${label} ↗`;
  return a;
}

/** A wrapping row of link pills. */
export function linksRow(links: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'learn-links';
  for (const l of links) row.appendChild(l);
  return row;
}

/** A plain pill button ("Show more"). */
export function moreButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'learn-more-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// Which shelf a row lives in, deciding what its buttons do:
//   'auto'    — an auto/curated list: ★ favourites, ⊘ hides ("not interested").
//   'fav'     — the Favourites shelf: ★ un-saves and drops the row.
//   'history' — the Watched archive: ⊘ marks not-interested (hide + forget).
// Everywhere, tapping the video itself records it as seen.
export type ShelfKind = 'auto' | 'fav' | 'history';

export interface VideoRowOptions {
  shelf?: ShelfKind;
  onRemove?: () => void; // after the row drops itself (so a shelf can update)
}

function iconBtn(icon: SVGElement, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'learn-video-act';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  icon.classList.add('learn-video-act-icon');
  btn.appendChild(icon);
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return btn;
}

/**
 * A tappable video card: thumbnail + title + channel, opening YouTube, with
 * favourite (★) and "not interested" (⊘) actions. Opening it records it as seen.
 */
export function videoRow(video: VideoLike, opts: VideoRowOptions = {}): HTMLElement {
  const shelf = opts.shelf ?? 'auto';
  const row = document.createElement('div');
  row.className = 'learn-video-row';

  const a = document.createElement('a');
  a.className = 'learn-video-link';
  a.href = watchUrl(video.id);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.addEventListener('click', () => markSeen(video));

  const img = document.createElement('img');
  img.className = 'learn-video-thumb';
  img.src = thumbUrl(video.id);
  img.alt = '';
  img.loading = 'lazy';
  a.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'learn-video-meta';
  const title = document.createElement('div');
  title.className = 'learn-video-title';
  title.textContent = video.title;
  meta.appendChild(title);
  if (video.channel) {
    const channel = document.createElement('div');
    channel.className = 'learn-video-channel';
    channel.textContent = video.channel;
    meta.appendChild(channel);
  }
  a.appendChild(meta);
  row.appendChild(a);

  const remove = (): void => { row.remove(); opts.onRemove?.(); };

  const actions = document.createElement('div');
  actions.className = 'learn-video-actions';

  const star = iconBtn(Icons.star(17), 'Save to favourites', () => {
    const nowFav = toggleFavourite(video);
    star.classList.toggle('is-fav', nowFav);
    star.setAttribute('aria-label', nowFav ? 'Remove from favourites' : 'Save to favourites');
    if (!nowFav && shelf === 'fav') remove();
  });
  if (isFavourite(video.id)) star.classList.add('is-fav');
  actions.appendChild(star);

  // No "not interested" on the Favourites shelf — the ★ already un-saves there.
  if (shelf !== 'fav') {
    const hide = iconBtn(Icons.eyeOff(17), 'Not interested', () => {
      hideVideo(video.id);
      if (shelf === 'history') removeSeen(video.id);
      remove();
    });
    actions.appendChild(hide);
  }

  row.appendChild(actions);
  return row;
}

// ── Paged "Show more" list ────────────────────────────────────────────────────

const PER_STEP = 3;          // how many more each "Show more" reveals
const MORE_YT_AFTER = 5;     // offer "More on YouTube" once this many are shown

/**
 * Render a growing list of videos into `container`: the first page's hits with a
 * "Show more" button that reveals more (fetching further pages as needed), a
 * "More on YouTube" link once a good few are shown, and hidden videos filtered
 * out throughout. `query` drives both the paging and the YouTube deep link.
 */
export function videoList(container: HTMLElement, query: string, first: VideoPage): void {
  let hits: VideoHit[] = first.hits.slice();
  let nextToken: string | null = first.nextPageToken;
  let shown = 0;
  let loading = false;

  const listEl = document.createElement('div');
  const controls = document.createElement('div');
  controls.className = 'learn-more';
  container.appendChild(listEl);
  container.appendChild(controls);

  const visible = (): VideoHit[] => hits.filter(h => !isHidden(h.id));

  function render(): void {
    const vis = visible();
    if (shown < 1) shown = Math.min(vis.length, PER_STEP);
    listEl.innerHTML = '';
    for (const h of vis.slice(0, shown)) listEl.appendChild(videoRow(h));

    controls.innerHTML = '';
    const canReveal = shown < vis.length;
    const canLoad = nextToken !== null;
    if (canReveal || canLoad) {
      const btn = moreButton(loading ? 'Loading…' : 'Show more', onShowMore);
      btn.disabled = loading;
      controls.appendChild(btn);
    }
    // Once a good few are shown, or there's nothing more to pull in-app, offer
    // the escape hatch to the full YouTube search.
    if (shown >= MORE_YT_AFTER || (!canReveal && !canLoad)) {
      controls.appendChild(linksRow([extLink('More on YouTube', youtubeSearchUrl(query))]));
    }
  }

  async function onShowMore(): Promise<void> {
    if (loading) return;
    if (shown < visible().length) {
      shown += PER_STEP;
      render();
      return;
    }
    if (nextToken === null) return;
    loading = true;
    render();
    const page = await fetchPage(query, nextToken);
    if (!container.isConnected) return;
    loading = false;
    if (page) { hits = hits.concat(page.hits); nextToken = page.nextPageToken; }
    else { nextToken = null; } // fetch failed — stop offering in-app more
    shown += PER_STEP;
    render();
  }

  render();
}
