// W238 feeddocks (design/app-ui/SPEC.md §501), her row 5 of 11-14: "Bluebikes stations ... should all appear at the same zoom level, and only if
// the transit layer is enabled, because they are transit. Of course they should appear when they are included in a planned or active route."
// W234 places2 built that on the map's own docks, which are OSM's: they lack one Bluebikes station in three (196 of the 597 inside the map on
// 2026-11-15, 146 of them in Boston proper) and sit apart from Bluebikes' own place, where a route's ring is (a median 5.5 m, Davis Square 29.7 m).
//
// - With Consider Bluebikes on and Bluebikes' station list kept on this phone (app/bikeshare.js: fetched under that switch alone, again at most once
//   a day, used offline at any age), the map's dock layers (bus-stops.js DOCK_LAYERS: the same layers, so the same sign, zoom, overlap, place in
//   the collisions, words, theme, ride twin and card) read Bluebikes' stations (FEED_SOURCE, a GeoJSON source of the app's own) in place of the
//   tiles' docks, which then draw nothing (none doubled; the few other networks' docks in OSM go with them, which Plain called "Bluebikes station"
//   too): every station Bluebikes lists but one its last known counts say isn't installed (bikeshare.js listedOf), at Bluebikes' place, by the
//   name a route's card gives it (walk-card.js shortDock), wherever it is (no cut at the map's edge, as a route's ring has none), with Bluebikes'
//   station_id, by which a route's own are drawn (bus-stops.js idsFilter).
// - Before the map is made (feedStyle, app/main.js, as anchorages.js outsideFile), when the list is kept: the first frame draws them. With no list
//   the style is the tiles', to the pixel. Once the map is made it changes over (swap) when the list first comes or the switch is flipped; a new
//   list or new counts set the source's data only where the stations drawn changed (a daily list that changes nothing draws nothing anew).
// - Nothing per frame, idle or move, and nothing fetched: the list is bikeshare.js's, under its switch.
import { DOCK_LAYERS, FEED_SOURCE } from "./bus-stops.js";
import { shortDock } from "./walk-card.js";
import { KEY } from "./bikeshare.js";

export { FEED_SOURCE };
/** The stations `list` ([{ id, name, ll }], bikeshare.js listedOf) as the map's features: the tiles' docks' kind and rank (their layers' icon and sort
 *  key), the name as a route's card says it (shortDock: before " - " and " / "), Bluebikes' station_id. */
export const featuresOf = (list) => ({ type: "FeatureCollection", features: (list || []).map(({ id, name, ll }) => ({ type: "Feature",
  properties: { kind: "klingon_dock", ...(shortDock(name) && { name: shortDock(name) }), station_id: String(id), rank: 8 }, geometry: { type: "Point", coordinates: ll } })) });
/** A filter without the map's edge (the tiles' `within`, which packmap.js withinBoxes widens for the stored packs). */
const noEdge = (f) => (f?.[0] === "within" ? true : f?.[0] === "all" ? f.filter((t, i) => !i || t?.[0] !== "within") : f);
const tiles = {}; // each dock layer's own source, source layer and filter in the style, to go back to
let now = null; // the stations drawn from the list, as the map names them, or null: the tiles'
/** The stations the map draws from Bluebikes' list, [{ id, name, full, ll }] named as the map names them (`full`: Bluebikes' whole name), or null while it draws the tiles' docks: what
 *  search finds in place of the index's docks (app/course.js, chart/search/search-worker.js "docks"; SPEC §308, search finds what the map draws).
 *  A change is told by the event "starchart:feeddocks". */
export const drawnList = () => now;
const listOf = (fc, l) => { const full = new Map((l || []).map((d) => [String(d.id), d.name])); // second fix pass: Bluebikes' whole name (`l`'s), for search
  return fc.features.map((f) => ({ id: f.properties.station_id, name: f.properties.name ?? "", full: full.get(f.properties.station_id) ?? f.properties.name ?? "", ll: f.geometry.coordinates })); };
/** A dock layer of the style (`l`, changed in place) on Bluebikes' list, or back on the tiles. */
const toFeed = (l) => { tiles[l.id] ??= { source: l.source, "source-layer": l["source-layer"], filter: l.filter }; delete l["source-layer"]; return Object.assign(l, { source: FEED_SOURCE, filter: noEdge(tiles[l.id].filter) }); };
const toTiles = (l) => Object.assign(l, tiles[l.id] ?? {});

/** Before the map is made: with `list` (bikeshare.js listedNow), the style's dock layers read it, in a source of their own. Returns `style`. */
export function feedStyle(style, list) {
  if (!list) return style;
  style.sources[FEED_SOURCE] = { type: "geojson", data: featuresOf(list) };
  now = listOf(style.sources[FEED_SOURCE].data, list);
  for (const l of style.layers) if (DOCK_LAYERS.includes(l.id)) toFeed(l);
  return style;
}

/**
 * Mount it on `map`, made with `style` (feedStyle's). `list()` is the stations to draw or null (bikeshare.js `listed`); sync() after a new list or new
 * counts are kept (bikeshare.js onKept), and by itself when the switch is flipped. `after()` once the layers changed over (main.js: her trip's docks'
 * filter, bus-stops.js again, and a stored pack's edge, drawPacks). Returns { sync, stats }.
 */
export function mountFeedDocks({ map, style, list, after = () => {} }) {
  const stats = { sets: 0, swaps: 0, n: 0 }; // for tests: the source's data set, the layers changed over, the stations drawn
  const key = (fc) => JSON.stringify(fc.features);
  let drawn = style.sources[FEED_SOURCE] ? key(style.sources[FEED_SOURCE].data) : null; // the stations drawn from the list, or null: the tiles'
  stats.n = drawn ? style.sources[FEED_SOURCE].data.features.length : 0; now = drawn ? listOf(style.sources[FEED_SOURCE].data, list()) : null;
  function swap(on) { // each dock layer again in its place, as it is now (its icon, words, paint, visibility), on the list or the tiles
    const order = map.getLayersOrder(), specs = map.getStyle().layers;
    for (const id of DOCK_LAYERS) {
      const S = style.layers.find((l) => l.id === id), { "source-layer": sl, ...L } = specs.find((l) => l.id === id) ?? {};
      if (!S || !L.id) continue;
      if (on) toFeed(S); else toTiles(S);
      const before = order.slice(order.indexOf(id) + 1).find((b) => map.getLayer(b));
      map.removeLayer(id);
      map.addLayer({ ...L, source: S.source, ...(S["source-layer"] && { "source-layer": S["source-layer"] }), filter: S.filter }, before);
    }
    stats.swaps++;
  }
  function sync() {
    if (!map.getStyle()) { map.once("style.load", sync); return; } // a lost WebGL context: once its style is back
    const l = list(), fc = l && featuresOf(l), k = fc && key(fc);
    if (k === drawn) return;
    if (fc) { if (map.getSource(FEED_SOURCE)) map.getSource(FEED_SOURCE).setData(fc); else map.addSource(FEED_SOURCE, { type: "geojson", data: fc }); stats.sets++; }
    const over = !fc !== !drawn;
    if (over) swap(!!fc);
    if (!fc && map.getSource(FEED_SOURCE)) map.removeSource(FEED_SOURCE);
    if (fc) style.sources[FEED_SOURCE] = { type: "geojson", data: fc }; else delete style.sources[FEED_SOURCE];
    drawn = k; stats.n = fc ? fc.features.length : 0; now = fc ? listOf(fc, l) : null;
    if (over) after();
    globalThis.dispatchEvent?.(new CustomEvent("starchart:feeddocks", { detail: { n: stats.n } })); // search's stations again (app/course.js)
  }
  globalThis.addEventListener?.("starchart:settings", (e) => { if (e.detail?.key === KEY) sync(); }); // switched off: the tiles' again; on with a list kept: the list's at once
  sync();
  return { sync, stats };
}
