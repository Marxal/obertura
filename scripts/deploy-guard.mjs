// Only `main` may replace the live site.
//
// Cloudflare's Workers Build runs `wrangler deploy` for EVERY branch pushed to
// GitHub, and the newest deploy becomes the live site. On 2026-10-30 a working
// branch pushed by a second Claude session went live a minute after `main`,
// silently undoing that round on bitochess.com. wrangler runs this script (the
// `build.command` in wrangler.jsonc) before every deploy; exiting non-zero
// stops the deploy, so a branch build now fails instead of going live.
//
// WORKERS_CI_BRANCH is set by Workers Builds (Cloudflare changelog, 2025-06-10).
// When it is missing — a manual `npx wrangler deploy` from a laptop, `wrangler
// dev`, or Cloudflare dropping the variable — this lets the deploy through, so
// it can never block a deploy that worked before it existed.

const branch = process.env.WORKERS_CI_BRANCH;

if (!branch) {
  console.log('[deploy-guard] no WORKERS_CI_BRANCH: not a Workers Build, carrying on.');
} else if (branch === 'main') {
  console.log('[deploy-guard] branch main: deploying.');
} else {
  console.error(
    `[deploy-guard] branch "${branch}" is not main, so this build stops here and the live site `
    + 'is left alone. This failure is expected: only pushes to main go live. To ship this work, '
    + 'merge it into main.',
  );
  process.exit(1);
}
