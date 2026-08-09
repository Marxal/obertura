// How big a payload will Supabase actually accept?
//
// The account sync pushes the imported games as one jsonb value, and a heavy
// library (1000 games with saved analysis) measures ~20 MB. Supabase publishes no
// request-body limit for the REST API, and the limit that exists in practice is
// imposed by whatever sits in front of Postgres (their gateway, and Cloudflare
// before it) rather than by Postgres itself. So: measure it, don't assume it.
//
// WHAT THIS DOES AND DOESN'T DO. It POSTs bodies of increasing size to
// /rest/v1/profiles using only the PUBLIC anon key — the same key already inlined
// in the shipped bundle — and reads the status code. It writes NOTHING: the anon
// role has no `auth.uid()`, so the table's insert policy rejects every one of
// these requests. That's the trick. A gateway enforces its body limit while the
// upload is still streaming, before Postgres or row-level security is ever
// consulted, which means:
//
//   413 (or a dropped connection)  → the gateway refused the body. That's the cap.
//   401 / 403 / 42501 / any RLS or auth error → the body ARRIVED and was rejected
//                                     on its merits. That size is fine.
//
// So an "error" of the second kind is the pass condition. Nothing is created,
// nothing is modified, no test account is needed.
//
// Usage — both values come from the Cloudflare Pages dashboard (Settings →
// Environment variables), or from Supabase's own dashboard under Project
// Settings → API:
//
//   node scripts/probe-sync-limit.mjs <SUPABASE_URL> <ANON_KEY>
//
// Optionally pass your own ladder in MB:
//
//   node scripts/probe-sync-limit.mjs <URL> <KEY> 1 8 20 50 100

const [url, key, ...sizeArgs] = process.argv.slice(2);

if (!url || !key) {
  console.error(
    'Usage: node scripts/probe-sync-limit.mjs <SUPABASE_URL> <ANON_KEY> [sizeMB...]\n' +
      '\nBoth are public values — the anon key is already visible in the shipped\n' +
      'bundle. Never pass the service-role key to this (or to anything else).',
  );
  process.exit(2);
}

const base = url.replace(/\/+$/, '');
const sizes = sizeArgs.length ? sizeArgs.map(Number) : [1, 4, 8, 16, 20, 32, 48, 64, 100];

if (sizes.some((n) => !Number.isFinite(n) || n <= 0)) {
  console.error('Sizes must be positive numbers (megabytes).');
  process.exit(2);
}

// An id that is deliberately not anybody's user id. RLS refuses it regardless,
// but there's no reason to aim at a real row even so.
const NOBODY = '00000000-0000-0000-0000-000000000000';

// Build a body of approximately `mb` megabytes. The padding is random-ish rather
// than one repeated character, in case anything along the way compresses on the
// fly and flatters the result.
function bodyOf(mb) {
  const target = Math.round(mb * 1024 * 1024);
  const chunk = Array.from({ length: 1024 }, (_, i) => String.fromCharCode(97 + ((i * 7) % 26))).join('');
  let pad = '';
  while (pad.length < target) pad += chunk;
  pad = pad.slice(0, target);
  return JSON.stringify({ id: NOBODY, repertoire: { pad } });
}

function verdict(status) {
  if (status === 413) return ['CAPPED', 'gateway refused the body — this is the limit'];
  if (status === 0) return ['CAPPED?', 'connection dropped mid-upload — usually a body limit too'];
  if (status === 401 || status === 403) return ['THROUGH', 'body arrived; auth/RLS rejected it, as designed'];
  if (status === 404) return ['THROUGH?', 'body arrived but the table was not found — check the URL'];
  if (status >= 200 && status < 300) return ['THROUGH!', 'body arrived AND was accepted — RLS is not doing its job, investigate'];
  return ['THROUGH', `body arrived; server said ${status}`];
}

console.log(`\nProbing ${base}/rest/v1/profiles`);
console.log('Nothing is written — every request is expected to be rejected.\n');

let largestThrough = 0;
let firstCapped = null;

for (const mb of sizes) {
  const body = bodyOf(mb);
  const actual = (Buffer.byteLength(body) / 1048576).toFixed(1);
  process.stdout.write(`  ${String(mb).padStart(4)} MB (${actual} MB on the wire) … `);

  let status = 0;
  let detail = '';
  const started = Date.now();
  try {
    const res = await fetch(`${base}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body,
    });
    status = res.status;
    detail = (await res.text()).slice(0, 160).replace(/\s+/g, ' ').trim();
  } catch (err) {
    status = 0;
    detail = err instanceof Error ? err.message : String(err);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const [tag, why] = verdict(status);
  console.log(`${status || 'ERR'}  ${tag}  (${secs}s)`);
  console.log(`         ${why}`);
  if (detail) console.log(`         server: ${detail}`);

  if (tag.startsWith('CAPPED')) {
    firstCapped = mb;
    break; // no point climbing past the wall
  }
  largestThrough = mb;
}

console.log('\n── Result ──');
if (firstCapped === null) {
  console.log(`No cap found up to ${largestThrough} MB. The sync's ~20 MB worst case is safe.`);
} else {
  console.log(`Largest body accepted: ${largestThrough} MB. Refused at: ${firstCapped} MB.`);
  if (firstCapped <= 24) {
    console.log(
      'That is inside the range a heavy games library can reach — the games half of\n' +
        'the sync needs a size guard before anyone hits it. Report this back.',
    );
  }
}
console.log('');
