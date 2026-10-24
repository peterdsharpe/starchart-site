// W56 parking (design/app-ui/SPEC.md §73): the anchorages (bike parking), from chart/anchorages/anchorages-v1.json:
// OSM's, with their capacity and a rank (0 a dedicated public rack, 1 lockers, sheds, bike rooms and customers' racks),
// and the City of Cambridge's racks that OSM lacks, as a source of their own (chart/anchorages/build.py).
//   - The Anchorages tile in Layers (starchart.layer.anchorages, off by default) draws every one from z14: the rack mark
//     (W86 map: a ring with a bar through it, a bike lock; no capacity, "just location"). While it is on, the tiles' own up-close `anchorage` layer draws nothing, so none is doubled.
//   - near(ll, m): the ones within m metres of ll, dedicated racks first, then by distance (app/course.js, at the pad).
//   - W102 trim (SPEC §202): the file (125 KB) is fetched only when asked, need(): the tile on, or a landing pad (a preview
//     or a flight, app/course.js); never at the start. Until it is in, the pad counts the tiles' own racks.
import { rowOn, LAYERS, showLayers } from "./layers.js";
import { pick } from "./lingo-mode.js"; // W60 c

/** W60 c: the words app/course.js says of them, [SCUL, Plain]: the pad's button ("Anchorages: 3 within 490 ft") and the
 *  preview's landing pad line (" · 3 anchorages"). */
export const WORDS = {
  near: [(n, ft) => `${n === 1 ? "Anchorage" : "Anchorages"}: ${n} within ${ft} ft`, (n, ft) => `${n === 1 ? "Bike rack" : "Bike racks"}: ${n} within ${ft} ft`],
  pad: [(n) => ` · ${n} ${n === 1 ? "anchorage" : "anchorages"}`, (n) => ` · ${n} ${n === 1 ? "bike rack" : "bike racks"}`],
};
export const words = (k, ...a) => pick(WORDS[k])(...a);

export const SOURCE = "anchorages", KEY = "starchart.layer.anchorages";
const KX = 111320 * Math.cos((42.36 * Math.PI) / 180), KY = 110574;
let rows = null; // [lon, lat, capacity, rank, src]
let get = null, want = null; // W102 trim: the file's fetch, once mounted; and its promise, once asked for

/** The file's rows, each with its source: "osm" or "cambridge". */
export function rowsOf(file) {
  return [...file.osm.map((r) => [...r, "osm"]), ...(file.cambridge ?? []).map((r) => [...r, "cambridge"])];
}
export const loaded = () => !!rows;
export const use = (file) => { rows = rowsOf(file); };
/** W102 trim: the file, fetched once, when first asked for; true once it is in. A failed fetch is tried again at the next ask. */
export function need() {
  if (!want && get) want = get().then((file) => { use(file); return true; }, () => { want = null; return false; });
  return want ?? Promise.resolve(false);
}

/** Within `m` metres of `ll`: [{ ll, d, cap, rank, src }], dedicated racks first (rank 0), then the nearest. */
export function near(ll, m, list = rows ?? []) {
  const out = [];
  for (const [x, y, cap, rank, src] of list) {
    const dx = (x - ll[0]) * KX, dy = (y - ll[1]) * KY;
    if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
    const d = Math.hypot(dx, dy);
    if (d <= m) out.push({ ll: [x, y], d, cap, rank, src });
  }
  return out.sort((a, b) => a.rank - b.rank || a.d - b.d);
}

const geojson = (list) => ({ type: "FeatureCollection", features: list.map(([x, y, cap, rank, src]) => ({ type: "Feature",
  properties: { cap, rank, src }, geometry: { type: "Point", coordinates: [x, y] } })) });

/** The layer on `map` (under the tiles' own `anchorage`), once the file is in; `at` resolves the file's address. W102 trim: the
 *  file is asked for only while the tile is on (need()); off, nothing is fetched. */
export function mountAnchorages({ map, at = (p) => p, tilesFilter = null }) { // W82 packdraw, at the review: tilesFilter(), the tiles' own filter now (the stored packs' boxes in it)
  const row = LAYERS.find((l) => l.keys.includes(KEY));
  const own = map.getLayer("anchorage") ? map.getFilter("anchorage") : null;
  const tilesOwn = () => { // while the tile is on, the tiles' up-close anchors give way to these
    if (!own) return;
    const f = rowOn(row) ? ["==", ["get", "kind"], "none"] : tilesFilter?.() ?? own; // W82 packdraw, at the review: with the packs' boxes
    if (JSON.stringify(map.getFilter("anchorage")) !== JSON.stringify(f)) map.setFilter("anchorage", f);
  };
  get = async () => { // W102 trim
    const r = await fetch(at("chart/anchorages/anchorages-v1.json"));
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }; // the chart's tiles still have OSM's, up close; app/course.js counts those at the pad
  let added = false; // W102 trim
  const add = () => need().then((ok) => { // W102 trim: once, when the tile is first on
    if (!ok || added) return;
    added = true;
    map.addSource(SOURCE, { type: "geojson", data: geojson(rows) }); // credited in About, so the chart's own credit stays short
    map.addLayer({ id: SOURCE, type: "symbol", source: SOURCE, minzoom: 14, // W86 map: the rack mark (design/glyphs/build.py), no number: "just location" (her note)
      layout: { visibility: "none", "icon-image": "rack", "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.26, 17, 0.5], // W86 map: 12.5 px at z14, where they crowd, 24 at z17
        "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "rank"] },
      paint: { "icon-opacity": ["case", [">", ["get", "rank"], 0], 0.7, 1] } },
    map.getLayer("anchorage") ? "anchorage" : undefined);
    showLayers(map, KEY); tilesOwn(); map.triggerRepaint(); // W86 map: no text, so no ink to follow the theme
  });
  if (rowOn(row)) add(); // W102 trim
  addEventListener("starchart:settings", (e) => { if (e.detail?.key === KEY) { if (added) { tilesOwn(); map.triggerRepaint(); } else if (rowOn(row)) add(); } }); // W102 trim: the first time on, the file
}
