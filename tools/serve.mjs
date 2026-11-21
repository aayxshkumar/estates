#!/usr/bin/env node
// Zero-dependency static server: public/ at /, compiled TypeScript at /dist/.
//   node tools/serve.mjs [port]

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.map': 'application/json',
  '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

function resolvePath(url) {
  const path = decodeURIComponent(new URL(url, 'http://x').pathname);
  const rel = normalize(path).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return null;
  const base = rel.startsWith('dist/') ? ROOT : join(ROOT, 'public');
  const file = join(base, rel || 'index.html');
  return file.startsWith(ROOT) ? file : null;
}

createServer((req, res) => {
  const file = resolvePath(req.url ?? '/');
  let st;
  try { st = file && statSync(file); } catch { st = null; }
  if (!file || !st || !st.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`estates on http://localhost:${PORT}`));
