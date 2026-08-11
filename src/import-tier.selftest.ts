// Self-test for the import count-slice rules (import-tier.ts).
//
// The property that actually matters: a signed-out visitor can never end up
// with a selectable choice above FREE_GUEST_IMPORT — not through the default,
// and not through a chip. Everything else here guards the ladder a signed-in
// user sees, which was the pre-existing behaviour and mustn't drift.

import {
  countOptionsFor,
  defaultCountFor,
  FREE_GUEST_IMPORT,
  type CountOption,
} from './import-tier';

interface TestResult { name: string; pass: boolean; detail: string }

function check(results: TestResult[], name: string, pass: boolean, detail = ''): void {
  results.push({ name, pass, detail });
}

// The choices a user could actually apply — locked chips open the sign-up sheet
// and never change the slice.
function selectable(opts: CountOption[]): CountOption[] {
  return opts.filter(o => !o.locked);
}

export function runImportTierSelfTest(): TestResult[] {
  const r: TestResult[] = [];
  const GUEST = true;
  const MEMBER = false;

  // ── The guest cap ──────────────────────────────────────────────────────────
  // Spread across the cap: below it, on it, just over, and well over.
  const CAP = FREE_GUEST_IMPORT;
  for (const total of [0, 1, CAP - 1, CAP, CAP + 1, CAP * 6, 640, 1000]) {
    const opts = countOptionsFor(total, false, GUEST);
    const pick = selectable(opts);
    check(
      r,
      `guest with ${total} games can only select ≤ ${FREE_GUEST_IMPORT}`,
      pick.every(o => o.value !== 'all' && o.value <= FREE_GUEST_IMPORT),
      JSON.stringify(pick.map(o => o.value)),
    );
    const def = defaultCountFor(total, GUEST);
    check(
      r,
      `guest with ${total} games defaults within the cap`,
      def === 'all' ? total <= FREE_GUEST_IMPORT : def <= FREE_GUEST_IMPORT,
      String(def),
    );
  }

  // 'all' is only the guest default when "all" IS within the cap — otherwise it
  // would quietly hand over the whole library.
  check(
    r,
    `guest default is ${CAP} once there are more than ${CAP} games`,
    defaultCountFor(CAP + 1, GUEST) === FREE_GUEST_IMPORT,
    String(defaultCountFor(CAP + 1, GUEST)),
  );
  check(
    r,
    `guest default is "all" when the scan held ${CAP} or fewer`,
    defaultCountFor(CAP, GUEST) === 'all' && defaultCountFor(3, GUEST) === 'all',
    `${defaultCountFor(CAP, GUEST)} / ${defaultCountFor(3, GUEST)}`,
  );

  // ── What the guest is SHOWN ────────────────────────────────────────────────
  const small = countOptionsFor(20, false, GUEST);
  check(
    r,
    'guest under the cap sees no padlocked chips (nothing to upsell)',
    small.length === 1 && !small[0].locked,
    JSON.stringify(small),
  );

  const big = countOptionsFor(900, false, GUEST);
  check(
    r,
    'guest over the cap sees the bigger slices, padlocked',
    big.length === 3
      && big[0].locked !== true
      && big[1].locked === true
      && big[2].locked === true,
    JSON.stringify(big),
  );
  check(
    r,
    'the guest chip row always leads with the one they can take',
    big[0].value === FREE_GUEST_IMPORT,
    JSON.stringify(big[0]),
  );

  // ── The signed-in ladder, unchanged ────────────────────────────────────────
  check(
    r,
    'member with 80 games gets All only',
    JSON.stringify(countOptionsFor(80, false, MEMBER).map(o => o.value)) === '["all"]',
    JSON.stringify(countOptionsFor(80, false, MEMBER)),
  );
  check(
    r,
    'member with 300 games gets 100 + All',
    JSON.stringify(countOptionsFor(300, false, MEMBER).map(o => o.value)) === '[100,"all"]',
    JSON.stringify(countOptionsFor(300, false, MEMBER)),
  );
  check(
    r,
    'member with 900 games gets 100 + 500 + All',
    JSON.stringify(countOptionsFor(900, false, MEMBER).map(o => o.value)) === '[100,500,"all"]',
    JSON.stringify(countOptionsFor(900, false, MEMBER)),
  );
  check(
    r,
    'no chip is ever padlocked for a member',
    countOptionsFor(900, true, MEMBER).every(o => !o.locked),
    JSON.stringify(countOptionsFor(900, true, MEMBER)),
  );
  check(
    r,
    'member defaults to 500 over 500 games, else all',
    defaultCountFor(900, MEMBER) === 500 && defaultCountFor(500, MEMBER) === 'all',
    `${defaultCountFor(900, MEMBER)} / ${defaultCountFor(500, MEMBER)}`,
  );

  // ── The truncation label ───────────────────────────────────────────────────
  const truncated = countOptionsFor(1000, true, MEMBER);
  check(
    r,
    'a truncated scan spells the cap out on the All chip',
    truncated[truncated.length - 1].label.startsWith('All ('),
    truncated[truncated.length - 1].label,
  );
  const truncatedGuest = countOptionsFor(1000, true, GUEST);
  check(
    r,
    'a truncated guest scan labels its locked All chip the same way',
    truncatedGuest[truncatedGuest.length - 1].label.startsWith('All ('),
    truncatedGuest[truncatedGuest.length - 1].label,
  );

  return r;
}
