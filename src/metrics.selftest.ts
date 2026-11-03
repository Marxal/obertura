// The counter's promise: nothing stored and nothing sent before a yes. Runs the
// real module against stand-ins for the browser's storage and network.

import {
  countChoice, isMetricsOptedOut, resetMetricsForTest, sendStateless, setCountChoice,
  setMetricsOptedOut, track, trackAppOpen, trackOnce,
} from './metrics';

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
    check('a new device has no answer yet', countChoice() === null);
    trackAppOpen();
    track('games_imported');
    trackOnce('onboarding_complete');
    check('before an answer nothing is sent', sent.length === 0, sent.join());
    check('before an answer nothing is stored locally', local.length === 0, `${local.length} keys`);
    check('before an answer nothing is stored for the session', session.length === 0, `${session.length} keys`);

    sendStateless('counts_asked');
    check('the question itself is one bare word', sent.join() === 'counts_asked', sent.join());
    check('and stores nothing', local.length === 0);

    fresh();
    trackAppOpen();
    track('games_imported');
    setCountChoice(true);
    check('a yes counts what was waiting, the launch first',
      sent.join() === 'install,app_open,games_imported,first_games_imported', sent.join());
    check('a yes is remembered', countChoice() === 'yes');
    const count = sent.length;
    track('games_imported');
    check('a first-time event counts once, the plain one each time',
      sent.slice(count).join() === 'games_imported', sent.slice(count).join());

    for (const name of ['drill_completed', 'puzzle_session', 'daily_completed', 'endgame_solved', 'line_saved'] as const) {
      fresh();
      setCountChoice(true);
      track(name);
      check(`${name} counts as using the app`, sent.includes('first_interaction'), sent.join());
    }
    fresh();
    setCountChoice(true);
    track('starter_pack_added');
    check('adding a starter pack alone is not using the app', !sent.includes('first_interaction'), sent.join());
    track('drill_completed');
    track('puzzle_session');
    check('using the app counts once per device',
      sent.filter((s) => s === 'first_interaction').length === 1, sent.join());

    fresh();
    trackAppOpen();
    track('line_saved');
    setCountChoice(false);
    check('a no sends nothing that was waiting', sent.length === 0, sent.join());
    check('a no is remembered', countChoice() === 'no' && isMetricsOptedOut());
    track('line_saved');
    trackOnce('install');
    trackAppOpen();
    check('after a no nothing is counted', sent.length === 0, sent.join());
    const leftover = [...Array(local.length).keys()].map((i) => local.key(i));
    check('after a no only the answer is stored', leftover.join() === 'obertura.metricsOptOut', leftover.join());

    fresh();
    local.setItem('obertura.installedAt', '1000');
    local.setItem('obertura.metricsSeen', 'install');
    session.setItem('obertura.metricsSession', '1');
    setCountChoice(false);
    check('a no removes notes kept before the question existed',
      local.getItem('obertura.installedAt') === null && local.getItem('obertura.metricsSeen') === null
        && session.getItem('obertura.metricsSession') === null);

    fresh();
    setMetricsOptedOut(true);
    check('the Settings switch is the same answer', countChoice() === 'no');
    setMetricsOptedOut(false);
    check('turning it back off is a yes', countChoice() === 'yes');

    fresh();
    local.setItem('obertura.metricsOptOut', '1');
    check('someone already opted out is not asked again', countChoice() === 'no');

    fresh();
    for (let i = 0; i < 500; i++) track('line_saved');
    setCountChoice(true);
    check('what waits for an answer has a ceiling', sent.length <= 110, `${sent.length}`);

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
