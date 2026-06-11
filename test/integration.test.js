// Integration tests against the live reference sapi site (bayai.lite.cat).
// These need network access and a deployed site: `npm run test:integration`.
// Override the target with SAPI_TEST_SITE=https://other.site/ if needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const SITE = process.env.SAPI_TEST_SITE || 'https://bayai.lite.cat/';
const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'sapi.js');

let cacheHome;

before(async () => {
  cacheHome = await mkdtemp(join(tmpdir(), 'sapi-integration-cache-'));
});

after(async () => {
  await rm(cacheHome, { recursive: true, force: true });
});

function sapi(...args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [bin, ...args],
      {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: cacheHome },
      },
      (err, stdout, stderr) => {
        resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr });
      },
    );
  });
}

test('site advertises sapi in its html', async () => {
  const res = await fetch(SITE);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /implements sapi/i, `${SITE} html should contain the "implements sapi" discovery comment`);
});

test('data.json is served and parses as json', async () => {
  const res = await fetch(new URL('data.json', SITE));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body.trimStart(), /^</, 'data.json must be json, not an html fallback page');
  JSON.parse(body); // throws if invalid
});

test('query.js is served and looks like a sapi query module', async () => {
  const res = await fetch(new URL('query.js', SITE));
  assert.equal(res.status, 200);
  const src = await res.text();
  assert.doesNotMatch(src.trimStart(), /^</, 'query.js must be javascript, not an html fallback page');
  assert.match(src, /export default/, 'query.js must have a default export');
});

test('cli queries the live site end to end', async () => {
  const r = await sapi(`${SITE}?in=hackathons`);
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.ok(result !== null && typeof result === 'object', 'query should return a json object or array');
});

test('cli result respects the query parameters', async () => {
  const all = await sapi(SITE);
  const filtered = await sapi(`${SITE}?in=hackathons`);
  assert.equal(all.code, 0, all.stderr);
  assert.equal(filtered.code, 0, filtered.stderr);
  const allResults = JSON.parse(all.stdout);
  const filteredResults = JSON.parse(filtered.stdout);
  assert.ok(Array.isArray(allResults) && Array.isArray(filteredResults));
  assert.ok(
    filteredResults.length <= allResults.length,
    'a filtered query must not return more results than an unfiltered one',
  );
});
