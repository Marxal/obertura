// The unified import entry point. Pick a platform; get the same ImportResult.
// "My games" and (next) opponent scouting both call this — the only difference
// between them is the username and which lines you compare against afterwards.
//
// This is the seam the next task's UI plugs into: a platform toggle, a 1/3/12
// range chooser, then a tally + time-control filter on top of `result.games`.

import { runImport, type Platform, type ImportOptions, type ImportResult, type SourceFetch } from './import-core';
import { fetchChesscom } from './chesscom';
import { fetchLichess } from './lichess';

const SOURCES: Record<Platform, SourceFetch> = {
  chesscom: fetchChesscom,
  lichess: fetchLichess,
};

export function importGames(
  platform: Platform,
  username: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  return runImport(platform, SOURCES[platform], username, opts);
}

// Re-export the shared pieces a UI needs in one import.
export {
  RANGES,
  DEFAULT_RANGE,
  MAX_GAMES,
  TIME_CLASS_LABELS,
  DEFAULT_TIME_CLASSES,
  tallyTimeClasses,
  filterByTimeClasses,
  summariseGames,
  type Platform,
  type Range,
  type TimeClass,
  type ImportResult,
  type ImportedGame,
  type TimeTally,
} from './import-core';
