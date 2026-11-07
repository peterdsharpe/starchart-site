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
  const k = pack?.kinds?.[kind], plain = mode === "meatspace" && (k?.plain && !/\{/.test(k.plain) ? k.plain : plainWhat(pack, kind).replace(/^(a|an) /, "")); // W60 b
  return plain ? plain[0].toUpperCase() + plain.slice(1) : (k?.label || kind).replace(/\s*\{[a-z]+\}\s*/g, " ").trim(); // W60 b: plain
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

/** The chips: [{ kind, n }] in STOP_KINDS' order, a kind with none left out. */
export function stopCounts(stops) {
  return STOP_KINDS.map((kind) => ({ kind, n: stops.filter((s) => s.kind === kind).length })).filter((c) => c.n > 0);
}

/** The minutes a stop adds: there and back from the course, at `v` m/s. */
export const detourMin = (stop, v) => minutesFor(2 * DETOUR * stop.off_m, v);

/** A stop's row: "Tardis · 0.6 LY along · +1 min" (from the ship, in flight: `from_m`); W60 b: Plain, "Toilet · 0.6 mi along · +1 min". */
export const stopRow = (stop, v, from_m = 0) => `${placeName(stop)} · ${distLabel(stop.at_m - from_m)} along · +${dur(detourMin(stop, v))}`; // W60 b: placeName; W68 fixes: dur

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
