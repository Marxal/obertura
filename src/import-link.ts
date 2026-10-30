// "Analyse my games" from the landing page: /app/?import=chesscom&user=NAME.
//
// The landing page's analysis section (docs/index.html, "Analyse your games")
// asks for the platform and the username itself, then opens the app on this
// link, so a visitor lands straight in the import instead of being asked the
// same two questions again on "Where do you play?" (onboarding-where.ts).
//
// Read ONCE at boot and then removed from the address bar, so a reload or a
// home-screen shortcut saved from this page never starts a second import.
// Anything that doesn't look like a real username is ignored rather than
// sent to Chess.com or Lichess.

import type { Platform } from './import-core';

export interface ImportLink { platform: Platform; username: string; }

// Both sites allow letters, digits, underscores and hyphens; Chess.com 3–25
// characters, Lichess 2–20. One loose pattern covers both — the import itself
// reports a username that doesn't exist.
const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

export function takeImportLink(): ImportLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
  const platform = params.get('import');
  const username = (params.get('user') ?? '').trim();
  if (platform !== 'chesscom' && platform !== 'lichess') return null;

  params.delete('import');
  params.delete('user');
  try {
    const rest = params.toString();
    history.replaceState(history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  } catch {
    // An address bar we can't rewrite only means a reload asks again.
  }
  return USERNAME.test(username) ? { platform, username } : null;
}
