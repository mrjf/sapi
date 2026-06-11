import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'sapi.js');
const exampleDir = join(root, 'example');

const TYPES = { '.json': 'application/json', '.js': 'text/javascript', '.html': 'text/html' };

let server;
let base; // e.g. http://127.0.0.1:PORT
let cacheHome;

before(async () => {
  cacheHome = await mkdtemp(join(tmpdir(), 'sapi-test-cache-'));
  // a scope whose pretty-printed query result far exceeds the 64KB pipe
  // buffer, to catch stdout truncation on process exit
  const bigEvents = Array.from({ length: 3000 }, (_, i) => ({
    id: i,
    title: `event number ${i}`,
    category: 'padding-'.repeat(8),
  }));
  server = http.createServer(async (req, res) => {
    // serve the example dir at the site root; everything else 404s,
    // so /events/?... exercises the walk-up-to-root scope resolution
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/big/data.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ events: bigEvents }));
    }
    if (path === '/big/query.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('export default (data) => data.events;');
    }
    const file = path === '/' || path === '/events/' ? 'index.html' : path.replace(/^.*\//, '');
    try {
      if (path !== '/' && path !== `/${file}`) throw new Error('not at root');
      const body = await readFile(join(exampleDir, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(cacheHome, { recursive: true, force: true });
});

// async, not spawnSync: the test http server runs in this same process, so a
// synchronous wait would deadlock the CLI's fetch against our blocked event loop
function sapi(...args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [bin, ...args],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: cacheHome },
      },
      (err, stdout, stderr) => {
        resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr });
      },
    );
  });
}

test('runs the query with params from the page url', async () => {
  const r = await sapi(`${base}/?in=hackathons&city=oakland`);
  assert.equal(r.code, 0, r.stderr);
  const events = JSON.parse(r.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Open Source Robotics Hackathon');
});

test('no params returns everything', async () => {
  const r = await sapi(`${base}/`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 4);
});

test('walks up to the root scope from a subpath', async () => {
  const r = await sapi(`${base}/events/?in=meetups`);
  assert.equal(r.code, 0, r.stderr);
  const events = JSON.parse(r.stdout);
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.category === 'meetups'));
});

test('--data prints raw data.json', async () => {
  const r = await sapi(`${base}/`, '--data');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).events.length, 4);
});

test('--schema prints schema.json', async () => {
  const r = await sapi(`${base}/`, '--schema');
  assert.equal(r.code, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout)['x-sapi']);
});

test('--query-src prints the query source', async () => {
  const r = await sapi(`${base}/`, '--query-src');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /export default function query/);
});

test('exit 3 against an origin with no sapi files', async () => {
  const empty = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => empty.listen(0, '127.0.0.1', resolve));
  const r = await sapi(`http://127.0.0.1:${empty.address().port}/?a=b`);
  empty.close();
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /does not implement sapi/);
});

test('repeated params become arrays', async () => {
  // a repeated key reaches query.js as an array; the example's exact-match
  // category filter then matches nothing, which proves the array semantics
  const r = await sapi(`${base}/?in=hackathons&in=meetups`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 0);
});

test('large results are not truncated at the 64KB pipe buffer', async () => {
  const r = await sapi(`${base}/big/`);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.length > 100_000, `expected >100KB of output, got ${r.stdout.length} bytes`);
  assert.equal(JSON.parse(r.stdout).length, 3000);
});

test('adapters handle matching non-sapi urls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sapi-test-adapters-'));
  await writeFile(
    join(dir, 'echo.js'),
    `export default {
      name: 'echo',
      pattern: '^https://adapter\\\\.example/',
      async query(url, { params }) { return { url, params }; },
    };`,
  );
  const r = await sapi('https://adapter.example/page?y=z', '--adapter-dir', dir);
  await rm(dir, { recursive: true, force: true });
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.url, 'https://adapter.example/page?y=z');
  assert.equal(result.params.y, 'z');
});

test('usage errors exit 2', async () => {
  assert.equal((await sapi()).code, 2);
  assert.equal((await sapi('ftp://nope/')).code, 2);
  assert.equal((await sapi('not a url')).code, 2);
});
