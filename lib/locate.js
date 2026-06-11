import { cachedFetch } from './cache.js';

/**
 * Candidate sapi scopes for a page URL: the page's own directory,
 * then each ancestor directory up to the origin root. See PROTOCOL.md §3.
 */
export function scopesFor(url) {
  const u = new URL(url);
  let path = u.pathname;
  if (!path.endsWith('/')) path = path.slice(0, path.lastIndexOf('/') + 1);
  const scopes = [];
  for (;;) {
    scopes.push(u.origin + path);
    if (path === '/') break;
    path = path.replace(/[^/]+\/$/, '');
  }
  return scopes;
}

/**
 * Build the params object from a page URL's query string.
 * Each key maps to its decoded string value, or an array of strings
 * (in document order) when the key repeats. See PROTOCOL.md §4.
 */
export function paramsFor(url) {
  const params = {};
  for (const [key, value] of new URL(url).searchParams) {
    if (key in params) {
      params[key] = [].concat(params[key], value);
    } else {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Find the sapi scope governing a page URL: the nearest scope (walking up
 * from the page's directory) where data.json exists and parses as JSON.
 * The parse check matters in practice: SPA hosts often answer 200 with the
 * index.html fallback for any path, including /data.json.
 * Returns { scope, body, data } or null.
 */
export async function locate(url, opts = {}) {
  for (const scope of scopesFor(url)) {
    const res = await cachedFetch(scope + 'data.json', opts);
    if (res.status !== 200) continue;
    try {
      return { scope, body: res.body, data: JSON.parse(res.body) };
    } catch {
      // 200 but not JSON (likely an SPA fallback page) — keep walking up
    }
  }
  return null;
}
