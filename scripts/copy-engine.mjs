import { copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, 'node_modules/stockfish/bin');
const dest = join(root, 'public/engine');

mkdirSync(dest, { recursive: true });
copyFileSync(join(bin, 'stockfish-18-lite-single.js'), join(dest, 'stockfish.js'));
copyFileSync(join(bin, 'stockfish-18-lite-single.wasm'), join(dest, 'stockfish.wasm'));
console.log('Engine files copied → public/engine/');
