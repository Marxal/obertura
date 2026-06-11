// Registers the extensionless-TS resolve hook (ts-resolve.mjs) before the
// self-test runner loads any app modules. Used via `node --import`.
import { register } from 'node:module';
register('./ts-resolve.mjs', import.meta.url);
