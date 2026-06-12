# implementing sapi on your site — instructions for an agent

you are adding sapi (staticAPI) support to a website. when you're done, any sapi client will be able to run `sapi <page-url>` and get the same results the page would show for that URL, without scraping. the authoritative rules are in [PROTOCOL.md](PROTOCOL.md); read it before you start. this file tells you how to get there, in order.

## 0. what you are producing

two or three static files, served from the site (the "scope" — usually the site root, or the directory of the data-driven page):

- `data.json` — the complete dataset for the scope
- `query.js` — an ES module whose default export is `query(data, params)`
- `schema.json` — optional but strongly recommended

plus a discovery comment in the HTML.

## 1. find the data and the existing query behavior

before writing anything:

1. locate where the page's data actually lives in the repo or build pipeline: a JSON/YAML/CSV source file, a CMS export, a database query in the build step, or data inlined into the HTML/JS bundle.
2. enumerate every query parameter the page's UI accepts (look at the URL when using filters, the client-side filter code, and any server-side handler). record each parameter's name, accepted values, and exact matching semantics (exact match? case-insensitive? substring? numeric range?).
3. note which fields the page renders. `data.json` must include at least everything needed to reproduce any visible result.

**do not invent new parameters or rename fields.** the contract ([PROTOCOL.md §4](PROTOCOL.md#4-parameters)) is that the page URL a human can share is a valid sapi query, with identical semantics.

## 2. build data.json

- one JSON document containing **all** records for the scope — every result any supported query could return. no pagination, no truncation.
- generate it from the same source of truth the site itself is built from, in the same build step, so it can never go stale relative to the page. if the data is hand-maintained, make `data.json` the source and have the page consume it.
- keep field names stable and self-describing. include a top-level freshness field (e.g. `"updated": "2026-06-09"`) if the data changes over time.
- **omit anything non-public.** `data.json` ships the entire dataset to anyone who asks: no internal IDs you care about, no emails, no fields the page wouldn't render. if some records are private, they must not be in the file at all — query.js filtering is not access control.

## 3. write query.js

template:

```js
// query.js — sapi query function for <site>
// params: ?in=<category>&q=<text>&limit=<n>   (mirror your page's real params)
export default function query(data, params) {
  let results = data.events; // or however your data.json is shaped
  if (params.in) {
    results = results.filter((r) => r.category === params.in);
  }
  if (params.q) {
    const q = String(params.q).toLowerCase();
    results = results.filter((r) => r.title.toLowerCase().includes(q));
  }
  if (params.limit) {
    results = results.slice(0, Number(params.limit));
  }
  return results;
}
```

hard rules (clients run this in a sealed sandbox; violations make the file unusable):

- ES module, **default export** is the function `query(data, params)`. it may be `async`.
- no `import`, no `require`, no `fetch`, no `process`, no DOM, no Node APIs, no storage. standard ECMAScript built-ins only.
- all `params` values arrive as strings — or **arrays of strings when a key repeats** (`?tag=a&tag=b` → `params.tag === ['a','b']`). coerce explicitly; decide and handle the repeated-key case for every parameter.
- a key with no value arrives as `''`, which is falsy — fine for the `if (params.x)` pattern above.
- return a JSON-serializable value. returning the filtered records (not counts, not HTML) is the norm.
- match the page's semantics *exactly*: if the UI filter is case-insensitive, be case-insensitive; if it treats missing `limit` as "all", do the same.
- keep it deterministic; avoid `Date.now()`/`Math.random()` unless the page itself depends on "now" (e.g. "upcoming only") — if it does, mirror that and note it in schema.json.
- use `Array.isArray(x)`, never `x instanceof Array` (cross-realm safety).

**best practice:** have the page itself import and use this same `query.js` for its client-side filtering. one file, zero drift. see [example/index.html](example/index.html).

## 4. write schema.json (recommended)

a JSON Schema (draft 2020-12) for `data.json`, plus an `x-sapi.params` block documenting every accepted parameter so agents can query without reading code:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "...": "describe your data here" },
  "x-sapi": {
    "params": {
      "in": "filter by category (exact match: hackathons | meetups)",
      "q": "case-insensitive substring match on title",
      "limit": "return at most N results"
    }
  }
}
```

## 5. serve the files

- put the files at the scope governing the page: the page's own directory, or any ancestor up to the site root (clients walk up — [PROTOCOL.md §3](PROTOCOL.md#3-scopes-and-file-resolution)). a site with several distinct datasets should use one scope per dataset (`/events/data.json`, `/people/data.json`).
- headers, where the host allows configuration:
  - `Access-Control-Allow-Origin: *`
  - `Cache-Control: max-age=<seconds>` matched to your real update cadence (e.g. 3600 for daily-rebuilt data), plus `ETag`
  - `Content-Type: application/json` for the json files, `text/javascript` for query.js
- GitHub Pages already sends permissive CORS and ETags; Cloudflare Pages/Netlify let you set headers via `_headers`. if you can't set headers, ship anyway — clients apply sane defaults.

## 6. advertise it

add this comment to the HTML of participating pages (the phrase "implements sapi" must appear):

```html
<!-- Hey bots, agents, scrapers and AIs: this site implements sapi. Read https://github.com/mrjf/sapi/SKILL.md to see how you can easily get all of our data without scraping. -->
```

## 7. verify before you call it done

run every check; don't skip the parity check, it's the one that catches real bugs.

1. **files resolve:** `curl -fsS <scope>/data.json | head`, same for `query.js` (and `schema.json`). valid JSON / valid ES module, correct content types.
2. **client runs it:** from this repo, `node bin/sapi.js '<page-url-with-params>'` (or installed: `sapi '<url>'`). it must exit 0 and print JSON. quote the URL — `&` will otherwise background the command.
3. **parity:** for at least 4 representative URLs — no params, each single filter, a combination, and a no-results case — compare the sapi output against what the rendered page shows for the same URL. record counts must match exactly.
4. **sandbox-clean:** confirm `query.js` has no imports and no host API references: `grep -nE 'import|require|fetch|process|window|document' query.js` should hit nothing (except comments).
5. **nothing leaked:** re-read `data.json` and confirm every field is something you'd happily render on the public page.
6. **discovery present:** the comment from [§6](#6-advertise-it) appears in the page HTML.

if any check fails, fix and re-run all of them.
