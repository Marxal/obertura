// The counter's promise: it stores nothing to count, and a first time is worked out
// from the app's own data. Runs the real module against stand-ins for the browser.

import {
  isMetricsOptedOut, noteAppUsed, resetMetricsForTest, setMetricsOptedOut, setUsedBefore,
  track, trackAppOpen, trackOncePerLaunch,
} from './metrics';
import { returnsCrossed } from './streak';

interface TestResult { name: string; pass: boolean; detail: string }

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

export function runMetricsSelfTest(readFile: (path: string) => string): TestResult[] {
  const results: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    results.push({ name, pass, detail: pass ? '' : detail });
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { window: g.window, fetch: g.fetch, target: g.__DEPLOY_TARGET__ };
  let sent: string[] = [];
  let local = fakeStorage();
  let session = fakeStorage();
  const fresh = (): void => {
    sent = [];
    local = fakeStorage();
    session = fakeStorage();
    g.window = {
      get localStorage() { return local; },
      get sessionStorage() { return session; },
    };
    resetMetricsForTest();
  };
  g.__DEPLOY_TARGET__ = 'cloudflare';
  g.fetch = (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).name);
    return Promise.resolve();
  };

  try {
    fresh();
    trackAppOpen();
    trackAppOpen();
    track('line_saved');
    trackOncePerLaunch('pro_sheet_shown');
    trackOncePerLaunch('pro_sheet_shown');
    check('counts go straight out, no question first',
      sent.join() === 'app_open,line_saved,pro_sheet_shown', sent.join());
    check('nothing is stored locally to count', local.length === 0, `${local.length} keys`);
    check('nothing is stored for the session', session.length === 0, `${session.length} keys`);

    resetMetricsForTest();
    sent = [];
    trackOncePerLaunch('pro_sheet_shown');
    check('a new launch can count again', sent.join() === 'pro_sheet_shown', sent.join());

    for (const name of ['drill_completed', 'puzzle_session', 'daily_completed', 'endgame_solved'] as const) {
      fresh();
      setUsedBefore(false);
      track(name);
      check(`${name} is a first use on a device that had never trained`,
        sent.includes('first_interaction'), sent.join());
    }
    fresh();
    setUsedBefore(true);
    track('drill_completed');
    check('a device that trained before is not a first use', !sent.includes('first_interaction'), sent.join());
    fresh();
    track('drill_completed');
    check('without a reading of the device, no first use is claimed', !sent.includes('first_interaction'), sent.join());
    fresh();
    setUsedBefore(false);
    track('drill_completed');
    track('puzzle_session');
    noteAppUsed();
    check('first use counts once in a launch',
      sent.filter((s) => s === 'first_interaction').length === 1, sent.join());
    fresh();
    setUsedBefore(false);
    track('line_saved');
    track('starter_pack_added');
    check('saving a line or adding a pack alone is not a first use', !sent.includes('first_interaction'), sent.join());
    fresh();
    setUsedBefore(false);
    noteAppUsed();
    check('a mistake exercise is a first use', sent.join() === 'first_interaction', sent.join());

    fresh();
    setMetricsOptedOut(true);
    setUsedBefore(false);
    trackAppOpen();
    track('drill_completed');
    noteAppUsed();
    check('left out: nothing is counted', sent.length === 0 && isMetricsOptedOut(), sent.join());
    setMetricsOptedOut(false);
    check('the switch turns back off', !isMetricsOptedOut());

    const crossed = (days: string[], day: string): string => returnsCrossed(days, day).join();
    check('the first training day is not a return', crossed([], '2026-11-03') === '');
    check('the next day is not a return yet', crossed(['2026-11-03'], '2026-11-04') === '');
    check('two days on is', crossed(['2026-11-03'], '2026-11-05') === 'return_after_d2');
    check('and it counts only once', crossed(['2026-11-03', '2026-11-05'], '2026-11-06') === '');
    check('a week on crosses the next', crossed(['2026-11-03', '2026-11-05'], '2026-11-10') === 'return_after_d7');
    check('a long gap crosses all three',
      crossed(['2026-11-03'], '2026-12-20') === 'return_after_d2,return_after_d7,return_after_d30');
    check('across a clock change it still counts whole days', crossed(['2026-10-24'], '2026-10-26') === 'return_after_d2');

    // The app and the Worker keep the list by hand; a name missing from the
    // Worker is a dropped count that nobody sees.
    const app = readFile('src/metrics.ts');
    const union = app.slice(app.indexOf('export type MetricName'), app.indexOf("'purchase_confirmed';") + 21);
    const names = [...union.matchAll(/\| '([a-z0-9_]+)'/g)].map((m) => m[1]);
    const worker = readFile('worker/metrics.ts');
    const missing = names.filter((name) => !worker.includes(`'${name}'`));
    check('every app event is on the Worker list', names.length > 20 && missing.length === 0, missing.join());
    const landing = readFile('docs/index.html');
    for (const name of ['landing_visit', 'landing_try']) {
      check(`${name} is on the Worker list`, landing.includes(`'${name}'`) && worker.includes(`'${name}'`));
    }
  } finally {
    g.window = saved.window;
    g.fetch = saved.fetch;
    g.__DEPLOY_TARGET__ = saved.target;
    resetMetricsForTest();
  }
  return results;
}
