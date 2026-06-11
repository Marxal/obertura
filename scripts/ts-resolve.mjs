// A tiny ESM resolution hook so `node --experimental-strip-types` can run the
// app's TypeScript self-tests directly. The source imports siblings without a
// file extension (`./import-core`), which Vite/tsc resolve but bare Node does
// not. This hook appends `.ts`/`.tsx`/`/index.ts` when an extensionless
// relative import fails to resolve, leaving everything else (bare packages like
// `chess.js`) to Node's default resolver.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXT_CANDIDATES = ['.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    try {
      return await next(specifier, context);
    } catch (err) {
      for (const ext of EXT_CANDIDATES) {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return next(specifier + ext, context);
        }
      }
      throw err;
    }
  }
  return next(specifier, context);
}
