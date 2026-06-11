// sapi query function for the example events site.
// Pure ECMAScript, no imports, no host APIs — see PROTOCOL.md §2.2.
// The same params the page UI accepts: ?in=<category>&city=<city>&q=<text>&limit=<n>
export default function query(data, params) {
  let events = data.events;
  if (params.in) {
    events = events.filter((e) => e.category === params.in);
  }
  if (params.city) {
    const city = String(params.city).toLowerCase();
    events = events.filter((e) => e.city.toLowerCase() === city);
  }
  if (params.q) {
    const q = String(params.q).toLowerCase();
    events = events.filter((e) => e.title.toLowerCase().includes(q));
  }
  if (params.limit) {
    events = events.slice(0, Number(params.limit));
  }
  return events;
}
