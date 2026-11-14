// W211 walkride (design/app-ui/SPEC.md §396), her row 41 (2026-11-09 17:29): "When I am taking a walking route and I get on a
// train, the app does not understand that I am on the train. This is made worse by the fact that there is often no GPS signal
// in the subway."
//
// A walk's ride (course.js nav.leg, W79 walkgo §148), and a bike + T course's train (W62 cometcard §90; W212 bikeride §402, her rows 2
// and 3 of 11-09: "whether it's on foot or on a bike"), one watch and one set of words for both: when the ride begins by itself,
// where her train is by its timetable (and, online, the MBTA's prediction for it), and what a fix on the way means. No DOM here:
// course.js draws the card; main.js mounts mountRideLive, the one request, with the comets' limiter. Every clock is the wall's
// (Date.now(), ms), so the watch is plain data that a resumed page keeps (W190 statefacts).
//
//   rideWatch(l, door)        -> the watch's state for ride leg `l` (walktransit.js: path, at, dep, arr), `door` the walk's end
//   rideFix(w, l, f)          -> a fix { lonlat, now, estimated }: "off" | "board" | "walked" | "unboard" | "out" | "past" | "away" | null
//   rideBeat(w, l, now)       -> the clock: "board" (signal lost at its stop) | "cue" | "due" | null
//   rideAt(w, l, now)         -> { left, next, arr, dep, due }: the stops to go, the next one, when she gets off, when it leaves
//   rideUrl(l), rideLive(...) -> the MBTA's prediction for her train at her stop: it names her stop, line and direction, never a position
//   mountRideLive({ leg, limiter }) -> { tick, stats }: asks it every RIDE_MS while she rides, the app in sight and online
//   ridePlace(w, l, now, here, ms) -> W222 ontrain (§433): on board, her one place along her line (ride-line.js), never back
//   WORDS                     -> the ride card's words, [SCUL, Plain]
import { metres } from "./geo.js";
import { rideLine, pointAt } from "./ride-line.js"; // W222 ontrain (SPEC §433): a ride's line on its tracks
import { MBTA } from "./comets-logic.js";
import { LEAVE_M } from "./comet-card.js";
import { busName, midName } from "./walk-card.js"; // R2 sandworm
import { LOST_MS } from "./fixnote.js";
import { MASSPORT } from "../chart/routing/transit.js"; // as bus-live.js: the MBTA has no word on Massport's shuttles

export const RIDE = {
  stop_m: LEAVE_M, // at a stop: within 150 m of it (the walk's end, or the stop's own point), as W62's leave rule
  lost_ms: LOST_MS, // signal lost at its stop this long: underground, so the ride begins (5 s, when GPS lost would say so)
  walk_mps: 3, // along the line faster than this is the train: a brisk walk is 1.8 m/s, a jog 3
  line_m: 250, // on the line: this near the straight lines between its stops (the tracks bend between them)
  move_m: 200, // and this far along it from the stop she boards at
  span_m: 200, // the speed over this much of the line at least, from her latest fix this far behind: GPS's noise, 3-8 m, and one bad fix under 100 m off can't fake it
  trail_ms: 300000, // the fixes kept for it: a bus held at a light, or a fix every few minutes, still measures
  gone_m: 300, // having been at its stop, this far from it otherwise: she walked on
  out_m: 400, // on board, a fix this near her stop is her out of the station: the next walk, from there
  // W222 ontrain (SPEC §433): her line is its tracks where the T's lines have them (ride-line.js rideLine); line_m stays the straight line's
  track_m: 60, // on its tracks: this near them, and twice her fix's accuracy more (the T's lines lie a few metres to 15 m off the rails)
  bike_mps: 10, // with a bike, a train is faster than this over span_m (she rides 4-8 m/s, an e-bike up to 9); a bus with a bike as on foot: walk_mps
  going_m: 50, // along the line faster than a walk over this much: on her way out of the station, so the walk's course takes no fix
  still_ms: 10000, // past her stop, or off her line: her fixes this long within still_m is a stop (a station's dwell), where she's planned for again
  still_m: 30, // ...: a train standing or a walk's 10 s, with GPS's noise
  glide_ms: 300, // her place on board glides on to where it moves, never a snap (the camera's 200-400 ms)
  step_m: 15, // a move further than this between two frames is a glide (a train goes under 1 m a frame)
};

/** Each stop's time (ms) on ride leg `l`, from the stop she boards at to hers: the timetable's (ownTimes()), stops that share a time
 *  each with their own (apart()). */
export function rideTimes(l) {
  return apart(ownTimes(l), l.path);
}
/** The timetable's own: the plan's (walktransit.js `at`), moved with its departure (a live one, W73), else spread evenly from its
 *  departure to its arrival (a plan kept from before the times). */
function ownTimes(l) {
  const n = l.path.length - 1;
  if (Array.isArray(l.at) && l.at.length === n + 1) return l.at.map((t) => t - l.at[0] + l.dep);
  return l.path.map((_, i) => l.dep + ((l.arr - l.dep) * i) / Math.max(1, n));
}

/** R1 busstop (SPEC §440): the MBTA gives whole minutes, so a bus's stops often share one, and a ride whose last two did was due at
 *  the stop before hers. Each run of stops at one time `at` (ms, in place) is spread by distance along `path`, from that time toward
 *  the next stop's own; a run that ends at her stop, over the 59 s after it. A stop with a time of its own keeps it. */
function apart(at, path) {
  const n = at.length - 1;
  let sm = null;
  for (let a = 0, b; a < n; a = b + 1) {
    for (b = a; b < n && at[b + 1] === at[a]; ) b++;
    if (b === a) continue;
    sm ??= stopsM(path);
    const e = Math.min(b + 1, n), span = b < n ? at[e] - at[a] : 59000, d = sm[e] - sm[a];
    for (let q = a + 1; q <= b; q++) at[q] = at[a] + span * (d > 0 ? (sm[q] - sm[a]) / d : (q - a) / (e - a));
  }
  return at;
}

/** Where `p` is against the ride's path (its stops, joined straight): `d` its distance from the path in metres, `m` how far along
 *  (from the first stop; beyond the last stop, past it), `past` beyond her stop, along the way the train goes on. */
export function onLine(path, p) {
  let best = { d: Infinity, m: 0, past: false }, m0 = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], [kx, ky] = scale(a);
    const bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky, px = (p[0] - a[0]) * kx, py = (p[1] - a[1]) * ky, len2 = bx * bx + by * by, len = Math.sqrt(len2);
    const u = len2 ? (px * bx + py * by) / len2 : 0, last = i === path.length - 1, t = Math.max(0, last ? u : Math.min(1, u));
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < best.d) best = { d, m: m0 + t * len, past: last && u > 1 };
    m0 += len;
  }
  return best;
}

/** Metres a degree of longitude and of latitude near `a`: the stops are a few km apart, so flat is near enough. */
const scale = (a) => [111320 * Math.cos((a[1] * Math.PI) / 180), 110540];
/** The stops' distances along the path (m), from its first stop, as onLine() measures them. */
const stopsM = (path) => path.reduce((o, p, i) => { if (i) { const a = path[i - 1], [kx, ky] = scale(a); o.push(o[i - 1] + Math.hypot((p[0] - a[0]) * kx, (p[1] - a[1]) * ky)); } return o; }, [0]);
/** The timetable's time (ms, unshifted) at `m` along the path: between two stops, by the distance. */
function timeAt(l, m) {
  const at = rideTimes(l), sm = rideLine(l).sm, n = sm.length - 1; // W222 ontrain: along its line
  if (m >= sm[n]) return at[n];
  let i = 1;
  while (i < n && sm[i] < m) i++;
  const f = sm[i] > sm[i - 1] ? (m - sm[i - 1]) / (sm[i] - sm[i - 1]) : 1;
  return at[i - 1] + f * (at[i] - at[i - 1]);
}

/** The metres along `line` her train is at `t` (ms, unshifted) by the timetable: between two stops, by the time. */
function metresAt(l, line, t) {
  const at = rideTimes(l), sm = line.sm, n = at.length - 1;
  let k = 0;
  while (k < n - 1 && at[k + 1] <= t) k++;
  return t <= at[0] ? 0 : t >= at[n] ? sm[n] : sm[k] + (at[k + 1] > at[k] ? ((sm[k + 1] - sm[k]) * (t - at[k])) / (at[k + 1] - at[k]) : sm[k + 1] - sm[k]);
}
/** A watch measured on another line (the T's lines read meanwhile, a page from before them) moves to this one: her place by where it was
 *  (`at`), her fixes' trail anew. */
function sync(w, line) {
  if (w.on === line.key) return;
  if (w.on) { w.s = w.at ? onLine(line.pts, w.at).m : 0; w.trail = []; }
  Object.assign(w, { on: line.key, shown: null, glide: null });
}
/**
 * On board, her place on ride leg `l`'s line at `now` (ms, the wall's), for the avatar: `here`, the pose of a fresh fix (main.js, within
 * RIDE.lost_ms of one), leads where it is on the line; with none, the timetable, shifted by how late her train runs (a fix's, the
 * MBTA's prediction). Never behind the place before (`w.s`): a fix or a shift behind it holds it till the train catches up. A move on
 * glides (RIDE.glide_ms, by `ms`, the frame's clock). Returns { lonlat, heading, s }: the point, the way the line goes, its metres.
 */
export function ridePlace(w, l, now, here = null, ms = now) {
  const line = rideLine(l);
  sync(w, line);
  const o = here && onLine(line.pts, here), s = (w.s = Math.max(w.s || 0, o && o.d <= RIDE.line_m ? o.m : metresAt(l, line, now - (w.shift || 0))));
  if (w.glide && !(ms - w.glide.t >= 0 && ms - w.glide.t < RIDE.glide_ms)) { w.glide = null; w.shown = s; } // a glide done is at its end
  if (!w.glide && w.shown != null && s - w.shown > RIDE.step_m) w.glide = { a: w.shown, t: ms };
  const g = w.glide, u = g ? (ms - g.t) / RIDE.glide_ms : 1, shown = (w.shown = g ? g.a + (s - g.a) * (1 - (1 - u) ** 3) : s), p = pointAt(line, shown);
  w.at = p.ll;
  return { lonlat: p.ll, heading: p.heading, s: shown };
}

/**
 * W222 ontrain (SPEC §433, the integrator's ruling of 11-12): past her stop, or on a train that isn't the route's, she is planned for again
 * only where she can get off, never between two stations. Her fixes since (`st`, aboardWatch()) say: "moving", faster than a walk; "stop",
 * once they have stayed within RIDE.still_m for RIDE.still_ms (a station's dwell, or off and standing), once a stop (the first, or one she
 * went to fast since the last, RIDE.gone_m from it); "off", at a walk RIDE.gone_m from the last stop with no fast move since; else null.
 * Off at her stop by GPS, the watch starts there (`stop`), and once the train has stood (`stood`: still as above, its dwell), faster than
 * a jog: the train took her on past it. Its braking into the stop is never that: GPS has her off 150 m out. With a bike (`bike`), faster
 * than she rides (RIDE.bike_mps), so the bike course after it takes her fixes.
 */
export const aboardWatch = (stop = null, bike = false) => ({ at: [], stop, fast: !stop, stood: !stop, vmin: bike ? RIDE.bike_mps : stop ? 2 * RIDE.walk_mps : RIDE.walk_mps }); // stop: off at her stop by GPS (course.js): on, only if a train takes her on
export function aboard(st, p, now) {
  st.at = st.at.filter((x) => now - x.now <= RIDE.still_ms + 5000);
  st.at.push({ now, ll: p.slice() });
  if (st.stop && !st.fast && metres(st.stop, p) > RIDE.gone_m) return "off"; // walked on from where she was planned for
  const old = st.at.findLast((x) => now - x.now >= RIDE.still_ms - 1500); // the latest of them about RIDE.still_ms ago or more
  if (old && st.at.every((x) => x.now < old.now || metres(x.ll, p) <= RIDE.still_m)) {
    if (!st.stood && st.stop) st.stop = p.slice(); // off at her stop by GPS 150 m out: RIDE.gone_m from where the train stood, not from that fix
    st.stood = true;
    if (st.stop && !(st.fast && metres(st.stop, p) > RIDE.gone_m)) return null;
    Object.assign(st, { stop: p.slice(), fast: false });
    return "stop";
  }
  const o = st.at.find((x) => now - x.now <= RIDE.still_ms), dt = (now - o.now) / 1000;
  if (st.stood && dt >= 3 && metres(o.ll, p) / dt > (st.vmin || RIDE.walk_mps)) { st.fast = true; return "moving"; }
  return null;
}

/** Which ride a watch is for. */
export const rideKey = (l) => `${l.route}|${l.dir}|${l.from}|${l.dep}`;
/** The timetable's time (ms) where fix `p` is (`o` its onLine()): at a stop on the way, that stop's (the train stands there), else
 *  between two stops by the distance. */
const timeHere = (l, p, o) => { const i = l.path.findIndex((q, k) => k && metres(p, q) <= RIDE.stop_m); return i > 0 ? rideTimes(l)[i] : timeAt(l, o.m); };
/** The watch for ride leg `l`: the walk to it ends at `door` (the station's entrance), and she isn't on board yet. `inside`: the
 *  time she's at its stop by the timetable, with no fix (a change in the station, off the ride before), else null. */
export const rideWatch = (l, door = null, inside = null) => ({ key: rideKey(l), door, phase: "wait", how: "", seen: inside == null ? null : { lonlat: l.path[0].slice(), now: inside, m: 0, at: true },
  trail: inside == null ? [] : [{ now: inside, m: 0 }], atStop: inside, shift: 0, cued: false, due: false, live: null, again: false }); // trail: her fixes of the last RIDE.trail_ms, { now, m }

/** Is `p` at the stop she boards at: within RIDE.stop_m of its own point or of the walk's end. */
const atBoard = (w, l, p) => metres(p, l.path[0]) <= RIDE.stop_m || (!!w.door && metres(p, w.door) <= RIDE.stop_m);
/** When she boards: the planned train, or, at the stop only after it left, the next of its line there (the plan's `next`, W189), else then. */
function startOf(w, l) {
  const at = w.atStop ?? l.dep;
  if (at <= l.dep) return l.dep;
  return (l.next || []).find((t) => t >= at) ?? at;
}
function board(w, how, shift, s = 0) { // W222 ontrain: s, her place on its line
  Object.assign(w, { phase: "ride", how, shift, cued: false, due: false, s, shown: null, glide: null, going: false });
  return "board";
}

/**
 * A real fix (`f.estimated`, W31 navview's along a course, is no fix of hers): what it means for the ride.
 * - Anywhere, within RIDE.stop_m of her stop: she gets off there ("off", the next walk from it, as W79's leave rule).
 * - Waiting (walking to the stop, or at it): along the line RIDE.move_m and more from it, faster than a walk since her latest fix
 *   RIDE.span_m behind (so a walker's GPS noise is no train, and a bus that stood at a light moves again), she's on the train
 *   ("board"); having been at the stop, RIDE.gone_m from it otherwise, she walked on ("walked": the walk again, as today).
 *   W222 ontrain: the line is its tracks (rideLine), her corridor RIDE.track_m and twice her fix's accuracy (`f.accuracy`), and wherever
 *   she got on; with a bike (`f.bike`) on a train, faster than she rides (RIDE.bike_mps). Faster than a walk over RIDE.going_m only,
 *   or by the fix's own speed (`f.speed`, the phone's) on along the line, she's on her way (`w.going`: the walk's course takes no fix
 *   till it's sure: a walk's course calls off route at the first 20 m a train takes her from it).
 * - On board: back at the stop she boarded at, she never boarded ("unboard"); within RIDE.out_m of her stop off the line, or once
 *   the timetable has her there, she's out of the station ("out": the next walk from where she is; past her stop too, as far as she
 *   could walk since its arrival); past her stop ("past"), or off the line before then ("away"), a new plan. Elsewhere on the line
 *   (near her stop too, a bus's or a train's in the open), the train is where she is: its time there says how late it runs.
 */
export function rideFix(w, l, f) {
  if (!f?.lonlat || f.estimated) return null;
  const line = rideLine(l), p = f.lonlat, now = f.now, o = onLine(line.pts, p), toHer = metres(p, l.path.at(-1)); // W222 ontrain: its line, on its tracks
  sync(w, line); // W222 ontrain
  w.trail = w.trail.filter((x) => now - x.now <= RIDE.trail_ms);
  const vmin = f.bike && l.mode !== "bus" ? RIDE.bike_mps : RIDE.walk_mps, faster = (span) => { const q = w.trail.findLast((x) => x.m <= o.m - span), dt = q ? (now - q.now) / 1000 : 0; return !!q && (dt <= 0 || (o.m - q.m) / dt >= vmin); }; // W222 ontrain: vmin, a bike's on a train
  const fast = faster(RIDE.span_m); // a stopped clock (a test's) and RIDE.span_m on: no walk does that
  const here = atBoard(w, l, p), on = o.d <= corridor(line, o.m) + 2 * (f.accuracy || 0); // W222 ontrain: on, its corridor by her fix's accuracy
  w.seen = { lonlat: p.slice(), now, m: o.m, at: here };
  const was = w.trail.at(-1); // W222 ontrain: her fix before this one
  w.trail.push({ now, m: o.m });
  if (toHer <= RIDE.stop_m) return "off";
  if (w.phase === "wait") {
    w.going = false; // W222 ontrain
    if (here) { w.atStop ??= now; return null; }
    if (on && fast && o.past) return "past"; // on the train and already past her stop: never seen boarding
    if (on && fast && o.m >= RIDE.move_m) return board(w, "moving", now - timeHere(l, p, o), o.m); // W222 ontrain: wherever she got on
    if (on && (faster(RIDE.going_m) || (f.speed >= vmin && !!was && o.m > was.m))) { w.going = true; return null; } // W222 ontrain: on her way out along the line (or the phone's speed says so from the first metres), not yet sure: the walk's course takes no fix (course.js)
    return w.atStop != null && metres(p, l.path[0]) > RIDE.gone_m && (!w.door || metres(p, w.door) > RIDE.gone_m) ? "walked" : null;
  }
  if (here) { w.phase = "wait"; return "unboard"; } // the next train, by a move or a lost signal
  const r = rideAt(w, l, now), moving = goes(w, p, now); // W222 ontrain: moving faster than a walk, she's on a train, never out walking
  if (toHer <= RIDE.out_m && (o.d > RIDE.line_m || r.due) && !moving) return "out";
  if (o.past) return !moving && r.due && toHer <= ((now - r.arr) / 1000) * RIDE.walk_mps ? "out" : "past"; // out by a far exit and on, else still on the train
  if (o.d > RIDE.line_m) return moving ? (r.due ? "past" : "away") : r.due ? "out" : "away"; // W222 ontrain: moving past its arrival off the line, her train went on past her stop
  w.shift = now - timeHere(l, p, o); // the train is where she is: the latest of a fix and a prediction says how late it runs
  if (o.m > (w.s || 0)) { w.s = o.m; w.at = p.slice(); } // W222 ontrain: ahead, her place moves on; behind it, it holds till the train catches up
  return null;
}

/** W222 ontrain: the corridor at `m` along `line`: on its tracks RIDE.track_m, a pair of stops joined straight (no way on them) RIDE.line_m. */
function corridor(line, m) {
  const k = line.sm.findIndex((x) => x >= m);
  return line.key === "track" && !line.flat?.[k < 0 ? line.sm.length - 2 : Math.max(0, k - 1)] ? RIDE.track_m : RIDE.line_m;
}
/** W222 ontrain: on board, her fixes of the last RIDE.still_ms (`w.go`) have her faster than a walk over 4 s or more. */
function goes(w, p, now) {
  w.go = (w.go || []).filter((x) => now - x.now <= RIDE.still_ms);
  w.go.push({ now, ll: p.slice() });
  const o = w.go[0], dt = (now - o.now) / 1000;
  return dt >= 4 && metres(o.ll, p) / dt > RIDE.walk_mps;
}

/** The clock, as often as the card is drawn: the ride begins with her at its stop when the signal's lost there for RIDE.lost_ms;
 *  on board, "cue" once as it leaves the stop before hers, "due" once at the arrival. Its departure passing with her last fix at the
 *  stop is no boarding by itself: a fix a second there is her on the platform (a late train), and no fix for 5 s is the lost signal. */
export function rideBeat(w, l, now) {
  if (w.phase === "wait") {
    const s = w.seen;
    return s?.at && now - s.now >= RIDE.lost_ms ? board(w, "lost", Math.max(0, startOf(w, l) - l.dep)) : null;
  }
  const r = rideAt(w, l, now);
  if (!w.cued && r.left <= 1) { w.cued = true; return "cue"; }
  if (!w.due && r.due) { w.due = true; return "due"; }
  return null;
}

/** The ride at `now`, by the timetable shifted by how late her train runs: `left` the stops to go (0 once due), `next` the index
 *  of the next stop on `l.path`, `arr` when it reaches her stop and `dep` when it leaves the one she boards at (ms), `due` its
 *  arrival passed. */
export function rideAt(w, l, now) {
  const at = rideTimes(l), n = at.length - 1, t = now - (w.shift || 0);
  let k = 0;
  while (k < n && at[k + 1] <= t) k++;
  return { left: n - k, next: Math.min(n, k + 1), arr: at[n] + (w.shift || 0), dep: at[0] + (w.shift || 0), due: t >= at[n], moving: t >= at[0] };
}

/** The MBTA's predictions for ride leg `l` at her stop, on its line and direction (as bus-live.js's busUrl at the stop a bus is
 *  caught at): the same for everyone riding there, never a position. */
export const rideUrl = (l, key = "") => `${MBTA}/predictions?filter[stop]=${encodeURIComponent(l.to)}&filter[route]=${encodeURIComponent(l.route)}` +
  `&filter[direction_id]=${l.dir}&fields[prediction]=arrival_time,departure_time,schedule_relationship&sort=arrival_time${key ? `&api_key=${encodeURIComponent(key)}` : ""}`;
/**
 * Of rideUrl's reply, her train's arrival at her stop: the trip chosen before (`w.live.trip`), else the first due there at or after
 * the arrival the watch has now, two minutes early at most (R1 busstop: from her stop's own timetable minute, as the MBTA's
 * prediction is, never apart()'s 59 s past it). It sets how late the train runs (`w.shift`), so the stops to go and the time she
 * gets off follow it. Returns "gone" when the chosen trip is no longer predicted there (it arrived), else whether it moved the ride.
 */
export function rideLive(w, l, json, now) {
  const rows = (json?.data || []).map((x) => ({ trip: x.relationships?.trip?.data?.id ?? null, arr: Date.parse(x.attributes?.arrival_time ?? x.attributes?.departure_time ?? "") }))
    .filter((r) => Number.isFinite(r.arr) && r.arr >= now - 60000);
  const was = w.live?.trip;
  if (was && !rows.some((r) => r.trip === was)) return "gone";
  const want = ownTimes(l).at(-1) + (w.shift || 0), r = was ? rows.find((x) => x.trip === was) : rows.find((x) => x.arr >= want - 120000);
  if (!r) return false;
  w.live = { trip: r.trip, arr: r.arr, at: now };
  w.shift = r.arr - rideTimes(l).at(-1);
  return true;
}

export const RIDE_MS = 15000; // the wait between two asks, as the bus's (bus-live.js BUS_MS)
/**
 * Mount it: `leg()` is course.js's nav.leg (null when not in flight), `limiter` the comets' (app/comets.js). tick() from the frame
 * loop asks when one is due: only on board a ride (never a Massport shuttle), in sight and online; it stops once her train is no
 * longer predicted at her stop (it arrived). Returns { tick, stats }.
 */
export function mountRideLive({ leg, limiter, key = "", fetchFn = (u, o) => fetch(u, o), ms = () => performance.now(), now = () => Date.now(),
  visible = () => document.visibilityState === "visible", online = () => navigator.onLine !== false }) {
  const stats = { requests: 0, urls: [] };
  let at = -Infinity, asking = false, done = "";
  async function ask(w, l) {
    asking = true; at = ms(); stats.requests++;
    const url = rideUrl(l, key);
    stats.urls.push(url);
    let json = null;
    try {
      const r = await fetchFn(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
      limiter.answer(r.status, Date.now());
      json = r.ok ? await r.json() : null;
    } catch { json = null; }
    asking = false;
    if (json && leg()?.ride === w && w.phase === "ride" && rideLive(w, l, json, now()) === "gone") done = w.key;
  }
  function tick() {
    const g = leg(), w = g?.n === 0 && g.ride?.phase === "ride" ? g.ride : null, l = w && (g.walk ? g.plan.legs[g.i] : g.legs.trains[g.k || 0]); // W212 bikeride (SPEC §402): a bike + T course's train too, its k-th
    if (!l || l.route?.startsWith(MASSPORT) || w.key === done || asking || !visible() || !online() || ms() - at < RIDE_MS || !limiter.take(Date.now())) return;
    ask(w, l);
  }
  return { tick, stats };
}

/** Ride leg `l`'s line as the card says it: "Red Line" (SCUL: "Red Line comet"; a boat no comet), "Bus 83" (SCUL: "Sandworm 83"; R2 sandworm). */
const lineOf = (l) => (l.mode === "bus" ? busName(l) : l.route.startsWith("Boat-") ? l.line : [`${l.line} comet`, l.line]);
const pickAll = (v, f) => (Array.isArray(v) ? v.map(f) : f(v));
/** "Off …"'s line, [SCUL, Plain]: "the Red Line comet" and "the Red Line" (`comet` false: no "comet", the short words); a bus "sandworm 83"
 *  and "bus 83", the Silver Line and a shuttle by their own names (R2 sandworm's busName, merged at integration). */
const offOf = (l, comet = true) => {
  const [s, b] = l.mode === "bus" ? busName(l).map((n) => midName(n, true)) : [`the ${l.line}`, `the ${l.line}`];
  return [`${s}${comet && l.mode !== "bus" && !l.route.startsWith("Boat-") ? " comet" : ""}`, b];
};

export const WORDS = {
  /** The card's words on board: the line, her stop and the stops to go. */
  riding: (l, left) => pickAll(lineOf(l), (n) => `${n} to ${l.to_name} · ${left > 1 ? `${left} stops to go` : left === 1 ? "next stop" : "arriving"}`),
  /** Its foot: the next stop, or, when hers is next, where to get off. */
  next: (name) => `Next: ${name}`,
  /** One stop before hers: a pill, with a buzz (the card's foot says where to get off); and its words where the whole won't fit. */
  cue: (l) => `Next stop: ${l.to_name}`,
  cueShort: (l) => `${l.to_name} next`,
  // 0.1.99: no line for a lost signal on board (was `underground`, "No GPS underground: following the timetable"): her row of
  // 2026-11-10, "Dismissing it at every ride is annoying". The card shows the ride; the speed reads "–" (UX rule 57)
  /** A fix past her stop, or off her line: a new plan from where she is, once (W222 ontrain: at a stop, said as it's made). */
  past: (l) => [`Past ${l.to_name}: a new course from here`, `Past ${l.to_name}: a new plan from here`],
  away: (l) => { const b = offOf(l); return [`Off ${b[0]}: a new course from here`, `Off ${b[1]}: a new plan from here`]; },
  /** W222 ontrain: as it's seen, while the train still moves: the plan comes at its next stop. */
  wait: {
    past: (l) => [`Past ${l.to_name}: a new course at the next stop`, `Past ${l.to_name}: a new plan at the next stop`],
    away: (l) => { const b = offOf(l); return [`Off ${b[0]}: a new course at the next stop`, `Off ${b[1]}: a new plan at the next stop`]; },
  },
  /** W222 ontrain: their words where the whole would reach the avatar (a narrow screen with large text: one line), both modes. */
  short: { past: (l) => [`Past ${l.to_name}`, `Past ${l.to_name}`], away: (l) => offOf(l, false).map((n) => `Off ${n}`) }, // [SCUL, Plain]: SCUL's bus is a sandworm here too
};
