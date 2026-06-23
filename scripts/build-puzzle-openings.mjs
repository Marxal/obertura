/**
 * Build the bundled allowlist of openings that have Lichess puzzle sets.
 *
 * Lichess only offers puzzles for a curated set of opening "angles" (the family
 * keys listed at https://lichess.org/training/openings). The Puzzles tab maps the
 * user's openings onto these keys, so we ship the list and only offer puzzles for
 * openings that actually have them.
 *
 * Output: src/puzzle-openings.json — a flat array of angle keys (slugs), e.g.
 *   ["Sicilian_Defense", "Italian_Game", ...]
 *
 * No token needed — the page is public. Run:
 *   node scripts/build-puzzle-openings.mjs
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const URL = 'https://lichess.org/training/openings';

const res = await fetch(URL, { headers: { Accept: 'text/html' } });
if (!res.ok) {
  console.error(`Lichess returned ${res.status} for ${URL}`);
  process.exit(1);
}
const html = await res.text();

// Every opening is linked as /training/<Slug>. Collect the unique slugs in order,
// skipping the non-opening links (themes, "openings", "mix", login, etc.).
const SKIP = new Set(['openings', 'mix', 'themes', 'dashboard', 'history']);
const seen = new Set();
const slugs = [];
for (const m of html.matchAll(/\/training\/([A-Za-z0-9_'.-]+)/g)) {
  const slug = m[1];
  if (SKIP.has(slug.toLowerCase())) continue;
  if (seen.has(slug)) continue;
  seen.add(slug);
  slugs.push(slug);
}

if (slugs.length < 50) {
  console.error(`Only found ${slugs.length} slugs — the page layout may have changed.`);
  process.exit(1);
}

writeFileSync(join(root, 'src/puzzle-openings.json'), JSON.stringify(slugs, null, 2) + '\n');
console.log(`Wrote ${slugs.length} opening angle keys to src/puzzle-openings.json`);
