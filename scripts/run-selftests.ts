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
import { runMoveStatsSelfTest } from '../src/move-stats.selftest';
import { runProgressSelfTest } from '../src/progress.selftest';
import { runTreeSelfTest } from '../src/tree.selftest';
import { runExplorerApiSelfTest } from '../src/explorer-api.selftest';
import { runEngineSelfTest } from '../src/engine.selftest';

interface TestResult { name: string; pass: boolean; detail: string }

const SUITES: { suite: string; run: () => TestResult[] }[] = [
  { suite: 'openings', run: runOpeningsSelfTest },
  { suite: 'import', run: runImportSelfTest },
  { suite: 'scheduler', run: runSchedulerSelfTest },
  { suite: 'analysis', run: runAnalysisSelfTest },
  { suite: 'spar', run: runSparSelfTest },
  { suite: 'scout', run: runScoutSelfTest },
  { suite: 'move-stats', run: runMoveStatsSelfTest },
  { suite: 'progress', run: runProgressSelfTest },
  { suite: 'tree', run: runTreeSelfTest },
  { suite: 'explorer-api', run: runExplorerApiSelfTest },
  { suite: 'engine', run: runEngineSelfTest },
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
