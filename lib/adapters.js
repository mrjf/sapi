import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Adapters teach the sapi client how to query sites that don't implement
 * sapi. Each adapter is an ES module in an adapter directory:
 *
 *   export default {
 *     name: 'basketball-reference',
 *     pattern: '^https://www\\.basketball-reference\\.com/',  // string or RegExp
 *     async query(url, { params, fetch }) {
 *       // fetch the page(s), parse out the data, return JSON
 *     },
 *   };
 *
 * Adapters are user-installed local code and run with full privileges,
 * unlike remote query.js which is sandboxed.
 */
export function adapterDirs(extraDir) {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const dirs = [join(base, 'sapi', 'adapters')];
  if (extraDir) dirs.unshift(extraDir);
  return dirs;
}

/**
 * Return the first adapter whose pattern matches the URL, scanning
 * directories in priority order and files in name order. Null if none match.
 */
export async function findAdapter(url, { extraDir } = {}) {
  for (const dir of adapterDirs(extraDir)) {
    let files;
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.js')).sort();
    } catch {
      continue; // directory doesn't exist
    }
    for (const file of files) {
      let adapter;
      try {
        adapter = (await import(pathToFileURL(join(dir, file)).href)).default;
      } catch (err) {
        process.stderr.write(`sapi: skipping broken adapter ${file}: ${err.message}\n`);
        continue;
      }
      if (!adapter?.pattern || typeof adapter.query !== 'function') continue;
      const re = adapter.pattern instanceof RegExp ? adapter.pattern : new RegExp(adapter.pattern);
      if (re.test(url)) return adapter;
    }
  }
  return null;
}
