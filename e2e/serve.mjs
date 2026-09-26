// Minimal static server that mimics GitHub Pages' project path (/brain-growth/).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

export function serve(root, base = '/brain-growth/', port = 4173) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(base)) { res.writeHead(302, { location: base }); return res.end(); }
    let p = normalize(join(root, url.pathname.slice(base.length)));
    try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); } catch { res.writeHead(404); return res.end('not found'); }
    try {
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
