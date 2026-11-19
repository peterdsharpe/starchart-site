// W90 comfort (design/app-ui/SPEC.md §184): how good the riding is along a course, from the chart's own tiles. arclight and his
// wife, 2026-10-23: "Colour the course by the road's bikeability score ... blue for the best, red for the worst, colourblind-safe
// ... continuous so there's no legend of discrete colours to remember". W140 dircomfort (SPEC §254): where the route carries the
// graph's comfort the way it rides (router.js `comfort`, graph version 4), that colours it; elsewhere (unknown: an older pack's edges)
// the tiles carry no feature ids and one value for both ways, so the course is matched to the roads of the tiles under it, off the main thread:
//   - the course is sampled every STEP_M metres; each sample takes the comfort (0 worst to 7 best, chart/SCHEMA.md "Comfort") of
//     the road nearest it within NEAR_M, a road across the course's way counting TURN_M metres farther (a cross street at a junction)
//   - from the z15 tiles of the stored chart and the stored packs (the world's archives: app/main.js); where there are none (only
//     the chart's z13 prefix is in, W76 privacy, or off the chart), from the z13 tiles with a wider reach; where those have no
//     road either, the route's own ways mapped to a comfort (estimate(): a bike path 7, a protected lane 6, a street 4, a rotary 2,
//     a trunk road, or a stretch with the transports and no bike lane, W59's bare, 1; W173 quality3: each at its level's mean score, levelAt)
//   - a run shorter than FLICKER_M (a junction's cross street, a bridge's end) takes its neighbours' level
//   - the answer is the stops along the line, [[at_m, comfort], ...], at_m from the line's start in its own metres
// W156 qualitysteps (SPEC §275): the scale is a few discrete steps (comfortInk), no longer a gradient: the course, the cards' and the peek's
// bars (app/hints.js) and the Ride quality layer (bikeQualityLayer) use it, so they read as one scale. W173 quality3 (SPEC §306): one
// continuum on the comfort score again (QUALITY_STOPS, rampAt), the blue still a category.
import { VectorTile } from "../chart/vendor/vector-tile.mjs";
import { PbfReader } from "../chart/vendor/pbf.mjs";
import { PMTiles, FileSource } from "../chart/vendor/pmtiles.mjs";
import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json
import { COMFORT } from "./comfort-model.js"; // W188 comfortone: chart/pipeline/comfort.json's levels, never typed here

/** W156 qualitysteps (SPEC §275): his note, 2026-10-25: "roads with bike lanes should be the light bright blue that we've used so far for bike
 *  lanes ... both to dark mode and light mode ... we don't need to actually overlay any color on roads that have average bikeability ... yellow,
 *  then orange, then red, depending on how non-bikeable they are ... discrete color changes rather than as a gradient". The steps:
 *  - good: a lane, a track or a path (the tiles' bike class laned, shielded or wormhole; the router's laned_starpath, shielded_starpath or
 *    wormhole the way the route rides), Dark's bike blue in both themes, whatever its score. GOOD is its value, past the levels' 0–7.
 *  - by the comfort level (0–7, the tiles' at every zoom and the graph's; not v16's comfort_score, which falls a level off it on about 2 % of
 *    pieces, chart/SCHEMA.md): yellow under 2.5 (level 2), orange under 1.5 (level 1), red under 0.5 (level 0), so z13 and z14+, the peek's
 *    bars, the tiles' path and the route's level agree by construction. Of the
 *    tiles' road length (v16, z15, 15 000 km): good 6.3 %, red 0.9 %, orange 9.4 %, yellow 15.2 %, average 68 % (SPEC §275).
 *  - average, from 2.5: the layer draws nothing; on the course, the cards' and the peek's bars, the course's own --course, so a route reads
 *    as one line (W173 quality3: now green on the continuum, drawn by the layer too).
 *  Yellow light, orange middle, red dark, in each theme (lightness orders them for every colour-blind view); each 3:1 on the ground and on the
 *  course's casing (Daystar's white inner casing); orange a red-orange, 20+ CIEDE2000 from --course. (W173 quality3: green and yellow
 *  are under 3:1 on that white, the line reading by its ink casing, and the orange is 16 CIEDE2000 from Dark's course: SPEC §306.) The gradients (W121's maps,
 *  ?scale=old, green, viridis, turbo and uniform-day-old) are gone with their switches. */
export const GOOD = COMFORT.levels, GOOD_BIKES = ["wormhole", "shielded", "laned"], GOOD_KINDS = ["wormhole", "shielded_starpath", "laned_starpath"]; // W156 qualitysteps: not sharrows
/** W160 quality2 (SPEC §283): her note 26, "why are some footpaths color coded yellow or red ... I thought all footpaths were safe": a path cars
 *  can't use (the tiles' class; the router's space_walk) is no stressful street, so it takes no worse step anywhere (steps, dirt or a grade
 *  scored it low): the layer leaves it plain, and the route, the tiles' path and the peek's bars count it average (CALM). */
export const PATH_CLASSES = ["cycleway", "path", "footway", "track", "steps", "pedestrian", "bridleway"], PATH_KINDS = ["space_walk"], CALM = 3.5; // W160 quality2; W173 quality3: a score of 43.75, a quiet street's green (was 3)
const calm = (v, path) => (path && v != null ? Math.max(v, CALM) : v); // W160 quality2: a path's level, never under average
/** W160 quality2 (SPEC §283): her notes, 2026-10-25: "red and yellow are sufficient for bikeability, we don't need orange. However both red
 *  and yellow should be brighter in daytime view"; "should not include the blue for bike lanes ... keep them separate, they can always be
 *  combined". Two worse steps: red at levels 0–1 (W156's red and orange, 9.9 % of road length), yellow at level 2 (13.3 %). By day a bright
 *  yellow (Dark's) and a bright red, each outlined by Daystar's ink (bikeQualityEdge), not darkened fills. */
/** W173 quality3 (SPEC §306): her note, 2026-10-27: "blue for a stretch on a protected bike lane (just like you're doing now), then green for
 *  a quieter road with no bike lanes road, yellow for busier roads, orange for stressful roads, red for really bad roads ... I would reserve
 *  red only for really bad roads"; his yes the same day: "you need not quantize it. You can have it be a continuum. More data is good."
 *  - good (a lane, track or path, as before) stays a category: the bike blue.
 *  - every other road a continuum on its comfort score (0–100, v16's comfort_score from z14; at z12–z13 and on the graph only the level,
 *    0–7, taken at its roads' mean score, LEVEL_SCORE): red up to QUALITY_STOPS' first, then orange, yellow and green at the next, green
 *    from the last. The stops are uneven, from the shares of road length (SPEC §306): pure red is the worst 1.2 % of the roads cars use.
 *  The app's values stay in level units (score / 12.5, GOOD past them), so a route's runs, the smoothing and the estimate keep theirs.
 *  One palette in both themes, Daystar's on its ink edge; lightness orders yellow, orange and red in every colour-blind view, and the
 *  blue–yellow axis parts the bluish green from them; the orange a red-orange, apart from the course's own (its pins and footprints). */
export const SCORE_PER_LEVEL = 100 / COMFORT.levels; // W173 quality3: chart/SCHEMA.md: comfort = floor(score × 8), comfort_score = round(score × 100); W188 comfortone: 12.5, from comfort.json's levels
export const QUALITY_STOPS = [[12, "red"], [22, "orange"], [32, "yellow"], [42, "green"]]; // W173 quality3: [score, colour] (was W156's and W160's steps)
/** W173 quality3: each level's mean comfort_score over the roads cars use (v16, z15, by length; SPEC §306), the score a road with only its
 *  level takes (z12–z13, the graph), so it looks as its z14 self does on average (a level's middle would make level 1 redder than its roads). */
export const LEVEL_SCORE = [11, 21, 30, 42.5, 55, 65, 80, 93]; // W173 quality3
export const QUALITY_INK = { // W156 qualitysteps
  dark: { good: COLOURS.quality.good, green: COLOURS.quality.green, yellow: COLOURS.quality.yellow, orange: COLOURS.quality.orange, red: COLOURS.quality.red }, // W185 colours: the tokens'; W173 quality3: the continuum's stops (was average, the course's #ff8a1f)
  light: { good: COLOURS.quality.good, green: COLOURS.quality.green, yellow: COLOURS.quality.yellow, orange: COLOURS.quality.orange, red: COLOURS.quality.red }, // W185 colours; W173 quality3: Dark's, on Daystar's ink edge; red a dark crimson, under the orange (was #fc1559; average #c95500)
}; // W156 qualitysteps
/** W160 quality2: the reason line's roads (app/hint-logic.js stressWhy): levels 0–2, the red to yellow end. */
export const STRESS_BELOW = 2.5; // W173 quality3: was QUALITY_CUTS[1]
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); // W173 quality3
/** W173 quality3: the continuum's colour at `score` (0–100) in the ink `k`: linear between the stops in sRGB, as MapLibre's interpolate. */
export function rampAt(score, k) { // W173 quality3
  const st = QUALITY_STOPS, i = st.findIndex(([at]) => score < at);
  if (i === 0) return k[st[0][1]];
  if (i < 0) return k[st.at(-1)[1]];
  const [a, ca] = st[i - 1], [b, cb] = st[i], t = (score - a) / (b - a), x = hex2(k[ca]), y = hex2(k[cb]);
  return `#${x.map((v, j) => Math.round(v + (y[j] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
let theme = globalThis.document?.documentElement.dataset.theme; // W121 viridis: theme.js has set it before any module runs
const inks = (th) => QUALITY_INK[th === "light" ? "light" : "dark"]; // W156 qualitysteps
/** W121 viridis: comfort `v`, 0 (worst) to 7 (best), or GOOD, in the scale's colour
 *  for the theme; W173 quality3: in level units, a fraction of one too (score / 12.5), on the continuum (W156 qualitysteps: its step's). */
export function comfortInk(v, th = theme) {
  return v >= GOOD ? inks(th).good : rampAt(v * SCORE_PER_LEVEL, inks(th)); // W173 quality3: the continuum (W156 qualitysteps: a step's)
}
/** The scale's 8 levels in the theme's colours: one array, its colours swapped in place at each theme switch (comfortTheme). */
export const COMFORT_INK = []; // W121 viridis: was a scale itself
/** W121 viridis: the theme's colours from now on (COMFORT_INK, comfortInk). */
export function comfortTheme(th) { theme = th; COMFORT_INK.splice(0, COMFORT.levels, ...Array.from({ length: COMFORT.levels }, (_, v) => comfortInk(v))); return COMFORT_INK; } // W121 viridis; W188 comfortone: comfort.json's levels
comfortTheme(theme); // W121 viridis
if (globalThis.document) addEventListener("starchart:theme", (e) => comfortTheme(e.detail.theme)); // W121 viridis: before course.js's and layers.js's, which import this
export const STEP_M = 5, FLICKER_M = 20, TURN_M = 12;
export const NEAR_M = { 15: 10, 13: 20 }; // the reach at each zoom: z13's lines are simplified more
const CELLS = 16; // a tile's grid for the search, 16 × 16 (57 m cells at z15 here)

/** The z15 (or z) tile that holds a point, and its place in that tile in units of `extent`. */
export function unitsOf([lon, lat], z, extent = 4096) {
  const n = 2 ** z * extent, y = (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
  return [((lon + 180) / 360) * n, y * n];
}
/** Metres per unit of the global grid at zoom z and latitude lat. */
const metresPer = (z, lat, extent = 4096) => (40075016.7 * Math.cos((lat * Math.PI) / 180)) / (2 ** z * extent);

/** The course sampled every `step` metres from its start and at its end: { pts: [[lon, lat, ux, uy]], len: metres }, each with
 *  its segment's way, as a unit vector [ux, uy] on the screen (y down). */
export function samples(coords, step = STEP_M) {
  const pts = [], k = Math.cos(((coords[0]?.[1] ?? 0) * Math.PI) / 180) * 111320;
  let s = 0, next = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i], b = coords[i + 1], dx = (b[0] - a[0]) * k, dy = (b[1] - a[1]) * 111320, d = Math.hypot(dx, dy);
    if (!d) continue;
    const ux = dx / d, uy = -dy / d;
    while (next <= s + d) { const t = (next - s) / d; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ux, uy]); next += step; }
    s += d;
  }
  const last = coords.at(-1), prev = pts.at(-1);
  if (last && (!prev || s - (next - step) > 0.5)) pts.push([last[0], last[1], prev?.[2] ?? 1, prev?.[3] ?? 0]);
  return { pts, len: s };
}

/** A line's length in metres, as samples() measures it (the stops' metres). */
export function lineMetres(coords) {
  const k = Math.cos(((coords[0]?.[1] ?? 0) * Math.PI) / 180) * 111320;
  let s = 0;
  for (let i = 0; i + 1 < coords.length; i++) s += Math.hypot((coords[i + 1][0] - coords[i][0]) * k, (coords[i + 1][1] - coords[i][1]) * 111320);
  return s;
}

/** W173 quality3: a road's comfort in level units, as the layer colours it: its comfort_score / 12.5 (z14 up, below GOOD), else its level's
 *  mean score (z12–z13, levelAt), so a z13 tile and a z15 one agree on a road (was the level alone, W156 qualitysteps). */
export const levelOf = (p) => (p.comfort_score != null && p.comfort_score !== "" && Number.isFinite(+p.comfort_score) ? Math.max(0, Math.min(GOOD - 0.01, +p.comfort_score / SCORE_PER_LEVEL)) : levelAt(+p.comfort)); // W173 quality3
/** W173 quality3: a level alone (0–7) in level units, at its roads' mean score (LEVEL_SCORE). */
export const levelAt = (l) => LEVEL_SCORE[Math.max(0, Math.min(COMFORT.levels - 1, Math.round(l)))] / SCORE_PER_LEVEL; // W173 quality3; W188 comfortone: the top level, comfort.json's
/** A decoded tile's roads: [{ comfort, lines: [[{x, y}], ...] }] in its extent's units (decodeRoads, or a test's). */
export function decodeRoads(data) {
  const vt = new VectorTile(new PbfReader(new Uint8Array(data))), layer = vt.layers.roads, roads = [];
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i), c = f.properties.comfort;
    if (c == null || !Number.isFinite(+c) || f.type !== 2) continue; // transport lanes and buoy fields have none
    roads.push({ comfort: GOOD_BIKES.includes(f.properties.bike) ? GOOD : calm(levelOf(f.properties), PATH_CLASSES.includes(f.properties.class)), lines: f.loadGeometry() }); // W156 qualitysteps: a lane, track or path GOOD, as the layer; W160 quality2: a footpath's at least average; W173 quality3: levelOf
  }
  return { extent: layer?.extent ?? 4096, roads };
}

/** The roads of tiles read at zoom z, as one grid of segments in global units, for nearest(). */
class Grid {
  constructor(z) { this.z = z; this.cells = new Map(); this.segs = []; this.have = new Set(); }
  add(x, y, tile) {
    if (!tile) return; // no such tile: its samples try the next zoom
    this.have.add(`${x}/${y}`);
    const E = tile.extent, size = E / CELLS;
    this.extent = E;
    for (const r of tile.roads) for (const l of r.lines) for (let i = 0; i + 1 < l.length; i++) {
      const x0 = x * E + l[i].x, y0 = y * E + l[i].y, x1 = x * E + l[i + 1].x, y1 = y * E + l[i + 1].y, n = this.segs.length;
      this.segs.push([x0, y0, x1, y1, r.comfort]);
      for (let cx = Math.floor(Math.min(x0, x1) / size); cx <= Math.floor(Math.max(x0, x1) / size); cx++)
        for (let cy = Math.floor(Math.min(y0, y1) / size); cy <= Math.floor(Math.max(y0, y1) / size); cy++) {
          const key = `${cx}/${cy}`, list = this.cells.get(key);
          if (list) list.push(n); else this.cells.set(key, [n]);
        }
    }
  }
  /** The comfort of the road nearest the sample p ([lon, lat, ux, uy]) within `near` metres, a crossing one TURN_M farther;
   *  undefined where its tile has no data, null where no road is near. */
  nearest(p, near) {
    const E = this.extent ?? 4096, [gx, gy] = unitsOf(p, this.z, E), tx = Math.floor(gx / E), ty = Math.floor(gy / E);
    if (!this.have.has(`${tx}/${ty}`)) return undefined;
    const mpu = metresPer(this.z, p[1], E), r = near / mpu, size = E / CELLS, seen = new Set();
    let best = Infinity, lv = null;
    for (let cx = Math.floor((gx - r) / size); cx <= Math.floor((gx + r) / size); cx++)
      for (let cy = Math.floor((gy - r) / size); cy <= Math.floor((gy + r) / size); cy++)
        for (const n of this.cells.get(`${cx}/${cy}`) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          const [x0, y0, x1, y1, c] = this.segs[n], vx = x1 - x0, vy = y1 - y0, L2 = vx * vx + vy * vy;
          const u = L2 ? Math.max(0, Math.min(1, ((gx - x0) * vx + (gy - y0) * vy) / L2)) : 0;
          const d = Math.hypot(x0 + u * vx - gx, y0 + u * vy - gy) * mpu;
          if (d > near) continue;
          const cos = L2 ? Math.abs((vx * p[2] + vy * p[3]) / Math.sqrt(L2)) : 1, cost = d + TURN_M * (1 - cos);
          if (cost < best) { best = cost; lv = c; }
        }
    return lv;
  }
}

/** The tiles [x, y] at zoom z within `near` metres of the samples. */
function tilesFor(pts, z, near, extent = 4096) {
  const out = new Map();
  for (const p of pts) {
    const [gx, gy] = unitsOf(p, z, extent), r = near / metresPer(z, p[1], extent);
    for (const fx of [gx - r, gx + r]) for (const fy of [gy - r, gy + r]) { const x = Math.floor(fx / extent), y = Math.floor(fy / extent); out.set(`${x}/${y}`, [x, y]); }
  }
  return [...out.values()];
}

/** W90 comfort: the comfort the route's own ways suggest at each metre (the estimate where the tiles have no road): a function
 *  of the line's metres. `route`: the router's { ways: [[at_m, kind]], bare: [[from_m, to_m]], distance_m }; `len`, the line's. */
export const KIND_LEVEL = { wormhole: 7, shielded_starpath: 6, laned_starpath: 4, shared_starpath: 4, starpath: 4, space_walk: 4, black_hole: 2, transport_lane: 1 }; // router.js kind()
/** W140 dircomfort (SPEC §254): the graph's comfort the way the route rides (router.js `comfort`, [[at_m, level or null]]) at each
 *  metre of the line, or null where the graph has none (an older pack's edges, a route without it). W156 qualitysteps: GOOD where the
 *  route rides a lane, a track or a path that way (its `ways`' kinds, router.js kind()). */
export function graphComfort(route, len) { // W140 dircomfort
  const runs = route?.comfort, ways = route?.ways, k = route?.distance_m > 0 ? route.distance_m / (len || 1) : 1; // W140 dircomfort; W156 qualitysteps: ways
  if (!runs?.length && !ways?.length) return () => null; // W140 dircomfort; W156 qualitysteps: or ways
  const level = (s) => runs?.findLast(([at]) => at <= s * k)?.[1] ?? null; // W173 quality3: the graph's own level there, for comfortAlong's score
  return Object.assign((s) => { const kind = ways?.findLast(([at]) => at <= s * k)?.[1]; const lv = runs?.findLast(([at]) => at <= s * k)?.[1]; return GOOD_KINDS.includes(kind) ? GOOD : calm(lv == null ? null : levelAt(lv), PATH_KINDS.includes(kind)); }, { level }); // W173 quality3: a level at its roads' mean score // W140 dircomfort; W156 qualitysteps: GOOD first; W160 quality2: a footpath at least average
} // W140 dircomfort
export function estimate(route, len) {
  const k = route?.distance_m > 0 ? route.distance_m / (len || 1) : 1, ways = route?.ways ?? [], bare = route?.bare ?? [], graph = graphComfort(route, len); // W140 dircomfort: graph
  return (s) => {
    const m = s * k, g = graph(s); // W140 dircomfort
    if (g != null) return g; // W140 dircomfort: the graph's, where it has one
    if (bare.some(([a, b]) => m >= a && m < b)) return levelAt(1); // W173 quality3: at the level's mean score, as the graph's level 1
    return levelAt(KIND_LEVEL[ways.findLast(([at]) => at <= m)?.[1]] ?? 4); // W173 quality3: the same
  };
}

/** The estimate's stops for a line of `len` metres, from the route's runs alone, at once (the line's first colours, before the
 *  tiles' answer). */
export function estimateStops(route, len) {
  const k = route?.distance_m > 0 ? len / route.distance_m : 1, at = estimate(route, len), cuts = new Set([0]);
  for (const [m] of route?.ways ?? []) cuts.add(m * k);
  for (const [a, b] of route?.bare ?? []) { cuts.add(a * k); cuts.add(b * k); }
  for (const [m] of route?.comfort ?? []) cuts.add(m * k); // W140 dircomfort
  const out = [];
  for (const s of [...cuts].filter((s) => s >= 0 && s < len).sort((a, b) => a - b)) { const v = at(s + 0.01); if (out.at(-1)?.[1] !== v) out.push([Math.round(s * 10) / 10, v]); }
  return out.length ? out : [[0, levelAt(4)]]; // W173 quality3: a street at its level's mean score
}

/** Runs shorter than `min` samples take a neighbour's level: both neighbours' when they agree, else the longer one's. In place. */
export function smooth(levels, min) {
  for (let pass = 0; pass < 3; pass++) {
    const runs = [];
    for (let i = 0; i < levels.length; i++) { const r = runs.at(-1); if (r && r.v === levels[i]) r.n++; else runs.push({ v: levels[i], i, n: 1 }); }
    let changed = false;
    for (let j = 0; j < runs.length; j++) {
      const r = runs[j], a = runs[j - 1], b = runs[j + 1];
      if (r.n >= min || (!a && !b)) continue;
      const v = a && b ? (a.v === b.v || a.n >= b.n ? a.v : b.v) : (a ?? b).v;
      levels.fill(v, r.i, r.i + r.n); r.v = v; changed = true;
    }
    if (!changed) break;
  }
  return levels;
}

/** The stops of per-sample levels: [[at_m, level]] at each change, from 0. */
export function stopsOf(levels, step, len) {
  const out = [];
  levels.forEach((v, i) => { if (!i || v !== levels[i - 1]) out.push([i ? Math.min(len, Math.round((i - 0.5) * step * 10) / 10) : 0, v]); });
  return out;
}

/**
 * The comfort along a line of [lon, lat]s. `read(z, x, y)`: a promise of that tile's roads (decodeRoads' shape), or null where
 * the archive has no such tile, or a rejection (the chart's prefix past z13); `zooms`, the zooms to try, best first; `route`, for
 * the estimate where no tile has a road. { stops, len, from: { z15, z13, route } (samples from each) }.
 */
export async function comfortAlong(coords, read, { zooms = [15, 13], route = null, step = STEP_M } = {}) {
  const { pts, len } = samples(coords, step);
  const levels = new Array(pts.length).fill(undefined), from = { route: 0, graph: 0 }; // W140 dircomfort: graph
  const graph = graphComfort(route, len); // W140 dircomfort: by the direction of travel, where the graph knows; the tiles' (one value both ways) elsewhere
  const exact = []; // W173 quality3: the graph's samples at a level's mean score, which the z15 tiles' comfort_score can refine
  let todo = pts.map((_, i) => i).filter((i) => { const v = graph(Math.min(len, i * step)); if (v == null) return true; levels[i] = v; from.graph++; if (v === levelAt(graph.level(Math.min(len, i * step)))) exact.push(i); return false; }); // W140 dircomfort; W173 quality3: exact
  for (const z of zooms) {
    const more = z === 15 ? exact : []; // W173 quality3
    if (!todo.length && !more.length) break; // W173 quality3: or more
    const near = NEAR_M[z] ?? 15, grid = new Grid(z), list = tilesFor([...todo, ...more].map((i) => pts[i]), z, near); // W173 quality3: and more
    for (let i = 0; i < list.length; i += 8) // eight at a time
      await Promise.all(list.slice(i, i + 8).map(([x, y]) => Promise.resolve().then(() => read(z, x, y)).then((t) => grid.add(x, y, t), () => {})));
    from[`z${z}`] = 0;
    const left = [];
    for (const i of todo) { const v = grid.nearest(pts[i], near); if (v === undefined) left.push(i); else if (v === null) levels[i] = null; else { levels[i] = v; from[`z${z}`]++; } }
    // W173 quality3 (SPEC §306): the graph's level by direction stays, refined by the tiles' score where they agree on it (a score from
    // the road the course is on, in the graph's level; else the level's mean score: downhill lifts a level, which no tile score shows)
    for (const i of more) { const v = grid.nearest(pts[i], near), lv = graph.level(Math.min(len, i * step)); if (v != null && v !== GOOD && Math.floor(v) === lv) { levels[i] = v; from.score = (from.score ?? 0) + 1; } }
    todo = left;
  }
  // a short stretch with no road in the tiles (a crossing, a sidewalk the tiles drop) takes its neighbours'; a long one, the route's
  const guess = estimate(route, len), gap = Math.ceil(40 / step);
  for (let i = 0; i < levels.length;) {
    if (levels[i] != null) { i++; continue; }
    let j = i; while (j < levels.length && levels[j] == null) j++;
    const a = levels[i - 1], b = levels[j];
    for (let k = i; k < j; k++) levels[k] = j - i <= gap && (a != null || b != null) ? (a ?? b) : (from.route++, guess(k * step));
    i = j;
  }
  return { stops: stopsOf(smooth(levels, Math.ceil(FLICKER_M / step)), step, len), len, from };
}

/** A line-gradient's steps for the stops ([[t, colour]] by line-progress, for course-logic.js lineInk): the course ahead of
 *  `p` (0..1) in the scale's colours, the part flown in the same at `dim`. */
export function inkSteps(stops, len, p = 0, dim = 0.32) {
  const faded = (h) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${dim})`;
  const out = [];
  let cut = false;
  for (const [at, v] of stops) {
    const t = len > 0 ? at / len : 0;
    if (!cut && p > 0 && t > p) { out.push([p, comfortInk(out.length ? stops[out.length - 1][1] : v)]); cut = true; } // W121 viridis: comfortInk, a level's fractions too
    out.push([t, t < p ? faded(comfortInk(v)) : comfortInk(v)]); // W121 viridis
  }
  if (!cut && p > 0 && stops.length) out.push([p, comfortInk(stops.at(-1)[1])]); // W121 viridis
  return out;
}

/** W90 comfort: a route card's bar (app/course.js), the route from start to end in the scale: a CSS image. */
export function comfortBar(stops, len) {
  if (!stops?.length || !(len > 0)) return "none";
  const pc = (at) => `${Math.min(100, (100 * at) / len).toFixed(1)}%`;
  return `linear-gradient(90deg, ${stops.map(([at, v], i) => `${comfortInk(v)} ${pc(at)} ${pc(stops[i + 1]?.[0] ?? len)}`).join(", ")})`;
}

/** W149 qualitywidth (SPEC §266): his note, 2026-10-25: "your ride quality overlay does NOT overlay on the full width of the street
 *  ... during the Bike quality overlay, you should use that width too". A zoom curve `e` (a style's line-width) at zoom `z`, its data
 *  parts kept: a match's or a case's outputs, or a product's factors, mixed number by number where the two stops differ only there. */
const curveAt = (e, z) => { // W149 qualitywidth
  if (!(Array.isArray(e) && e[0] === "interpolate" && e[2][0] === "zoom")) return e; // W149 qualitywidth: one width at every zoom
  const s = e.slice(3), i = Math.max(0, s.findLastIndex((x, k) => k % 2 === 0 && x <= z)), [z0, a, z1, b] = s.slice(i, i + 4); // W149 qualitywidth
  if (z1 === undefined || z <= z0) return a; // W149 qualitywidth: past the last stop, or before the first
  const base = e[1][0] === "exponential" ? e[1][1] : 1, t = base === 1 ? (z - z0) / (z1 - z0) : (base ** (z - z0) - 1) / (base ** (z1 - z0) - 1); // W149 qualitywidth: MapLibre's interpolation
  return mix(a, b, t); // W149 qualitywidth
};
const OUTPUTS = { match: (i, n) => i > 2 && (i % 2 === 1 || i === n - 1), case: (i) => i > 0 && i % 2 === 0, "*": (i) => i > 0 }; // W149 qualitywidth: where each holds its numbers
const mix = (a, b, t) => { // W149 qualitywidth: a + (b − a)·t, as numbers where it can
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  if (typeof a === "number" && typeof b === "number") return Math.round((a + (b - a) * t) * 1000) / 1000;
  const out = Array.isArray(a) && Array.isArray(b) && a.length === b.length && OUTPUTS[a[0]];
  if (out && a.every((x, i) => out(i, a.length) || JSON.stringify(x) === JSON.stringify(b[i]))) return a.map((x, i) => (out(i, a.length) ? mix(x, b[i], t) : x));
  return ["+", a, ["*", Math.round(t * 1e4) / 1e4, ["-", b, a]]];
};
/** W149 qualitywidth: the layer's zooms, and the layers whose widths it takes: each road at its own drawn width, the bike paths (and
 *  the cycle tracks beside their streets) at the cyan line's, the footpaths and the unpaved paths at their lines', every other road
 *  at its band's (starpath-band, by class: a street's visible width; the edge glows just outside it). */
export const QUALITY_ZOOMS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], QUALITY_WIDTHS = ["wormhole", "cycle-track", "space-walk", "deep-space-trail", "starpath-tunnel"]; // W149 qualitywidth; review: and a tunnel at its own dashed band's
/** W149 qualitywidth: the Ride quality layer's width from the style's `layers`: at each of QUALITY_ZOOMS a case on those layers' filters
 *  (their own), else the band's match on class, joined by the band's own curve, so it stays in step when the style's widths change.
 *  A layer the style lacks, or whose width steps (curveAt reads only a curve or a fixed width), is left to the band. */
export function qualityWidth(layers) {
  const of = (id) => layers.find((l) => l.id === id), band = of("starpath-band").paint["line-width"]; // W149 qualitywidth
  const readable = (id) => of(id) && of(id).paint["line-width"]?.[0] !== "step"; // W149 qualitywidth (review): never a zoom inside the case
  return [...band.slice(0, 3), ...QUALITY_ZOOMS.flatMap((z) => [z, ["case", ...QUALITY_WIDTHS.filter(readable).flatMap((id) => [of(id).filter, curveAt(of(id).paint["line-width"], z)]), curveAt(band, z)]])]; // W149 qualitywidth
}

/** W90 comfort: the Bike quality layer (app/layers.js): every road with a comfort, in the scale's colour over the road's casing,
 *  under the course; W149 qualitywidth: at the road's own width, from the style's `layers` (qualityWidth). W156 qualitysteps: a lane,
 *  track or path in the bike blue, a worse road in its step's colour (comfortInk), an average one not at all (the filter). W173 quality3:
 *  every other street cars use on the continuum (comfortInk), a footpath plain (the filter, `drawn`). */
export function bikeQualityLayer(layers) {
  const score = ["case", ["has", "comfort_score"], ["to-number", ["get", "comfort_score"]], ["interpolate", ["linear"], ["to-number", ["get", "comfort"]], ...LEVEL_SCORE.flatMap((x, l) => [l, x])]]; // W173 quality3: v16's comfort_score from z14, the level's mean score below, as levelOf (W156 qualitysteps: the level alone)
  const ink = inks(theme); // W156 qualitysteps
  return {
    id: "bike-quality", type: "line", source: "chart", "source-layer": "roads", filter: drawn, minzoom: 11, // W156 qualitysteps; W173 quality3: every road it rates (was the worse streets only)
    layout: { "line-cap": "round", "line-join": "round", visibility: "none",
      "line-sort-key": ["case", ["==", ["get", "bike"], "wormhole"], 99, curveAt(layers.find((l) => l.id === "starpath-band").paint["line-width"], 17)] }, // W149 qualitywidth (review): the bike paths and cycle tracks on top, then the wider street at a junction (its band's z17 width)
    paint: {
      "line-color": ["case", good, ink.good, ["interpolate", ["linear"], score, ...QUALITY_STOPS.flatMap(([at, c]) => [at, ink[c]])]], // W156 qualitysteps; W173 quality3: the continuum on the score, as comfortInk, the blue back (W160 quality2: red and yellow alone)
      "line-width": qualityWidth(layers), // W149 qualitywidth: was one thin line for every road, 0.8 px at z11 to 5 at z18
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.75, 14, 0.95],
    },
  };
}
const good = ["match", ["get", "bike"], GOOD_BIKES, true, false]; // W156 qualitysteps: a lane, track or path, as GOOD_BIKES
/** W160 quality2: the layer's roads: a street with a comfort under average, not a lane, track or path (the Bike lanes layer draws those, and
 *  the two combine) nor a path cars can't use (PATH_CLASSES). */
/** W173 quality3: now every road it rates: a lane, track or path in the blue, and every street cars use on the continuum; a footpath (PATH_CLASSES,
 *  no bike lane) stays plain, as W160 quality2's. */
const drawn = ["all", ["has", "comfort"], ["any", good, ["!", ["match", ["get", "class"], PATH_CLASSES, true, false]]]]; // W173 quality3 (was worse: no lanes, under level 2.5)
/** W160 quality2: now under the bright yellow (1.19:1 on Daystar's ground) and red, the worse streets 1 px wider each side, as below.
 *  W173 quality3: under every road the layer draws (`drawn`), the blue and the continuum.
 *  W156 qualitysteps: Daystar's thin ink edge under the bike blue, which stands 1.25:1 on its ground: the lanes, tracks and paths 1 px wider
 *  each side from z16 (0.4 px to z13, EDGE_PX), in Daystar's ink (--starlight) at 0.85; none on Dark (transparent, EDGE_INK). Shown and hidden with the layer (app/layers.js).
 *  The theme is in the colour, not the opacity, so W148 routepop's preview fade (app/course.js) reads and scales the opacity as the layer's. */
export const EDGE_INK = { dark: "transparent", light: COLOURS.quality.edge }, EDGE_OPACITY = 0.85; // W156 qualitysteps; review: the theme in the colour
const EDGE_PX = (z) => Math.min(2, Math.max(0.8, (z - 11) * 0.4)); // W156 qualitysteps: both sides' px at zoom z, 0.8 to z13 (a 1 px edge drowned its thin line's blue), 2 from z16
export function bikeQualityEdge(layers) { // W156 qualitysteps
  const w = qualityWidth(layers); // W156 qualitysteps
  return { id: "bike-quality-edge", type: "line", source: "chart", "source-layer": "roads", filter: drawn, minzoom: 11, layout: { "line-cap": "round", "line-join": "round", visibility: "none" }, // W156 qualitysteps; W160 quality2: under the worse streets (was the blue's); W173 quality3: under every road the layer draws
    paint: { "line-color": EDGE_INK[theme === "light" ? "light" : "dark"], "line-width": [...w.slice(0, 3), ...w.slice(3).map((x, i, s) => (i % 2 ? ["+", x, EDGE_PX(s[i - 1])] : x))], "line-opacity": EDGE_OPACITY } }; // W156 qualitysteps
} // W156 qualitysteps

/** W90 comfort: a worker that matches courses, reading the world's archives (app/main.js: the stored chart or its prefix, and the
 *  stored packs) as the world does, at the world's zoom, so it asks the tile host nothing the chart wouldn't (W76 privacy).
 *  along(route) -> a promise of comfortAlong's answer for route.geometry, and `ms`, its time in the worker. */
export function comfortWorker(world, url) {
  let worker = null, next = 0;
  const waiting = new Map();
  return {
    async along(route) {
      worker ??= Object.assign(new Worker(import.meta.url, { type: "module" }), { onmessage: ({ data }) => { const w = waiting.get(data.id); waiting.delete(data.id); if (data.error) w.no(new Error(data.error)); else w.ok(data); } });
      const f = world.load.file, file = await (typeof f === "function" ? f() : f), z = world.zoom ?? 15;
      const id = next++, { ways, bare, distance_m, comfort } = route; // W140 dircomfort: comfort
      return new Promise((ok, no) => { waiting.set(id, { ok, no }); worker.postMessage({ id, coords: route.geometry, url: file ? null : url, file, packs: world.load.packs ?? [], zooms: z >= 15 ? [15, 13] : [13], route: { ways, bare, distance_m, comfort } }); }); // W140 dircomfort
    },
  };
}

// Run as a module worker: match the courses the page sends.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const archives = new Map();
  const open = (file, url) => { const key = file ? `file:${file.name}:${file.size}` : url; if (!archives.has(key)) archives.set(key, new PMTiles(file ? new FileSource(file) : url)); return archives.get(key); };
  self.onmessage = async ({ data: { id, coords, url, file, packs, zooms, route } }) => {
    const t0 = performance.now();
    try {
      const list = [open(file, url), ...packs.map((p) => open(p))];
      const read = async (z, x, y) => { // the first archive with the tile, as world.js's firstOf
        let err = null;
        for (const a of list) { try { const r = await a.getZxy(z, x, y); if (r) return decodeRoads(r.data); } catch (e) { err ??= e; } }
        if (err) throw err;
        return null;
      };
      const out = await comfortAlong(coords, read, { zooms, route });
      self.postMessage({ id, ...out, ms: Math.round(performance.now() - t0) });
    } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
  };
}
