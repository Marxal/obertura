import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Read the app name + version straight from package.json so the About screen and
// feedback form always reflect the real build (see about.ts / feedback.ts).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  base: '/obertura/',
  define: {
    __APP_NAME__: JSON.stringify('Bito Chess'),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
