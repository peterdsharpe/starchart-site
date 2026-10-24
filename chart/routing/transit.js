// W61 transit (design/app-ui/SPEC.md §87): bike plus comet. The planner over the MBTA's comets that take a bike
// (chart/transit/build_timetable.py's file) and today's bike graph, pure JS with no DOM: it runs in the routing worker
// (worker.js's `comet` message), in Node's tests, and its earn rule on the page.
//
//   const tt = readTimetable(buffer);                         // the file, gunzipped
//   plan(router, tt, from, to, at, { bike })  -> { plans, bike, reason? }   plans: the best few, quickest first
//   earn(result, { wet })                     -> the plan that earns its card, with its `earned`, or null
//
// The search (W59 multimodal's research, §3): one Dijkstra from the start over the bike graph in Quickest's time, bounded
// at 30 min (or the bike's own time, if less), gives the ride to every station; the same backwards from the end gives the
// ride from every station (the edge into v along out[k] is out[k] ^ 1). RAPTOR in two rounds over the day's trips (at most
// one change of train, inside a station) joins them. The best few are then ridden exactly, with router.route, and timed
// again on the same trains or the next ones.
//
// The rules are app/comet-bikes.js's RULES, the table the peeks use, applied to each ride from boarding to leaving: no
// minute of it inside a weekday's no-bike hours, the Blue Line's by its direction. No getting on, off or changing at Park
// Street, Downtown Crossing or Government Center (NO_PLATFORM); riding through is fine. The file holds the Commuter Rail
// trains whose bikes_allowed is 1, and (W102 leftovers) those whose bikes_allowed is 2 on Saturdays and Sundays only.
import { RULES, NO_PLATFORM, boston } from "../../app/comet-bikes.js";

const V_TOP = 12 * 0.44704; // Quickest's costs are seconds at this speed (router.js)
const WALK_MS = 3 * 0.44704; // walking the bike, between an entrance and the junction it snaps to
/** The station's own minutes, wheeling the bike (W59 multimodal §2's penalties), in seconds. */
export const STATION = {
  dismount: 60, // off the bike at the entrance, and the fare; the same back on at the other end
  board: 60, // on the platform a minute before the train
  change: 180, // one change of train in a station, wheeling the bike between platforms
  ride: 30 * 60, // the longest ride to or from a station the search looks at
  top: 3, // the plans ridden exactly
  fewer: 180, // W74 transitfix: a plan with fewer trains goes first while it arrives within this of a quicker one (rank())
};

// ---- the file ----------------------------------------------------------------------------------------
const TYPES = { u1: Uint8Array, u2: Uint16Array, u4: Uint32Array, i4: Int32Array };
/** The timetable file (chart/transit/build_timetable.py), gunzipped: its header, and each trip's minutes at each stop. */
export function readTimetable(data) {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "SCTT") throw new Error("not a Starchart timetable");
  const dv = new DataView(buf), hlen = dv.getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
  const s = {};
  for (const [k, { offset, type, length }] of Object.entries(h.sections)) s[k] = new TYPES[type](buf, 12 + hlen + offset, length);
  const routes = h.routes.map((r) => r.id);
  let trip = 0, dt = 0;
  const patterns = h.patterns.map((p) => {
    const n = p.st.length, times = new Uint16Array(p.n * n), svc = new Uint16Array(p.n);
    for (let i = 0; i < p.n; i++, trip++) {
      svc[i] = s.trip_svc[trip];
      let t = (times[i * n] = s.trip_t0[trip]);
      for (let j = 1; j < n; j++) times[i * n + j] = t += s.dt[dt++];
    }
    const no = (l) => { const a = new Uint8Array(n); for (const i of l || []) a[i] = 1; return a; };
    return { ...p, route: p.r, routeIx: routes.indexOf(p.r), times, svc, noOn: no(p.no_on), noOff: no(p.no_off) };
  });
  const banned = new Set(NO_PLATFORM.map((id) => h.stations.findIndex((x) => x.id === id)).filter((i) => i >= 0));
  const services = h.services.map((x) => Uint8Array.from(x.days.match(/../g) || [], (b) => parseInt(b, 16)));
  return { ...h, patterns, services, banned, days: new Map() };
}

/** "20261012" to a day number (days since 1970-01-01, at noon so a zone can't move it). */
const dayNo = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12) / 86400000);
/** Whether the file covers Boston's date at `now`: "ok", "ended" (past the feed's end: no comet plans) or "early". */
export function coverage(tt, now) {
  const d = dayNo(boston(now).date.replaceAll("-", ""));
  return d > dayNo(tt.feed.end) ? "ended" : d < dayNo(tt.feed.start) ? "early" : "ok";
}

/** The trips of service day `k` (days since the feed's start), per pattern: the indices of its trips that run that day. */
function tripsOn(tt, k) {
  if (tt.days.has(k)) return tt.days.get(k);
  const on = tt.services.map((bits) => k >= 0 && k >> 3 < bits.length && (bits[k >> 3] >> (k & 7)) & 1);
  const out = tt.patterns.map((p) => { const a = []; for (let i = 0; i < p.n; i++) if (on[p.svc[i]]) a.push(i); return a; });
  if (tt.days.size > 3) tt.days.delete(tt.days.keys().next().value);
  tt.days.set(k, out);
  return out;
}

// ---- the rules -----------------------------------------------------------------------------------------
/**
 * May a standard bike ride `route` going `dir` from minute m0 to minute m1 of a day (weekday or not)? app/comet-bikes.js's
 * RULES, the peeks' table: true when bikesNow() would say yes (or "some trains", for a Commuter Rail train the file holds
 * because its bikes_allowed is 1, or 2 on a weekend's service) at every minute of the ride.
 */
export function rideOk(route, dir, weekday, m0, m1 = m0) {
  const rule = RULES.find((r) => r.match.test(route));
  if (rule.never) return false;
  if (rule.always || rule.rack || rule.trip || !weekday) return true;
  const spans = Array.isArray(rule.weekday) ? rule.weekday : rule.weekday[dir] ?? Object.values(rule.weekday).flat();
  const a0 = ((m0 % 1440) + 1440) % 1440, a1 = a0 + (m1 - m0);
  return !spans.some(([a, b]) => a0 < b && a1 >= a);
}

// ---- the bike graph ----------------------------------------------------------------------------------
const scratch = new WeakMap(); // router -> { dist: [Float64Array, Float64Array], done }
// W83 algo: router -> the last forward search { key (its seeds), bound, F }. Below its bound a search's costs are exact, and
// plan() reads none above its own, so a preview from the same start with a bound no larger reuses it (W83 profile c5)
const forward = new WeakMap();
/** Dijkstra over junctions in Quickest's seconds from `seeds` [[junction, s]], forwards or (reverse) backwards, to `bound`. */
function dijkstra(router, seeds, reverse, bound, slot) {
  const N = router.N, { outStart, out, hd, zone } = router, { whole, node } = router.style("quickest");
  let sc = scratch.get(router);
  if (!sc) scratch.set(router, (sc = { dist: [new Float64Array(N), new Float64Array(N)], done: new Uint8Array(N) }));
  const dist = sc.dist[slot], done = sc.done;
  dist.fill(Infinity); done.fill(0);
  let hf = new Float64Array(1 << 14), hq = new Int32Array(1 << 14), n = 0, settled = 0;
  const push = (f, v) => {
    if (n === hf.length) { const a = new Float64Array(2 * n), b = new Int32Array(2 * n); a.set(hf); b.set(hq); hf = a; hq = b; }
    let i = n++;
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hq[i] = hq[p]; i = p; }
    hf[i] = f; hq[i] = v;
  };
  const pop = () => {
    const v = hq[0], lf = hf[--n], lv = hq[n]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hf[i] = hf[c]; hq[i] = hq[c]; i = c; }
    hf[i] = lf; hq[i] = lv; return v;
  };
  for (const [v, c] of seeds) if (c < dist[v]) { dist[v] = c; push(c, v); }
  while (n) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1; settled++;
    const du = dist[u];
    if (du > bound) break;
    if (node[u] === Infinity && du > 0) continue; // a gate that bars bikes
    const wait = (Number.isFinite(node[u]) ? node[u] / V_TOP : 0) + (zone[u] >= 0 ? 7.5 : 0); // half a pulsar, on average
    for (let k = outStart[u], k1 = outStart[u + 1]; k < k1; k++) {
      const d = out[k], v = hd[d], c = du + (reverse ? whole[d ^ 1] : whole[d]) / V_TOP + wait;
      if (c < dist[v]) { dist[v] = c; push(c, v); }
    }
  }
  return { dist, settled };
}

/** Seeds for a place: the two ends of the way it snaps to, with the walk and the part of the way to each. */
function seedsAt(router, ll) {
  const p = router.snap(ll);
  if (!p) return [];
  const { s } = router, L = s.len[p.e], walk = p.d / WALK_MS, perM = router.style("quickest").perM;
  return [[s.from[p.e], walk + L * p.t * perM[2 * p.e + 1] / V_TOP], [s.to[p.e], walk + L * (1 - p.t) * perM[2 * p.e] / V_TOP]];
}

const snaps = new WeakMap(); // timetable -> { router, ent: per station [[lonlat, junction, walk s]] }
/** Each station's entrances on this graph: the file's snapped junction where it still fits, else snapped again. */
function entrances(router, tt) {
  const c = snaps.get(tt);
  if (c && c.router === router) return c.ent;
  const { s } = router;
  const ent = tt.stations.map((st) => st.ent.map(([lon, lat, j, d]) => {
    const ll = [lon, lat], at = (v) => router.metres(ll, [s.lon[v] * 1e-6, s.lat[v] * 1e-6]);
    if (j != null && j < router.N && Math.abs(at(j) - d) < 1.5) return [ll, j, d / WALK_MS];
    const p = router.snap(ll);
    if (!p) return null;
    const a = s.from[p.e], b = s.to[p.e], v = at(a) <= at(b) ? a : b;
    return [ll, v, at(v) / WALK_MS];
  }).filter(Boolean));
  snaps.set(tt, { router, ent });
  return ent;
}

// ---- the trains ----------------------------------------------------------------------------------------
/**
 * RAPTOR in `rounds` rounds over day `k`'s trips. `t0`: seconds after the service day's midnight; `access`: Map station
 * -> seconds from t0 until on its platform; `egress`: Map station -> seconds from its platform to the end. Returns the
 * best journey to each station that has an egress, quickest first: { t (at the end, seconds), start, end, legs:
 * [{ p (pattern), trip, i (boarding stop), j (leaving stop), dep, arr (s) }] }.
 */
export function raptor(tt, k, t0, access, egress, { weekday = true, rounds = 2, prev = null, change = EARN.change } = {}) { // W73 transit: change, her rule (risk())
  const day = tripsOn(tt, k), S = tt.stations.length, P = tt.patterns;
  const sets = [{ trips: day, shift: 0 }];
  if (prev) sets.push({ trips: tripsOn(tt, k - 1), shift: -1440 }); // after midnight: yesterday's last trips, in today's minutes
  if (!tt.byStation) {
    tt.byStation = Array.from({ length: S }, () => []);
    P.forEach((p, pi) => p.st.forEach((s, i) => tt.byStation[s].push([pi, i])));
  }
  const best = new Float64Array(S).fill(Infinity), lab = [new Float64Array(S).fill(Infinity)], from = [new Array(S).fill(null)];
  for (const [s, a] of access) if (!tt.banned.has(s)) { lab[0][s] = t0 + a; best[s] = t0 + a; }
  let marked = [...access.keys()].filter((s) => !tt.banned.has(s));
  for (let r = 1; r <= rounds && marked.length; r++) {
    const prevLab = lab[r - 1], cur = new Float64Array(S).fill(Infinity), back = new Array(S).fill(null);
    lab.push(cur); from.push(back);
    const queue = new Map();
    for (const s of marked) for (const [pi, i] of tt.byStation[s]) if (!queue.has(pi) || queue.get(pi) > i) queue.set(pi, i);
    const now = [];
    for (const [pi, i0] of queue) for (const { trips, shift } of sets) {
      const p = P[pi], n = p.st.length, T = p.times, list = trips[pi];
      if (!list.length) continue;
      let trip = -1, bi = -1;
      const at = (tr, i) => (T[tr * n + i] + shift) * 60;
      for (let i = i0; i < n; i++) {
        const s = p.st[i];
        if (tt.banned.has(s)) continue; // ride through, but never on or off here
        if (trip >= 0 && !p.noOff[i]) {
          const t = at(trip, i);
          if (t < cur[s] && t < best[s] && rideOk(p.route, p.dir, weekday, at(trip, bi) / 60, t / 60)) {
            cur[s] = best[s] = t;
            back[s] = { p: pi, trip, i: bi, j: i, dep: at(trip, bi), arr: t, shift };
            now.push(s);
          }
        }
        const ready = prevLab[s] + (r > 1 ? STATION.change : STATION.board);
        if (prevLab[s] < Infinity && !p.noOn[i] && (trip < 0 || at(trip, i) >= ready)) {
          // the first trip leaving after we're ready, whose ride may start then (the rest is checked on leaving)
          for (const tr of list) {
            const t = at(tr, i);
            if (t < ready || !rideOk(p.route, p.dir, weekday, t / 60)) continue;
            // W74 transitfix: the same trip, boarded where we're ready first (in round 1, the least riding to it), not upstream
            if (trip < 0 || t < at(trip, i) || (tr === trip && prevLab[s] < prevLab[p.st[bi]])) { trip = tr; bi = i; }
            break;
          }
        }
      }
    }
    marked = [...new Set(now)];
  }
  const out = [];
  for (const [s, e] of egress) {
    const all = []; // W73 transit: each round's journey with its changes charged (risk()); W74 transitfix: ranked by rank()
    for (let r = 1; r < lab.length; r++) {
      if (!(lab[r][s] < Infinity)) continue; // W73 transit
      const legs = []; // back from round r: each round's train boarded where the round before arrived
      for (let q = r, x = s; q > 0; q--) { const l = from[q][x]; legs.unshift(l); x = P[l.p].st[l.i]; } // W73 transit: q, r
      all.push({ t: lab[r][s] + e, risk: risk(tt, k, legs, weekday, change), legs }); // W73 transit
    }
    const best = rank(all, (c) => [c.t, c.risk, c.legs.length])[0]; // W74 transitfix
    if (!best) continue; // W73 transit
    const start = P[best.legs[0].p].st[best.legs[0].i]; // W73 transit: best
    if (!access.has(start) || start === s) continue;
    out.push({ ...best, start, end: s }); // W73 transit: risk
  }
  return rank(out, (c) => [c.t, c.risk, c.legs.length]); // W73 transit: charged; W74 transitfix: rank()
}

/** W74 transitfix: journeys or plans in order: the quickest first with each change charged (risk()), but one with fewer trains
 *  ahead of any it arrives within STATION.fewer of (W74A: a change for a minute or two isn't worth it). `key(x)`: [arrival s,
 *  charge s, trains]. */
function rank(list, key) {
  const out = list.map((x) => ({ x, k: key(x) })).sort((a, b) => a.k[0] + a.k[1] - b.k[0] - b.k[1]); // stable: earlier first on a tie
  for (let i = 0; i < out.length; i++) {
    let m = i;
    for (let j = i + 1; j < out.length; j++) if (out[j].k[2] < out[m].k[2] && out[j].k[0] <= out[i].k[0] + STATION.fewer) m = j;
    if (m !== i) out.splice(i, 0, ...out.splice(m, 1));
  }
  return out.map((o) => o.x);
}

/** W73 transit: her reliability rule (w72 walktransit §2.3): each change of train costs half the next train's headway there
 *  (`change.frac`), the wait if the connection is missed half the time, at most `change.s`; the first boarding is free, since
 *  the start can be timed to it. In seconds, for ranking and earning only: no plan's clock moves. */
function risk(tt, k, legs, weekday, change = EARN.change) {
  let s = 0;
  for (const l of legs.slice(1)) {
    const p = tt.patterns[l.p], m = p.st.length, list = tripsOn(tt, k + (l.shift ? -1 : 0))[l.p];
    const at = (tr, i) => (p.times[tr * m + i] + l.shift) * 60;
    const next = list.slice(list.indexOf(l.trip) + 1).find((x) => rideOk(p.route, p.dir, weekday, at(x, l.i) / 60, at(x, l.j) / 60));
    s += Math.min(change.s, change.frac * (next === undefined ? Infinity : at(next, l.i) - at(l.trip, l.i)));
  }
  return s;
}

/** The same trains as `legs` (their patterns and stops), or the next ones, from `ready` (seconds): the legs, or null.
 *  W74 transitfix: the next one on any pattern of the line between the same two stations, the soonest there (its own on a
 *  tie), so a train missed by seconds on a pattern with no later trip falls back to the next, not to no plan. */
function retime(tt, k, legs, ready, weekday) {
  const out = [];
  for (const [n, l] of legs.entries()) {
    const p0 = tt.patterns[l.p], a = p0.st[l.i], b = p0.st[l.j], go = ready + (n ? STATION.change : STATION.board), day = tripsOn(tt, k + (l.shift ? -1 : 0));
    let next = null;
    for (const pi of [l.p, ...tt.patterns.keys()]) { // W74 transitfix: its own pattern first
      const p = tt.patterns[pi], m = p.st.length, i = pi === l.p ? l.i : p.st.indexOf(a), j = pi === l.p ? l.j : p.st.indexOf(b, i + 1);
      if (p.route !== p0.route || p.dir !== p0.dir || i < 0 || j < 0 || p.noOn[i] || p.noOff[j]) continue;
      const at = (tr, x) => (p.times[tr * m + x] + l.shift) * 60;
      const tr = day[pi].find((x) => at(x, i) >= go && rideOk(p.route, p.dir, weekday, at(x, i) / 60, at(x, j) / 60));
      if (tr !== undefined && (!next || at(tr, j) < next.arr)) next = { ...l, p: pi, i, j, trip: tr, dep: at(tr, i), arr: at(tr, j) };
    }
    if (!next) return null;
    out.push(next);
    ready = next.arr;
  }
  return out;
}

// ---- the rides ---------------------------------------------------------------------------------------
/**
 * W59 routes defines the riding with no bike support (`Router.bare`, on its branch): a through road (trunk to tertiary)
 * with no lane or track, not tagged with a separate one beside it, and ridden, not walked. Until it merges, the same rule
 * here over the route's own edges; once router.route() returns `bare`, that is used and this falls away.
 */
const BIKE_SHARED = 1, CLS_TRUNK = 1, CLS_TERTIARY = 4, S_SEPARATE = 4;
const bareEdge = (router, d) => {
  const e = d >> 1, s = router.s;
  if (router.bike(d) > BIKE_SHARED || router.wrong(d) || s.cls[e] < CLS_TRUNK || s.cls[e] > CLS_TERTIARY) return false;
  return !(s.bike_side && ((s.bike_side[e] >> (d & 1 ? 4 : 0)) & S_SEPARATE));
};
/** router.route(q), with `bare_m`: the metres ridden with no bike support. */
export function ride(router, q) {
  let bare = 0;
  if (typeof router.bare !== "function") { // W59 routes not merged yet: count them from the legs the route is described from
    router.describe = function (legs, ...rest) {
      for (const [d, f0, f1] of legs) if (bareEdge(this, d)) bare += this.s.len[d >> 1] * (f1 - f0);
      return Object.getPrototypeOf(this).describe.call(this, legs, ...rest);
    };
  }
  try {
    const r = router.route(q);
    return r && { ...r, bare_m: Math.round(r.bare ? r.bare.reduce((a, [x, y]) => a + y - x, 0) : bare) };
  } finally { delete router.describe; }
}

/** A route's minute-by-minute points [{ lonlat, m }] (m: minutes from now at that point), from `m0`, for the rain. */
export function samples(route, m0 = 0) {
  const g = route.geometry, T = route.time_s / 60, out = [];
  if (!g?.length || !(T > 0)) return out;
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + Math.hypot((g[i][0] - g[i - 1][0]) * 82000, (g[i][1] - g[i - 1][1]) * 111320));
  const L = cum.at(-1);
  for (let m = 0, i = 0; m < T; m++) {
    const w = Math.min(1, T - m), at = L * Math.min(1, (m + w / 2) / T);
    while (i < g.length - 2 && cum[i + 1] < at) i++;
    const u = cum[i + 1] > cum[i] ? (at - cum[i]) / (cum[i + 1] - cum[i]) : 0;
    const j = Math.min(i + 1, g.length - 1);
    out.push({ lonlat: [g[i][0] + (g[j][0] - g[i][0]) * u, g[i][1] + (g[j][1] - g[i][1]) * u], m: m0 + m + w / 2, w });
  }
  return out;
}

const summary = (r, style) => ({ style, time_s: r.time_s, distance_m: r.distance_m, climb_m: r.climb_m, bare_m: r.bare_m, samples: samples(r) });
/** The bike cards to beat: the three styles' routes (the preview's), each { style, time_s, distance_m, climb_m, bare_m, samples }. W105 night: `night`, router.route()'s. */
export function bikeCards(router, from, to, night = false) { // W105 night: night
  return ["wormhole", "flat", "quickest"].map((style) => { const r = ride(router, { from, to, style, night }); return r && summary(r, style); }).filter(Boolean); // W105 night: night
}

// ---- the plan ----------------------------------------------------------------------------------------
/**
 * Bike plus comet from `from` to `to` ([lon, lat]) leaving at `at` (ms). `opts.bike`: the bike cards to beat (bikeCards()),
 * planned here when not given; `opts.all`: every plan found, not only those that could earn a card (EARN's cap); W105 night: `opts.night`, the rides' (router.route()'s, as the app's course re-plans them). Returns { plans, bike, at, stats } with the plans quickest first, or with `reason` and no
 * plans: "ended" (the file is past its feed's end), "early", "far" (no station within reach of both ends).
 * A plan: { legs, total_s (door to door from `at`), ride_s, ride_m, bare_m, climb_m, start, end, lines }.
 */
export function plan(router, tt, from, to, at, opts = {}) {
  const t = performance.now(), stats = {};
  const cov = coverage(tt, at);
  const bike = opts.bike || bikeCards(router, from, to, opts.night); // W105 night: opts.night
  stats.bike_ms = Math.round(performance.now() - t);
  if (cov !== "ok") return { plans: [], bike, at, reason: cov, stats };
  const B = boston(at), k = dayNo(B.date.replaceAll("-", "")) - dayNo(tt.feed.start);
  const t0 = B.min * 60 + Math.floor((at % 60000) / 1000), prev = B.min < 4 * 60;
  const bikeBest = Math.min(...bike.map((b) => b.time_s));
  const bound = Math.min(STATION.ride, Number.isFinite(bikeBest) ? bikeBest : Infinity);
  const t1 = performance.now();
  const seeds = seedsAt(router, from), key = JSON.stringify(seeds), last = forward.get(router); // W83 algo
  const F = last && last.key === key && last.bound >= bound ? last.F : dijkstra(router, seeds, false, bound, 0), R = dijkstra(router, seedsAt(router, to), true, bound, 1); // W83 algo: last.F
  if (F !== last?.F) forward.set(router, { key, bound, F }); // W83 algo
  stats.dijkstra_ms = Math.round(performance.now() - t1); stats.settled = [F.settled, R.settled]; stats.reused = F === last?.F; // W83 algo: reused
  const ent = entrances(router, tt), access = new Map(), egress = new Map(), via = new Map();
  for (let s = 0; s < ent.length; s++) {
    if (!ent[s].length) continue;
    let a = Infinity, e = Infinity, ea = null, ee = null;
    for (const x of ent[s]) {
      const fa = F.dist[x[1]] + x[2], fe = R.dist[x[1]] + x[2];
      if (fa < a) { a = fa; ea = x[0]; }
      if (fe < e) { e = fe; ee = x[0]; }
    }
    const st = tt.stations[s];
    if (a <= bound) access.set(s, a + STATION.dismount + st.access_s);
    if (e <= bound) egress.set(s, st.access_s + STATION.dismount + e);
    via.set(s, [ea, ee]);
  }
  stats.stations = [access.size, egress.size];
  if (!access.size || !egress.size) return { plans: [], bike, at, reason: "far", stats };
  const t2 = performance.now();
  const rules = opts.rules || EARN; // W73 transit: here, for raptor's change
  const found = raptor(tt, k, t0, access, egress, { weekday: B.weekday, prev, change: rules.change }); // W73 transit: change
  stats.raptor_ms = Math.round(performance.now() - t2);
  // the best few, one per pair of stations, ridden exactly; not one that can't earn a card even if its rides come out quicker
  // than estimated (W59 multimodal: the estimates ran -6 % to +18 % of the exact rides; a quarter and a minute of slack lost none on the tuning trips), unless `all`
  const most = bikeBest + Math.min(rules.cap.s, rules.cap.frac * bikeBest); // W73 transit: rules, above
  const seen = new Set(), top = [];
  for (const c of found) {
    const key = `${c.start}>${c.end}`, rides = access.get(c.start) + egress.get(c.end) - 2 * STATION.dismount - tt.stations[c.start].access_s - tt.stations[c.end].access_s;
    if (seen.has(key) || (!opts.all && c.t + c.risk - t0 - 0.25 * rides - 60 > most)) continue; // W73 transit: c.risk
    seen.add(key); top.push(c);
    if (top.length >= STATION.top) break;
  }
  const t3 = performance.now(), plans = [];
  for (const c of top) {
    const S0 = tt.stations[c.start], S1 = tt.stations[c.end];
    const night = opts.night, r0 = ride(router, { from, to: via.get(c.start)[0], style: "quickest", night }), r1 = ride(router, { from: via.get(c.end)[1], to, style: "quickest", night }); // W105 night: the rides the app's course gives after dark
    if (!r0 || !r1) continue;
    const onPlat = t0 + r0.time_s + STATION.dismount + S0.access_s;
    const legs = retime(tt, k, c.legs, onPlat, B.weekday);
    if (!legs) continue;
    const off = legs.at(-1).arr + S1.access_s + STATION.dismount, end = off + r1.time_s;
    plans.push(describe(tt, { from, to, at, t0, r0, r1, legs, S0, S1, onPlat, off, end, in_ll: via.get(c.start)[0], out_ll: via.get(c.end)[1], risk_s: Math.round(risk(tt, k, legs, B.weekday, rules.change)) })); // W62 cometcard: the entrances; W73 transit: risk_s, as retimed
  }
  stats.rides_ms = Math.round(performance.now() - t3); stats.ms = Math.round(performance.now() - t);
  // W73 transit: with each change charged; W74 transitfix: fewer trains first within STATION.fewer (rank())
  return { plans: rank(plans, (p) => [p.total_s, p.risk_s, p.legs.filter((l) => l.type === "train").length]), bike, at, stats };
}

/** A plan's legs and totals: ride, walk_in, wait, train (and a change, and another), walk_out, ride. Times as ms. */
function describe(tt, { at, t0, r0, r1, legs, S0, S1, onPlat, off, end, in_ll, out_ll, risk_s }) { // W62 cometcard: in_ll, out_ll; W73 transit: risk_s
  const ms = (s) => at + (s - t0) * 1000, route = (r, type, m0) => ({ type, time_s: r.time_s, distance_m: r.distance_m, climb_m: r.climb_m, bare_m: r.bare_m, geometry: r.geometry, samples: samples(r, m0) });
  const out = [route(r0, "ride", 0), { type: "walk_in", station: S0.id, name: S0.name, lonlat: in_ll, time_s: STATION.dismount + S0.access_s, ...(S0.stairs ? { stairs: true } : {}) }]; // W62 cometcard: lonlat, the entrance leg 1 lands at
  let ready = onPlat;
  for (const [n, l] of legs.entries()) {
    const p = tt.patterns[l.p], r = tt.routes[p.routeIx], a = tt.stations[p.st[l.i]], b = tt.stations[p.st[l.j]];
    if (n) out.push({ type: "change", station: a.id, name: a.name, time_s: STATION.change });
    out.push({ type: "wait", station: a.id, time_s: Math.round(l.dep - ready - (n ? STATION.change : 0)) });
    out.push({ type: "train", route: p.route, line: r.name, color: r.color, dir: p.dir, head: p.head, from: a.id, from_name: a.name, to: b.id, to_name: b.name,
      dep: ms(l.dep), arr: ms(l.arr), stops: l.j - l.i, time_s: l.arr - l.dep, path: p.st.slice(l.i, l.j + 1).map((x) => tt.stations[x].ll), // W62 cometcard: path, its stations, for the dashed line
      ids: p.st.slice(l.i, l.j + 1).map((x) => tt.stations[x].id) }); // W76 comets: and their ids, for the storm-day check (alerted())
    ready = l.arr;
  }
  out.push({ type: "walk_out", station: S1.id, name: S1.name, lonlat: out_ll, time_s: S1.access_s + STATION.dismount, ...(S1.stairs ? { stairs: true } : {}) }); // W62 cometcard: lonlat, where leg 2 sets out
  out.push(route(r1, "ride", (off - t0) / 60));
  return {
    legs: out, total_s: Math.round(end - t0), risk_s, arrive: ms(end), ride_s: r0.time_s + r1.time_s, ride_m: r0.distance_m + r1.distance_m, // W73 transit: risk_s, its changes' charge
    bare_m: r0.bare_m + r1.bare_m, climb_m: r0.climb_m + r1.climb_m, start: S0.id, end: S1.id,
    lines: [...new Set(legs.map((l) => tt.patterns[l.p].route))],
  };
}

// ---- earning a card ------------------------------------------------------------------------------------
/**
 * When a comet plan earns its card (arclight, 2026-10-19: "it might win on comfort if it's raining or something"), any
 * one of these, against the bike cards; tuned on W32's fifty trips (chart/transit/README.md).
 * - time: at least `time.s` and `time.frac` quicker than the quickest bike card (W59 multimodal's bar);
 * - rain: the nowcast has radiation along every bike card's course as it is ridden, and the plan cuts the wet riding by
 *   `rain.frac` and `rain.s`, at a cost of at most `cap` over the quickest bike card;
 * - comfort: it cuts the riding with no bike support by `bare.frac` and `bare.m` against the bike card with the least of
 *   it, or the climb by `climb.frac` and `climb.m` against the flattest, at the same cap.
 * `cap`: the less of `cap.s` and `cap.frac` of the quickest bike card's time. `horizon`: the nowcast's reach in minutes;
 * past `sure` it is less sure. `change` (W73 transit): her reliability rule, risk(): each change of train counts as
 * `change.frac` of the next train's headway, at most `change.s`, on top of the plan's minutes in every rule above.
 */
export const EARN = {
  time: { s: 300, frac: 0.2 },
  rain: { s: 300, frac: 0.5 },
  bare: { m: 1000, frac: 0.5 },
  climb: { m: 30, frac: 0.5 },
  cap: { s: 600, frac: 0.3 },
  horizon: 120, sure: 60,
  change: { frac: 0.5, s: 1200 }, // W73 transit: half the next train's headway, at most 20 min (w72 walktransit §2.3)
};

/** The wet riding minutes along `pts` ([{ lonlat, m, w }], samples()), by `wet(lonlat, m)`: rain there at that minute,
 *  within the nowcast's reach. { min, late: some of them past `sure` }. */
export function wetMinutes(pts, wet, { horizon = EARN.horizon, sure = EARN.sure } = {}) {
  let min = 0, late = false;
  for (const p of pts) if (p.m <= horizon && wet(p.lonlat, p.m)) { min += p.w ?? 1; if (p.m > sure) late = true; }
  return { min: Math.round(min * 10) / 10, late };
}

/**
 * The comet plan that earns its card, or null: { ...plan, earned: { reason: "time" | "rain" | "comfort", ...numbers } },
 * the first rule that holds, in that order. `wet`: (lonlat, m) => rain there m minutes from now (the nowcast; app/
 * weather.js's along() gives it), or none for a dry ride. `rules`: EARN, or a variant to tune. W76 comets (#40): `paceK`,
 * the pilot's Pace (app/settings.js pace()). The cards show minutes at that pace (the bike cards' all of them, the comet's
 * its last ride: app/comet-card.js), so for a pilot quicker than the router a plan earns on time only while it is still
 * quicker as shown: no "Quicker" card with more minutes than the bike's. Every rule is weighed at the router's pace.
 */
export function earn(result, { wet = null, rules = EARN, paceK = 1 } = {}) { // W76 comets: paceK
  const bike = result.bike || [];
  if (!bike.length || !result.plans?.length) return null;
  const quick = Math.min(...bike.map((b) => b.time_s)), k = Math.max(1, paceK); // W76 comets: k
  const cap = Math.min(rules.cap.s, rules.cap.frac * quick);
  const wetOf = (pts) => (wet ? wetMinutes(pts, wet, rules) : { min: 0, late: false });
  const bikeWet = wet ? bike.map((b) => wetOf(b.samples || [])) : null;
  const leastWet = bikeWet ? Math.min(...bikeWet.map((x) => x.min)) : 0;
  const leastBare = Math.min(...bike.map((b) => b.bare_m ?? Infinity)), leastClimb = Math.min(...bike.map((b) => b.climb_m));
  const cut = (a, b, frac, min) => a - b >= min && b <= (1 - frac) * a;
  for (const p of result.plans) {
    const saves = quick - p.total_s - (p.risk_s || 0), costs = -saves; // W73 transit: its changes charged
    const last = p.legs.findLast((l) => l.type === "ride")?.time_s || 0, paced = quick / k - p.total_s - last * (1 / k - 1); // W76 comets: as the cards show it (a change's charge isn't shown), for a pilot quicker than the router
    if (saves >= Math.max(rules.time.s, rules.time.frac * quick) && paced > 0) return { ...p, earned: { reason: "time", saves_s: saves, bike_s: quick, comet_s: p.total_s } };
    if (costs > cap) continue;
    if (wet && leastWet > 0) {
      const w = p.legs.filter((l) => l.type === "ride").map((l) => wetOf(l.samples)), mine = w.reduce((a, x) => a + x.min, 0);
      if (cut(leastWet * 60, mine * 60, rules.rain.frac, rules.rain.s)) {
        return { ...p, earned: { reason: "rain", wet_bike_min: leastWet, wet_comet_min: Math.round(mine * 10) / 10, costs_s: costs, late: bikeWet.some((x) => x.late) || w.some((x) => x.late) } };
      }
    }
    if (Number.isFinite(leastBare) && cut(leastBare, p.bare_m, rules.bare.frac, rules.bare.m)) return { ...p, earned: { reason: "comfort", kind: "bare", bike_m: leastBare, comet_m: p.bare_m, costs_s: costs } };
    if (cut(leastClimb, p.climb_m, rules.climb.frac, rules.climb.m)) return { ...p, earned: { reason: "comfort", kind: "climb", bike_m: leastClimb, comet_m: p.climb_m, costs_s: costs } };
  }
  return null;
}

// ---- the live check ------------------------------------------------------------------------------------
/** One request a plan, the same for every pilot (BRIEF §8's api-v3.mbta.com): the bike alerts, with what to match. W76 comets:
 *  and the riders' (V3's default activities, BOARD, EXIT and RIDE), for the storm-day effects (STORM). */
export const ALERTS = "https://api-v3.mbta.com/alerts?filter[activity]=BRINGING_BIKE,BOARD,EXIT,RIDE&fields[alert]=informed_entity,active_period,effect,header";
/** W76 comets (#17, w72 season §2): the effects that drop a plan when they touch one of its trains, whatever their activities. */
export const STORM = ["SUSPENSION", "SHUTTLE", "STATION_CLOSURE"];
/**
 * The lines of a plan's trains that an active alert names (V3's JSON:API reply), at its trains' times: a BRINGING_BIKE one
 * on the line, at its boarding or leaving station, or on its kind of line. W76 comets: and a storm-day one (STORM) on the
 * whole line or its kind, a SUSPENSION or SHUTTLE naming two of the train's stations (a stretch it rides: one alone is the
 * stretch's end, where the train still runs on this side), a STATION_CLOSURE naming its boarding or leaving station; each
 * of the last two only in the train's direction when the alert gives one ("skipping Hawes St outbound"). W78 walkalerts:
 * `bike: false` (app/walk.js's walker, who takes none) skips the BRINGING_BIKE ones, so only the storm-day ones count; a
 * leg's kind is its `rtype` where it has one (the walker's buses are 3, the Green Line 0).
 */
export function alerted(json, plan, { bike = true } = {}) { // W78 walkalerts: bike
  const trains = plan.legs.filter((l) => l.type === "train"), hit = new Set();
  for (const a of json?.data || []) {
    const at = a.attributes || {}, periods = at.active_period?.length ? at.active_period : [{}], storm = STORM.includes(at.effect); // W76 comets: storm
    for (const l of trains) {
      const active = periods.some((p) => (!p.start || Date.parse(p.start) <= l.arr) && (!p.end || Date.parse(p.end) >= l.dep));
      const ents = at.informed_entity || [], mine = (e) => (!e.route || e.route === l.route) && (e.direction_id == null || e.direction_id === l.dir); // W76 comets: its line, its way
      const named = bike && ents.some((e) => (e.activities || ["BRINGING_BIKE"]).includes("BRINGING_BIKE") // W78 walkalerts: bike
        && (e.route ? e.route === l.route : e.stop ? [l.from, l.to].includes(e.stop) : e.route_type != null && e.route_type === (l.rtype ?? routeType(l.route)))); // W78 walkalerts: rtype
      const stormed = storm && (ents.some((e) => !e.stop && !e.trip && (e.route ? mine(e) : e.route_type != null && e.route_type === (l.rtype ?? routeType(l.route)))) // W76 comets: the whole line, or its kind (not one trip); W78 walkalerts: rtype
        || (at.effect === "STATION_CLOSURE" ? ents.some((e) => mine(e) && [l.from, l.to].includes(e.stop)) // W76 comets
          : new Set(ents.filter((e) => mine(e) && (l.ids || [l.from, l.to]).includes(e.stop)).map((e) => e.stop)).size >= 2)); // W76 comets
      if (active && (named || stormed)) hit.add(l.route); // W76 comets: stormed
    }
  }
  return [...hit];
}
const routeType = (r) => (r.startsWith("CR-") ? 2 : r.startsWith("Boat-") ? 4 : 1);

// ---- the live departure (W73 transit) ---------------------------------------------------------------------
/** W73 transit: the coming departures at a plan's boarding station on its first train's line and direction, each with its
 *  scheduled time to find the plan's own train by: one request a stop and line, the same for everyone boarding there, never a
 *  position (BRIEF §8's api-v3.mbta.com). */
export const departuresUrl = (l) => `https://api-v3.mbta.com/predictions?filter[stop]=${encodeURIComponent(l.from)}&filter[route]=${encodeURIComponent(l.route)}` +
  `&filter[direction_id]=${l.dir}&include=schedule&fields[prediction]=departure_time,schedule_relationship&fields[schedule]=departure_time`;
/**
 * W73 transit: the plan with its first train at its predicted time (departuresUrl()'s reply), the train found by its scheduled
 * departure. Its arrival and the plan's end move with it; a change keeps its next train while it is still caught. `live:
 * true` when a prediction set the time; the plan as timed with `live: false` when none is found for that train (none yet,
 * no reply, or a reply whose trains don't name it: the subway's added trains have no schedule). null when that train is
 * gone: cancelled or skipped there, leaving before the pilot is on the platform, or late enough to miss the change.
 */
export function departure(json, plan) {
  const i = plan.legs.findIndex((l) => l.type === "train"), t = plan.legs[i], wait = plan.legs[i - 1];
  const sched = new Map((json?.included || []).filter((x) => x.type === "schedule").map((x) => [x.id, Date.parse(x.attributes?.departure_time)]));
  let mine = null, off = 60000;
  for (const p of json?.data || []) {
    const s = Math.abs(sched.get(p.relationships?.schedule?.data?.id) - t.dep); // NaN for an added train, or no departure here
    if (s < off) { mine = p; off = s; }
  }
  if (!mine) return { ...plan, live: false };
  const a = mine.attributes || {}, dep = Date.parse(a.departure_time);
  if (a.schedule_relationship === "CANCELLED" || a.schedule_relationship === "SKIPPED") return null;
  if (!Number.isFinite(dep)) return { ...plan, live: false };
  const d = Math.round((dep - t.dep) / 1000), legs = plan.legs.slice();
  if (wait.time_s + d < STATION.board) return null; // it leaves before the pilot is on the platform
  legs[i - 1] = { ...wait, time_s: wait.time_s + d };
  legs[i] = { ...t, dep, arr: t.arr + dep - t.dep, live: true };
  const n = legs.findIndex((l, x) => x > i && l.type === "train");
  if (n < 0) return { ...plan, legs, total_s: plan.total_s + d, arrive: plan.arrive + dep - t.dep, live: true };
  if (legs[n - 1].time_s - d < 0) return null; // the change missed
  legs[n - 1] = { ...legs[n - 1], time_s: legs[n - 1].time_s - d }; // the wait for the next train
  return { ...plan, legs, live: true };
}

// ---- the words, for W62's card -----------------------------------------------------------------------
/** W61 transit: the words W62's card will need, in SCUL's (a train is a comet, a bike a ship, rain radiation) and plain. */
export const WORDS = {
  card: { scul: "By comet", plain: "By train" },
  board: { scul: "{line} {t} at {station}", plain: "{line} {t} at {station}" },
  time: { scul: "{n} min sooner", plain: "{n} min sooner" },
  rain: { scul: "{n} min less radiation", plain: "{n} min less rain" },
  bare: { scul: "{n} less with the transports", plain: "{n} less beside traffic" },
  climb: { scul: "{n} fewer posi g-wells", plain: "{n} less climbing" },
  stairs: { scul: "Stairs at {station}", plain: "Stairs at {station}" },
  unchecked: { scul: "Not checked for alerts", plain: "Not checked for alerts" },
  ended: { scul: "The comets' timetable is out of date", plain: "The train timetable is out of date" },
};
export const word = (k, vars = {}, mode = "scul") => WORDS[k][mode].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
