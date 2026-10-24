// W23 touch: what a thing on the chart is, in the place sheet's words, for the hover tooltip and the tap's peek
// (design/app-ui/SPEC.md §27). Pure functions: no DOM, no MapLibre.

import { labelFor, spotWhat } from "../chart/lingo/lingo.js"; // W38 places: spotWhat
import { distLabel, nameParts, says } from "./course-logic.js"; // W26 peek; W60 b: says
import { lingo } from "./lingo-mode.js"; // W60 b

/** The plain kind, as the place sheet says it: the Codex's first clause ("a rotary", "a protected bike lane"). */
export const plainKind = (pack, kind) => (pack.kinds[kind]?.codex || "").split(/[.(;]/)[0].trim();

// The layers that name what is under the pointer: one per kind of thing, the widest of a road's stack, so the query
// stays small. Icons (pois, the constellations, the park and water labels, the lore) open a sheet; the rest a peek.
// W33 peeks: never a pulsar or a black hole (arclight, 2026-10-17: "Clicking on a pulsar is not useful ... I almost always
// prefer to click on the underlying street and get the starpath overlay. Same with black holes."): a tap there names the
// street, and a rotary's ring is a street like any other.
const LINES = new Set(["starpath", "transport-lane-band", "wormhole-glow", "cycle-track-glow", "wormhole-plain", "hyperspace-byway-casing", "space-walk", "asteroid-belt-river"]);
// W88 mapfix: cycle-track-glow, a cycle track's (the wormholes' twin, chart/style/build_style.py)
// W88 paths: wormhole-plain, a path's with the Bike lanes layer off, when its glow is hidden
const SKIP = /^(pulsar|black-hole)/; // W33 peeks
const FILLS = new Set(["terraform", "nebula"]);
/** A style layer the hints read. `l` is a style layer (`source-layer`) or a MapLibre one (`sourceLayer`). */
export function hintLayer(l) {
  if (l.source === "lore") return l.type === "symbol";
  if (l.source !== "chart" || SKIP.test(l.id)) return false; // W33 peeks: SKIP
  const sl = l.sourceLayer ?? l["source-layer"];
  if (l.type === "symbol") return ["pois", "landcover_labels", "water_labels", "spots"].includes(sl) || /^constellation/.test(l.id); // W38 places: spots
  if (l.type === "circle") return sl === "pois" || sl === "spots";
  return LINES.has(l.id) || FILLS.has(l.id);
}

/** The thing a feature is: its SCUL name and plain kind, or null for what has nothing to say (an unnamed street). */
export function hintOf(pack, f, mode = lingo()) { // W60 b: mode
  const p = f.properties || {}, type = f.layer?.type;
  if ((type === "line" || type === "fill") && !p.name && !p.route) return null;
  if (f.layer?.["source-layer"] === "spots") return p.name ? { name: p.name, what: spotWhat(p.class, p.group) } : null; // W38 places: "Restaurant"
  const kind = pack.kinds[p.kind] ? p.kind : f.layer?.["source-layer"] === "water" ? "heavy_nebula" : null;
  if (!kind) return null;
  const name = labelFor(pack, kind, p.name || !p.route ? p : { ...p, name: p.route }, mode), plain = mode === "meatspace"; // W60 b: mode
  const said = plain ? says(name, plainKind(pack, kind)) : nameParts(pack, kind, name, mode).some((t) => t.generic); // W26 peek: no kind the name already says ("Starpath Broadway", not "· a street"); W60 b: Plain's "Beacon Street"
  const what = said ? "" : plainKind(pack, kind);
  if (kind === "sandworm_nest" && p.name && !plain) return { name, what: p.name }; // W33 peeks: which nest, by its stop's name; its sandworms say they are buses; W60 b: not in Plain, where the name is the stop's
  return name || what ? { name: name === what ? "" : name, what } : null;
}

// W26 peek: a road's facts, for the peek (SPEC §32). arclight, 2026-10-17: "the car speed in miles per hour, the bike lane
// status (if there is a bike lane or not, if it's protected or not), maybe the grade". Transports (cars) and warp (mph) are
// SCUL's words. `mph`, `lanes` and `grade` are tiles v8's (chart/SCHEMA.md); a fact whose attribute is missing is left out.
const PATHS = new Set(["cycleway", "path", "footway", "track", "steps", "pedestrian"]);
const BIKE = { wormhole: "Separate path, no transports", shielded: "Protected bike lane", laned: "Painted bike lane", shared: "Sharrows, no bike lane", none: "No bike lane" };
// W37 sidepath: protected lanes mapped as their own ways beside the street (tiles v9's `sidepath`, 1 or 2 sides). arclight,
// 2026-10-18: "If I click on a starpath, it's safe to assume I want to consider the 'bikeability' of that route in general".
const ALONG = { 1: "Protected bike lane alongside, one\u00a0side", 2: "Protected bike lanes alongside, both\u00a0sides" }; // the side stays with its word when the line wraps
export const GRADE_MIN = 3; // %, the steepest 80 m: enough to notice on a bike
/** The facts of a road or path from its tile properties, one short line each; none for anything else. */
export function roadFacts(p = {}, mode = lingo()) { // W60 b: mode
  if (!p.class && !p.bike) return [];
  const plain = mode === "meatspace"; // W60 b
  if (p.kind === "transport_lane") return [plain ? "Cars only, no bikes" : "No-fly: transports only"]; // W60 b
  const cars = !PATHS.has(p.class) && p.bike !== "wormhole", lanes = Math.round(+p.lanes) || 0, mph = Math.round(+p.mph) || 0, out = [];
  if (cars && (lanes > 0 || mph > 0) && plain) out.push(`${lanes > 0 ? `${lanes} lane${lanes === 1 ? "" : "s"} of cars` : "Cars"}${mph > 0 ? `,\u00a0${mph}\u00a0mph` : ""}`); // W60 b: Plain's, with no gloss
  else if (cars && (lanes > 0 || mph > 0)) out.push( /* W60 b: else */ `${lanes > 0 ? `${lanes} lane${lanes === 1 ? "" : "s"} of transports` : "Transports"}${mph > 0 ? ` at warp ${mph}` : ""} · cars${mph > 0 ? `,\u00a0${mph}\u00a0mph` : ""}`); // W27 card: in plain words too, as "Pulsar · a traffic light" (W28 first-use 11)
  const along = cars ? ALONG[Math.round(+p.sidepath)] : undefined; // W37 sidepath: never "No bike lane" beside one
  if (BIKE[p.bike] && (cars || p.bike === "wormhole") && !(along && (p.bike === "none" || p.bike === "shared"))) out.push(plain && p.bike === "wormhole" ? "Separate path, no cars" : BIKE[p.bike]); // W60 b
  if (along) out.push(along);
  if (+p.grade >= GRADE_MIN) out.push(`${plain ? "Grade" : "G-well"} up to ${Math.round(+p.grade)} %`); // W60 b
  return out;
}
// W27 card: a road's comfort (tiles v8, 0 to 7, chart/SCHEMA.md "Comfort") as its flying conditions, for the peek. arclight,
// 2026-10-17: "Can you display a 'ship-friendliness' score ... on that tap-overlay when I click on a road/path?" The words
// follow the rider's levels of SCHEMA's 30 places: wormholes and protected lanes 7, quiet streets 4 and 5, busy roads 0 to 2.
export const FLYING = ["Rough", "Rough", "Rough", "Fair", "Fair", "Good", "Good", "Smooth"];
/** A road's flying conditions: its level, the word ("Fair"), and what a screen reader says ("Flying conditions: fair, 4 of
 *  7"); null without a `comfort`, and on a transport lane ("No-fly"). */
export function flyingOf(p = {}, mode = lingo()) { // W60 b: mode
  if (p.kind === "transport_lane" || p.comfort == null || p.comfort === "" || !Number.isFinite(+p.comfort)) return null;
  const level = Math.max(0, Math.min(7, Math.round(+p.comfort))), word = FLYING[level];
  return { level, word, said: `${mode === "meatspace" ? "Riding" : "Flying"} conditions: ${word.toLowerCase()}, ${level} of 7` }; // W60 b
}
/** What a peek says: the hint's name and kind, the road's facts, and "1.3 LY from you" when `m`, the metres from the pilot,
 *  is known. Null where the hint is. W27 card: and a road's flying conditions. */
export function peekOf(pack, f, m = null) {
  const h = hintOf(pack, f);
  if (!h) return null;
  const road = f.layer?.type === "line"; // W33 peeks: a rotary's ring too
  return { ...h, facts: road ? roadFacts(f.properties) : [], flying: road ? flyingOf(f.properties) : null, away: m != null && m >= 0 ? `${distLabel(m)} from you` : "" };
}

/** W33 peeks: an icon not drawn at this zoom (chart/style's up_close: a Sandworm Nest below z17, at opacity 0), by its
 *  layer's paint as queryRenderedFeatures evaluates it: a tap there must not name it, nor ask the MBTA about it. */
const unseen = (f) => {
  const p = f.layer?.paint, shape = p?.["icon-opacity"] ?? p?.["circle-opacity"]; // W38 places: a spot's dot, or its name alone
  return !!p && (shape === undefined ? p["text-opacity"] === 0 : shape === 0 && (p["text-opacity"] ?? 0) === 0);
};
/**
 * Of the features near a point, the one to name: the nearest point (an icon) within `r` px, else the top named line,
 * else the top named area. W33 peeks: never a pulsar or a black hole, and a rotary's ring is named as its street.
 * `fs` are queryRenderedFeatures' results, top layer first; `project` gives a [lon, lat]'s [x, y].
 */
export function pickHint(pack, fs, pt, project, r = 16) {
  let best = null, bd = Infinity;
  for (const f of fs) {
    if (f.geometry?.type !== "Point" || (f.layer.type !== "symbol" && f.layer.type !== "circle") || SKIP.test(f.layer.id || "") || unseen(f)) continue; // W33 peeks: SKIP, unseen
    const [x, y] = project(f.geometry.coordinates), d = Math.hypot(x - pt[0], y - pt[1]);
    if (d <= r && d < bd) { bd = d; best = f; }
  }
  if (best) return best;
  const named = fs.filter((g) => g.layer.type === "line" && !SKIP.test(g.layer.id || "") && hintOf(pack, g)); // W33 peeks: SKIP
  if (named.length) return named.map((f) => ({ f, d: nearestPx(geomLines(f.geometry).map((l) => l.map(project)), pt).d })).reduce((a, b) => (b.d < a.d ? b : a)).f; // W84 roadtap: the nearest named line, so a busy junction names the road under the finger, as the peek's tail shows
  return fs.find((g) => g.layer.type === "fill" && !SKIP.test(g.layer.id || "") && hintOf(pack, g)) || null;
}

/** W84 roadtap: a GeoJSON geometry's lines of [lon, lat]s (a point's, one point; an area's, its rings). */
export const geomLines = (g) => (g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" || g?.type === "Polygon" ? g.coordinates : g?.type === "MultiPolygon" ? g.coordinates.flat() : g?.type === "Point" ? [[g.coordinates]] : []);
/** W84 roadtap: the nearest point to `p` on a line of screen points (or on any of several lines): { d, p: [x, y] }. */
export function nearestPx(lines, p) {
  let best = { d: Infinity, p };
  for (const l of lines) for (let i = 0; i < l.length; i++) {
    const a = l[i], b = l[i + 1] || a, vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0, q = [a[0] + u * vx, a[1] + u * vy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < best.d) best = { d, p: q };
  }
  return best;
}

/** One line of words: "Powder House Black Hole · a rotary", or the kind alone ("a public toilet" under "Tardis"). */
export const hintText = (h) => [h.name, h.what].filter(Boolean).join(" · ");
