// Serve the example sapi site locally: npm run example
// Browsers block fetch() and module imports from file:// pages, so the
// example must be viewed over HTTP.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'example');
const TYPES = {
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.html': 'text/html; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = await readFile(join(exampleDir, file));
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'text/plain',
      'access-control-allow-origin': '*',
      'cache-control': 'max-age=0',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  }
});

// PORT=0 asks the OS for a free port (the actual URL is printed on startup)
const port = process.env.PORT === undefined ? 8080 : Number(process.env.PORT);
server.listen(port, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  console.log(`example sapi site running at ${base}`);
  console.log('try:');
  console.log(`  open '${base}?in=hackathons'`);
  console.log(`  node bin/sapi.js '${base}?in=hackathons'`);
});
