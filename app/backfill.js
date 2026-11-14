// W228 backfill (design/app-ui/SPEC.md §477, her row 1 of the 11-13 evening; UX rule 88): back from another app on a route, the
// stretch she was away for is filled from the route itself, where the plan makes it plain, and marked as filled. The one pure
// function that decides it; app/main.js hands it the route, the last fix before she left (A), the first good fix after she is
// back (B) and her pace, and gives the answer to the ride's record (app/blackbox.js Recorder.fill) and its distance.
// Node tests it (app/tests/backfill.test.mjs).
import { metres } from "./geo.js";

/** How near the route a fix must be to be on it: the on-course corridor (app/course-logic.js OFF_M); how much faster than her
 *  pace the stretch may have gone (twice: a fast spell, never a car or a bus), and the pace its moving time is counted at at
 *  most (half: slower is a stop, say for coffee, which isn't riding). `back_m`: how far either side of A's place along the
 *  route A is looked for, and `step_m` the steps B's is looked for in. A rise counts once it is `rise_m` above the lowest point
 *  since, as the ride's own climb counts GPS heights (app/logbook.js FlightStats). */
export const FILL = { off_m: 40, fast: 2, slow: 0.5, back_m: 100, rise_m: 3, step_m: 20 };

/** The climb, in metres, of the route's height profile `elev` ([[metres along, height]], the router's) from `s0` to `s1`. */
export function climbOf(elev, s0, s1, rise = FILL.rise_m) {
  if (!elev?.length) return 0;
  const at = (s) => { // the profile's height at s, between its points
    if (s <= elev[0][0]) return elev[0][1];
    const i = elev.findIndex((e) => e[0] >= s);
    if (i < 0) return elev.at(-1)[1];
    const [a, za] = elev[i - 1], [b, zb] = elev[i];
    return b > a ? za + ((zb - za) * (s - a)) / (b - a) : zb;
  };
  let ref = at(s0), up = 0;
  for (const z of [...elev.filter((e) => e[0] > s0 && e[0] < s1).map((e) => e[1]), at(s1)]) {
    if (z < ref) ref = z;
    else if (z - ref >= rise) { up += z - ref; ref = z; }
  }
  return up;
}

/**
 * The filled stretch, or null. `course` is the route being followed (chart/prototype/events.js Course: length, slice,
 * distanceTo); `a`, the last fix before she left ({lonlat, t, s}: s, how far along the route it was put then); `b`, the first
 * good fix after she is back ({lonlat, t}); `aboard` on either, on a train or a bus then (§433's, never filled); `v`, her pace for
 * how she travels on it (m/s, riding or walking); `elev`, the route's height profile (or none). Times in ms on one clock. It says
 * no when she was aboard, A wasn't on the route, B isn't on it, B isn't further along than A, or the stretch went faster than
 * twice her pace. Else {pts, ts, m, climb_m, moving_s}: the route's own line from A's
 * place to B's ([lon, lat]), their times spread from A's to B's at an even speed, its length, its climb, and its moving time,
 * the lesser of the time away and the stretch at half her pace.
 */
export function backfill({ course, a, b, v, elev = null }, k = FILL) {
  if (!course?.length || !a?.lonlat || !b?.lonlat || !(v > 0) || !(b.t > a.t)) return null;
  if (a.aboard || b.aboard) return null; // a train's or a bus's leg: the on-train rule's
  const L = course.length, s = Number.isFinite(a.s) ? a.s : 0;
  const pa = course.distanceTo(a.lonlat, Math.max(0, s - k.back_m), Math.min(L, s + k.back_m));
  if (!(pa.d <= k.off_m)) return null; // A wasn't on the route
  const away = (b.t - a.t) / 1000, reach = Math.min(L, pa.s + k.fast * v * away + k.off_m);
  let pb = null; // B's place: the first pass of the route by it from A's place on, within what twice her pace could reach (a route
  for (let x = pa.s; x < reach; x += k.step_m) { // that comes back past B later is passed by it twice; the nearer pass may be the later)
    const n = course.distanceTo(b.lonlat, x, Math.min(reach, x + k.step_m));
    if (n.d <= k.off_m) { if (!pb || n.d < pb.d) pb = n; } else if (pb) break;
  }
  if (!pb) return null; // B isn't on it (or only behind A, or out of her reach)
  const m = pb.s - pa.s;
  if (!(m > 0)) return null; // B isn't further along
  if (m / away > k.fast * v) return null; // too fast for her pace
  const pts = [], cum = [];
  for (const p of course.slice(pa.s, pb.s)) { // a place where A or B falls on a point of the route is that point once
    const d = pts.length ? metres(pts.at(-1), p) : 0;
    if (pts.length && d < 1) { pts[pts.length - 1] = p; continue; }
    pts.push(p); cum.push((cum.at(-1) ?? 0) + d);
  }
  const total = cum.at(-1) || 1, span = b.t - a.t;
  // at an even speed, strictly between A's time and B's and each after the last, so the track's order holds
  const ts = [];
  for (const c of cum) ts.push(Math.max((ts.at(-1) ?? a.t) + 1, a.t + 1 + Math.round((c / total) * (span - 2))));
  return { pts, ts, m, climb_m: climbOf(elev, pa.s, pb.s, k.rise_m), moving_s: Math.min(away, m / (k.slow * v)) };
}

/**
 * The stretch from A to the route's end, or null, for a ride that arrived there (the route touched down) while only rough fixes
 * came back (indoors at her destination, the phone never good again before the wait ended). `r`, the first of them ({lonlat, t,
 * accuracy_m, aboard}), lies within its own accuracy of the route's end; then it is backfill()'s, B being the route's end at r's time
 * (her pace, aboard, further along). Else null: the gap stays.
 */
export function toEnd({ course, a, r, v, elev = null }, k = FILL) {
  if (!course?.length || !r?.lonlat) return null;
  const end = course.pointAt(course.length);
  if (!(metres(r.lonlat, end) <= r.accuracy_m)) return null; // not plainly at the route's end
  return backfill({ course, a, b: { lonlat: end, t: r.t, aboard: r.aboard }, v, elev }, k);
}
