// "Import my last game" — the FAB shortcut that fetches the single most recent
// game from the connected Lichess / Chess.com account, files it with the rest of
// my imported games (idempotently — the store is keyed by id, so a game a bulk
// import or the weekly auto-refresh already holds is overwritten, never doubled),
// and hands it back so the caller can open it on the board to save as a line.
//
// "Connected" here just means a username is on the device (saved by any earlier
// import). There's no OAuth — the public games APIs need no token.

import { importGames, type ImportedGame, type Platform } from './import-games';
import { getUsername as getChesscomUser } from './chesscom';
import { getUsername as getLichessUser } from './lichess';
import { getGamesSource } from './import-panel';
import { saveGames } from './storage';

export interface ConnectedAccount {
  platform: Platform;
  username: string;
}

// The account the last game comes from: the source the stored games came from if
// there is one, otherwise whichever platform has a saved username (Chess.com
// first). null when nothing is connected.
export function connectedAccount(): ConnectedAccount | null {
  const source = getGamesSource();
  if (source?.username) return { platform: source.platform, username: source.username };
  const cc = getChesscomUser();
  if (cc) return { platform: 'chesscom', username: cc };
  const li = getLichessUser();
  if (li) return { platform: 'lichess', username: li };
  return null;
}

export function hasConnectedAccount(): boolean {
  return connectedAccount() !== null;
}

// Fetch the newest game, persist it (deduped), and return it. Returns null when
// no account is connected or no recent game could be found. Throws on network
// failure so the caller can tell "offline" from "nothing to import".
export async function importLastGame(): Promise<ImportedGame | null> {
  const account = connectedAccount();
  if (!account) return null;

  // A wide window so an inactive month doesn't come back empty; maxGames stops
  // the fetch at the first (newest) game, so the window costs nothing extra.
  const result = await importGames(account.platform, account.username, { months: 12, maxGames: 1 });
  const game = result.games[0];
  if (!game) return null;

  await saveGames([game]);
  return game;
}
