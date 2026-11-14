// W53 turns (SPEC §67): the turn list's rows and the course strip's shape, as pure functions (no DOM). app/turns.js draws them.
//
// The rows are the course's instructions (chart/routing/instructions.js, from the router's `maneuvers[]`) in the turn
// card's own words (app/course.js tick(), SPEC §44's table: port and starboard), with the distance from the start. The
// strip is the router's `elev` [[at_m, z_m]] and `ways` [[at_m, kind]] (chart/routing/router.js describe()).

import { cardMove, turnWords, crossWords, thenWords } from "../chart/prototype/course.js"; // W212 walkcross: crossWords; W212 turnline: thenWords
import { turnPicture, turnAlt } from "./turn-pictures.js"; // W217 turnicons (SPEC §416): a jog's two turns one picture, a rotary as it is
import { FT } from "./course-logic.js";
import { lingo, pick } from "./lingo-mode.js"; // W60 b

const PLAIN = new Set(["depart"]);

/** The turn card's words for a turn: "Port onto Starpath Beacon", "Third exit onto …", "Bear to port" (app/course.js tick()).
 *  W60 b: `mode`, the Words setting's: Plain's "Left onto Beacon Street", with the road's plain name. */
export function cardWords(ins, roadName, mode = lingo()) { // W60 b: mode
  if (ins.turn === "cross") return crossWords(ins, mode, roadName && roadName.replace(/^the /, "")); // W212 walkcross (SPEC §398): "Cross Cambridge Street", "Cross the street"
  return roadName ? `${cardMove(ins, mode)} onto ${roadName.replace(/^the /, "")}` : turnWords(ins, mode).replace(/^./, (c) => c.toUpperCase());
}

/** W212 turnline (SPEC §403), her row 8.3: the card's line with the turn after it when the two are one move (CourseFlight
 *  thenOf): "Turn right, then left", "Right onto Beech Street, then left"; SCUL "Turn to starboard, then port". */
export const cardThen = (words, then, mode = lingo()) => (then ? `${words}, then ${thenWords(then.turn, mode)}` : words); // W212 turnline

/** The list's rows: each turn, then the landing pad. `name(ins)`: the road's SCUL name or null; `pulsar(ins)`: a pulsar at it. */
export function turnRows(instructions, { name = () => null, pulsar = () => false, stop = () => false, pad = "Landing pad", side = null, mode = lingo() } = {}) { // W60 b: mode; W86 stops: stop(ins), a stop sign at it
  const p = mode === "meatspace", sides = p ? { port: "on the left", starboard: "on the right" } : { port: "to port", starboard: "to starboard" }; // W60 b
  const rows = [];
  for (const ins of instructions || []) {
    if (PLAIN.has(ins.turn)) continue;
    if (ins.turn === "arrive") {
      rows.push({ ins, at_m: ins.along_m, glyph: "arrive", text: sides[side] ? `${pad}, ${sides[side]}` : pad, mark: null, pad: true }); // W60 b: sides
      continue;
    }
    // a pulsar or black hole at the turn is marked as the call says it ("At the pulsar, …", "Orbit the black hole.")
    const mark = ins.turn === "black_hole" ? (p ? "rotary" : "black hole") : pulsar(ins) ? (p ? "traffic light" : "pulsar") : stop(ins) ? "stop sign" : null; // W60 b: Plain's; W86 stops: the same in both
    rows.push({ ins, at_m: ins.along_m, glyph: turnPicture(ins, null, p), alt: turnAlt(ins, p), text: cardWords(ins, name(ins), mode), mark, pad: false }); // W60 b: mode; W217 turnicons: turnPicture (a file's name or a rotary's own picture), its words; W219 sculgreen: p, SCUL's rotary in its green
  }
  return rows;
}

// ---- the course strip -----------------------------------------------------------------------------
/** The strip's hue for a way kind: cyan for wormholes and protected lanes, red for transport lanes, lavender for the rest. */
export function wayHue(kind) {
  if (kind === "wormhole" || kind === "shielded_starpath") return "wormhole";
  if (kind === "transport_lane") return "transport";
  if (kind === "space_walk") return "walk";
  return "starpath";
}
export const STEEP = 0.06, SMOOTH_M = 50, STEP_M = 10;
/** W111 flatride (SPEC §218, OSS review #13): the strip's least scale, in metres. A rise under it is drawn to it, so 2 m
 *  along the Charles is a tenth of the strip, not a hill; the golden trips' rises run 2.7–65 m, median 9.7 m. */
export const FLAT_M = 20;

/** The height at `s` along the route, between the junctions' heights. */
export function heightAt(elev, s) {
  if (!elev?.length) return 0;
  if (s <= elev[0][0]) return elev[0][1];
  for (let i = 1; i < elev.length; i++) {
    const [s1, z1] = elev[i];
    if (s <= s1) { const [s0, z0] = elev[i - 1]; return s1 > s0 ? z0 + ((z1 - z0) * (s - s0)) / (s1 - s0) : z1; }
  }
  return elev.at(-1)[1];
}

/** Climbs of 6 % or more, the grade smoothed over 50 m (the heights are SRTM at the junctions): [[s0, s1], ...]. */
export function steepRuns(elev, total) {
  const runs = [];
  if (!elev?.length || total < SMOOTH_M) return runs;
  const h = SMOOTH_M / 2;
  let open = null;
  for (let s = 0; s <= total; s += STEP_M) {
    const a = Math.max(0, s - h), b = Math.min(total, s + h);
    const g = b > a ? (heightAt(elev, b) - heightAt(elev, a)) / (b - a) : 0;
    if (g >= STEEP && b - a >= h) { if (!open) open = [s, s]; open[1] = s; } else if (open) { runs.push(open); open = null; }
  }
  if (open) runs.push(open);
  return runs.map(([s0, s1]) => [Math.max(0, s0 - STEP_M / 2), Math.min(total, s1 + STEP_M / 2)]);
}

/** The strip between `from` and `to` (metres along): its silhouette's points [[s, z]], the heights' range, the way runs
 *  [{ s0, s1, hue }], the steep runs [[s0, s1]] and (W104 oss2) the unpaved runs, `dust`, each cut to the window.
 *  W111 flatride: `scale`, the metres the strip's height stands for: the range, or FLAT_M if that is more. */
export function stripModel(route, from = 0, to = route?.distance_m ?? 0) {
  const elev = route?.elev || [], ways = route?.ways || [], total = route?.distance_m ?? 0;
  from = Math.max(0, from); to = Math.min(total, to);
  const pts = [];
  const n = Math.max(2, Math.min(200, Math.ceil((to - from) / STEP_M) + 1));
  for (let i = 0; i < n; i++) { const s = from + ((to - from) * i) / (n - 1); pts.push([s, heightAt(elev, s)]); }
  const zs = pts.map((p) => p[1]), lo = Math.min(...zs), hi = Math.max(...zs);
  const runs = [];
  for (let i = 0; i < ways.length; i++) {
    const s0 = Math.max(from, ways[i][0]), s1 = Math.min(to, ways[i + 1]?.[0] ?? total);
    if (s1 > s0) runs.push({ s0, s1, hue: wayHue(ways[i][1]) });
  }
  const steep = steepRuns(elev, total).map(([a, b]) => [Math.max(from, a), Math.min(to, b)]).filter(([a, b]) => b > a);
  const dust = (route?.dust || []).map(([a, b]) => [Math.max(from, a), Math.min(to, b)]).filter(([a, b]) => b > a); // W104 oss2: the unpaved stretches
  return { from, to, pts, lo, hi, scale: Math.max(hi - lo, FLAT_M), range_ft: Math.round((hi - lo) / FT), runs, steep, dust }; // W104 oss2: dust; W111 flatride: scale
}

// ---- W219 preview3 (SPEC §424), her row 10: a bike row's bar is its heights -------------------------------------
/** Her design's numbers (shots/route-compare-mockups/04-bike-elevation-rows, round 4), px: the bar a compact row draws and the
 *  graph's base, outside to outside; its ink edge; the hills' full height over the base; how far each end eases into its cap; the
 *  least height scale (her 80 ft: a flat ride's hills stay low); the points along. */
export const PROFILE = { bar: 12, edge: 1.2, hill: 35, taper: 34, flat_m: 80 * FT, n: 120 };
/** The rows' one height scale: the lowest point of any of `routes` and the metres a full hill stands for (their highest less that, or
 *  PROFILE.flat_m if that is more), so taller means hillier from row to row. */
export function profileScale(routes, P = PROFILE) {
  const zs = routes.flatMap((r) => (r?.elev?.length ? stripModel(r).pts.map((p) => p[1]) : []));
  if (!zs.length) return { lo: 0, scale: P.flat_m };
  const lo = Math.min(...zs), hi = Math.max(...zs);
  return { lo, scale: Math.max(hi - lo, P.flat_m) };
}
/** A route's graph `w` px wide on the scale `{ lo, scale }`: its outline `d` (a bar's base with its half-round caps, the hills standing
 *  on the base's top edge and easing into the caps), its height `h`, and where a point `s` metres along is: `xAt(s)`, `yAt(s)` (the
 *  outline's top there), `sAt(x)`; `zAt(s)` its height, m. Its lowest point is on the base only when it is the rows' lowest. */
export function profileShape(route, w, { lo = 0, scale = PROFILE.flat_m } = {}, P = PROFILE) {
  const m = stripModel(route), E = P.edge, half = E / 2, R = (P.bar - E) / 2, h = P.bar + P.hill, len = Math.max(1, m.to - m.from);
  const x0 = half + R, x1 = Math.max(x0, w - half - R), yb = h - half, yt = yb - 2 * R; // the caps' centres; the base's bottom and top edges
  const zAt = (s) => (route?.elev?.length ? heightAt(route.elev, s) : lo);
  const ease = (d) => { const u = Math.min(1, Math.max(0, d / P.taper)); return u * u * (3 - 2 * u); }; // no wall or notch at an end
  const xAt = (s) => x0 + ((Math.min(m.to, Math.max(m.from, s)) - m.from) / len) * (x1 - x0);
  const yAt = (s) => { const x = xAt(s); return yt - (Math.max(0, zAt(s) - lo) / scale) * P.hill * ease(Math.min(x - x0, x1 - x)); };
  const sAt = (x) => m.from + Math.min(1, Math.max(0, (x - x0) / Math.max(1e-6, x1 - x0))) * len;
  const f = (v) => +v.toFixed(2), pts = Array.from({ length: P.n + 1 }, (_, i) => { const s = m.from + (len * i) / P.n; return `${f(xAt(s))} ${f(yAt(s))}`; });
  const d = `M${f(x0)} ${f(yb)}A${f(R)} ${f(R)} 0 0 1 ${f(x0)} ${f(yt)}L${pts.join("L")}L${f(x1)} ${f(yt)}A${f(R)} ${f(R)} 0 0 1 ${f(x1)} ${f(yb)}Z`;
  return { d, w, h, x0, x1, yt, yb, xAt, yAt, sAt, zAt, from: m.from, to: m.to, dust: m.dust };
}

/** The range at the strip's right end: "↕ 40 ft" ("flat" under 1 ft); W73 polish: not "+40 ft", which read as a climb beside the facts' "▲3 ft". */
export const rangeLabel = (m) => (m.range_ft >= 1 ? `↕ ${m.range_ft} ft` : "flat"); // W73 polish

/** In flight: the turns already flown and those still ahead of `s` (a turn within 5 m is still ahead, as the card has it). */
export function splitAt(rows, s) {
  const k = rows.findIndex((r) => r.at_m > s + 5 || r.pad);
  return k < 0 ? { flown: rows.length, ahead: [] } : { flown: k, ahead: rows.slice(k) };
}
export const flownWords = (n) => pick(n === 1 ? "1 turn flown" : `${n} turns flown`, n === 1 ? "1 turn done" : `${n} turns done`); // W60 b: Plain's

// ---- W54 flight (SPEC §70): warnings for steps and steep parts ---------------------------------------
export const STEEP_MERGE_M = 50; // two steep runs this close are one climb
export const CLUSTER_M = 50; // W67 graph3: Space Junk or tracks this close to the last are one warning
/** The course's warnings, by distance from the start: each flight of steps (the router's `steps`, from the graph's steps
 *  pieces) and each climb of 6 % or more (the strip's steepRuns). [{ at_m, to_m, warn: "steps" | "steep", grade }].
 *  W67 graph3: and the Space Junk (the router's `junk`) and track crossings (`tracks`), each cluster within CLUSTER_M one
 *  warning: "junk" and "tracks". */
export function warnings(route) {
  const total = route?.distance_m ?? 0, out = [];
  for (const [a, b] of route?.steps || []) out.push({ at_m: a, to_m: b, warn: "steps", grade: 0 });
  for (const [warn, at] of [["junk", route?.junk || []], ["tracks", (route?.tracks || []).map((t) => t[0])]]) { // W67 graph3
    let last = null; // W67 graph3
    for (const a of at) if (last && a - last.to_m <= CLUSTER_M) last.to_m = a; else out.push((last = { at_m: a, to_m: a, warn, grade: 0 })); // W67 graph3
  } // W67 graph3
  const runs = [];
  for (const [a, b] of steepRuns(route?.elev, total)) { const last = runs.at(-1); if (last && a - last[1] <= STEEP_MERGE_M) last[1] = b; else runs.push([a, b]); }
  for (const [a, b] of runs) out.push({ at_m: a, to_m: b, warn: "steep", grade: Math.round((100 * (heightAt(route.elev, b) - heightAt(route.elev, a))) / Math.max(1, b - a)) });
  return out.sort((x, y) => x.at_m - y.at_m);
}
/** W196 voice4 (SPEC §344), her row 1: "Walk your bike ahead." where the course walks the bike, the router's `walks` ([from_m,
 *  to_m]: a footway or sidewalk bikes may not ride, the wrong way up a one-way, steps), as warnings [{ at_m, to_m, warn: "walk" }]:
 *  walks within CLUSTER_M of each other one, said where it walks WALK_CALL_M or more besides its steps ("Steps ahead." says
 *  those). Voice only: no row in the turn list, where the map's footprints show it. None on a walk, all of which is walked. */
export const WALK_CALL_M = 15; // as instructions.js WALK_SAY_M's "Walk across."; on 222 rides of 1 to 9 km, 125 of 284 walks are shorter (a crossing, a kerb's link)
export function walkWarnings(route, foot = false) {
  if (foot) return [];
  const steps = route?.steps || [], out = [];
  const walked = (a, b) => b - a - steps.reduce((m, [x, y]) => m + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  let last = null;
  for (const [a, b] of route?.walks || []) {
    if (last && a - last.to_m <= CLUSTER_M) { last.to_m = b; last.m += walked(a, b); }
    else out.push((last = { at_m: a, to_m: b, warn: "walk", grade: 0, m: walked(a, b) }));
  }
  return out.filter((w) => w.m >= WALK_CALL_M).map(({ m, ...w }) => w);
}
/** W200 parkwalk (SPEC §357): where a bike course walks through a park whose rules ban riding (the router's `parks`, [from_m,
 *  to_m, name]), one warning per park [{ at_m, to_m, warn: "park", name }]: its walks within CLUSTER_M one, from WALK_CALL_M walked.
 *  A row in the turn list (and a line under the cards, parkLine), not a voice line: "Walk your bike ahead." says it. None on a walk. */
export function parkWalks(route) { // W200 parkwalk
  if (route?.style === "foot") return []; // W200 parkwalk: on foot it's all walked
  const out = []; // W200 parkwalk
  for (const [a, b, name] of route?.parks || []) { const w = out.findLast((x) => x.name === name); if (w && a - w.to_m <= CLUSTER_M) { w.to_m = b; w.m += b - a; } else out.push({ at_m: a, to_m: b, warn: "park", grade: 0, name, m: b - a }); } // W200 parkwalk
  return out.filter((w) => w.m >= WALK_CALL_M).map(({ m, ...w }) => w); // W200 parkwalk
} // W200 parkwalk
/** W200 parkwalk: "Walk your bike through Boston Common" (SCUL: your ship, the codex's), the parks in order, as the app's lists. */
const parkWords = (names) => { const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]; return pick(`Walk your ship through ${list}`, `Walk your bike through ${list}`); }; // W200 parkwalk
/** W200 parkwalk: the preview's line under the cards for the chosen route, or "" where it walks through none. */
export const parkLine = (route) => { const names = [...new Set(parkWalks(route).map((w) => w.name))]; return names.length ? parkWords(names) : ""; }; // W200 parkwalk
/** A warning's row in the turn list: "Steps", "Negi g-well, 8 %", with its glyph: the g-well's (design/glyphs/), or the
 *  steps drawn in CSS (`icon`, app/turns.css). W67 graph3: "Space Junk" with its glyph, "Comet tracks" drawn in CSS. */
const WARN_ROW = { // W67 graph3: [glyph in design/glyphs/, icon in app/turns.css, SCUL, Plain]
  steps: [null, "steps", "Steps", "Steps"], junk: ["space_junk", null, "Space Junk", "Barrier"], tracks: [null, "tracks", "Comet tracks", "Tracks"], // W67 graph3
  park: [null, "walk", null, null], // W200 parkwalk: the walker (turns.css), its words parkWords'
}; // W67 graph3
export const warnRow = (w) => { const k = WARN_ROW[w.warn]; return { ins: { turn: "warn", along_m: w.at_m }, at_m: w.at_m, glyph: null, src: k ? k[0] : "g_well_negi", icon: k ? k[1] : null, // W67 graph3: WARN_ROW
  text: w.warn === "park" ? parkWords([w.name]) : k ? pick(k[2], k[3]) : pick(`Negi g-well, ${w.grade} %`, `Steep climb, ${w.grade} %`), mark: null, pad: false, warn: w.warn }; }; // W60 b: Plain's climb; W67 graph3; W200 parkwalk: a park's
/** The turn rows with the warnings among them, in order along the course, the landing pad last. */
export function withWarnings(rows, warns) {
  const out = rows.filter((r) => !r.pad), pad = rows.filter((r) => r.pad);
  for (const w of warns) out.push(warnRow(w));
  return [...out.sort((a, b) => a.at_m - b.at_m), ...pad];
}
/** In flight, the warning due at `s` (metres along) at `v` m/s: the first not yet said whose start is within
 *  max(WARN_M, WARN_S seconds) ahead, and not passed. */
export const WARN_M = 100, WARN_S = 20;
export function warnDue(warns, s, v, said) {
  const lead = Math.max(WARN_M, WARN_S * Math.max(0, v || 0));
  return warns.find((w) => !said.has(w) && w.at_m >= s - 5 && w.at_m - s <= lead) ?? null;
}
