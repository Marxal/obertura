// What may leave the device, and what may never.
//
// This suite exists because of one bug: `obertura.supabase.auth` — the
// signed-in session, access token and refresh token included — matched "starts
// with obertura" and was therefore uploaded to the account row, written into
// every backup file, and applied over the session of any device that pulled it.
// The visible symptom was signing in with Google and being signed out again
// seconds later; the real one was a refresh token in a database column.
//
// The point of the tests below is that the deny list is checked BY NAME. A rule
// this quiet is one refactor away from being lost, and nothing else in the app
// would notice.

import { backupLocalKey } from './local-keys';

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function runLocalKeysSelfTest(): TestResult[] {
  const out: TestResult[] = [];
  const check = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, pass, detail });
  };

  // ── The credential. The reason this file exists. ──────────────────────────
  check(
    'the Supabase session never leaves the device',
    !backupLocalKey('obertura.supabase.auth'),
    'obertura.supabase.auth was accepted into a backup — it holds the access '
      + 'and refresh tokens',
  );
  check(
    'nothing under obertura.supabase. leaves the device',
    !backupLocalKey('obertura.supabase.auth-code-verifier')
      && !backupLocalKey('obertura.supabase.anything'),
    'a key under the supabase prefix was accepted',
  );

  // ── The rest of the deny list, each for its own reason ────────────────────
  check(
    'the entitlement cache never travels',
    !backupLocalKey('obertura.entitled'),
    'a backup carrying obertura.entitled would grant full access on restore',
  );
  check(
    'the sync state never travels',
    !backupLocalKey('obertura.sync.account') && !backupLocalKey('obertura.sync.seenCore'),
    'sync state describes THIS device and would lie elsewhere',
  );
  check(
    'cached prices never travel',
    !backupLocalKey('obertura.pricing'),
    'prices are per-locale and cheap to re-fetch',
  );
  check(
    'the Lichess return crumb never travels',
    !backupLocalKey('obertura.lichessReturnTo'),
    'mid-redirect state for one device',
  );
  check(
    'retired Drive keys never travel',
    !backupLocalKey('obertura.drive.token'),
    'a retired feature’s leftovers',
  );

  // ── The three metrics keys (src/metrics.ts) ───────────────────────────────
  // Each is checked on its own line, by name, so that losing one is a named
  // failure rather than a number that quietly drifts. All three describe what
  // THIS install has already counted; carrying any of them makes a second
  // device inherit the first one's history and stop counting.
  check(
    'the install date never travels',
    !backupLocalKey('obertura.installedAt'),
    'a restored obertura.installedAt would trip every retention milestone on a '
      + 'brand-new device’s first launch',
  );
  check(
    'the spent-events list never travels',
    !backupLocalKey('obertura.metricsSeen'),
    'a device inheriting obertura.metricsSeen would never count its own '
      + 'once-ever events',
  );
  check(
    'the don’t-count-me switch never travels',
    !backupLocalKey('obertura.metricsOptOut'),
    'a backup carrying obertura.metricsOptOut would silently switch off '
      + 'counting on whatever device restored it',
  );

  // ── What SHOULD travel, so the deny list can't quietly swallow everything ──
  const carried = [
    'obertura.onboardingComplete',
    'obertura.builderTourDone',
    'obertura.puzzleRating',
    'obertura.boardColour',
    'obertura.pieceSet',
    'obertura-review-log',
    'obertura-training-days',
    'engineEnabled',
  ];
  for (const key of carried) {
    check(`${key} is carried`, backupLocalKey(key), 'a real preference or statistic was excluded');
  }

  // ── Anything the app doesn't own ──────────────────────────────────────────
  check(
    'foreign keys are never carried',
    !backupLocalKey('oauth2authcodepkce-state') && !backupLocalKey('theme'),
    'a key the app does not own was accepted',
  );

  return out;
}
