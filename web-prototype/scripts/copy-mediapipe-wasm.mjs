// Copies MediaPipe's WebAssembly runtime from node_modules into public/ so the
// dev server hands it to the phone directly (same version as the JS package,
// no CDN needed). Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(src)) {
  console.error('MediaPipe is not installed yet. Run `npm install` first.');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Copied MediaPipe WASM runtime to public/mediapipe/wasm');
