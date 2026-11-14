// W54 course (design/app-ui/SPEC.md §69): the stops along a course, as pure functions (no DOM). The places come from the
// search index already on the phone (chart/search/search.js inBox); app/course.js draws the chips and the rows.

import { minutesFor, distLabel, placeName, plainWhat } from "./course-logic.js"; // W60 b: placeName, plainWhat
import { lingo, pick } from "./lingo-mode.js"; // W60 b
import { dur } from "./duration.js"; // W68 fixes

/** The kinds the chips count, in their order (BRIEF §6.2's words, from the lingo pack's labels). */
export const STOP_KINDS = ["tardis", "coolant", "refueling_station", "fuel_depot", "space_dock", "gantry"]; // W67 water: coolant, beside the tardis
export const NEAR_M = 150; // within 150 m of the course
const DETOUR = 1.3; // the streets to a place and back are about 1.3 times as long as the straight line

/** A chip's word for a kind: its lingo label without the name ("Refueling Station {name}" → "Refueling Station"). W60 b: in
 *  Plain, its plain word ("Toilet"), else what the Codex says it is ("Convenience store"). */
export const kindWord = (pack, kind, mode = lingo()) => { // W60 b: mode
  const k = pack?.kinds?.[kind], plain = mode === "meatspace" && (k?.plain && !/\{/.test(k.plain) ? k.plain : plainWhat(pack, kind)); // W60 b; W225 kindwords: plainWhat's label, bare, with its capital
  return plain || (k?.label || kind).replace(/\s*\{[a-z]+\}\s*/g, " ").trim(); // W60 b: plain
};

/** A box around `line` ([lon, lat] points), `m` metres wider each way: [w, s, e, n]. */
export function boxAround(line, m = NEAR_M) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of line) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const dy = m / 111320, dx = m / (111320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [w - dx, s - dy, e + dx, n + dy];
}

/** Where each place is along `line`: its metres along (`at_m`), its metres off it (`off_m`) and its side ("port" or
 *  "starboard", as the ship faces along the course). Kept: within `within` of the course, and past `from_m` (the ship, in
 *  flight). Sorted by `at_m`. */
export function stopsAlong(line, places, { within = NEAR_M, from_m = 0 } = {}) {
  if (!line?.length || line.length < 2) return [];
  const kx = 111320 * Math.cos((line[0][1] * Math.PI) / 180), ky = 111320;
  const xy = line.map(([x, y]) => [x * kx, y * ky]);
  const out = [];
  for (const p of places) {
    const q = [p.lonlat[0] * kx, p.lonlat[1] * ky];
    let best = { d: Infinity, s: 0, side: 0 }, s = 0;
    for (let i = 1; i < xy.length; i++) {
      const a = xy[i - 1], b = xy[i], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy, L = Math.sqrt(L2);
      const u = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2)) : 0;
      const d = Math.hypot(a[0] + u * vx - q[0], a[1] + u * vy - q[1]);
      if (d < best.d) best = { d, s: s + u * L, side: vx * (q[1] - a[1]) - vy * (q[0] - a[0]) };
      s += L;
    }
    if (best.d > within || best.s < from_m) continue;
    out.push({ ...p, at_m: best.s, off_m: best.d, side: best.side > 0 ? "port" : "starboard" });
  }
  return out.sort((a, b) => a.at_m - b.at_m);
}

/** W203 fountains (SPEC §368, her row 5 of 2026-11-08: "If we know that a water fountain is not currently available we should not
 *  suggest it"): is place `p` known to be shut in `d`'s month? The data's `shut` (the tiles' and the index's) is the months a drinking-water
 *  place is known shut, bit m for month m, January 0 (chart/pipeline/Starchart.java shutMonths); none, or data from before it, is open. */
export const shutNow = (p, d = new Date()) => Math.floor((p?.shut || 0) / 2 ** d.getMonth()) % 2 === 1;
/** W203 fountains: the same for the chart's style, a filter true for a feature not known shut in `d`'s month (app/main.js). */
export const openNow = (d = new Date()) => ["!=", ["%", ["floor", ["/", ["to-number", ["get", "shut"], 0], 2 ** d.getMonth()]], 2], 1];

// ---- W209 water3 (SPEC §384, her row 5 of 2026-11-08: "If we know that a water fountain is not currently available we should not suggest
// it ... If we display it at all in the map, we should do it in a way that makes it clear that it has been winterized") ----------------
/** The months Boston turns its outdoor fountains off, from and to (1 = January): W67 water's November to April (§98). No page of the
 *  city's (Boston's or Cambridge's) gives them (§384), so this is the window it kept. */
export const WINTER = [11, 4];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const inWinter = (d) => { const m = d.getMonth() + 1; return m >= WINTER[0] || m <= WINTER[1]; };
/** May place `p` be off for the winter in `d`'s month? A fountain outdoors whose tags don't say its season (the data's `winter`: no
 *  seasonal=no, not indoors, no opening_hours that opens it, no `shut` months), in the window. A fountain known open, known shut (hidden,
 *  §368), or from data before `winter`, never. */
export const offNow = (p, d = new Date()) => Number(p?.winter) === 1 && !p.shut && inWinter(d);
/** Its peek's line: "Usually off from November to April". */
export const offLine = () => { const [a, b] = [MONTHS[WINTER[0] - 1], MONTHS[WINTER[1] - 1]]; return pick(`Usually in cryogenic hibernation, ${a} to ${b}`, `Usually off from ${a} to ${b}`); };
/** The free stops' icon in `d`'s month (`L`, the style's stop-label-free, app/main.js): in the window, its `starchart:winter-icon`, where a
 *  fountain that may be off wears the snowflake (coolant_winter, chart/style/build_style.py); else the plain drop. */
export const winterIcon = (L, d = new Date()) => (inWinter(d) && L.metadata?.["starchart:winter-icon"]) || L.layout["icon-image"];
/** Water's reach: a fountain that may be off is lit only when none known open is this near where the search is from. */
export const REACH_M = 1000;
/** The places of a kind to light (`ps`, nearest first, with their `distance_m`), `limit` of them: none known shut (W203 fountains); in the
 *  window, none that may be off, unless no other is within REACH_M, when the nearest of them all are. */
export function waterPick(ps, limit, d = new Date()) {
  const open = ps.filter((p) => !shutNow(p, d)), on = open.filter((p) => !offNow(p, d));
  return (on.some((p) => p.distance_m <= REACH_M) ? on : open).slice(0, limit);
}
/** A search's rows (`rs`) as Water lights them: none known shut; in the window, none that may be off while one known open is within REACH_M
 *  (`ps`, the drinking water nearest where the search is from, with their `distance_m`), and in the places of those that go, Water's own picks
 *  not among them (W209 water3 fix 2: else "water" could list none, "Not found", with one known open in reach); else those stay, with the snowflake. */
export function waterRows(rs, ps, d = new Date()) {
  const on = ps.some((p) => !shutNow(p, d) && !offNow(p, d) && p.distance_m <= REACH_M);
  const kept = rs.filter((r) => !shutNow(r, d) && !(on && offNow(r, d))), key = (p) => `${p.kind} ${p.lonlat}`, has = new Set(kept.map(key)); // W209 water3 fix 2: kept
  return on ? [...kept, ...waterPick(ps, 8, d).filter((p) => !has.has(key(p))).slice(0, rs.length - kept.length)] : kept; // W209 water3 fix 2: Water's picks in their places, 8 at most
}

/** The chips: [{ kind, n }] in STOP_KINDS' order, a kind with none left out. */
export function stopCounts(stops) {
  return STOP_KINDS.map((kind) => ({ kind, n: stops.filter((s) => s.kind === kind).length })).filter((c) => c.n > 0);
}

/** The minutes a stop adds: there and back from the course, at `v` m/s. */
export const detourMin = (stop, v) => minutesFor(2 * DETOUR * stop.off_m, v);

/** W201 walkstops (SPEC §363, her row 12): a walker's plan (chart/routing/walktransit.js) as a route its stops are counted along: its
 *  walks, each a part with its own line (not the rides, nor a change inside a station, a straight line between its platforms), and their
 *  metres and seconds, all of it walked (walk_s), so the minutes a stop adds are at walking pace (course-logic.js routeSeconds). */
export function walkParts(plan) {
  const parts = (plan?.legs || []).filter((l) => l.type === "walk" && !l.change && l.geometry?.length > 1)
    .map((l) => ({ geometry: l.geometry, distance_m: l.m, time_s: l.time_s, walk_s: l.time_s }));
  const sum = (k) => parts.reduce((a, q) => a + q[k], 0);
  return { parts, distance_m: sum("distance_m"), time_s: sum("time_s"), walk_s: sum("time_s") };
}
/** W201 walkstops review 2: the stops along a plan's walks, joined: a place near two walks once, at the nearer. */
export function onceEach(stops) {
  const m = new Map();
  for (const x of stops) { const k = `${x.kind} ${x.lonlat}`; if (!(m.get(k)?.off_m <= x.off_m)) m.set(k, x); }
  return [...m.values()];
}

/** A stop's row: "Tardis · 0.6 LY along · +1 min" (from the ship, in flight: `from_m`); W60 b: Plain, "Toilet · 0.6 mi along · +1 min".
 *  R2 cardfoot: `dist(m)`, the ride's distance words (on a walk its miles in both modes, SPEC §452). */
export const stopRow = (stop, v, from_m = 0, dist = distLabel) => `${placeName(stop)} · ${dist(stop.at_m - from_m)} along · +${dur(detourMin(stop, v))}`; // W60 b: placeName; W68 fixes: dur // R2 cardfoot: dist

// ---- radiation on the course -------------------------------------------------------------------------
/** The points for app/weather.js along(): every `step` metres of `line`, and its end, each with the minutes to it at the
 *  route's own pace (`total_m` in `time_s`): [{ lonlat, m, s }]. */
export function rainPts(line, total_m, time_s, step = 200) {
  const kx = 111320 * Math.cos((line[0][1] * Math.PI) / 180), at = (s) => ({ s, m: total_m > 0 ? (s / total_m) * (time_s / 60) : 0 });
  const out = [{ lonlat: line[0], ...at(0) }];
  let s = 0, next = step;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]], L = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 111320);
    for (; next <= s + L; next += step) { const u = (next - s) / L; out.push({ lonlat: [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])], ...at(next) }); }
    s += L;
  }
  if (s - out.at(-1).s > 1) out.push({ lonlat: line.at(-1), ...at(s) }); // the landing pad
  return out;
}
/** The chosen card's line: "Radiation meets the course near Union Square, about 25 min in" (5 min steps), or, raining
 *  at the start, "Radiation on the course near Union Square now". */
export function rainLine(place, m) {
  const where = place ? ` near ${place}` : "";
  const min = Math.max(5, Math.round(m / 5) * 5); // W60 b
  return m < 2.5 ? pick(`Radiation on the course${where} now`, `Rain on the route${where} now`) : pick(`Radiation meets the course${where}, about ${dur(min)} in`, `Rain meets the route${where}, about ${dur(min)} in`); // W60 b: Plain's; W68 fixes: dur
}
