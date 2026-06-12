// sapi adapter for basketball-reference.com player search.
// install: cp adapters/basketball-reference.js ~/.config/sapi/adapters/
// (or pass --adapter-dir adapters)
//
//   sapi 'https://www.basketball-reference.com/search/search.fcgi?search=robert+williams'
//
// returns an array of player objects. for each player, the full profile page
// is parsed structurally:
//   - name, url, years, knicknames (they're basketball players)
//   - meta: every labeled field in the bio box (position, shoots, born,
//     college, draft, nba_debut, experience, height, weight, ...)
//   - stats: every stat table on the page keyed by table id (per_game,
//     totals, advanced, playoffs_*, ...), one object per row keyed by
//     data-stat, numbers coerced. tables that basketball-reference ships
//     inside HTML comments (their lazy-load trick) are included.
// profile fetches are capped at 5 players (override with &limit=N).

const PROFILE_LIMIT = 5;

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,)])/g, '$1')
    .trim();
}

function coerce(value) {
  return /^-?(\d+(\.\d+)?|\.\d+)$/.test(value) ? Number(value) : value;
}

// search results: a sequence of <div class="search-item"> blocks, each with a
// link to the page and a label like "Robert Williams (2019-2026)"
function parseSearchItems(html, baseUrl) {
  const items = [];
  for (const chunk of html.split('<div class="search-item">').slice(1)) {
    const m = chunk.match(/<div class="search-item-name">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const url = new URL(m[1], baseUrl).href;
    if (!/\/players\//.test(url)) continue; // skip coaches, teams, etc.
    const label = stripTags(m[2]);
    const years = label.match(/\((\d{4}-\d{4})\)/)?.[1];
    items.push({ name: label.replace(/\s*\(\d{4}-\d{4}\)\s*$/, ''), url, years });
  }
  return items;
}

// the bio box: <p> elements of "<strong>Label:</strong> value" pairs (the
// colon can sit inside or outside the </strong>, several labels can share one
// <p> separated by ▪, and height/weight are unlabeled <span>s)
function parseMeta(html) {
  const start = html.indexOf('id="meta"');
  if (start === -1) return {};
  let slice = html.slice(start);
  for (const marker of ['class="stats_pullout"', 'id="inner_nav"', '<table']) {
    const end = slice.indexOf(marker);
    if (end !== -1) slice = slice.slice(0, end);
  }

  const meta = {};
  const fullName = slice.match(/<p>\s*<strong>\s*<strong>\s*([^<]+?)\s*<\/strong>/);
  if (fullName && !fullName[1].endsWith(':')) meta.full_name = fullName[1];

  for (const [, pHtml] of slice.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    for (const segment of pHtml.split('<strong>')) {
      const m = segment.match(/^\s*([^:<]+?)\s*(?::\s*(?:<\/strong>)+|(?:<\/strong>)+\s*:)([\s\S]*)/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const value = stripTags(m[2]).replace(/\s*[▪•]\s*$/, '').trim();
      if (key && value) meta[key] = value;
    }
  }

  const size = slice.match(/<p>\s*<span>(\d+-\d+)<\/span>[\s\S]{0,20}?<span>(\d+lb)<\/span>/);
  if (size) {
    meta.height = size[1];
    meta.weight = size[2];
  }
  const birth = slice.match(/data-birth="([^"]+)"/);
  if (birth) meta.born_date = birth[1];
  return meta;
}

// every stat table on the page, keyed by table id; each row is an object of
// data-stat -> value. basketball-reference ships most tables inside HTML
// comments, so unwrap those first.
function parseTables(html) {
  const unwrapped = html.replace(/<!--([\s\S]*?)-->/g, '$1');
  const tables = {};
  for (const [, tagAttrs, tableHtml] of unwrapped.matchAll(/<table([^>]*)>([\s\S]*?)<\/table>/g)) {
    // require whitespace before id=: greedy matching would otherwise grab
    // attributes like data-soc-sum-entity-id="williro04" as the table id
    const id = tagAttrs.match(/\sid="([^"]+)"/)?.[1];
    if (!id) continue;
    const body = tableHtml.replace(/<thead[\s\S]*?<\/thead>/g, '');
    const rows = [];
    for (const [, trAttrs, rowHtml] of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
      if (/class="[^"]*thead/.test(trAttrs)) continue; // mid-table header rows
      const row = {};
      for (const [, attrs, cell] of rowHtml.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)) {
        const stat = attrs.match(/data-stat="([^"]+)"/)?.[1];
        if (!stat) continue;
        const value = stripTags(cell);
        if (value !== '') row[stat] = coerce(value);
      }
      if (Object.keys(row).length) rows.push(row);
    }
    if (rows.length) tables[id] = rows;
  }
  return tables;
}

// player page: name in <h1><span>, nicknames in the first parenthesized <p>
// of the bio box, then the structured meta fields and every stat table
function parseProfile(html) {
  const profile = {};
  const name = html.match(/<h1[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/);
  if (name) profile.name = stripTags(name[1]);

  const afterName = name ? html.slice(html.indexOf(name[0])) : html;
  const nick = afterName.match(/<p[^>]*>\s*\(([^)<]+)\)\s*<\/p>/);
  if (nick) profile.knicknames = stripTags(nick[1]).split(/\s*,\s*/);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (canonical) profile.url = canonical[1];

  profile.meta = parseMeta(html);
  profile.stats = parseTables(html);
  return profile;
}

export default {
  name: 'basketball-reference',
  pattern: '^https://www\\.basketball-reference\\.com/search/search\\.fcgi',

  async query(url, { params, fetch }) {
    const { status, body } = await fetch(url);
    if (status !== 200) {
      throw new Error(`basketball-reference returned ${status} for ${url}`);
    }

    // a unique match 302s straight to the player page
    if (!body.includes('class="search-item"')) {
      const profile = parseProfile(body);
      return profile.name ? [profile] : [];
    }

    let items = parseSearchItems(body, url);
    // rank exact name matches ahead of the site's fuzzy matches
    // ("robert williams" should surface Robert Williams before Ron Williams)
    if (params.search) {
      const needle = String(params.search).toLowerCase().trim();
      items = [
        ...items.filter((i) => i.name.toLowerCase() === needle),
        ...items.filter((i) => i.name.toLowerCase() !== needle),
      ];
    }
    const limit = Math.max(1, Number(params.limit) || PROFILE_LIMIT);
    return Promise.all(
      items.slice(0, limit).map(async (item) => {
        try {
          const res = await fetch(item.url);
          if (res.status !== 200) return item;
          return { ...item, ...parseProfile(res.body), url: item.url };
        } catch {
          return item; // profile fetch failed; the search result alone is still useful
        }
      }),
    );
  },
};
