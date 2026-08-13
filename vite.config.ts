import { defineConfig, type Plugin } from 'vite';
import { readFileSync, cpSync } from 'node:fs';
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
function cloudflareLandingPage(): Plugin {
  return {
    name: 'cloudflare-landing-page',
    apply: 'build',
    closeBundle() {
      cpSync(fileURLToPath(new URL('./docs', import.meta.url)), fileURLToPath(new URL('./dist', import.meta.url)), {
        recursive: true,
      });
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
