// Headless runner for the app's pure-logic self-tests, so they can be checked in
// CI / a container as well as on the phone. Run via:
//   npm run selftest
// (which adds Node's TS type-stripping + a tiny extensionless-import resolver).
//
// Only DOM/IndexedDB-free suites are listed here; the storage self-test runs
// against a real IndexedDB, so it stays phone-only.

import { runOpeningsSelfTest } from '../src/openings.selftest';
import { runImportSelfTest } from '../src/import.selftest';
import { runSchedulerSelfTest } from '../src/scheduler.selftest';
import { runAnalysisSelfTest } from '../src/analysis.selftest';
import { runSparSelfTest } from '../src/spar.selftest';
import { runScoutSelfTest } from '../src/scout.selftest';
import { runTrapsSelfTest } from '../src/traps.selftest';
import { runMoveStatsSelfTest } from '../src/move-stats.selftest';
import { runProgressSelfTest } from '../src/progress.selftest';
import { runStatsSelfTest } from '../src/stats.selftest';
import { runStruggleSelfTest } from '../src/struggle.selftest';
import { runTreeSelfTest } from '../src/tree.selftest';
import { runEngineSelfTest } from '../src/engine.selftest';
import { runPuzzlesSelfTest } from '../src/puzzles.selftest';
import { runPuzzleRatingSelfTest } from '../src/puzzle-rating.selftest';
import { runPuzzleAltSelfTest } from '../src/puzzle-alt.selftest';
import { runWinprobSelfTest } from '../src/winprob.selftest';
import { runReviewSelfTest } from '../src/review.selftest';
import { runMoveFactsSelfTest } from '../src/move-facts.selftest';
import { runAccuracySelfTest } from '../src/accuracy.selftest';
import { runMistakeScanSelfTest } from '../src/mistake-scan.selftest';
import { runDailyRecapSelfTest } from '../src/daily-recap.selftest';
import { runBrilliantSelfTest } from '../src/brilliant.selftest';
import { runEndgameCatalogSelfTest } from '../src/endgame-catalog.selftest';
import { runEndgameProgressSelfTest } from '../src/endgame-progress.selftest';
import { runEndgameScanSelfTest } from '../src/endgame-scan.selftest';
import { runStudyImportSelfTest } from '../src/study-import.selftest';
import { runStudyCatalogSelfTest } from '../src/study-catalog.selftest';
import { runRepertoireSyncSelfTest } from '../src/repertoire-sync.selftest';
import { runOnboardingLinesSelfTest } from '../src/onboarding-lines.selftest';
import { runImportTierSelfTest } from '../src/import-tier.selftest';
import { runExplorerBandSelfTest } from '../src/explorer-band.selftest';
import { runPositionIndexSelfTest } from '../src/position-index.selftest';
import { runSaveIndexSelfTest } from '../src/save-index.selftest';
import { runTrainIndexSelfTest } from '../src/train-index.selftest';
import { runMapMergeSelfTest } from '../src/map-merge.selftest';

interface TestResult { name: string; pass: boolean; detail: string }

const SUITES: { suite: string; run: () => TestResult[] }[] = [
  { suite: 'openings', run: runOpeningsSelfTest },
  { suite: 'import', run: runImportSelfTest },
  { suite: 'import-tier', run: runImportTierSelfTest },
  { suite: 'scheduler', run: runSchedulerSelfTest },
  { suite: 'analysis', run: runAnalysisSelfTest },
  { suite: 'spar', run: runSparSelfTest },
  { suite: 'scout', run: runScoutSelfTest },
  { suite: 'traps', run: runTrapsSelfTest },
  { suite: 'move-stats', run: runMoveStatsSelfTest },
  { suite: 'explorer-band', run: runExplorerBandSelfTest },
  { suite: 'progress', run: runProgressSelfTest },
  { suite: 'stats', run: runStatsSelfTest },
  { suite: 'struggle', run: runStruggleSelfTest },
  { suite: 'tree', run: runTreeSelfTest },
  { suite: 'position-index', run: runPositionIndexSelfTest },
  { suite: 'save-index', run: runSaveIndexSelfTest },
  { suite: 'train-index', run: runTrainIndexSelfTest },
  { suite: 'map-merge', run: runMapMergeSelfTest },
  { suite: 'engine', run: runEngineSelfTest },
  { suite: 'puzzles', run: runPuzzlesSelfTest },
  { suite: 'puzzle-rating', run: runPuzzleRatingSelfTest },
  { suite: 'puzzle-alt', run: runPuzzleAltSelfTest },
  { suite: 'winprob', run: runWinprobSelfTest },
  { suite: 'review', run: runReviewSelfTest },
  { suite: 'move-facts', run: runMoveFactsSelfTest },
  { suite: 'accuracy', run: runAccuracySelfTest },
  { suite: 'mistake-scan', run: runMistakeScanSelfTest },
  { suite: 'daily-recap', run: runDailyRecapSelfTest },
  { suite: 'brilliant', run: runBrilliantSelfTest },
  { suite: 'endgame-catalog', run: runEndgameCatalogSelfTest },
  { suite: 'endgame-progress', run: runEndgameProgressSelfTest },
  { suite: 'endgame-scan', run: runEndgameScanSelfTest },
  { suite: 'study-import', run: runStudyImportSelfTest },
  { suite: 'study-catalog', run: runStudyCatalogSelfTest },
  { suite: 'account-sync', run: runRepertoireSyncSelfTest },
  { suite: 'onboarding-lines', run: runOnboardingLinesSelfTest },
];

let total = 0;
let failed = 0;

for (const { suite, run } of SUITES) {
  console.log(`\n# ${suite}`);
  const results = run();
  for (const r of results) {
    total++;
    if (!r.pass) failed++;
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${r.name}${r.pass ? '' : `  — ${r.detail}`}`);
  }
}

console.log(`\n${total - failed}/${total} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
