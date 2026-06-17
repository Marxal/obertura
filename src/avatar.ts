// A small round user avatar shared across the app's "identity" surfaces
// (Settings connected card, the lines-screen source chip, …). Shows the given
// picture when there is one, otherwise a generic user icon; a broken/blocked
// image quietly falls back to the icon. Reuses the .scout-avatar styling so
// avatars read the same everywhere.

import { Icons } from './icons';

export function userAvatar(url: string | undefined, size: number): HTMLElement {
  if (url) {
    const img = document.createElement('img');
    img.className = 'scout-avatar';
    img.src = url;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(userAvatarIcon(size)));
    return img;
  }
  return userAvatarIcon(size);
}

function userAvatarIcon(size: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'scout-avatar scout-avatar--icon';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.appendChild(Icons.userCircle(Math.round(size * 0.7)));
  return wrap;
}
