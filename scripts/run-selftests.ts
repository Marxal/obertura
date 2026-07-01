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
import { runTreeSelfTest } from '../src/tree.selftest';
import { runEngineSelfTest } from '../src/engine.selftest';
import { runPuzzlesSelfTest } from '../src/puzzles.selftest';
import { runPuzzleRatingSelfTest } from '../src/puzzle-rating.selftest';
import { runWinprobSelfTest } from '../src/winprob.selftest';
import { runReviewSelfTest } from '../src/review.selftest';
import { runMoveFactsSelfTest } from '../src/move-facts.selftest';
import { runAccuracySelfTest } from '../src/accuracy.selftest';

interface TestResult { name: string; pass: boolean; detail: string }

const SUITES: { suite: string; run: () => TestResult[] }[] = [
  { suite: 'openings', run: runOpeningsSelfTest },
  { suite: 'import', run: runImportSelfTest },
  { suite: 'scheduler', run: runSchedulerSelfTest },
  { suite: 'analysis', run: runAnalysisSelfTest },
  { suite: 'spar', run: runSparSelfTest },
  { suite: 'scout', run: runScoutSelfTest },
  { suite: 'traps', run: runTrapsSelfTest },
  { suite: 'move-stats', run: runMoveStatsSelfTest },
  { suite: 'progress', run: runProgressSelfTest },
  { suite: 'stats', run: runStatsSelfTest },
  { suite: 'tree', run: runTreeSelfTest },
  { suite: 'engine', run: runEngineSelfTest },
  { suite: 'puzzles', run: runPuzzlesSelfTest },
  { suite: 'puzzle-rating', run: runPuzzleRatingSelfTest },
  { suite: 'winprob', run: runWinprobSelfTest },
  { suite: 'review', run: runReviewSelfTest },
  { suite: 'move-facts', run: runMoveFactsSelfTest },
  { suite: 'accuracy', run: runAccuracySelfTest },
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
