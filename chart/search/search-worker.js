// The search module in a web worker, so loading the index never blocks the chart:
//   const w = new Worker(new URL("search-worker.js", import.meta.url), { type: "module" });
//   w.postMessage({ id: 1, type: "load", url: "data/tiles/greater-boston-search-v8.json.gz", packUrl: "chart/lingo/lingo-pack.json" });
//   w.postMessage({ id: 2, type: "search", q: "12 elm st", near: [lon, lat], opts: { limit: 8 } });
//   w.postMessage({ id: 3, type: "inbox", kinds: ["tardis"], bbox: [w, s, e, n] });   // W54 course: the stops along a course
//   w.postMessage({ id: 5, type: "nearest", kind: "spot", what: "Post office", near: [lon, lat], limit: 8 });   // W112 kindsearch
//   w.onmessage = ({ data }) => ...   // { id, type: "loaded", size } | { id, type: "results", results } | { id, type: "error", message }
// "load" also takes `file` (a Blob or File, such as the one in OPFS) instead of `url`, and `pack`
// instead of `packUrl`. A search sent before the load finishes waits for it.
// W82 packui (SPEC §156): "load" also takes `gazetteer`, the URL of the statewide gazetteer (chart/search/gazetteer.json), and
//   w.postMessage({ id: 4, type: "packs", packs: [{ id: "central", key: sha256, file }] });   // -> { id, type: "loaded", packs: n }
// gives the stored map packs' indexes (each replaces the last list). A search then asks the base's index, every pack's and the
// gazetteer's, merged by score with one entry per name within 100 m (one per town's name), a town or village named in full
// just after the best match (search.js searchAll).
// W238 feeddocks (design/app-ui/SPEC.md §501): search finds what the map draws (§308). With Bluebikes' stations on the map (app/feed-docks.js)
//   w.postMessage({ id: 6, type: "docks", docks: [{ id, name, full, ll }] });   // -> { id, type: "loaded", docks: n }; null or [] for none
// gives them (each replaces the last list): an index of their own (dockIndex), found by their names and by the docks' kind words ("bluebikes",
// "bike share", "klingon dock") as the index's docks were, by the same search, after the merged rows of every other kind (as the docks of one index,
// so a station named as the square it stands at is still found), in place of the index's
// and the packs' docks (OSM's), which the map no longer draws; a kind's nearest ("nearest", klingon_dock) are theirs too.
import { loadBlob, loadUrl, use, search, inBox, mergeResults, searchAll, load } from "./search.js"; // W54 course: inBox; W82 packui: mergeResults, searchAll; W238 feeddocks: load

let ready = Promise.reject(new Error("search: no index loaded"));
ready.catch(() => {});
let lingo = null, gaz = null, packs = new Map(), packsSent = 0; // W82 packui: the lingo pack, the gazetteer's index, pack id -> its index, and the last "packs" message's number
let docks = null; // W238 feeddocks: Bluebikes' stations the map draws, as an index (dockIndex), or null: the index's own docks
const DOCK = "klingon_dock"; // W238 feeddocks: search.js's
/** W238 feeddocks: the place a row of a station says ("Back Bay, Boston", as the index's docks): the nearest of the indexes' places of kinds
 *  that stand on a point and say their neighbourhood (a dock, water, a rack...) within PLACE_M, else none. A line that carries a fact of its
 *  own, before a " · " (search.js result: a covered rack's "Covered · Seaport, Boston", or "Covered · Alewife Brook Pkwy, Cambridge", its
 *  street), is never borrowed, of whatever kind: the nearest is then the station's town alone (its line's last part, "Boston"), or the next
 *  nearest's neighbourhood when that is in the same town, so a station's line is a neighbourhood or a town and never crosses a town line
 *  (Encore, Everett's: its rack, then Assembly station across the Mystic in Somerville: "Everett"). */
const PLACE_KINDS = [DOCK, "coolant", "anchorage", "tardis", "temple_of_knowledge", "comet_station", "constellation", "aed", "gantry", "shore_leave"], PLACE_M = 500;
const townOf = (line) => line.split(" · ").pop().split(", ").pop(); // W238 feeddocks third fix pass
function placeNear(idxs, ll) {
  const near = idxs.flatMap((x) => PLACE_KINDS.flatMap((k) => x.nearest(k, null, ll, 1))).filter((r) => r.place && r.distance_m <= PLACE_M).sort((a, b) => a.distance_m - b.distance_m);
  const plain = near.find((r) => !r.place.includes(" · "));
  if (!near.length || near[0] === plain) return plain?.place ?? null;
  const town = townOf(near[0].place); // the nearest carries a fact: its town, and the next one's neighbourhood only inside it
  return plain && townOf(plain.place) === town ? plain.place : town;
}
/** W238 feeddocks: stations `list` ([{ id, name, full, ll }], each named as the map names it, `full` Bluebikes' whole name) as an index of docks of their own (search.js load), its rows
 *  placed by placeNear of `idxs()`, the base's and the packs' then, at Bluebikes' own place; a row's place worked out when a search first
 *  returns it, so the list costs the first search almost nothing, and kept once found; a station with none is asked again only once the packs
 *  are others (`packsOf()`, a new "packs" message), so a pack stored after the list (Salem's, the north pack) gives its stations theirs. */
function dockIndex(list, idxs, packsOf) {
  const x = list.map((d) => Math.round(d.ll[0] * 1e5)), y = list.map((d) => Math.round(d.ll[1] * 1e5)), delta = (a) => a.map((v, i) => v - (i ? a[i - 1] : 0));
  const idx = load({ format: "starchart-search", version: 1, kinds: [DOCK], name: list.map((d) => d.name || ""), kind: list.map(() => 0), x: delta(x), y: delta(y),
    rank: list.map(() => 0), town: list.map(() => -1), quad: list.map(() => -1), alt: Object.fromEntries(list.flatMap((d, i) => (d.full && d.full !== d.name ? [[i, d.full]] : []))) }, lingo); // rank 0, as the index's docks; alt, Bluebikes' whole name, so one of two of a name in one cell (Salem MBTA's, 85 m apart: one row) is found by it
  const own = new Map(list.map((d, i) => [`${x[i]},${y[i]}`, { lonlat: d.ll }])), at = (r) => own.get(`${Math.round(r.lonlat[0] * 1e5)},${Math.round(r.lonlat[1] * 1e5)}`);
  const placeOf = (o) => (o.place != null || o.packs === packsOf() ? o.place : Object.assign(o, { place: placeNear(idxs(), o.lonlat), packs: packsOf() }).place); // once a station, when first returned; none, again once the packs change
  const placed = (rs) => rs.map((r) => { const o = at(r); return o ? { ...r, place: placeOf(o) ?? r.place, lonlat: o.lonlat } : r; }); // Bluebikes' own place, not the index's 1e-5 degree grid
  return { ...idx, search: (...a) => placed(idx.search(...a)), nearest: (...a) => placed(idx.nearest(...a)), inBox: (...a) => placed(idx.inBox(...a)) };
}
/** W238 feeddocks: an index without its docks, while the stations are Bluebikes' own. */
const noDocks = (x) => ({ ...x, search: (...a) => x.search(...a).filter((r) => r.kind !== DOCK), nearest: (k, ...a) => (k === DOCK ? [] : x.nearest(k, ...a)) });

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "load") {
      ready = (async () => {
        const pack = lingo = m.pack || await (await fetch(m.packUrl)).json(); // W82 packui: lingo
        if (m.gazetteer) gaz = await loadUrl(m.gazetteer, pack).catch(() => null); // W82 packui: a build without it still searches
        return use(m.file ? await loadBlob(m.file, pack) : await loadUrl(m.url, pack));
      })();
      const idx = await ready;
      self.postMessage({ id: m.id, type: "loaded", size: idx.size, houses: idx.houses, built: idx.built, choices: idx.choices }); // W112 kindsearch: choices
    } else if (m.type === "search") {
      await ready;
      const all = docks ? [await ready, ...packs.values()].map(noDocks) : [await ready, ...packs.values()]; // W238 feeddocks: Bluebikes' stations for the indexes' docks
      const rows = docks || packs.size || gaz ? searchAll(all, gaz, m.q, m.near ?? null, m.opts ?? {}) : search(m.q, m.near ?? null, m.opts ?? {}); // W82 packui: searchAll; W238 feeddocks: all
      const limit = m.opts?.limit ?? 10; // W238 feeddocks
      self.postMessage({ id: m.id, type: "results", results: docks && rows.length < limit ? [...rows, ...searchAll([docks], null, m.q, m.near ?? null, m.opts ?? {})].slice(0, limit) : rows }); // W238 feeddocks: the stations after every other kind, as one index's docks, never dropped as another index's of the same name (mergeResults); not asked when the other kinds fill the rows
    } else if (m.type === "inbox") { // W54 course: the places of some kinds in a box, for the stops along a course
      await ready;
      self.postMessage({ id: m.id, type: "results", results: packs.size ? mergeResults([inBox(m.kinds, m.bbox), ...[...packs.values()].map((p) => p.inBox(m.kinds, m.bbox))], Infinity) : inBox(m.kinds, m.bbox) }); // W82 packui: and the packs'
    } else if (m.type === "nearest") { // W112 kindsearch: a kind's (or a class's) places nearest a point, the base's and the packs'
      const all = (docks ? [...[await ready, ...packs.values()].map(noDocks), docks] : [await ready, ...packs.values()]).flatMap((x) => x.nearest(m.kind, m.what, m.near, m.limit)); // W112 kindsearch; W238 feeddocks: Bluebikes' stations for the docks
      self.postMessage({ id: m.id, type: "results", results: all.sort((a, b) => a.distance_m - b.distance_m).slice(0, m.limit) }); // W112 kindsearch
    } else if (m.type === "docks") { // W238 feeddocks
      const base = await ready;
      docks = m.docks?.length ? dockIndex(m.docks, () => [base, ...packs.values()], () => packs) : null; // the packs when a place is asked for: they come after the list at the start (app/course.js)
      self.postMessage({ id: m.id, type: "loaded", docks: docks?.size ?? 0 });
    } else if (m.type === "packs") { // W82 packui
      const n = ++packsSent; // W82 packui: a slower, older list (a pack's, then Remove's) doesn't replace a newer one
      await ready.catch(() => {}); // W82 packui: lingo
      const next = new Map(); // W82 packui
      for (const p of m.packs) next.set(p.id, packs.get(p.id)?.key === p.key ? packs.get(p.id) : Object.assign(await loadBlob(p.file, lingo), { key: p.key })); // W82 packui: one at a time; key, its file's hash
      if (n === packsSent) packs = next; // W82 packui
      self.postMessage({ id: m.id, type: "loaded", packs: packs.size }); // W82 packui
    }
  } catch (e) {
    self.postMessage({ id: m.id, type: "error", message: e.message });
  }
};
