import { parseArgs } from 'node:util';
import { cachedFetch } from './cache.js';
import { locate, paramsFor } from './locate.js';
import { runQuery } from './run.js';
import { findAdapter } from './adapters.js';
import { VERSION } from './version.js';

const HELP = `sapi — query sapi (staticAPI) sites locally

usage:
  sapi <url> [options]

the url is the page url, query string and all. sapi finds the page's
data.json + query.js, caches them, and runs the query locally.

options:
  --data             print the site's raw data.json and exit
  --schema           print the site's schema.json and exit
  --query-src        print the site's query.js source and exit (read before you run!)
  --no-cache         bypass the local cache for this request
  --no-adapters      skip adapter matching, speak the sapi protocol only
  --adapter-dir <d>  also load adapters from this directory (highest priority)
  --timeout <ms>     query.js execution timeout (default 5000)
  --compact          print compact JSON instead of pretty-printed
  -h, --help         show this help
  -V, --version      print version

exit codes:
  0  success
  1  error
  2  usage error
  3  site does not implement sapi (and no adapter matched)

cache: ~/.cache/sapi (or $XDG_CACHE_HOME/sapi)
adapters: ~/.config/sapi/adapters (or $XDG_CONFIG_HOME/sapi/adapters)
`;

// resolves once the bytes reach the OS — the caller exits via process.exit,
// which would otherwise truncate output beyond the 64KB pipe buffer
function out(value, compact) {
  const text =
    (typeof value === 'string' ? value.replace(/\n?$/, '') : JSON.stringify(value, null, compact ? 0 : 2)) + '\n';
  return new Promise((resolve) => process.stdout.write(text, resolve));
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        data: { type: 'boolean' },
        schema: { type: 'boolean' },
        'query-src': { type: 'boolean' },
        'no-cache': { type: 'boolean' },
        'no-adapters': { type: 'boolean' },
        'adapter-dir': { type: 'string' },
        timeout: { type: 'string', default: '5000' },
        compact: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
    });
  } catch (err) {
    process.stderr.write(`sapi: ${err.message}\n\n${HELP}`);
    return 2;
  }
  const { values: opts, positionals } = parsed;

  if (opts.version) {
    await out(VERSION);
    return 0;
  }
  if (opts.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return opts.help ? 0 : 2;
  }
  if (positionals.length > 1) {
    process.stderr.write('sapi: expected exactly one url (quote urls containing & or ?)\n');
    return 2;
  }

  let url;
  try {
    url = new URL(positionals[0]);
  } catch {
    process.stderr.write(`sapi: not a valid url: ${positionals[0]}\n`);
    return 2;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    process.stderr.write(`sapi: only http(s) urls are supported, got ${url.protocol}\n`);
    return 2;
  }

  const noCache = Boolean(opts['no-cache']);
  const params = paramsFor(url);
  const timeout = Number(opts.timeout);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    process.stderr.write(`sapi: invalid --timeout: ${opts.timeout}\n`);
    return 2;
  }

  try {
    if (!opts['no-adapters']) {
      const adapter = await findAdapter(url.href, { extraDir: opts['adapter-dir'] });
      if (adapter) {
        const result = await adapter.query(url.href, {
          params,
          fetch: (u, o = {}) => cachedFetch(u, { noCache, ...o }),
        });
        await out(result, opts.compact);
        return 0;
      }
    }

    const located = await locate(url.href, { noCache });
    if (!located) {
      process.stderr.write(`sapi: ${url.origin} does not implement sapi (no valid data.json found at any scope of ${url.pathname})\n`);
      return 3;
    }
    const { scope, body, data } = located;

    if (opts.data) {
      await out(body, opts.compact);
      return 0;
    }
    if (opts.schema) {
      const schema = await cachedFetch(scope + 'schema.json', { noCache });
      if (schema.status !== 200) {
        process.stderr.write(`sapi: ${scope} publishes no schema.json (it is optional)\n`);
        return 1;
      }
      await out(schema.body, opts.compact);
      return 0;
    }

    const querySrc = await cachedFetch(scope + 'query.js', { noCache });
    if (querySrc.status !== 200) {
      process.stderr.write(`sapi: found ${scope}data.json but no query.js beside it — scope does not implement sapi (try --data for the raw data)\n`);
      return 3;
    }
    if (opts['query-src']) {
      await out(querySrc.body, opts.compact);
      return 0;
    }

    const result = await runQuery(querySrc.body, {
      data,
      params,
      timeout,
      identifier: scope + 'query.js',
    });
    await out(result === undefined ? null : result, opts.compact);
    return 0;
  } catch (err) {
    process.stderr.write(`sapi: ${err.message}\n`);
    return 1;
  }
}
