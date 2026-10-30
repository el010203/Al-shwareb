// Only public app assets belong in the Pages upload, never backend source/secrets.
import { mkdir, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const path of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
console.log('Public app built in dist/ (Pages Functions are compiled separately).');
