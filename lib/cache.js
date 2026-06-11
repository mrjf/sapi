import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from './version.js';

// default freshness window when the server sends no Cache-Control, per PROTOCOL.md
const DEFAULT_TTL_SECONDS = 300;

export function cacheDir() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'sapi');
}

function entryPath(url) {
  const hash = createHash('sha256').update(url).digest('hex');
  return join(cacheDir(), `${hash}.json`);
}

function maxAgeOf(headers) {
  const cc = headers.get('cache-control') || '';
  const m = cc.match(/(?:^|[,\s])max-age=(\d+)/i);
  return m ? Number(m[1]) : DEFAULT_TTL_SECONDS;
}

async function save(path, entry) {
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(path, JSON.stringify(entry));
}

/**
 * Fetch a URL through the local sapi cache.
 * Returns { status, body, fromCache, stale? }. Only 200 responses are cached.
 * Honors max-age (default 300s) and revalidates with If-None-Match when possible.
 */
export async function cachedFetch(url, { noCache = false } = {}) {
  const path = entryPath(url);
  let entry = null;
  if (!noCache) {
    try {
      entry = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      // no usable cache entry
    }
  }

  if (entry && (Date.now() - entry.fetchedAt) / 1000 < entry.maxAge) {
    return { status: entry.status, body: entry.body, fromCache: true };
  }

  const headers = { 'user-agent': `sapi/${VERSION}` };
  if (entry?.etag) headers['if-none-match'] = entry.etag;

  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (err) {
    if (entry) {
      // network failure: serve stale rather than nothing
      return { status: entry.status, body: entry.body, fromCache: true, stale: true };
    }
    throw new Error(`failed to fetch ${url}: ${err.message}`);
  }

  if (res.status === 304 && entry) {
    entry.fetchedAt = Date.now();
    entry.maxAge = maxAgeOf(res.headers);
    await save(path, entry);
    return { status: entry.status, body: entry.body, fromCache: true };
  }

  const body = await res.text();
  if (res.status === 200) {
    await save(path, {
      url,
      fetchedAt: Date.now(),
      maxAge: maxAgeOf(res.headers),
      etag: res.headers.get('etag'),
      status: res.status,
      body,
    });
  }
  return { status: res.status, body, fromCache: false };
}
