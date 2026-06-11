# the sapi protocol

version 0.1 (draft)

sapi (staticAPI) is a convention for making a website's data queryable locally. a site publishes its full dataset and its query logic as static files; a client downloads them once, caches them, and runs queries on its own machine. the page URL — query string and all — *is* the API call.

the key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, MAY are to be interpreted as described in RFC 2119.

## 1. terms

- **publisher** — the site implementing sapi.
- **client** — software (a CLI, an agent, a browser script) that queries a sapi site.
- **page URL** — any URL of the site, including its query string, e.g. `https://example.com/events/?in=hackathons&zip=94108`.
- **scope** — a directory path on the site at which the sapi files are published. every page is governed by exactly one scope (see §3).
- **sapi files** — the files below, served at `<scope>/data.json` etc.

## 2. the files

| file | required | contents |
|---|---|---|
| `data.json` | REQUIRED | all the data for the scope, as one JSON document |
| `query.js` | REQUIRED | the query function to run against the data |
| `schema.json` | OPTIONAL | a schema describing `data.json` |

a scope **implements sapi** if and only if both `data.json` and `query.js` are served from it with status 200.

### 2.1 data.json

- MUST be a single valid JSON document, UTF-8 encoded. any JSON value is allowed; an object or an array of records is typical.
- MUST contain the complete dataset for its scope: every result any supported query could return must be derivable from it. there is no pagination and no partial transfer — that is the point of the protocol.
- SHOULD be served with `Content-Type: application/json`.
- field names SHOULD be stable across regenerations; clients will cache and build against them.

### 2.2 query.js

the query function, as an ECMAScript module.

- MUST be a valid ES module whose **default export** is the query function. clients MAY additionally accept a named export `query` for leniency, but publishers MUST provide the default export.
- the function signature is `query(data, params)`:
  - `data` — the parsed `data.json` document.
  - `params` — an object built from the page URL's query string (§4).
- MAY be an `async` function; clients MUST await its result.
- MUST return a JSON-serializable value (the query result).
- MUST be self-contained:
  - MUST NOT use `import` (static or dynamic) or `require`.
  - MUST NOT perform I/O of any kind — no network, filesystem, storage, or environment access.
  - MUST NOT rely on host APIs (Node, browser, or otherwise). only standard ECMAScript built-ins (`JSON`, `Math`, `Array`, `Intl`, …) may be used. clients run it in an isolated realm where nothing else exists.
- SHOULD be deterministic: the same `(data, params)` SHOULD produce the same result. avoid `Date.now()` and `Math.random()` unless the page's own behavior genuinely depends on them.
- SHOULD use realm-safe idioms — e.g. `Array.isArray(x)` rather than `x instanceof Array` — because clients may pass values created in another realm.
- because it is plain ECMAScript, the publisher MAY (and is encouraged to) use the very same file in the site's own front end, so the published query logic can never drift from the page's behavior.

### 2.3 schema.json

- OPTIONAL. when present, it SHOULD be a JSON Schema (draft 2020-12) describing `data.json`.
- publishers SHOULD document the accepted query parameters under a top-level `"x-sapi": { "params": { "<name>": "<description>", … } }` annotation, so agents can construct queries without reading `query.js`.

## 3. scopes and file resolution

the sapi files for a page live in the page's directory or one of its ancestors. a site MAY publish different datasets at different scopes (e.g. `/events/` and `/people/`), and a single-page site simply publishes at the root.

given a page URL, a client MUST resolve the governing scope as follows:

1. take the page URL's path; if it does not end in `/`, truncate it to its containing directory.
2. request `<scope>data.json` at that directory.
3. on a non-200 response, move up one directory and repeat, until the origin root has been tried.
4. the first scope where `data.json` returns 200 **and parses as JSON** is the governing scope. (the parse check guards against single-page-app hosts that answer every path with the index.html fallback and status 200.) `query.js` (and `schema.json`, if published) MUST then be taken from that same scope; if `query.js` is missing there, the scope does not implement sapi and resolution MUST NOT continue upward.

## 4. parameters

the query parameters of a sapi call are exactly the query parameters of the page URL. publishers MUST make `query.js` accept the same parameter names and semantics that the page's human-facing UI accepts, so that any URL a person can share is a valid sapi query for the same results.

clients MUST build the `params` object from the page URL's query string with standard `application/x-www-form-urlencoded` decoding (the semantics of `URLSearchParams`):

- each key maps to its decoded string value.
- a key that appears more than once maps to an array of its decoded string values, in document order.
- a key with no value (`?flag` or `?flag=`) maps to the empty string.
- all values are strings (or arrays of strings); `query.js` is responsible for any coercion to numbers, booleans, etc.

## 5. discovery

a publisher who wants the implementation to be discoverable SHOULD include, in the HTML of participating pages, a comment containing the phrase `implements sapi` (case-insensitive) and a URL where the protocol is described:

```html
<!-- Hey bots, agents, scrapers and AIs: this site implements sapi. Read https://github.com/mrjf/sapi/SKILL.md to see how you can easily get all of our data without scraping. -->
```

clients MAY detect sapi support by matching `/implements sapi/i` in a page's HTML, and MAY also simply probe for the files per §3 without fetching the page at all.

## 6. HTTP requirements

publishers:

- SHOULD serve all sapi files with `Access-Control-Allow-Origin: *`, so browser-based clients can use them.
- SHOULD serve `Cache-Control: max-age=<seconds>` reflecting how often the data actually changes, and an `ETag`, so clients can cache aggressively and revalidate cheaply.
- SHOULD serve the files compressed (gzip or brotli) when the host supports it.

clients:

- MUST cache fetched sapi files and honor `Cache-Control: max-age`. when the server sends no freshness information, clients MUST apply a default freshness lifetime of 300 seconds.
- SHOULD revalidate expired entries with `If-None-Match` when an `ETag` was provided.
- SHOULD send an identifying `User-Agent` (e.g. `sapi/0.1.0`).
- SHOULD serve stale cached content rather than failing when the origin is unreachable.

## 7. client execution requirements

`query.js` is remote code. a conforming client:

- MUST execute it in an isolated environment exposing only standard ECMAScript intrinsics — no module imports, no network, no filesystem, no process/environment access.
- SHOULD enforce an execution timeout.
- SHOULD treat language-level sandboxing as best-effort, and give users a way to read the source before or instead of running it (e.g. `sapi --query-src`). a cautious client MAY skip execution entirely: fetch `data.json` and write its own query logic.
- MUST NOT persist or reuse any state produced by one execution in another.

## 8. adapters (non-normative)

adapters are a client-side extension for sites that do *not* implement sapi: locally installed modules, each with a URL pattern, that fetch and parse a matching site into JSON so it can be queried with the same ergonomics. adapters are user-installed trusted code and are outside the on-the-wire protocol; nothing in this section constrains publishers. the reference client loads them from `~/.config/sapi/adapters/`:

```js
export default {
  name: 'basketball-reference',
  pattern: '^https://www\\.basketball-reference\\.com/',
  async query(url, { params, fetch }) {
    // fetch page(s), parse, return JSON
  },
};
```

## 9. security considerations

- executing fetched `query.js` is executing someone else's code. §7's isolation requirements are mandatory, but JavaScript-level isolation has a history of escapes; defense in depth (OS-level sandboxing, containers) is encouraged for clients embedded in larger systems.
- `data.json` is attacker-controlled input to whatever consumes the query result. treat results as untrusted data: no `eval`, no HTML injection, schema-validate if it matters.
- a hostile `query.js` can busy-loop (mitigated by timeouts) or return enormous results (clients MAY cap result size).
- publishers should remember that `data.json` is the *whole* dataset: do not include fields you would not render publicly — the protocol removes the obscurity of HTML, not the need for access control.

## 10. versioning

this is sapi protocol version 0.1. the protocol carries no version marker on the wire; future versions that change file names, resolution, or the query contract will introduce explicit markers. anything not specified here (notably: the shape of `data.json` and the meaning of parameters) is the publisher's contract with their users, documented via `schema.json`.
