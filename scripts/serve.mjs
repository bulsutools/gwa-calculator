// Tiny static file server for local dev and tests.
// Usage: node scripts/serve.mjs [port]   (default 8080, serves repo root)
// Also importable: import { startServer } from './serve.mjs'
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function startServer(root = ROOT, port = 0) {
 const server = createServer(async (req, res) => {
  try {
   let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
   if (p.endsWith('/')) p += 'index.html';
   const file = normalize(join(root, p));
   if (!file.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
   const body = await readFile(file);
   res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
   res.end(body);
  } catch {
   res.writeHead(404); res.end('not found');
  }
 });
 return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const port = Number(process.argv[2]) || 8080;
 const { url } = await startServer(ROOT, port);
 console.log(`Serving ${ROOT} at ${url}`);
}
