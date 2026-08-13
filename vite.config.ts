import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Read the app name + version straight from package.json so the About screen and
// feedback form always reflect the real build (see about.ts / feedback.ts).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// DEPLOY_TARGET picks which host this build is shaped for (see CLAUDE.md):
//  - "github" (default): app at the dist root, base '/obertura/' — unchanged,
//    the GitHub Actions workflow copies docs/ to dist/docs itself afterwards.
//  - "cloudflare": app moves under base '/app/' so docs/index.html (the
//    marketing landing page) can take over the dist root instead.
const target = process.env.DEPLOY_TARGET === 'cloudflare' ? 'cloudflare' : 'github';

// Copies docs/ (landing page + its images) into the dist root once the app
// itself has finished building into dist/app/, so the two coexist.
//
// It also fills in the landing page's two Supabase placeholders, which is what
// lets the "create your account" popup sign somebody up WITHOUT sending them
// into the app first. docs/index.html is a standalone static file — it is not
// part of the Rollup graph, so `import.meta.env` never reaches it and the
// values have to be substituted into the copy by hand here.
//
// BOTH VALUES ARE PUBLIC. The anon key is already inlined into the app's own
// bundle by Vite and shipped to every visitor (see the note at the top of
// src/supabase.ts); putting it in the landing page exposes nothing new. Row-level
// security is what protects the data, never the secrecy of this string.
//
// If either env var is missing the placeholders are left exactly as they are,
// the page's `canSignUpHere` check fails, and the buy button falls back to
// handing the visitor to the app — which is precisely what has to happen on the
// GitHub Pages build, where no Supabase project is configured at all.
const SUPABASE_PLACEHOLDERS: Array<[string, string | undefined]> = [
  ['__SUPABASE_URL__', process.env.VITE_SUPABASE_URL],
  ['__SUPABASE_ANON_KEY__', process.env.VITE_SUPABASE_ANON_KEY],
];

function cloudflareLandingPage(): Plugin {
  return {
    name: 'cloudflare-landing-page',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist', import.meta.url));
      cpSync(fileURLToPath(new URL('./docs', import.meta.url)), dist, { recursive: true });

      if (!SUPABASE_PLACEHOLDERS.every(([, value]) => value)) return;
      const landing = `${dist}/index.html`;
      let html = readFileSync(landing, 'utf-8');
      for (const [token, value] of SUPABASE_PLACEHOLDERS) {
        html = html.split(token).join(value as string);
      }
      writeFileSync(landing, html);
    },
  };
}

export default defineConfig({
  base: target === 'cloudflare' ? '/app/' : '/obertura/',
  build: {
    outDir: target === 'cloudflare' ? 'dist/app' : 'dist',
  },
  plugins: target === 'cloudflare' ? [cloudflareLandingPage()] : [],
  define: {
    __APP_NAME__: JSON.stringify('Bito Chess'),
    __APP_VERSION__: JSON.stringify(pkg.version),
    // The app itself needs to know which host it was built for: the public
    // Cloudflare build is open to anonymous visitors and skips the beta gate,
    // while the internal GitHub Pages build keeps it (see gate.ts / main.ts).
    __DEPLOY_TARGET__: JSON.stringify(target),
  },
});
