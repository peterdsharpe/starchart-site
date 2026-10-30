// W23 touch: what a thing on the chart is, in the place sheet's words, for the hover tooltip and the tap's peek
// (design/app-ui/SPEC.md §27). Pure functions: no DOM, no MapLibre.

import { labelFor, spotWhat } from "../chart/lingo/lingo.js"; // W38 places: spotWhat
import { distLabel, nameParts, says, plainWhat } from "./course-logic.js"; // W26 peek; W60 b: says; W152 app O1: plainWhat
import { lingo } from "./lingo-mode.js"; // W60 b
import { GOOD_BIKES, STRESS_BELOW, PATH_CLASSES, levelOf } from "./comfort-along.js"; // W173 quality3: levelOf // W156 qualitysteps; W160 quality2: the cuts and the paths, for the reason
import { COMFORT } from "./comfort-model.js"; // W188 comfortone: chart/pipeline/comfort.json's numbers, never typed here

/** The plain kind, as the place sheet says it: the Codex's first clause ("a rotary", "a protected bike lane"). */
export { plainWhat as plainKind }; // W152 app O1: one cut of the codex, course-logic.js's

// The layers that name what is under the pointer: one per kind of thing, the widest of a road's stack, so the query
// stays small. Icons (pois, the constellations, the park and water labels, the lore) open a sheet; the rest a peek.
// W33 peeks: never a pulsar or a black hole (arclight, 2026-10-17: "Clicking on a pulsar is not useful ... I almost always
// prefer to click on the underlying street and get the starpath overlay. Same with black holes."): a tap there names the
// street, and a rotary's ring is a street like any other.
const LINES = new Set(["starpath", "transport-lane-band", "wormhole", "cycle-track", "wormhole-plain", "hyperspace-byway-casing", "space-walk", "asteroid-belt-river"]);
// W88 mapfix: cycle-track-glow, a cycle track's (the wormholes' twin, chart/style/build_style.py); W160 mapclean: wormhole and cycle-track, the glows went
// W88 paths: wormhole-plain, a path's with the Bike lanes layer off, when its glow is hidden
const SKIP = /^(pulsar|black-hole|course-marks)/; // W33 peeks; W173 mapstyle2: a route's own lights and rotaries under z14 too
const FILLS = new Set(["terraform", "nebula"]);
/** A style layer the hints read. `l` is a style layer (`source-layer`) or a MapLibre one (`sourceLayer`). */
export function hintLayer(l) {
  if (l.source === "lore") return l.type === "symbol";
  if (l.source === "anchorages") return l.type === "symbol"; // W122 homerow: the racks file's (app/anchorages.js), the tiles' racks in its box
  if (l.source !== "chart" || SKIP.test(l.id)) return false; // W33 peeks: SKIP
  const sl = l.sourceLayer ?? l["source-layer"];
  if (l.type === "symbol") return ["pois", "landcover_labels", "water_labels", "spots"].includes(sl) || /^constellation/.test(l.id); // W38 places: spots
  if (l.type === "circle") return sl === "pois" || sl === "spots";
  return LINES.has(l.id) || FILLS.has(l.id);
}

// W160 quality2 (SPEC §283): her note 26, 'You can just write "footpath" instead of "a footpath", which formats weirdly with a line break after
// the article': a footpath's kind in the peek's place line, with no article.
const PEEK_WHAT = { space_walk: "Footpath" }; // W160 quality2
/** The thing a feature is: its SCUL name and plain kind, or null for what has nothing to say (an unnamed street). */
export function hintOf(pack, f, mode = lingo()) { // W60 b: mode
  const p = f.properties || {}, type = f.layer?.type;
  if ((type === "line" || type === "fill") && !p.name && !p.route) return null;
  if (f.layer?.["source-layer"] === "spots") return p.name ? { name: p.name, what: spotWhat(p.class, p.group) } : null; // W38 places: "Restaurant"
  const kind = pack.kinds[p.kind] ? p.kind : f.layer?.["source-layer"] === "water" ? "heavy_nebula" : null;
  if (!kind) return null;
  const name = labelFor(pack, kind, p.name || !p.route ? p : { ...p, name: p.route }, mode), plain = mode === "meatspace"; // W60 b: mode
  const said = plain || name === labelFor(pack, kind, p, "meatspace") ? says(name, plainWhat(pack, kind)) : nameParts(pack, kind, name, mode).some((t) => t.generic); // W26 peek: no kind the name already says ("Starpath Broadway", not "· a street"); W60 b: Plain's "Beacon Street"; W91 stopsigns: a SCUL name in plain words is judged as Plain's ("Stop sign", not "Stop sign · a stop sign")
  const what = said ? "" : PEEK_WHAT[kind] ?? plainWhat(pack, kind); // W160 quality2: PEEK_WHAT
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
export const GRADE_MIN = COMFORT.grade.from_pct; // %, the steepest window_m (80 m): enough to notice on a bike; W188 comfortone: where the score's grade starts to cost (was 3, typed)
/** The facts of a road or path from its tile properties, one short line each; none for anything else. */
export function roadFacts(p = {}, mode = lingo()) { // W60 b: mode
  if (!p.class && !p.bike) return [];
  const plain = mode === "meatspace"; // W60 b
  if (p.kind === "transport_lane") return [plain ? "Cars only, no bikes" : "No-fly: transports only"]; // W60 b
  const cars = !PATHS.has(p.class) && p.bike !== "wormhole", lanes = Math.round(+p.lanes) || 0, mph = Math.round(+p.mph) || 0, out = [];
  if (cars && (lanes > 0 || mph > 0) && plain) out.push(`${lanes > 0 ? `${lanes} lane${lanes === 1 ? "" : "s"} of cars` : "Cars"}${mph > 0 ? `,\u00a0${mph}\u00a0mph` : ""}`); // W60 b: Plain's, with no gloss
  else if (cars && (lanes > 0 || mph > 0)) out.push( /* W60 b: else */ `${lanes > 0 ? `${lanes} lane${lanes === 1 ? "" : "s"} of transports` : "Transports"} (cars)${mph > 0 ? `,\u00a0warp\u00a0${mph}` : ""}`); // W27 card: in plain words too, as "Pulsar · a traffic light" (W28 first-use 11); W140 words: the speed once
  const along = cars ? ALONG[Math.round(+p.sidepath)] : undefined; // W37 sidepath: never "No bike lane" beside one
  if (BIKE[p.bike] && (cars || p.bike === "wormhole") && !(along && (p.bike === "none" || p.bike === "shared"))) out.push(plain && p.bike === "wormhole" ? "Separate path, no cars" : BIKE[p.bike]); // W60 b
  if (along) out.push(along);
  if (+p.grade >= GRADE_MIN) out.push(`${plain ? "Grade" : "G-well"} up to ${Math.round(+p.grade)} %`); // W60 b
  if (p.kind === "space_walk" && (p.class === "steps" || (p.class === "footway" && p.bike === "none"))) out.push(plain ? "Walk your bike" : "Walk your ship"); // W160 quality2 (SPEC §283): her note 26; the codex's "walk your ship"; review: only where the router walks (steps, a footway bikes aren't allowed on), not a path it rides
  const why = stressWhy(p, mode); // W160 quality2
  return why ? [why, ...out] : out; // W160 quality2: the reason first
}
// W160 quality2 (SPEC §283): her note 26, "When I click on them there is no ... information telling me why they've been color coded". A road the
// Stressful streets layer colours (a street cars use, with no lane, track or path, under average: comfort-along.js) says why, in a few words: its
// worst factors of the score (chart/SCHEMA.md "Comfort") as far as the tiles carry them, each estimated from its fields as the profile scores
// it, the two that take the most (each at least STRESS_MIN of the score). The tiles carry no potholes, kerb width or parking, so a street scored
// low by those alone gets no line (the facts below still say what it has). W188 comfortone: the weights and tables are comfort.json's (COMFORT),
// no longer hand copies of them (SURFACE_F, TRAFFIC and the literals).
const { weights: W, surface: SURFACE, speed: SPEED, grade: GRADE, room: ROOM } = COMFORT; // W188 comfortone
const byLanes = (each, b, c) => (each <= 1.5 ? 1 : each <= 2 ? 1 + ((b - 1) * (each - 1.5)) / 0.5 : b + (c - b) * Math.min(1, each - 2)); // W188 comfortone: Starchart.java's Comfort.byLanes
const STRESS_MIN = 0.2; // W160 quality2: a factor that takes a fifth of the score or more
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** W160 quality2: why the layer colours a road ("Busy, fast traffic", "Steep", "Rough surface"), or "" where it doesn't or the tiles can't say. */
export function stressWhy(p = {}, mode = lingo()) { // W160 quality2
  const c = +p.comfort;
  if (p.comfort == null || p.comfort === "" || !Number.isFinite(c) || c >= STRESS_BELOW || /* W173 quality3: the red to yellow end (was QUALITY_CUTS[1]) */ GOOD_BIKES.includes(p.bike) || PATH_CLASSES.includes(p.class) || p.kind === "transport_lane") return "";
  const mph = +p.mph || 0, lanes = +p.lanes || 0, each = lanes > 0 ? (+p.oneway ? lanes : lanes / 2) : 1, g = +p.grade || 0, sf = SURFACE[p.surface] ?? 1; // W188 comfortone: SURFACE
  const roomF = byLanes(each, ROOM.lanes_2, ROOM.lanes_3) * (ROOM.traffic[p.class] ?? 1); // the lanes each way, by class (W188 comfortone: comfort.json's room)
  const t = clamp01((g - GRADE.from_pct) / (GRADE.to_pct - GRADE.from_pct)), gradeF = 1 - t * t * (3 - 2 * t); // 1 up to 3 %, 0 from 8 %, a smoothstep
  const plain = mode === "meatspace", f = [ // [the share of the score it takes, its words]; W188 comfortone: comfort.json's weights and speeds
    [W.speed * (1 - clamp01((SPEED.awful_mph - mph) / (SPEED.awful_mph - SPEED.comfy_mph))) * (mph > 0), plain ? "fast traffic" : "fast transports"],
    [W.room * (1 - roomF), "busy"], [W.grade * (1 - gradeF), "steep"], [W.surface * (1 - sf), "rough surface"]];
  const why = f.filter(([w]) => w >= STRESS_MIN).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, w]) => w).join(", ");
  return why && why[0].toUpperCase() + why.slice(1);
}
// W27 card: a road's comfort (tiles v8, 0 to 7, chart/SCHEMA.md "Comfort") as its flying conditions, for the peek. arclight,
// 2026-10-17: "Can you display a 'ship-friendliness' score ... on that tap-overlay when I click on a road/path?" The words
// follow the rider's levels of SCHEMA's 30 places: wormholes and protected lanes 7, quiet streets 4 and 5, busy roads 0 to 2.
// W173 quality3 (SPEC §306): levels 0, 1 and 2 run from the layer's red through orange to yellow now, so each has its word (was "Rough" for
// all three); the green levels keep theirs: "Bad riding", "Rough riding", "Busy riding", then "Fair riding" and up. `at`, its colour's place
// on the continuum in level units (comfort-along.js levelOf: its score / 12.5, else its level's mean score).
export const FLYING = ["Bad", "Rough", "Busy", "Fair", "Fair", "Good", "Good", "Smooth"]; // W173 quality3: was Rough, Rough, Rough
/** A road's flying conditions: its level, the word ("Fair"), and what a screen reader says ("Flying conditions: fair, 4 of
 *  7"); null without a `comfort`, and on a transport lane ("No-fly"). */
export function flyingOf(p = {}, mode = lingo()) { // W60 b: mode
  if (p.kind === "transport_lane" || p.comfort == null || p.comfort === "" || !Number.isFinite(+p.comfort)) return null;
  const top = COMFORT.levels - 1, level = Math.max(0, Math.min(top, Math.round(+p.comfort))), word = FLYING[level]; // W188 comfortone: the top level, comfort.json's (was 7, typed)
  return { level, word, said: `${mode === "meatspace" ? "Riding" : "Flying"} conditions: ${word.toLowerCase()}, ${level} of ${top}`, at: levelOf(p), ...(GOOD_BIKES.includes(p.bike) ? { good: true } : PATH_CLASSES.includes(p.class) && { calm: true }) }; // W60 b; W156 qualitysteps: good, a lane, track or path (its bars in the bike blue); W160 quality2: calm, a footpath (its bars never yellow or red, as the layer)
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
export function pickHint(pack, fs, pt, project, r = 16, under = []) { // W108 glyphs: under, the text-only names whose box is under the finger
  const own = under.find((f) => f.geometry?.type === "Point" && !unseen(f) && hintOf(pack, f)); // W108 glyphs: a tap on a square's name (no icon) is the square,
  if (own) return own; // W108 glyphs: however far from its point; one beside the name is the street's, as before
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
