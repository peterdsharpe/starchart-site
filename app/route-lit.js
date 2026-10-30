// W111 tiles16 (design/app-ui/SPEC.md §221; OSS review #14): a bike route lit whole. Tiles v16 keep every
// named route of a way (`route`, and `routes` when there are more), so a road of the route lights wherever the chart has
// it, not only the pieces whose one `route` was this one; v15's tiles light by `route` alone. The peek gives the route's
// length and climb, from the tiles' `bike_routes` table (z0, chart/SCHEMA.md), once it is read.
// W140 routelit (SPEC §253, his 0.1.61 note on Hawthorn St): a tap on a road shows that road only; the peek has a row per
// route ("Part of Charles River – Minuteman Path · 4.1 mi ›"), and a tap on the row lights that route.
//   - The light: a soft halo in the text's ink (`--starlight`) along each side of the route's roads, never on them, so each
//     keeps its own look and nothing reads as a bike path (never the bikes' cyan or blue, the course's orange, or Prefer's chalk dots),
//     on the chart's roads as its loaded tiles have them, from z12 where the tiles name routes. It goes out with the peek
//     (a tap elsewhere, a pan).
//   - It takes no taps, and the camera stays put (a tap never moves the camera).
import { LY, FT } from "./course-logic.js";
import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json

export const GLOW = "route-lit-glow", LINE = "route-lit", MINZOOM = 12; // W140 routelit: a halo, its soft glow and its edge; no casing

/** The named bike routes of a road's tile properties: `routes` split, else `route`, else none. */
export function routeNames(p = {}) {
  if (p.routes) return [...new Set(String(p.routes).split(";").map((s) => s.trim()).filter(Boolean))];
  return p.route ? [String(p.route)] : [];
}

/** The filter of the roads of any of `names`: `route` is one, or `routes` holds one between its `;`s. None lights nothing. */
export function routeFilter(names) {
  if (!names.length) return ["==", ["get", "route"], "\u0000"];
  const routes = ["concat", ";", ["coalesce", ["get", "routes"], ""], ";"];
  return ["any", ["in", ["get", "route"], ["literal", names]], ...names.map((n) => ["in", `;${n};`, routes])];
}

/** The peek's line for a route of the table (`{ length_m, climb_m }`): "Minuteman Bikeway · 10.2 mi · ▲ 60 ft"; without
 *  its name when the peek already says it ("Whole route · 10.2 mi"). The climb only from 10 ft, and only with `climb`
 *  (W140 routelit). Null without the row. */
export function routeLine(name, row, { named = false, mode = "meatspace", climb = true } = {}) {
  const m = +row?.length_m;
  if (!(m > 0)) return null;
  const ft = climb ? Math.round((+row.climb_m || 0) / FT / 10) * 10 : 0;
  return `${named ? "Whole route" : name} · ${(m / LY).toFixed(1)}\u00a0${mode === "meatspace" ? "mi" : "LY"}${ft >= 10 ? ` · ▲\u00a0${ft}\u00a0ft` : ""}`; // a number keeps its unit when the line wraps
}

/** W140 routelit: the peek's row for route `name` of a road whose own name is `peekName` (`one`, the road's only route):
 *  Plain "Part of Minuteman Bikeway · 10.2 mi", SCUL "Wormhole route Minuteman Bikeway · 10.2 LY"; "Whole route · …" for
 *  the route the peek already names (or an unnamed road's one route). The length once the table's `row` is read, the climb
 *  once the row has lit the route. */
export function routeRow(name, row, { peekName = "", one = false, mode = "meatspace", lit = false } = {}) {
  const named = peekName === name || (!peekName && one), head = named ? "Whole route" : mode === "meatspace" ? `Part of ${name}` : `Wormhole route ${name}`;
  return routeLine(head, row, { mode, climb: lit }) || head;
}

/** The light on `map`: light(names) and clear(). The route's roads are copied from the chart's loaded tiles
 *  (querySourceFeatures, a few ms) into a source of its own, so a tap never makes MapLibre parse the chart's tiles again,
 *  as a filter or a layer on the chart's source would. Its colour is the theme's as it is now. */
export function mountRouteLit(map) {
  const ink = () => { try { return getComputedStyle(document.documentElement).getPropertyValue("--starlight").trim() || COLOURS.color.starlight; } catch { return COLOURS.color.starlight; } }; // W185 colours // W140 routelit: the text's ink, the theme's
  const soft = (o) => (/^#[0-6]/.test(ink()) ? o * 0.65 : o); // W140 routelit: a dark ink (Daystar's) shades, so it shades less
  const none = { type: "FeatureCollection", features: [] };
  let lit = [];
  const add = () => {
    if (map.getLayer(LINE)) return;
    if (!map.getSource(LINE)) map.addSource(LINE, { type: "geojson", data: none });
    const at = ["starpath-label", "wormhole-label"].find((id) => map.getLayer(id)); // under the names
    const common = { type: "line", source: LINE, minzoom: MINZOOM, layout: { "line-cap": "round", "line-join": "round" } };
    const z = (a, b) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, a, 17, b];
    map.addLayer({ id: GLOW, ...common, paint: { "line-color": ink(), "line-opacity": soft(0.3), "line-gap-width": z(3, 10), "line-width": z(6, 22), "line-blur": z(4, 14) } }, at); // W140 routelit: beside the road, never on it
    map.addLayer({ id: LINE, ...common, paint: { "line-color": ink(), "line-opacity": soft(0.45), "line-gap-width": z(3, 10), "line-width": z(2, 6), "line-blur": z(1.5, 4) } }, at);
  };
  const set = (names) => {
    lit = names;
    if (!map.getSource("chart")) return;
    add();
    const features = names.length ? map.querySourceFeatures("chart", { sourceLayer: "roads", filter: routeFilter(names) }) : [];
    map.getSource(LINE).setData({ type: "FeatureCollection", features: features.map((f) => ({ type: "Feature", geometry: f.geometry, properties: { ...f.properties } })) }); // a plain object: the worker can't take a null-prototype one
    if (names.length) tint();
  };
  const tint = () => { for (const [id, o] of [[GLOW, 0.3], [LINE, 0.45]]) if (map.getLayer(id)) { map.setPaintProperty(id, "line-color", ink()); map.setPaintProperty(id, "line-opacity", soft(o)); } };
  map.on("style.load", () => { if (lit.length) set(lit); }); // a theme's or a restored context's style
  globalThis.addEventListener?.("starchart:theme", () => { if (lit.length) tint(); }); // W140 routelit: a theme's paint in place (By the sun) loads no style, and a lit route's peek has no time
  return { light: (names) => set(names), clear: () => { if (lit.length) set([]); }, get lit() { return lit; } };
}
