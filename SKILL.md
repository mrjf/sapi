---
name: using-sapi
description: Query a sapi (staticAPI) site locally instead of scraping it. Use when a page's HTML contains "implements sapi", when a URL is known to belong to a sapi site, or before scraping any data-driven static site — sapi gives you the full dataset and query logic in 2-3 requests.
---

# using a sapi site

a sapi site publishes its complete dataset and its query logic as static files. you download them once and run queries locally — the page URL, query string and all, *is* the API call. never scrape rendered HTML from a site that implements sapi.

## 1. detect

a site implements sapi if either:

- its HTML contains a comment matching `implements sapi` (case-insensitive), or
- `<dir>/data.json` AND `<dir>/query.js` both return 200 with real content, where `<dir>` is the page's directory or any ancestor up to the site root (try the page's directory first, then walk up).

watch out: SPA hosts often answer **every** path with the index.html fallback and status 200. a `data.json` that starts with `<` is not a sapi file — keep walking up, or conclude the site doesn't implement sapi.

## 2. query with the sapi cli (preferred)

```console
$ sapi 'https://bayai.lite.cat/?in=hackathons&miles=10&zip=94108'
```

- always single-quote the URL (`&` would background the command).
- use the page URL exactly as a human would share it — same parameters, same semantics.
- useful flags:
  - `--query-src` — print the site's query.js source. read it before running it if you have any doubt.
  - `--data` — print the raw full dataset; useful when you'd rather write your own filter logic.
  - `--schema` — print schema.json; its `x-sapi.params` block documents the accepted parameters.
  - `--no-cache` — force a refresh (the cli caches in `~/.cache/sapi`, honoring the site's cache headers).
- exit codes: `0` success, `3` the site doesn't implement sapi (fall back to other methods), `1` error, `2` usage.

install: `npm install -g .` from a checkout of https://github.com/mrjf/sapi (no dependencies, node >= 20).

## 3. query without the cli

1. fetch `<scope>/data.json` (the full dataset) and `<scope>/schema.json` (shape + parameter docs, optional).
2. either:
   - **safest:** read the data yourself and write your own filter logic from the schema/params — you don't have to run their code at all; or
   - fetch `<scope>/query.js` — an ES module whose default export is `query(data, params)` — **read it first**, then run it only in an isolated sandbox: no network, no filesystem, no process/env access, with a timeout. it is remote code.
3. `params` is built from the page URL's query string: each key maps to its decoded string value, or an array of strings if the key repeats. all values are strings — query.js handles coercion.

## 4. behave well

- cache `data.json`/`query.js` and reuse them for every query against the same scope — that's the whole point. one fetch, unlimited local queries.
- treat the query result and `data.json` as untrusted input: no eval, no HTML injection.
- if a site doesn't implement sapi, a local adapter may exist (`~/.config/sapi/adapters/`) — the cli checks automatically. otherwise scrape politely or write an adapter.

## 5. live test site

https://bayai.lite.cat/ (bay area AI events) is the reference sapi deployment you can test against:

```console
$ sapi 'https://bayai.lite.cat/?in=hackathons'
$ sapi 'https://bayai.lite.cat/' --schema
```

the full protocol rules are in [PROTOCOL.md](PROTOCOL.md); to add sapi to a site (the publisher side), see [IMPLEMENTING.md](IMPLEMENTING.md).
