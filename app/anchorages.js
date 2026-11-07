// W56 parking (design/app-ui/SPEC.md §73): the anchorages (bike parking), from chart/anchorages/anchorages-v1.json:
// OSM's, with their capacity and a rank (0 a dedicated public rack, 1 lockers, sheds, bike rooms and customers' racks),
// and the City of Cambridge's racks that OSM lacks, as a source of their own (chart/anchorages/build.py).
//   - W122 homerow (SPEC §230; her note: "It's enough if they appear when zooming in"): no tile; every one shows by itself
//     from z17 (W132 homerow2: laid out from z16, drawn from z17, as the tiles'), the rack mark (W86 map: a ring with a bar through it, a bike lock; no capacity, "just location"). The tiles' own
//     `anchorage` layer (z16) draws only outside the file's box, BOX, from the first frame (outsideFile(), in the style before
//     the map is made, app/main.js), so none is doubled and a stored map pack's racks past the box still draw. // W122 homerow
//   - A tap on one gives its peek, as the tiles' did (kind "anchorage", app/hint-logic.js). In flight they hide (app/fx.js GROUND). // W122 homerow
//   - near(ll, m): the ones within m metres of ll, dedicated racks first, then by distance (app/course.js, at the pad).
//   - W102 trim (SPEC §202): the file (125 KB) is fetched only when asked, need(): the map first at z16 (W122 homerow: was the
//     tile on), or a landing pad (a preview or a flight, app/course.js); never before the chart's first frame is drawn. Until it is in, the pad counts the tiles' own racks.
import { pick } from "./lingo-mode.js"; // W60 c

/** W60 c: the words app/course.js says of them, [SCUL, Plain]: the pad's button ("Anchorages: 3 within 490 ft") and the
 *  preview's landing pad line (" · 3 anchorages"). */
export const WORDS = {
  near: [(n, ft) => `${n === 1 ? "Anchorage" : "Anchorages"}: ${n} within ${ft} ft`, (n, ft) => `${n === 1 ? "Bike rack" : "Bike racks"}: ${n} within ${ft} ft`],
  pad: [(n) => ` · ${n} ${n === 1 ? "anchorage" : "anchorages"}`, (n) => ` · ${n} ${n === 1 ? "bike rack" : "bike racks"}`],
};
export const words = (k, ...a) => pick(WORDS[k])(...a);

export const SOURCE = "anchorages", MINZOOM = 16; // W122 homerow: from z16, by themselves (was the tile's key, and z15)
/** W132 homerow2 (SPEC §230): the file is in and laid out from z16, but its racks are drawn from z17, as the tiles' `anchorage`
 *  (chart/style/build_style.py up_close: opacity 0 till z17), so the two look and appear alike and z16 isn't cluttered. */
export const SHOWZOOM = 17; // W132 homerow2
/** W193 racksplit (SPEC §337): the tiles' racks are two layers by zoom (chart/style/build_style.py HULL_Z), `anchorage` until SPLITZOOM,
 *  placed before the building names (not drawn yet), and `anchorage-z18` from it, placed last; the file's go under each: [id, the tiles', from]. */
export const SPLITZOOM = 18, RACKS = [[SOURCE, "anchorage", SHOWZOOM], [`${SOURCE}-z18`, "anchorage-z18", SPLITZOOM]]; // W193 racksplit
/** W122 homerow: the file's box, [w, s, e, n]: chart/anchorages/build.py's W, S, E, N, the base chart's bounds. */
export const BOX = [-71.32, 42.22, -70.93, 42.52];
/** W122 homerow: the tiles' `anchorage` filter (["all", ["within", the edge's ring], …], which app/packmap.js withinBoxes widens
 *  for the stored packs) with the file's box cut out: the tiles' racks draw only where the file has none (a pack's, past it). */
export function outsideFile(filter) {
  const [w, s, e, n] = BOX, out = ["!", ["within", { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }]];
  return filter?.[0] === "all" ? [...filter, out] : filter ? ["all", filter, out] : out;
}
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

const geojson = (list) => // W122 homerow: kind, the tiles' own, so a tap gives the rack's peek (app/hints.js)
  ({ type: "FeatureCollection", features: list.map(([x, y, cap, rank, src]) => ({ type: "Feature",
  properties: { kind: "anchorage", cap, rank, src }, geometry: { type: "Point", coordinates: [x, y] } })) });

/** The layers on `map` (under the tiles' own racks, RACKS), once the file is in; `at` resolves the file's address. W122 homerow: the
 *  file is asked for the first time the map is at z16 or closer, after its first frame (W102 trim's laziness kept). */
export function mountAnchorages({ map, at = (p) => p, onAdd = () => {} }) { // W122 homerow: no tilesFilter (outsideFile, in the style); onAdd(), once the layer is in (app/main.js: the in-flight ground)
  get = async () => { // W102 trim
    const r = await fetch(at("chart/anchorages/anchorages-v1.json"));
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }; // the chart's tiles still have OSM's, up close; app/course.js counts those at the pad
  let added = false; // W102 trim
  const add = () => need().then((ok) => { // W102 trim: once
    if (!ok || added) return;
    added = true;
    map.addSource(SOURCE, { type: "geojson", data: geojson(rows) }); // credited in About, so the chart's own credit stays short
    for (const [id, tiles, from] of RACKS) map.addLayer({ id, type: "symbol", source: SOURCE, minzoom: MINZOOM, ...(id === SOURCE && { maxzoom: SPLITZOOM }), // W193 racksplit; W122 homerow: z16, by themselves (W91 icons: z15 with the tile); W86 map: the rack mark (design/glyphs/build.py), no number: "just location" (her note)
      layout: { "icon-image": "rack", "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.26, 17, 0.5], // W86 map: 24 px at z17; W122 homerow: always visible
        "icon-allow-overlap": false, "icon-ignore-placement": true, "symbol-sort-key": ["get", "rank"] }, // W192 mapfix3 (SPEC §337, her row 10): under the tiles' racks, the last placed: a rack where another icon or name is hides itself, and hides nothing (racks still side by side)
      paint: { "icon-opacity": ["step", ["zoom"], 0, from, ["case", [">", ["get", "rank"], 0], 0.7, 1]] } }, // W132 homerow2: none till z17, the tiles' step; unseen there, so no tap (app/hint-logic.js); W193 racksplit: from
    map.getLayer(tiles) ? tiles : undefined); // W193 racksplit: tiles
    onAdd(); map.triggerRepaint(); // W86 map: no text, so no ink to follow the theme; W122 homerow: onAdd()
  });
  const near = () => { if (!added && map.getZoom() >= MINZOOM) add(); }; // W122 homerow
  map.once("idle", () => { near(); map.on("zoomend", near); }); // W122 homerow: after the first frame, then at each zoom
}
