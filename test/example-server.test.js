// True end-to-end: spawn the real `npm run example` server script, then run
// the real sapi CLI against it as a separate process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'bin', 'sapi.js');
const serveScript = join(root, 'scripts', 'serve-example.js');

let server;
let base; // printed by the server on startup, e.g. http://127.0.0.1:PORT/
let cacheHome;

before(async () => {
  cacheHome = await mkdtemp(join(tmpdir(), 'sapi-e2e-cache-'));
  // PORT=0 lets the OS pick a free port; parse the actual URL from stdout
  server = spawn(process.execPath, [serveScript], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  base = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(
      () => reject(new Error(`example server did not start in time; output so far: ${buf}`)),
      15_000,
    );
    server.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/running at (http:\/\/[^\s]+\/)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`example server exited early with code ${code}`));
    });
  });
});

after(async () => {
  server?.kill();
  await rm(cacheHome, { recursive: true, force: true });
});

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

test('the example server serves the page with the discovery comment', async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /implements sapi/i);
});

test('sapi cli queries the running example server', async () => {
  const r = await sapi(`${base}?in=hackathons&city=oakland`);
  assert.equal(r.code, 0, r.stderr);
  const events = JSON.parse(r.stdout);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Open Source Robotics Hackathon');
});

test('sapi cli reads the schema from the running example server', async () => {
  const r = await sapi(base, '--schema');
  assert.equal(r.code, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout)['x-sapi'].params.in);
});
