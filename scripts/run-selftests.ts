// Headless runner for the app's pure-logic self-tests, so they can be checked in
// CI / a container as well as on the phone. Run via:
//   npm run selftest
// (which adds Node's TS type-stripping + a tiny extensionless-import resolver).
//
// Only DOM/IndexedDB-free suites are listed here; the storage self-test runs
// against a real IndexedDB, so it stays phone-only.

import { runImportSelfTest } from '../src/import.selftest';
import { runAnalysisSelfTest } from '../src/analysis.selftest';
import { runScoutSelfTest } from '../src/scout.selftest';

interface TestResult { name: string; pass: boolean; detail: string }

const SUITES: { suite: string; run: () => TestResult[] }[] = [
  { suite: 'import', run: runImportSelfTest },
  { suite: 'analysis', run: runAnalysisSelfTest },
  { suite: 'scout', run: runScoutSelfTest },
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
