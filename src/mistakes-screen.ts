// The Mistake retry pane on the Train screen — drills the exact positions from
// your own imported games where you went wrong. This file renders the pane;
// the game scan lives in mistake-scan.ts and the solving overlay in
// mistake-run.ts. (Pane body lands with the scan — this is the shell.)

import type { ImportedGame } from './import-core';
import { getAllGames } from './storage';
import { buildEmptyState } from './empty-state';
import { Icons } from './icons';

export interface MistakesScreenDeps {
  onImportGames: () => void;
  // Open a game in the full analyser (builder view) — the session's "Open full
  // analysis" route, wired from main.ts exactly like My games' onOpenGame.
  onOpenGame: (game: ImportedGame) => void;
}

export async function renderMistakesScreen(host: HTMLElement, deps: MistakesScreenDeps): Promise<void> {
  host.innerHTML = '';

  let games: ImportedGame[];
  try {
    games = await getAllGames();
  } catch {
    const err = document.createElement('p');
    err.className = 'mistakes-load-error';
    err.textContent = 'Could not load your games — pull to refresh or reopen the app.';
    host.appendChild(err);
    return;
  }

  // Everything here trains from your own games, so without an import there is
  // nothing to scan yet — point at the games screen.
  if (games.length === 0) {
    host.appendChild(buildEmptyState({
      icon: Icons.reset(28),
      line: 'Train the exact positions where your games went wrong.',
      body: 'Import your games first — the scan then finds your blunders and missed wins.',
      cta: { label: 'Import my games', onClick: deps.onImportGames },
    }));
    return;
  }
}
