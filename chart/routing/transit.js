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
import { MPH, PACE, V_TOP, readSections } from "./graphfile.js"; // W152 chart: router.js's (V_TOP: Quickest's costs are seconds at this speed), without loading it on the page

const WALK_MS = PACE.walk * MPH; // walking the bike, between an entrance and the junction it snaps to
/** The station's own minutes, wheeling the bike (W59 multimodal §2's penalties), in seconds. */
export const STATION = {
  dismount: 60, // off the bike at the entrance, and the fare; the same back on at the other end
  board: 60, // on the platform a minute before the train
  change: 180, // one change of train in a station, wheeling the bike between platforms
  ride: 30 * 60, // the longest ride to or from a station the search looks at
  top: 3, // the plans ridden exactly
  fewer: 180, // W74 transitfix: a plan with fewer trains goes first while it arrives within this of a quicker one (rank())
  buses: 2, // W128 buslegs: the plans with a bus ridden exactly, after the trains' (plan())
};

// ---- the file ----------------------------------------------------------------------------------------
/** The timetable file (chart/transit/build_timetable.py), gunzipped: its header, and each trip's minutes at each stop. */
export function readTimetable(data) {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const { h, s } = readSections(buf, "SCTT", "timetable");
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
  return { ...h, stations: places(h.stations, patterns), patterns, services, banned, days: new Map() }; // W222 stationwalk: places()
}

/**
 * W222 stationwalk (SPEC §434, her row 10): a station whose routes board at places apart (the walker's file's `parts`,
 * build_timetable.py places(): North Station's Commuter Rail at the Garden, its Orange and Green Lines at the subway) is a station
 * for each place, with the station's id and name: its point (its platforms' middle), its doors (each [lon, lat, junction, metres,
 * seconds inside to its platforms]) or its point, its seconds inside and its platforms (`kids`); `whole`, the file's station;
 * `sib`, the others as [station, the pathways' seconds between their platforms or undefined]. The first place keeps the station's
 * index, the others follow the file's stations, and each pattern's stop there moves to its route's place. A file without parts
 * (an old one) reads as before. W223 bikestations (SPEC §439): the comets' file has them too, wheeling a bike, and a place a bike
 * reaches only on stairs says so (`stairs`, its own: never its station's, which a station with such a place has too). W224 ownstairs
 * (SPEC §470): a station's or a place's `stairs` is the list of its routes whose way there has stairs (stairsAt()), or `true` in an older file.
 */
function places(stations, patterns) {
  if (!stations.some((x) => x.parts)) return stations;
  const out = stations.slice(), moved = new Map(); // station -> Map(route's index -> its place)
  stations.forEach((x, i) => {
    if (!x.parts) return;
    const at = x.parts.map((_, k) => (k ? out.push(null) - 1 : i)), by = new Map();
    x.parts.forEach((p, k) => {
      out[at[k]] = { ...x, ll: p.ll, ent: p.ent, access_s: p.access_s, kids: p.kids, stairs: p.stairs || undefined, /* W223 bikestations: its own, never its station's; W224 ownstairs: its list, or an older file's true */ parts: undefined, whole: x, sib: at.map((q, n) => [q, p.to?.[n] ?? undefined]).filter(([q]) => q !== at[k]) };
      for (const r of p.r) by.set(r, at[k]);
    });
    moved.set(i, by);
  });
  for (const p of patterns) if (p.st.some((s) => moved.has(s))) p.st = p.st.map((s) => moved.get(s)?.get(p.routeIx) ?? s);
  return out;
}

const joined = new WeakMap(); // W128 buslegs: the comets' timetable -> { walk, tt }, it with the walker's file's buses
/** W192 sltimes (SPEC §341): the prefix of Massport's ids in the walker's file (chart/transit/build_timetable.py MASSPORT): its
 *  airport shuttles, free, which the MBTA's API doesn't know and whose bike racks no rule of ours says. */
export const MASSPORT = "MP:";
/**
 * W128 buslegs (SPEC §239): the comets' timetable with the buses of the walker's file (build_timetable.py --all) joined on:
 * the local buses and the Silver Line, "Yes, on bike racks" at all times (mbta.com/bikes; app/comet-bikes.js RULES' rack),
 * not the rail shuttles (Shuttle-*: a disruption's, when bikes "may be prohibited"), nor Massport's (W192 sltimes: no rule of
 * ours says they take a bike). Its stations and patterns start with
 * the comets' own, at the same indices; a bus stop at a station is that station, a kerb stop a station of its own. Each bus
 * pattern has `bus: true`. null when the two files aren't of one feed (their service days would differ).
 */
export function withBuses(tt, walk) {
  if (!walk || walk.feed.start !== tt.feed.start || walk.feed.end !== tt.feed.end) return null;
  const c = joined.get(tt);
  if (c?.walk === walk) return c.tt;
  const routes = tt.routes.slice(), stations = tt.stations.slice(), patterns = tt.patterns.slice(), at = new Map(stations.map((s, i) => [s.id, i]));
  const parted = new Map(), own = new Map(); // W223 bikestations: the comets' places of a station, by its id; a bus place of the walker's that is a place of its own here
  stations.forEach((s, i) => { if (s.sib) (parted.get(s.id) || parted.set(s.id, []).get(s.id)).push(i); }); // W223 bikestations
  const placeOf = (s, w, mine) => { // W223 bikestations (SPEC §439): at a station the comets' file parts, the comets' place nearest the bus's, within PLACE_M; else a place of its own, a change from each of the comets' by the straight line
    const [d, i] = mine.map((q) => [apart(w.ll, stations[q].ll), q]).sort((a, b) => a[0] - b[0])[0];
    if (d <= PLACE_M) return i;
    if (!own.has(s)) { own.set(s, stations.push({ ...w, ent: w.ent?.map((e) => (e[5] ? [...e.slice(0, 4), null, e[5]] : e.slice(0, 4))), /* W223 bikestations: without the walker's seconds, an exit's mark kept */ access_s: NO_DATA_S, stairs: undefined, /* W224 ownstairs: nor its flag */ sib: mine.map((q) => [q, undefined]) }) - 1); for (const q of mine) stations[q] = { ...stations[q], sib: [...stations[q].sib, [own.get(s), undefined]] }; }
    return own.get(s);
  };
  for (const p of walk.patterns) {
    const r = walk.routes[p.routeIx];
    if (r.type !== 3 || r.id.startsWith("Shuttle-") || r.id.startsWith(MASSPORT)) continue; // W192 sltimes: nor Massport's shuttles
    const routeIx = routes.findIndex((x) => x.id === r.id);
    const st = p.st.map((s) => { const x = walk.stations[s].whole || walk.stations[s]; if (parted.has(x.id)) return placeOf(s, walk.stations[s], parted.get(x.id)); /* W223 bikestations */ if (!at.has(x.id)) at.set(x.id, stations.push(x.stairs ? { ...x, stairs: undefined } : x) - 1); return at.get(x.id); }); // W222 stationwalk: whole, the file's station, as before its places (a station the comets' file doesn't part); W224 ownstairs: never the walker's own flag (walked, its trains' platforms), which would warn for a bus
    patterns.push({ ...p, st, routeIx: routeIx >= 0 ? routeIx : routes.push(r) - 1, svc: p.svc.map((v) => v + tt.services.length), bus: true });
  }
  const out = { ...tt, routes, stations, patterns, services: [...tt.services, ...walk.services], days: new Map(), byStation: undefined };
  joined.set(tt, { walk, tt: out });
  return out;
}

/** "20261012" to a day number (days since 1970-01-01, at noon so a zone can't move it). */
export const dayNo = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12) / 86400000);
/** Whether the file covers Boston's date at `now`: "ok", "ended" (past the feed's end: no comet plans) or "early". */
export function coverage(tt, now) {
  const d = dayNo(boston(now).date.replaceAll("-", ""));
  return d > dayNo(tt.feed.end) ? "ended" : d < dayNo(tt.feed.start) ? "early" : "ok";
}

/**
 * W189 transittimes (SPEC §329): the next `n` departures (s on day k's clock) after `after` of `route` going `dir` from station
 * `from` to station `to` (trips that let her on at one and off at the other), from day k's trips, yesterday's past midnight and
 * tomorrow's past the service day's end. `ok(pattern, dep, arr)` (s) leaves some out: a bike's rules.
 */
export function nextDepartures(tt, k, { route, dir, from, to, after, n = 2, ok = () => true }) {
  const out = new Set();
  for (const [d, shift] of [[k - 1, -1440], [k, 0], [k + 1, 1440]]) {
    const day = tripsOn(tt, d);
    tt.patterns.forEach((p, pi) => {
      const m = p.st.length, i = p.route === route && p.dir === dir ? p.st.indexOf(from) : -1, j = i < 0 ? -1 : p.st.indexOf(to, i + 1);
      if (j < 0 || p.noOn[i] || p.noOff[j]) return;
      for (const tr of day[pi]) { const t = (p.times[tr * m + i] + shift) * 60; if (t > after && ok(p, t, (p.times[tr * m + j] + shift) * 60)) out.add(t); }
    });
  }
  return [...out].sort((a, b) => a - b).slice(0, n);
}
/** W189 transittimes: the next departures after a live `dep` (ms): the reply's `live` ones after it, then the timetable's `sched`
 *  (ms) from 2 min past the last of those (so a late bus's own scheduled time isn't counted again), `n` in all. */
export const fillNext = (live, sched, dep, n = 2) => {
  const a = [...new Set(live.filter((t) => t > dep))].sort((x, y) => x - y).slice(0, n), last = a.at(-1) ?? dep;
  return [...a, ...(sched || []).filter((t) => t > last + 120000)].slice(0, n);
};

/** The trips of service day `k` (days since the feed's start), per pattern: the indices of its trips that run that day, in the
 *  file's order (by departure at the first stop). */
export function tripsOn(tt, k) {
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
/** A binary min-heap of (cost, junction), for the Dijkstras here and walktransit.js's walkTree. router.js's A* keeps its
 *  own copy inline, on its hot path. */
export function minHeap() {
  let hf = new Float64Array(1 << 14), hq = new Int32Array(1 << 14), n = 0;
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
  return { push, pop, size: () => n };
}

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
  const { push, pop, size } = minHeap();
  let settled = 0;
  for (const [v, c] of seeds) if (c < dist[v]) { dist[v] = c; push(c, v); }
  while (size()) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1; settled++;
    const du = dist[u];
    if (du > bound) break;
    if (node[u] === Infinity && du > 0) continue; // a gate that bars bikes
    const wait = (Number.isFinite(node[u]) ? node[u] / V_TOP : 0) + (zone[u] >= 0 ? PACE.signal_s / 2 : 0); // half a pulsar, on average
    for (let k = outStart[u], k1 = outStart[u + 1]; k < k1; k++) {
      const d = out[k], v = hd[d], c = du + (reverse ? whole[d ^ 1] : whole[d]) / V_TOP + wait;
      if (c < dist[v]) { dist[v] = c; push(c, v); }
    }
  }
  return { dist, settled };
}

/** Seeds for a place: the two ends of the way it snaps to, with the walk and the part of the way to each. */
function seedsAt(router, ll) {
  const p = router.snap(ll, router.nobike); // W200 parkwalk: a bike's, never in a "nobikes" area
  if (!p) return [];
  const { s } = router, L = s.len[p.e], walk = p.d / WALK_MS, perM = router.style("quickest").perM;
  return [[s.from[p.e], walk + L * p.t * perM[2 * p.e + 1] / V_TOP], [s.to[p.e], walk + L * (1 - p.t) * perM[2 * p.e] / V_TOP]];
}

const snaps = new WeakMap(); // timetable -> { router, ent: per station [[lonlat, junction, metres]] }
/** Each station's entrances on this graph, with the metres from each to its junction: the file's snapped junction where it
 *  still fits, else snapped again. Also walktransit.js's, for its stops. */
export function entrances(router, tt) {
  const c = snaps.get(tt);
  if (c && c.router === router) return c.ent;
  const { s } = router;
  const ent = tt.stations.map((st) => st.ent.map(([lon, lat, j, d, ...inside]) => { // W222 stationwalk: inside, a place's door's seconds to its platforms
    const ll = [lon, lat], at = (v) => router.metres(ll, [s.lon[v] * 1e-6, s.lat[v] * 1e-6]);
    if (j != null && j < router.N && Math.abs(at(j) - d) < 1.5) return [ll, j, d, ...inside]; // W222 stationwalk: inside
    const p = router.snap(ll);
    if (!p) return null;
    const a = s.from[p.e], b = s.to[p.e], v = at(a) <= at(b) ? a : b;
    return [ll, v, at(v), ...inside]; // W222 stationwalk: inside
  }).filter(Boolean));
  snaps.set(tt, { router, ent });
  return ent;
}

// ---- the trains ----------------------------------------------------------------------------------------
/** W223 bikestations (SPEC §439): a station's places (the comets' file's parts, readTimetable()) board this far apart at most and
 *  still count as one for a bus of the walker's file (build_timetable.py PLACE_M); a bike is wheeled between places as through
 *  a station (its WALK), on a way this much longer than the straight line (walktransit.js WALK.detour). */
const PLACE_M = 60, WHEEL = { ms: 1, detour: 1.2 };
/** W223 bikestations: a bike's seconds from a door to a place the comets' file has no pathways for (build_timetable.py NO_DATA_S):
 *  a bus's place of its own at a station the comets' file parts (withBuses), whose walker's doors' seconds aren't a bike's. */
const NO_DATA_S = 90;
const apart = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 111320);
const hops = new WeakMap(); // timetable -> per station [[place, seconds]] or null: its changes to the station's other places
/** W223 bikestations (SPEC §439): per station, the changes from a train there to another place of its station, each [place, seconds
 *  from the train to the minute before the next]: the walk between their platforms with the bike (the feed's pathways, `sib`'s,
 *  else the straight line at WHEEL), then STATION.board, never less than a change at one place (STATION.change), as the walker's
 *  (walktransit.js footpaths()). null for a timetable without places (an old file), whose search is as before. */
function changes(tt) {
  if (!hops.has(tt)) hops.set(tt, tt.stations.some((x) => x.sib) ? tt.stations.map((x) => x.sib?.map(([q, s]) => [q, Math.max(s ?? (apart(x.ll, tt.stations[q].ll) * WHEEL.detour) / WHEEL.ms, STATION.change - STATION.board) + STATION.board]) || null) : null);
  return hops.get(tt);
}
/** W223 bikestations: the seconds from a train's arrival at station `a` to the minute before the next at `b`: a change at one place,
 *  or between two places of one station (changes()). */
const changeOf = (tt, a, b) => (a === b ? STATION.change : changes(tt)?.[a]?.find(([q]) => q === b)?.[1] ?? STATION.change);

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
  const hop = changes(tt), walked = []; // W223 bikestations: walked[r][q], the place of round r's train she changed from to place q
  for (const [s, a] of access) if (!tt.banned.has(s)) { lab[0][s] = t0 + a; best[s] = t0 + a; }
  let marked = [...access.keys()].filter((s) => !tt.banned.has(s));
  for (let r = 1; r <= rounds && marked.length; r++) {
    let prevLab = lab[r - 1]; // W223 bikestations: let
    if (hop && r > 1) { // W223 bikestations (SPEC §439): off a train, to another place of its station, boarded there as after a change at one place
      const eff = prevLab.slice(), w = (walked[r - 1] = []);
      for (const s of [...marked]) for (const [q, c] of hop[s] || []) if (prevLab[s] + c - STATION.change < eff[q]) { eff[q] = prevLab[s] + c - STATION.change; w[q] = s; marked.push(q); }
      prevLab = eff;
    }
    const cur = new Float64Array(S).fill(Infinity), back = new Array(S).fill(null); // W223 bikestations: prevLab above
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
      for (let q = r, x = s; q > 0; q--) { const l = from[q][x]; legs.unshift(l); x = P[l.p].st[l.i]; x = walked[q - 1]?.[x] ?? x; } // W73 transit: q, r; W223 bikestations: from the place she changed from
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
function risk(tt, k, legs, weekday, change = EARN.change, rack = EARN.rack) { // W128 buslegs: rack
  let s = 0;
  for (const [n, l] of legs.entries()) { // W128 buslegs: and the first, for a bus
    const p = tt.patterns[l.p], m = p.st.length, list = tripsOn(tt, k + (l.shift ? -1 : 0))[l.p];
    if (!n && !p.bus) continue; // W128 buslegs
    const at = (tr, i) => (p.times[tr * m + i] + l.shift) * 60;
    const next = list.slice(list.indexOf(l.trip) + 1).find((x) => rideOk(p.route, p.dir, weekday, at(x, l.i) / 60, at(x, l.j) / 60));
    const gap = next === undefined ? Infinity : at(next, l.i) - at(l.trip, l.i); // W128 buslegs: named
    if (n) s += Math.min(change.s, change.frac * gap); // W128 buslegs: if n
    if (p.bus) s += Math.min(rack.s, rack.frac * gap); // W128 buslegs: the rack's two places taken, and the next bus
  }
  return s;
}

/** The same trains as `legs` (their patterns and stops), or the next ones, from `ready` (seconds): the legs, or null.
 *  W74 transitfix: the next one on any pattern of the line between the same two stations, the soonest there (its own on a
 *  tie), so a train missed by seconds on a pattern with no later trip falls back to the next, not to no plan. */
function retime(tt, k, legs, ready, weekday) {
  const out = [];
  for (const [n, l] of legs.entries()) {
    const p0 = tt.patterns[l.p], a = p0.st[l.i], b = p0.st[l.j], go = ready + (n ? changeOf(tt, tt.patterns[legs[n - 1].p].st[legs[n - 1].j], a) : STATION.board), day = tripsOn(tt, k + (l.shift ? -1 : 0)); // W223 bikestations: changeOf, between two places of one station too
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
/** router.route(q), with `bare_m`: the metres ridden with no bike support (its `bare`, Router.bare). */
export function ride(router, q) {
  const r = router.route(q);
  return r && { ...r, bare_m: Math.round(r.bare.reduce((a, [x, y]) => a + y - x, 0)) };
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

const summary = (r, style) => ({ style, time_s: r.time_s, walk_s: r.walk_s || 0, distance_m: r.distance_m, /* W200 parkwalk: walk_s */ climb_m: r.climb_m, bare_m: r.bare_m, samples: samples(r) });
/** The bike cards to beat: the three styles' routes (the preview's), each { style, time_s, distance_m, climb_m, bare_m, samples }. W105 night: `night`, router.route()'s. */
export function bikeCards(router, from, to, night = false) { // W105 night: night
  return ["wormhole", "flat", "quickest"].map((style) => { const r = ride(router, { from, to, style, night }); return r && summary(r, style); }).filter(Boolean); // W105 night: night
}

// ---- the plan ----------------------------------------------------------------------------------------
/**
 * Bike plus comet from `from` to `to` ([lon, lat]) leaving at `at` (ms). `opts.bike`: the bike cards to beat (bikeCards()),
 * planned here when not given; `opts.all`: every plan found, not only those that could earn a card (EARN's cap); W105 night: `opts.night`, the rides' (router.route()'s, as the app's course re-plans them). W128 buslegs: `opts.buses`, the walker's timetable (readTimetable()'s), for plans by bus too (withBuses()). Returns { plans, bike, at, stats } with the plans quickest first, or with `reason` and no
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
  const bt = opts.buses ? withBuses(tt, opts.buses) : null, T = bt || tt; // W128 buslegs: with the buses, when given the walker's file
  const ent = entrances(router, T), access = new Map(), egress = new Map(), via = new Map(); // W128 buslegs: T
  for (let s = 0; s < ent.length; s++) {
    if (!ent[s].length) continue;
    const st = T.stations[s]; // W128 buslegs: T
    let a = Infinity, e = Infinity, ea = null, ee = null, ka = 0, ke = 0, ia = st.access_s, ie = st.access_s; // W223 bikestations: the door's seconds inside
    for (const x of ent[s]) {
      const fa = F.dist[x[1]] + x[2] / WALK_MS, fe = R.dist[x[1]] + x[2] / WALK_MS, k = x[3] ?? 0; // the entrance walked, wheeling the bike; W223 bikestations (SPEC §439): k, a place's door's own seconds to its platforms
      if (!x[4] && fa + k < a + ka) { a = fa; ea = x[0]; ka = k; ia = x[3] ?? st.access_s; } // W223 bikestations: the door with the least riding outside and in, never in by an exit's gate
      if (fe + k < e + ke) { e = fe; ee = x[0]; ke = k; ie = x[3] ?? st.access_s; } // W223 bikestations
    }
    if (a <= bound) access.set(s, a + STATION.dismount + ia); // W223 bikestations: ia
    if (e <= bound) egress.set(s, ie + STATION.dismount + e); // W223 bikestations: ie
    via.set(s, [ea, ee, ia, ie]); // W223 bikestations: ia, ie
  }
  stats.stations = [access.size, egress.size];
  if (!access.size || !egress.size) return { plans: [], bike, at, reason: "far", stats };
  const t2 = performance.now();
  const rules = opts.rules || EARN; // W73 transit: here, for raptor's change
  const rail = (m) => (bt ? new Map([...m].filter(([s]) => s < tt.stations.length)) : m); // W128 buslegs: the trains' search as before, on their own stations
  const found = raptor(tt, k, t0, rail(access), rail(egress), { weekday: B.weekday, prev, change: rules.change }); // W73 transit: change; W128 buslegs: rail()
  const byBus = bt ? raptor(bt, k, t0, access, egress, { weekday: B.weekday, prev, change: rules.change }).filter((c) => c.legs.some((l) => bt.patterns[l.p].bus)) : []; // W128 buslegs: and the journeys with a bus in them
  stats.raptor_ms = Math.round(performance.now() - t2);
  // the best few, one per pair of stations, ridden exactly; not one that can't earn a card even if its rides come out quicker
  // than estimated (W59 multimodal: the estimates ran -6 % to +18 % of the exact rides; a quarter and a minute of slack lost none on the tuning trips), unless `all`
  const capOf = (c) => Math.min(c.s, c.frac * bikeBest), most = bikeBest + Math.max(capOf(rules.cap), rules.wetCap ? capOf(rules.wetCap) : 0); // W73 transit: rules, above; W201 weather2: or the rain rule's own cap, leaned
  const seen = new Set(), top = [];
  const fast = bikeBest - Math.max(rules.bus.s, rules.bus.frac * bikeBest); // W128 buslegs: a bus only when clearly quicker (earn())
  for (const [list, n, bar] of [[found, STATION.top, most], [byBus, STATION.buses, fast]]) for (let i = 0, m = 0; i < list.length && m < n; i++) { // W128 buslegs: the buses' few after the trains'
    const c = list[i], key = `${c.start}>${c.end}:${bar === fast}`, rides = access.get(c.start) + egress.get(c.end) - 2 * STATION.dismount - via.get(c.start)[2] - via.get(c.end)[3]; // W128 buslegs: T, bar; W223 bikestations: the doors' seconds inside
    if (seen.has(key) || (!opts.all && c.t + c.risk - t0 - 0.25 * rides - 60 > bar)) continue; // W73 transit: c.risk; W128 buslegs: bar
    seen.add(key); top.push(c); m++; // W128 buslegs: m
  }
  const t3 = performance.now(), plans = [];
  for (const c of top) {
    const S0 = T.stations[c.start], S1 = T.stations[c.end]; // W128 buslegs: T
    const night = opts.night, r0 = ride(router, { from, to: via.get(c.start)[0], style: "quickest", night }), r1 = ride(router, { from: via.get(c.end)[1], to, style: "quickest", night }); // W105 night: the rides the app's course gives after dark
    if (!r0 || !r1) continue;
    const [in_ll, , in_s] = via.get(c.start), [, out_ll, , out_s] = via.get(c.end); // W223 bikestations: the doors and their seconds inside
    const onPlat = t0 + r0.time_s + STATION.dismount + in_s; // W223 bikestations: in_s
    const legs = retime(T, k, c.legs, onPlat, B.weekday); // W128 buslegs: T
    if (!legs) continue;
    const off = legs.at(-1).arr + out_s + STATION.dismount, end = off + r1.time_s; // W223 bikestations: out_s
    plans.push(describe(T, { from, to, at, t0, r0, r1, legs, S0, S1, onPlat, off, end, in_ll, out_ll, in_s, out_s, /* W223 bikestations */ risk_s: Math.round(risk(T, k, legs, B.weekday, rules.change, rules.rack)), k, weekday: B.weekday })); // W62 cometcard: the entrances; W73 transit: risk_s, as retimed; W128 buslegs: T, rack; W189 transittimes: k, weekday
  }
  stats.rides_ms = Math.round(performance.now() - t3); stats.ms = Math.round(performance.now() - t);
  // W73 transit: with each change charged; W74 transitfix: fewer trains first within STATION.fewer (rank())
  return { plans: rank(plans, (p) => [p.total_s, p.risk_s, p.legs.filter((l) => l.type === "train").length]), bike, at, stats };
}

/**
 * W224 ownstairs (SPEC §470, UX rule 84: a warning is about her own way): whether the bike is carried on stairs at station `S` for a
 * train of `route`: the file's list of the routes whose way there has stairs (build_timetable.py access_seconds()), or, in an older
 * file whose `stairs` is `true`, yes for every route, as before; no `stairs`, no.
 */
export const stairsAt = (S, route) => (Array.isArray(S.stairs) ? S.stairs.includes(route) : !!S.stairs);

/** A plan's legs and totals: ride, walk_in, wait, train (and a change, and another), walk_out, ride. Times as ms. */
function describe(tt, { at, t0, r0, r1, legs, S0, S1, onPlat, off, end, in_ll, out_ll, in_s, out_s, risk_s, k, weekday }) { // W62 cometcard: in_ll, out_ll; W73 transit: risk_s; W189 transittimes: k, weekday; W223 bikestations: in_s, out_s
  const ms = (s) => at + (s - t0) * 1000, route = (r, type, m0) => ({ type, time_s: r.time_s, walk_s: r.walk_s || 0, distance_m: r.distance_m, /* W200 parkwalk: walk_s */ climb_m: r.climb_m, bare_m: r.bare_m, geometry: r.geometry, samples: samples(r, m0) });
  const out = [route(r0, "ride", 0), { type: "walk_in", station: S0.id, name: S0.name, lonlat: in_ll, time_s: STATION.dismount + in_s, ...(stairsAt(S0, tt.patterns[legs[0].p].route) ? { stairs: true } : {}) }]; // W62 cometcard: lonlat, the entrance leg 1 lands at; W223 bikestations: its door's seconds inside; W224 ownstairs: her first train's
  let ready = onPlat;
  for (const [n, l] of legs.entries()) {
    const p = tt.patterns[l.p], r = tt.routes[p.routeIx], a = tt.stations[p.st[l.i]], b = tt.stations[p.st[l.j]];
    const c = n ? changeOf(tt, tt.patterns[legs[n - 1].p].st[legs[n - 1].j], p.st[l.i]) : 0; // W223 bikestations (SPEC §439): a change at one place, or between two of one station
    const was = n ? tt.patterns[legs[n - 1].p] : null, up = was && stairsAt(tt.stations[was.st[legs[n - 1].j]], was.route) !== stairsAt(a, p.route); // W224 ownstairs (SPEC §470): one of the two trains' ways there has stairs, the other's not, so no step-free way joins their platforms
    if (n) out.push({ type: "change", station: a.id, name: a.name, time_s: c, ...(up ? { stairs: true } : {}) }); // W223 bikestations: c; W224 ownstairs: up
    out.push({ type: "wait", station: a.id, time_s: Math.round(l.dep - ready - c) }); // W223 bikestations: c
    out.push({ type: "train", route: p.route, line: r.name, color: r.color, dir: p.dir, head: p.head, from: a.id, from_name: a.name, to: b.id, to_name: b.name,
      dep: ms(l.dep), arr: ms(l.arr), stops: l.j - l.i, time_s: l.arr - l.dep, path: p.st.slice(l.i, l.j + 1).map((x) => tt.stations[x].ll), // W62 cometcard: path, its stations, for the dashed line
      ids: p.st.slice(l.i, l.j + 1).map((x) => tt.stations[x].id), rtype: r.type, ...(p.bus ? { mode: "bus", short: r.short || "", rtype: 3 } : {}), // W76 comets: and their ids, for the storm-day check (alerted()); W128 buslegs: a bus as the walker's (walktransit.js); W212 bikeride: rtype, the subway's words underground (app/walk-ride.js)
      at: p.st.slice(l.i, l.j + 1).map((_, q) => ms((p.times[l.trip * p.st.length + l.i + q] + l.shift) * 60)), names: p.st.slice(l.i, l.j + 1).map((x) => tt.stations[x].name), // W212 bikeride (SPEC §402): each stop's time and name, for the ride followed by its timetable, as a walk's (walktransit.js)
      ...(n ? {} : { next: nextDepartures(tt, k, { route: p.route, dir: p.dir, from: p.st[l.i], to: p.st[l.j], after: l.dep, ok: (q, d, a) => rideOk(q.route, q.dir, weekday, d / 60, a / 60) }).map(ms) }) }); // W189 transittimes: the next two a bike may board
    ready = l.arr;
  }
  out.push({ type: "walk_out", station: S1.id, name: S1.name, lonlat: out_ll, time_s: out_s + STATION.dismount, /* W223 bikestations: out_s */ ...(stairsAt(S1, tt.patterns[legs.at(-1).p].route) ? { stairs: true } : {}) }); // W62 cometcard: lonlat, where leg 2 sets out; W224 ownstairs: her last train's
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
 * W128 buslegs: a plan with a bus earns only on time, by `bus` (not `time`), and each bus boarded adds `rack.frac` of the
 * next bus's headway there, at most `rack.s`, to its charge (risk()): no feed says whether the rack is free.
 * W201 weather2: `wetCap`, when given (tradeoffs.js rainRules(), Settings' weather beam), is the rain rule's cap in `cap`'s place;
 * none at level, where the rain rule takes `cap` as before.
 */
export const EARN = {
  time: { s: 300, frac: 0.2 },
  rain: { s: 300, frac: 0.5 },
  bare: { m: 1000, frac: 0.5 },
  climb: { m: 30, frac: 0.5 },
  cap: { s: 600, frac: 0.3 },
  horizon: 120, sure: 60,
  change: { frac: 0.5, s: 1200 }, // W73 transit: half the next train's headway, at most 20 min (w72 walktransit §2.3)
  bus: { s: 600, frac: 0.25 }, // W128 buslegs: a plan with a bus earns only on time, at least 10 min and 25 % quicker, with its rack charged
  rack: { frac: 0.25, s: 1200 }, // W128 buslegs: each bus boarded, the front rack's two places taken a quarter of the time: then the next bus
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
  const ride = (r) => (r.time_s || 0) - Math.min(r.time_s || 0, r.walk_s || 0), quickK = Math.min(...bike.map((b) => ride(b) / k + b.time_s - ride(b))); // W200 parkwalk: her pace scales the riding, never the walking (app/course-logic.js routeSeconds)
  const cap = Math.min(rules.cap.s, rules.cap.frac * quick), wetCap = rules.wetCap ? Math.min(rules.wetCap.s, rules.wetCap.frac * quick) : cap; // W201 weather2: the rain rule's cap, Settings' weather beam (tradeoffs.js rainRules())
  const wetOf = (pts) => (wet ? wetMinutes(pts, wet, rules) : { min: 0, late: false });
  const bikeWet = wet ? bike.map((b) => wetOf(b.samples || [])) : null;
  const leastWet = bikeWet ? Math.min(...bikeWet.map((x) => x.min)) : 0;
  const leastBare = Math.min(...bike.map((b) => b.bare_m ?? Infinity)), leastClimb = Math.min(...bike.map((b) => b.climb_m));
  const cut = (a, b, frac, min) => a - b >= min && b <= (1 - frac) * a;
  for (const p of result.plans) {
    const saves = quick - p.total_s - (p.risk_s || 0), costs = -saves; // W73 transit: its changes charged
    const r1 = p.legs.findLast((l) => l.type === "ride"), last = r1 ? ride(r1) : 0, paced = quickK - p.total_s - last * (1 / k - 1); // W76 comets: as the cards show it (a change's charge isn't shown), for a pilot quicker than the router; W200 parkwalk: their riding at her pace
    const bus = p.legs.some((l) => l.mode === "bus"), bar = bus ? rules.bus : rules.time; // W128 buslegs
    if (saves >= Math.max(bar.s, bar.frac * quick) && paced > 0) return { ...p, earned: { reason: "time", saves_s: saves, bike_s: quick, comet_s: p.total_s } }; // W128 buslegs: bar
    if (bus) continue; // W128 buslegs: never a bus for rain or comfort alone
    if (wet && leastWet > 0 && costs <= wetCap) { // W201 weather2: its own cap (at level the same)
      const w = p.legs.filter((l) => l.type === "ride").map((l) => wetOf(l.samples)), mine = w.reduce((a, x) => a + x.min, 0);
      if (cut(leastWet * 60, mine * 60, rules.rain.frac, rules.rain.s)) {
        return { ...p, earned: { reason: "rain", wet_bike_min: leastWet, wet_comet_min: Math.round(mine * 10) / 10, costs_s: costs, late: bikeWet.some((x) => x.late) || w.some((x) => x.late) } };
      }
    }
    if (costs > cap) continue; // W201 weather2: the comfort rules' cap, after the rain's
    if (Number.isFinite(leastBare) && cut(leastBare, p.bare_m, rules.bare.frac, rules.bare.m)) return { ...p, earned: { reason: "comfort", kind: "bare", bike_m: leastBare, comet_m: p.bare_m, costs_s: costs } };
    if (cut(leastClimb, p.climb_m, rules.climb.frac, rules.climb.m)) return { ...p, earned: { reason: "comfort", kind: "climb", bike_m: leastClimb, comet_m: p.climb_m, costs_s: costs } };
  }
  return null;
}

// ---- the live check ------------------------------------------------------------------------------------
/** One request a plan, the same for every pilot (BRIEF §8's api-v3.mbta.com): the bike alerts, with what to match. W76 comets:
 *  and the riders' (V3's default activities, BOARD, EXIT and RIDE), for the storm-day effects (STORM). */
export const ALERTS = "https://api-v3.mbta.com/alerts?filter[activity]=BRINGING_BIKE,BOARD,EXIT,RIDE&fields[alert]=informed_entity,active_period,effect,header,short_header"; // W211 stationcard2: short_header, a station card's
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
export function alerted(json, plan, { bike = true, why = null } = {}) { // W78 walkalerts: bike; W211 stationcard2: why, a Map that each line dropped is set in (its route: { route, effect, line, short, mode }, effect "BIKE" for a bike alert)
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
      if (active && (named || stormed) && why && !why.has(l.route)) why.set(l.route, { route: l.route, effect: stormed ? at.effect : "BIKE", line: l.line || "", short: l.short || "", mode: l.mode || "" }); // W211 stationcard2
    }
  }
  return [...hit];
}
const routeType = (r) => (r.startsWith("CR-") ? 2 : r.startsWith("Boat-") ? 4 : 1);

/**
 * W211 stationcard2 (SPEC §397), her row 40: "If subway service is suspended, please write that in the description of applicable
 * stations, instead of just saying that no trains are due." Of ALERTS' reply `json`, the storm-day ones (STORM) active at `now` (ms)
 * that stop a line at the station `id` (its GTFS parent, "place-portr"): an entity naming the station (its id) with its route, one on a
 * whole line (no stop or trip) of the station's `routes`, or on its kind (route_type). Where they name a way (direction_id), only the
 * ways she can't board count (activities BOARD, or none given): none, and the train still leaves here (a stretch's far end). Never a
 * guess: an entity of another station, a trip, or a line not among `routes` says nothing. [{ route, effect, oneWay, header }] in the
 * reply's order, a route once; `header` the alert's short header, else its header, without a leading "Red Line:".
 */
export function stationAlerts(json, id, now, routes = []) {
  const out = new Map();
  for (const a of json?.data || []) {
    const at = a.attributes || {}, periods = at.active_period?.length ? at.active_period : [{}];
    if (!STORM.includes(at.effect) || !periods.some((p) => (!p.start || Date.parse(p.start) <= now) && (!p.end || Date.parse(p.end) >= now))) continue;
    const ways = new Map(); // route: the ways she can't board it here (null: both)
    for (const e of at.informed_entity || []) {
      if (e.trip || e.route_type === 3 || !(e.activities || ["BOARD"]).includes("BOARD")) continue; // its review's P2: a bus's, at a T station (a detour on the 42 at Forest Hills), says nothing of its trains
      const rs = e.stop ? (e.stop === id ? (e.route ? [e.route] : routes) : []) : e.route ? (routes.includes(e.route) ? [e.route] : []) : e.route_type != null ? routes.filter((r) => (/^Green-|^Mattapan/.test(r) ? 0 : routeType(r)) === e.route_type) : [];
      for (const r of rs) { const w = ways.get(r) ?? new Set(); w.add(e.direction_id ?? "both"); ways.set(r, w); }
    }
    const header = String(at.short_header || at.header || "").replace(/^[^:]{0,40}\b(Line|Branch|Trolley|Rail)\b[^:]{0,20}:\s+/, "").trim();
    for (const [route, w] of ways) if (!out.has(route)) out.set(route, { route, effect: at.effect, oneWay: !w.has("both") && w.size === 1, header });
  }
  return [...out.values()];
}

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
  const rule = RULES.find((r) => r.match.test(t.route)), may = (x) => { const b = boston(x), m = b.min + (x % 60000) / 60000; return !(rule.trip && b.weekday) && rideOk(t.route, t.dir, b.weekday, m, m + t.time_s / 60); }; // W189 transittimes: as a bike may board; a weekday's Commuter Rail train says for itself (not in the reply), so the timetable's
  const later = (json?.data || []).filter((p) => p !== mine && !/^(CANCELLED|SKIPPED)$/.test(p.attributes?.schedule_relationship || "")).map((p) => Date.parse(p.attributes?.departure_time)).filter((x) => Number.isFinite(x) && may(x)); // W189 transittimes
  legs[i] = { ...t, dep, arr: t.arr + dep - t.dep, live: true, ...(t.next ? { next: fillNext(later, t.next, dep) } : {}) }; // W189 transittimes: the next ones live too
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
  // W211 stationcard2 (SPEC §397): a station card's line stopped by an alert (stationAlerts), in a few words, "one way" after where it names one
  SUSPENSION: { scul: "Suspended", plain: "Suspended" },
  SHUTTLE: { scul: "Shuttle sandworms", plain: "Shuttle buses" },
  STATION_CLOSURE: { scul: "Not stopping here", plain: "Not stopping here" },
  oneWay: { scul: "{said}, one\u00a0way", plain: "{said}, one\u00a0way" }, // its review's P2: "one way" never broken across lines; 0.1.98's words review: the comma ("Not stopping here, one way")
  // W211 stationcard2: the plans' sheet, a line a plan was left out for (alerted()'s why): "Green Line D is suspended: these routes avoid it."
  suspended: { scul: "{line} is suspended", plain: "{line} is suspended" },
  shuttled: { scul: "{line} has shuttle sandworms", plain: "{line} has shuttle buses" },
  skipping: { scul: "{line} is skipping a {place}", plain: "{line} is skipping a {place}" }, // its review's P2: a bus's "stop"
  noBikes: { scul: "No ships on the {line}", plain: "No bikes on the {line}" },
  avoid: { scul: "{lines}: these courses avoid {it}.", plain: "{lines}: these routes avoid {it}." }, // 0.1.98's words review: SCUL's course, as its pills' "a new course from here"
  avoids: { scul: "{lines}: this course avoids {it}.", plain: "{lines}: this route avoids {it}." },
};
/** W211 stationcard2 (SPEC §397): the plans' sheet's line for the lines `left` out for an alert (alerted()'s why: { route, effect, line,
 *  short, mode }), one plan's (`one`, a bike + T card) or several's; "" for none. A line by its name (a bus by its number). */
export function avoidLine(left, mode = "scul", one = false) {
  if (!left?.length) return "";
  const name = (l) => (l.mode === "bus" ? `${mode === "plain" ? "Bus" : "Sandworm"} ${l.short || l.route}` : l.line || (l.route.startsWith("CR-") ? `${l.route.slice(3)} Line` : `${l.route.replace(/^Green-/, "Green Line ")}${/^Green-/.test(l.route) ? "" : " Line"}`));
  const said = left.map((l) => word({ SUSPENSION: "suspended", SHUTTLE: "shuttled", STATION_CLOSURE: "skipping", BIKE: "noBikes" }[l.effect] || "suspended", { line: name(l), place: l.mode === "bus" ? "stop" : "station" }, mode));
  return word(one ? "avoids" : "avoid", { lines: said.join("; "), it: left.length > 1 ? "them" : "it" }, mode);
}
export const word = (k, vars = {}, mode = "scul") => WORDS[k][mode].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
