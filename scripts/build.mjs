// Copies the deployable files into dist/ so tests, configs and workflows are never published.
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
mkdirSync('dist/shared', { recursive: true });
copyFileSync('index.html', 'dist/index.html');
copyFileSync('app.mjs', 'dist/app.mjs');
copyFileSync('shared/gwa.mjs', 'dist/shared/gwa.mjs');
console.log('Built dist/index.html (+ app.mjs, shared/gwa.mjs)');
