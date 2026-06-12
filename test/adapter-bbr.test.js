// Offline tests for the basketball-reference adapter: the adapter receives
// fetch as a parameter, so we stub it with fixture HTML — no network.
// Fixtures mirror the site's real markup quirks: nicknames in a bare
// parenthesized <p>, the colon inside or outside </strong>, unlabeled
// height/weight spans, stat tables shipped inside HTML comments, and table
// tags carrying data-soc-sum-entity-id (which once hijacked the table id).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import adapter from '../adapters/basketball-reference.js';

const SEARCH_URL = 'https://www.basketball-reference.com/search/search.fcgi?search=robert+williams';

const SEARCH_HTML = `
<html><body><div id="players">
<div class="search-item">
  <div class="search-item-name"><a href="/players/w/williro01.html">Ron Williams (1969-1976)</a></div>
</div>
<div class="search-item">
  <div class="search-item-name"><a href="/players/w/williro04.html">Robert Williams (2019-2026)</a></div>
</div>
<div class="search-item">
  <div class="search-item-name"><a href="/coaches/smithjo99c.html">Joe Smith (1990-1995)</a></div>
</div>
</div></body></html>`;

const ROBERT_HTML = `
<html><head>
<link rel="canonical" href="https://www.basketball-reference.com/players/w/williro04.html">
</head><body>
<div id="meta">
<div><h1>
  <span>Robert Williams</span>
</h1>
<p>
  <strong>
  <strong>Robert Lee Williams III</strong>
  </strong>
  &#9642;
  Instagram: <a href="https://instagram.com/williams.lll">williams.lll</a>
</p>
<p>
(Time Lord, Timelord, Boo Butt, Lob Williams)
</p>
<p>
  <strong>
  Position:
  </strong>
  Center
  &#9642;
  <strong>
  Shoots:
  </strong>
  Right
</p>
<p><span>6-9</span>,&nbsp;<span>249lb</span>&nbsp;(206cm,&nbsp;112kg) </p>
<p><strong>Team</strong>: <a href='/teams/POR/2026.html'>Portland Trail Blazers</a></p>
<p>
  <strong>Born: </strong>
  <span id="necro-birth" data-birth="1997-10-17">
    <a href='/friv/birthdays.fcgi?month=10&day=17'>October 17</a>,
    <a href='/friv/birthyears.fcgi?year=1997'>1997</a>
  </span>
  <span>in&nbsp;Shreveport, <a href='/friv/birthplaces.fcgi?state=LA'>Louisiana</a></span>
</p>
<p><strong>Draft:</strong> <a href="/teams/BOS/draft.html">Boston Celtics</a>, 1st round (27th pick, 27th overall), <a href="/draft/NBA_2018.html">2018 NBA Draft</a></p>
</div></div>
<div class="stats_pullout"><p>not meta</p></div>
<!--
<table class="stats_table sortable row_summable suppress_headers soc" id="per_game_stats" data-cols-to-freeze="1,3"data-soc-sum-entity-id="williro04">
<thead><tr><th data-stat="year_id">Season</th><th data-stat="pts_per_g">PTS</th></tr></thead>
<tbody>
<tr><th data-stat="year_id">2018-19</th><td data-stat="pts_per_g">2.5</td><td data-stat="fg_pct">.776</td></tr>
<tr class="thead"><th data-stat="year_id">Season</th></tr>
<tr><th data-stat="year_id">2021-22</th><td data-stat="pts_per_g">10.0</td><td data-stat="fg_pct">.736</td></tr>
</tbody>
</table>
-->
</body></html>`;

const RON_HTML = `
<html><body>
<div id="meta"><div><h1><span>Ron Williams</span></h1>
<p>
(Fritz)
</p>
<p><strong>Position:</strong> Point Guard &#9642; <strong>Shoots:</strong> Right</p>
<p><span>6-3</span>,&nbsp;<span>185lb</span>&nbsp;(190cm,&nbsp;83kg) </p>
</div></div>
</body></html>`;

const PROFILES = {
  'https://www.basketball-reference.com/players/w/williro01.html': RON_HTML,
  'https://www.basketball-reference.com/players/w/williro04.html': ROBERT_HTML,
};

function fakeFetch(routes) {
  return async (url) => {
    const body = routes[url];
    return body === undefined ? { status: 404, body: 'not found' } : { status: 200, body };
  };
}

test('matches search urls with and without a query string', () => {
  const re = new RegExp(adapter.pattern);
  assert.ok(re.test(SEARCH_URL));
  assert.ok(re.test('https://www.basketball-reference.com/search/search.fcgi'));
  assert.ok(!re.test('https://www.basketball-reference.com/players/w/williro04.html'));
  assert.ok(!re.test('https://example.com/search/search.fcgi?search=x'));
});

test('parses search results and enriches with full structured profiles', async () => {
  const players = await adapter.query(SEARCH_URL, {
    params: { search: 'robert williams' },
    fetch: fakeFetch({ [SEARCH_URL]: SEARCH_HTML, ...PROFILES }),
  });
  assert.equal(players.length, 2, 'coach result must be filtered out');

  // exact name match ranks first despite site order
  const [robert, ron] = players;
  assert.equal(robert.name, 'Robert Williams');
  assert.equal(robert.years, '2019-2026');
  assert.equal(robert.url, 'https://www.basketball-reference.com/players/w/williro04.html');
  assert.deepEqual(robert.knicknames, ['Time Lord', 'Timelord', 'Boo Butt', 'Lob Williams']);

  // the whole bio box, structured
  assert.deepEqual(robert.meta, {
    full_name: 'Robert Lee Williams III',
    position: 'Center',
    shoots: 'Right',
    team: 'Portland Trail Blazers',
    born: 'October 17, 1997 in Shreveport, Louisiana',
    draft: 'Boston Celtics, 1st round (27th pick, 27th overall), 2018 NBA Draft',
    height: '6-9',
    weight: '249lb',
    born_date: '1997-10-17',
  });

  // stat table extracted from inside the HTML comment, keyed by its real id
  // (not the data-soc-sum-entity-id), header rows dropped, numbers coerced
  assert.deepEqual(Object.keys(robert.stats), ['per_game_stats']);
  assert.deepEqual(robert.stats.per_game_stats, [
    { year_id: '2018-19', pts_per_g: 2.5, fg_pct: 0.776 },
    { year_id: '2021-22', pts_per_g: 10.0, fg_pct: 0.736 },
  ]);

  assert.deepEqual(ron.knicknames, ['Fritz']);
  assert.equal(ron.meta.position, 'Point Guard');
  assert.equal(ron.meta.height, '6-3');
});

test('the readme jq selection finds time lord', async () => {
  const players = await adapter.query(SEARCH_URL, {
    params: { search: 'robert williams' },
    fetch: fakeFetch({ [SEARCH_URL]: SEARCH_HTML, ...PROFILES }),
  });
  // equivalent of: jq '[.[] | select(has("knicknames"))][0].knicknames'
  const first = players.filter((p) => 'knicknames' in p)[0];
  assert.deepEqual(first.knicknames, ['Time Lord', 'Timelord', 'Boo Butt', 'Lob Williams']);
});

test('a unique match that redirects straight to a profile still works', async () => {
  const players = await adapter.query(SEARCH_URL, {
    params: { search: 'robert williams' },
    fetch: fakeFetch({ [SEARCH_URL]: ROBERT_HTML }),
  });
  assert.equal(players.length, 1);
  assert.equal(players[0].name, 'Robert Williams');
  assert.equal(players[0].url, 'https://www.basketball-reference.com/players/w/williro04.html');
  assert.deepEqual(players[0].knicknames, ['Time Lord', 'Timelord', 'Boo Butt', 'Lob Williams']);
});

test('a failed profile fetch degrades to the bare search result', async () => {
  const players = await adapter.query(SEARCH_URL, {
    params: { search: 'robert williams' },
    fetch: fakeFetch({ [SEARCH_URL]: SEARCH_HTML }), // profiles all 404
  });
  assert.equal(players.length, 2);
  assert.equal(players[0].name, 'Robert Williams');
  assert.ok(!('knicknames' in players[0]));
});
