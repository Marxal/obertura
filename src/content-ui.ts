// Small shared DOM builders for the two Learn surfaces (the builder slide and
// Explore → Learn), so a video row or link pill looks the same in both. All
// external links open in a new tab with the app's usual noopener pattern —
// on the phone that hands off to the YouTube / Lichess app.

import { thumbUrl, watchUrl } from './youtube';

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

/** A tappable video card: thumbnail + title + channel, opening YouTube. */
export function videoRow(video: { id: string; title: string; channel?: string }): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'learn-video-row';
  a.href = watchUrl(video.id);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

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
  return a;
}
