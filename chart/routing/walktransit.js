// W73 walk (design/app-ui/SPEC.md §119): on foot and by T, for a walker (arclight's wife: "a half-mile walk is nothing;
// a bus to the train is a second thing to miss"). The planner over every mode's timetable (chart/transit/build_timetable.py
// --all) and the bike graph walked, pure JS with no DOM: it runs in the routing worker (worker.js's `walk` message) and in
// Node's tests.
//
//   const tt = readTimetable(buffer);                 // transit.js's reader, the walker's file
//   walkPlan(router, tt, from, to, at)  -> { plans, at, stats } or { plans: [], reason }   plans: her best two or three
//   walkRoute(router, from, to)       -> a walk as router.route()'s course, its turns and the walker's time (W79 walkgo)
//   walkPlan(..., { alerts })           W78 walkalerts: less any plan a storm day's alert stops (transit.js alerted(), V3's
//                                       ALERTS reply), before the cards are picked; W211 stationcard2: `left`, the lines of those that
//                                       would have been her cards ([{ route, effect, line, short, mode }]), for the sheet's line
//   walkPlan(..., { sky, all })         W198 walkcards: the cards under this sky (RANGES.sky's: null, "fine", "wet", "cold",
//                                       "hot"; app/walk.js skyOf()); `all`, every plan found as well (sweep-walkcards.mjs)
//   walkPlan(..., { docks })            W204 bikeshare: and walk, ride a Bluebike, walk on (bikePlans()), from the feed's docks
//                                       (bikeshare.js withStatus()), weighed as the others with the ride's comfort and the rain
//   walkPlan(..., { pace, cards })      W211 walkmore: at her walking pace (1 at WALK.speed; app/settings.js walkPace()), every walk,
//                                       a station's walk inside and a change on foot; `cards`, as many as the page fits; and her
//                                       lean's FAR: the walk the whole way always a card within its alone_m (pickCards())
//   walkRoute(router, from, to, pace)   W211 walkmore: at her walking pace
//
// The search (W72 walktransit, its deep dives dd1 and dd2):
// - **Walking on the graph:** one Dijkstra from each end over the bike graph walked (WALK: 1.4 m/s, steps at half that,
//   one-ways both ways, no bike penalties, a wait at each pulsar crossed, junctions flagged blocked skipped), bounded at
//   `reach_m` (and `alone_m` from the start, for walking the whole way). Stations end at their entrances, bus stops at
//   their kerb, each with the file's entrance-to-platform seconds walked.
// - **McRAPTOR** in up to `rounds` rounds over the day's trips (and yesterday's after midnight), every mode: labels over
//   (arrival, metres walked), a round per vehicle, so the answers are the Pareto set over arrival, walking and vehicles.
//   Changes inside a station (`change_s`), or on foot between stops within `foot_m` (straight line times `detour`).
//   Boarding by binary search, target pruning by the end's own labels (dd2's list).
// - **Her rule** (W72 walktransit §2.3) ranks them: the minutes to the door; each change after the first boarding costs
//   half the next vehicle's headway at that stop, at most `cap_s` (the expected wait when the connection is missed half
//   the time); walking past `free_m` costs half again; each dollar of fare two minutes. Up to three cards: her best, the
//   quickest, the one with least walking, each once.
// - **W198 walkcards** (SPEC §351): a card only for a plan some reasonable walker would take under today's sky (reasonable()):
//   none another beats or ties on every measure (its minutes to the door and outside, changes, fare, a missed change's risk),
//   and each near the best under some weighting of RANGES, her rule in their middle. The third card is the least outside.
import { boston } from "../../app/comet-bikes.js";
import { alerted, dayNo, entrances, minHeap, tripsOn, nextDepartures, MASSPORT } from "./transit.js"; // W78 walkalerts; W189 transittimes: nextDepartures; W192 sltimes: MASSPORT
import { lean, CHANGE_S, step, walkLean, SOONER } from "./tradeoffs.js"; // W199 prefs; W203 tradeoffs2: CHANGE_S; W211 walkmore: step, walkLean; W212 walkfirst: SOONER
import { BIKE, fareOf as bikeFare, stressM } from "./bikeshare.js"; // W204 bikeshare; 0.1.94's merge: as bikeFare, beside W203 walkcards2's fareOf (the T's)

/** The walker's numbers. */
export const WALK = {
  speed: 1.4, // m/s on the flat (W72 walktransit, dd1)
  steps: 0.7, // m/s on steps
  signal_s: 15, // a pulsar crossed on foot, on average (dd1: 4-12 a long leg, worth 1-3 min)
  reach_m: 2000, // the longest walk to or from a stop the search looks at
  alone_m: 3500, // the longest walk the whole way it offers; W211 walkmore: at level and on the T's side, FAR's further on the Walking side
  foot_m: 400, // a change on foot between two stops
  detour: 1.2, // such a change's straight line to the street's (dd1: median 1.15 on the graph)
  board_s: 60, // on the platform or at the kerb a minute before the vehicle
  change_s: 120, // between platforms inside a station
  rounds: 4, // at most four vehicles
  most_m: 3200, // the most walking in one plan
  bucket_m: 50, // walking compared in steps of this, so near-equal walks don't multiply the labels
  early_s: 180, before_s: 120, // W198 walkcards: app/walk-card.js LEAVE's: a first wait longer than early_s she spends indoors, setting off by its Leave by, and before_s of it at the stop
};
/** Her rule (W72 walktransit §2.3). W198 walkcards: no flat slack_s (15 min of her best) any more: RANGES' `near`.
 *  W203 tradeoffs2 (SPEC §365, her row 11d: two buses and a subway ranked above one bus and a subway): `penalty_s`, each change's own
 *  cost on top of its walk, its wait and a missed change's risk (the literature's transfer penalty; tradeoffs.js CHANGE_S). */
export const HER = { half: 0.5, cap_s: 1200, free_m: 1600, extra: 0.5, usd_s: 120, cards: 3, penalty_s: CHANGE_S }; // W203 tradeoffs2: penalty_s
/**
 * W211 walkmore (SPEC §395, her row 23, UX rule 44: "a walker walks"): how far she walks at each step of the walker's beam (tradeoffs.js
 * `walk`, -2 T and bus … +2 Walking), level WALK's and HER's: `alone_m`, the longest walk the whole way, which then always has a card
 * (pickCards()); `reach_m`, the longest walk to or from a stop looked at; `most_m`, the most walking in one plan; `free_m`, the walking
 * before her rule's half again (HER.extra). The numbers: chart/routing/sweep-walkcards.mjs --far (SPEC §395): alone_m, the longest walks
 * that reasonable() keeps on at least half the trips at that step, by the kilometre (to 2, 3, 3, 5 and 6 to 7 km).
 */
export const FAR = { alone_m: [2000, 3000, 3500, 5000, 6500], reach_m: [2000, 2000, 2000, 2800, 3600], most_m: [3200, 3200, 3200, 4800, 6400], free_m: [1600, 1600, 1600, 2400, 3200] }; // W211 walkmore
/** W211 walkmore: FAR at the walker's beam's step in `leans` (Settings' Trade-offs). */
export const far = (leans) => { const i = step(leans?.walk) + 2; return { alone_m: FAR.alone_m[i], reach_m: FAR.reach_m[i], most_m: FAR.most_m[i], free_m: FAR.free_m[i] }; }; // W211 walkmore
/**
 * W198 walkcards (SPEC §351): what reasonable walkers weigh, each as [low, hers, high], her rule (herScore()) the point in the
 * middle; one object, for W199's preferences page to narrow or move. A plan costs (weigh()) its minutes under cover (riding;
 * waiting or walking inside a sheltered station) + `out` × its minutes outside (walking; waiting at a kerb or an open-air
 * platform) + `change` × its changes + `risk` × a missed change's expected wait (its change_s) + `usd` × its fare + her
 * walking past free_m (herScore()'s). `sky`: the weather's shift of `out`. `near`: a plan earns a card within the more of
 * `s` and `frac` of the best's minutes to the door, of the best under some weighting.
 */
export const RANGES = {
  out: [0.75, 1, 1.5], // a minute outside against one under cover: a walker who likes it, her ("a half-mile walk is nothing"), the literature's commuter (1.5 dry; 2 in the rain)
  change: [0, HER.penalty_s, 2 * HER.penalty_s], // seconds a change costs beyond its walk, its wait and its risk: none, hers (W203 tradeoffs2: was none), twice hers
  risk: [0.5, 1, 1.5], // a missed change's expected wait, weighed
  usd: [60, 120, 240], // seconds a dollar of fare: $60, her $30 and $15 an hour
  sky: { wet: 0.5, cold: 0.25, hot: 0.25, fine: -0.15 }, // rain or snow on the way, a cold or a heat alert, a dry sky
  near: { frac: 0.1, s: 60 },
  bike: [0, 0.5, 1.5], // W204 bikeshare: seconds more a second ridden on a Bluebike on a street that isn't calm (stress_s): a rider at ease in traffic, her, a nervous one
  ride_wet: 1, // W204 bikeshare: and a second ridden in rain or snow, on top of the sky's shift of `out`: spray, wet brakes, a wet saddle
};
/** CharlieCard fares by GTFS route type, in dollars (fare_products.txt, Oct 2026); a change within two hours pays only the
 *  difference, so a plan pays its dearest leg. Commuter Rail and ferries vary by zone: these are the inner zones'. */
export const FARE = { 0: 2.4, 1: 2.4, 2: 2.4, 3: 1.7, 4: 2.4 }; // W203 walkcards2: her weighing's, where the file has no fares or a ride's isn't known (fareOf()); never shown

/**
 * W203 walkcards2 (SPEC §366): what `rides` cost on a CharlieCard (or a contactless card) by the MBTA's GTFS-Fares v2 as the walker's
 * file holds them (build_timetable.py fares()): dollars, or null when a ride's fare isn't known (a file without fares, a network or
 * a pair of zones with no rule): never guessed. Each ride ({ net, from, to, dep, arr, free }: its route's network, its stations, its
 * times in s) takes its network's leg rules, those naming its stations' fare areas before the network's default (an empty area),
 * the card's products where it has one; each change, a transfer rule from the ride before's group (its price, its count of
 * changes in a row, its time limit), else a new fare; the cheapest way through. `free`: Massport's shuttles, free to all.
 */
export function fareOf(tt, rides) { // W203 walkcards2
  const F = tt.fares;
  if (!F) return null;
  let ways = [{ usd: 0, g: null }];
  for (const r of rides) {
    if (r.free) { ways = ways.map((w) => ({ ...w, g: null })); continue; }
    const all = F.legs[r.net] || [], fa = (st) => st.fa?.[r.net] || [];
    const match = (rules) => { // R1 plans
      let m = rules.filter((x) => fa(r.from).includes(x[1]));
      if (!m.length) m = rules.filter((x) => !x[1]);
      let n = m.filter((x) => fa(r.to).includes(x[2]));
      if (!n.length) n = m.filter((x) => !x[2]);
      return n; // R1 plans
    }; // R1 plans
    const card = match(all.filter((x) => x[5])), legs = card.length ? card : match(all), next = []; // R1 plans (SPEC §441, review P10): the card's rules first, else all of them: at nine Blue Line stations the feed has only the Quick Ticket's, and the next leg on the card paid again; a ferry's zone 1A ticket has no card
    for (const [g, , , usd, only] of legs) for (const w of ways) {
      if (!only) next.push({ usd: w.usd + usd, g, dep: r.dep, arr: r.arr, rule: null, run: 0 });
      for (const t of w.g ? F.transfers : []) {
        const [from, to, count, limit, type] = t, run = w.rule === t ? w.run : 0;
        const span = limit == null ? 0 : (type === 1 || type === 2 ? r.dep : r.arr) - (type >= 2 ? w.arr : w.dep); // from the ride before's departure (0, 1) or arrival (2, 3) to this one's arrival (0, 3) or departure (1, 2)
        if (from === w.g && to === g && (count == null || count < 0 || run < count) && span <= (limit ?? 0)) next.push({ usd: w.usd + t[5], g, dep: r.dep, arr: r.arr, rule: t, run: run + 1 });
      }
    }
    if (!next.length) return null;
    ways = next;
  }
  return Math.round(Math.min(...ways.map((w) => w.usd)) * 100) / 100;
}
/** W198 walkcards (SPEC §351): the stations where she waits under a roof: their platforms below the street (every station of
 *  chart/transit/deep-v1.json, the T's tunnels), and Alewife, Massachusetts Avenue and the Silver Line's tunnel, which it
 *  lacks. Everywhere else (a kerb stop, an open-air platform) a wait is outside, as the walking is, but for the walk inside
 *  a station like these between its door and its platform. */
export const SHELTER = new Set(["place-alfcl", "place-andrw", "place-aqucl", "place-armnl", "place-asmnl", "place-bbsta", "place-bomnl", "place-boyls",
  "place-brdwy", "place-chncl", "place-cntsq", "place-coecl", "place-crtst", "place-davis", "place-dwnxg", "place-forhl", "place-gover", "place-haecl",
  "place-harsq", "place-hymnl", "place-jaksn", "place-kencl", "place-knncl", "place-masta", "place-mvbcl", "place-north", "place-pktrm", "place-portr",
  "place-prmnl", "place-sbmnl", "place-smmnl", "place-sstat", "place-state", "place-symcl", "place-tumnl", "place-wtcst"]);
/** W198 walkcards: their roof is the trains': a bus at one waits at its kerb or busway, outside (Davis's, Forest Hills'; Harvard's too,
 *  though some of its buses stop in a tunnel the walker's file doesn't tell apart), but in the Silver Line's tunnel, the only buses at
 *  these three (SL1, SL2, SL3, SLW). */
const TUNNEL = new Set(["place-sstat", "place-crtst", "place-wtcst"]);

const N_BLOCKED = 4, B_STEPS = 6;

// ---- walking on the graph ------------------------------------------------------------------------------
const trees = new WeakMap(); // router -> two slots of { dist, pred, done }
/**
 * Walking seconds from `ll` to every junction within `bound` s, with the edge each was reached by (pred, -1 at a seed).
 * The walk to the graph (the snap's gap) and the part of the snapped way are in the seeds.
 */
export function walkTree(router, ll, bound, slot = 0, pace = 1) { // W211 walkmore: pace, her walking pace (1 at WALK.speed)
  const N = router.N, { outStart, out, hd, zone, s } = router;
  let sc = trees.get(router);
  if (!sc) trees.set(router, (sc = [0, 1].map(() => ({ dist: new Float64Array(N), pred: new Int32Array(N), done: new Uint8Array(N) }))));
  const { dist, pred, done } = sc[slot];
  dist.fill(Infinity); pred.fill(-1); done.fill(0);
  const p = router.snap(ll);
  if (!p) return null;
  const L = s.len[p.e], gap = p.d / (WALK.speed * pace), sp = (d) => (router.bike(d) === B_STEPS ? WALK.steps : WALK.speed) * pace; // W211 walkmore: pace
  const seeds = [[s.from[p.e], gap + (L * p.t) / sp(2 * p.e + 1), 2 * p.e + 1, 1 - p.t], [s.to[p.e], gap + (L * (1 - p.t)) / sp(2 * p.e), 2 * p.e, p.t]];
  const { push, pop, size } = minHeap();
  let settled = 0;
  for (const [v, c] of seeds) if (c < dist[v]) { dist[v] = c; push(c, v); }
  while (size()) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1; settled++;
    const du = dist[u];
    if (du > bound) break;
    if (s.node_flags[u] & N_BLOCKED && pred[u] >= 0) continue;
    for (let k = outStart[u], k1 = outStart[u + 1]; k < k1; k++) {
      const d = out[k], v = hd[d], c = du + s.len[d >> 1] / sp(d) + (zone[v] >= 0 && zone[v] !== zone[u] ? WALK.signal_s : 0);
      if (c < dist[v]) { dist[v] = c; pred[v] = d; push(c, v); }
    }
  }
  return { dist, pred, snap: p, seeds, settled, ll, pace }; // W211 walkmore: pace, for toPoint()
}

/** The walk from the tree's start to junction v as points (the start, its snap, the ways, v). */
function pathTo(router, tree, v) {
  const ds = [];
  for (let x = v, d, guard = router.N; (d = tree.pred[x]) >= 0 && guard--; x = d & 1 ? router.s.to[d >> 1] : router.s.from[d >> 1]) ds.push(d);
  ds.reverse();
  const first = ds.length ? (ds[0] & 1 ? router.s.to[ds[0] >> 1] : router.s.from[ds[0] >> 1]) : v;
  const seed = tree.seeds.find((x) => x[0] === first) || tree.seeds[0];
  const pts = [tree.ll, tree.snap.at, ...router.piece(seed[2], seed[3], 1).pts];
  for (const d of ds) pts.push(...router.piece(d).pts.slice(1));
  return pts;
}

/** W79 walkgo: a walk from `from` to `to` over the graph walked, as router.route() gives a course (its turns, for the turn
 *  card and the voice), with the walker's time; null where an end is off the graph or out of reach. */
export function walkRoute(router, from, to, pace = 1) { // W79 walkgo; W211 walkmore: pace, her walking pace (app/settings.js walkPace())
  const v = WALK.speed * pace, F = walkTree(router, from, (2 * WALK.alone_m) / v, 0, pace), b = F && router.snap(to), s = router.s; // W211 walkmore: at her pace (FAR's longest walk alone is within it)
  if (!b) return null;
  const a = F.snap, L = s.len[b.e], viaFrom = F.dist[s.from[b.e]] + (L * b.t) / v, viaTo = F.dist[s.to[b.e]] + (L * (1 - b.t)) / v; // W211 walkmore: v
  let time = Math.min(viaFrom, viaTo), legs;
  if (a.e === b.e && (a.d + Math.abs(a.t - b.t) * L) / v <= time) { // along the one way; W211 walkmore: v
    time = (a.d + Math.abs(a.t - b.t) * L) / v; // W211 walkmore: v
    legs = [b.t >= a.t ? [2 * b.e, a.t, b.t] : [2 * b.e + 1, 1 - a.t, 1 - b.t]];
  } else {
    if (!Number.isFinite(time)) return null;
    const v = viaFrom <= viaTo ? s.from[b.e] : s.to[b.e], last = viaFrom <= viaTo ? [2 * b.e, 0, b.t] : [2 * b.e + 1, 0, 1 - b.t], ds = [];
    for (let x = v, d, guard = router.N; (d = F.pred[x]) >= 0 && guard--; x = d & 1 ? s.to[d >> 1] : s.from[d >> 1]) ds.push(d);
    ds.reverse();
    const first = ds.length ? (ds[0] & 1 ? s.to[ds[0] >> 1] : s.from[ds[0] >> 1]) : v, seed = F.seeds.find((x) => x[0] === first) || F.seeds[0];
    legs = [[seed[2], seed[3], 1], ...ds.map((d) => [d, 0, 1]), last].filter(([, f0, f1]) => f1 - f0 > 1e-6);
    if (!legs.length) legs = [last];
  }
  return { ...router.describe(legs, { at: b.at, walk: 0, place: to }, Math.round(time), { at: a.at, walk: a.d, place: from }, true), time_s: Math.round(time + b.d / v), walk_s: Math.round(time + b.d / v), style: "foot", pace }; // W212 walkcross: describe's foot, its crossings; W200 parkwalk: walk_s, all of it; W211 walkmore: v, and the pace it is at (for the Log's learning)
}

/** Walking seconds and metres from the tree's start to a point `ll` on the graph (its snap's ends), or null. */
function toPoint(router, tree, ll) {
  const p = router.snap(ll), s = router.s;
  if (!p) return null;
  const L = s.len[p.e];
  const v = WALK.speed * (tree.pace || 1), a = tree.dist[s.from[p.e]] + (L * p.t) / v, b = tree.dist[s.to[p.e]] + (L * (1 - p.t)) / v; // W211 walkmore: at the tree's pace
  const end = a <= b ? s.from[p.e] : s.to[p.e], t = Math.min(a, b) + p.d / v; // W211 walkmore: v
  return Number.isFinite(t) ? { s: t, end, snap: p } : null;
}

/** Stop-to-stop changes on foot within WALK.foot_m: per stop [[stop, seconds, metres]], built once a file. */
function footpaths(tt) {
  if (tt.foot) return tt.foot;
  const S = tt.stations.length, cell = WALK.foot_m, X = new Float64Array(S), Y = new Float64Array(S), grid = new Map();
  const kx = 111320 * Math.cos((42.36 * Math.PI) / 180);
  tt.stations.forEach((st, i) => { X[i] = st.ll[0] * kx; Y[i] = st.ll[1] * 111320; const k = `${Math.floor(X[i] / cell)},${Math.floor(Y[i] / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  tt.foot = Array.from({ length: S }, (_, i) => {
    const out = [], cx = Math.floor(X[i] / cell), cy = Math.floor(Y[i] / cell), sib = new Map(tt.stations[i].sib || []); // W222 stationwalk: sib, the station's other places
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
      const m = Math.hypot(X[i] - X[j], Y[i] - Y[j]) * WALK.detour;
      if (j !== i && m <= cell * WALK.detour && !sib.has(j)) out.push([j, m / WALK.speed + tt.stations[i].access_s + tt.stations[j].access_s, m]); // W222 stationwalk: !sib.has(j)
    }
    for (const [j, s] of sib) { const m = Math.hypot(X[i] - X[j], Y[i] - Y[j]) * WALK.detour; out.push([j, Math.max(s ?? m / WALK.speed, WALK.change_s - WALK.board_s), m, true]); } // W222 stationwalk: to another place of the station, inside it: the pathways' seconds between their platforms, else the walk between their points (then a minute to board, as at a stop), never less than a change at one place (`true`: search() keeps that floor at her pace too)
    return out;
  });
  return tt.foot;
}

// ---- the search ------------------------------------------------------------------------------------------
const bucket = (m) => Math.round(m / WALK.bucket_m);
/** Insert label x into a 2-D Pareto bag over (t, walking bucket): false when one there is as good on both. */
function insert(bag, x, keep = () => false) {
  const xb = bucket(x.m);
  for (const y of bag) if (y.t <= x.t && bucket(y.m) <= xb) return false;
  for (let k = bag.length - 1; k >= 0; k--) if (x.t <= bag[k].t && xb <= bucket(bag[k].m) && !keep(bag[k])) bag.splice(k, 1);
  bag.push(x);
  return true;
}

/**
 * McRAPTOR over day `k`. `access`/`egress`: Map stop -> { s, m, ent } (walking seconds to the platform, metres, the
 * entrance). `alone`: walking the whole way { s, m } or null. Returns the end's labels: { t, m, n, label, e }.
 */
export function search(tt, k, t0, access, egress, alone = null, { prev = false, rounds = WALK.rounds, pace = 1, most_m = WALK.most_m } = {}) { // W211 walkmore: pace, her walking pace (a change on foot's seconds ÷ it); most_m, her lean's (far())
  const S = tt.stations.length, P = tt.patterns, foot = footpaths(tt);
  const sets = [{ trips: tripsOn(tt, k), shift: 0 }];
  if (prev) sets.push({ trips: tripsOn(tt, k - 1), shift: -1440 });
  if (!tt.byStation) {
    tt.byStation = Array.from({ length: S }, () => []);
    P.forEach((p, pi) => p.st.forEach((s, i) => tt.byStation[s].push([pi, i])));
  }
  const best = new Array(S), dest = [];
  if (alone) dest.push({ t: t0 + alone.s, m: alone.m, n: 0, label: null, e: null, alone });
  const pruned = (t, m) => m > most_m || dest.some((d) => d.t <= t && bucket(d.m) <= bucket(m)); // W211 walkmore: most_m
  const add = (s, x) => !pruned(x.t, x.m) && insert((best[s] ||= []), x);
  let marked = new Map(); // stop -> labels new in the last round
  for (const [s, a] of access) {
    const x = { t: t0 + a.s, m: a.m, n: 0, s, how: { k: "access", a } };
    if (add(s, x)) (marked.get(s) || marked.set(s, []).get(s)).push(x);
  }
  let scanned = 0;
  for (let r = 1; r <= rounds && marked.size; r++) {
    const queue = new Map();
    for (const s of marked.keys()) for (const [pi, i] of tt.byStation[s]) if (!queue.has(pi) || queue.get(pi) > i) queue.set(pi, i);
    const fresh = new Map(), mark = (s, x) => (fresh.get(s) || fresh.set(s, []).get(s)).push(x);
    for (const [pi, i0] of queue) for (const { trips, shift } of sets) {
      const p = P[pi], n = p.st.length, T = p.times, list = trips[pi], L = list.length;
      if (!L) continue;
      scanned++;
      const rb = []; // the route's bag: { ti (in list), label, i (boarded at) }, by (trip, walking)
      for (let i = i0; i < n; i++) {
        const s = p.st[i];
        if (rb.length && !p.noOff[i]) for (const b of rb) {
          const tr = list[b.ti], t = (T[tr * n + i] + shift) * 60;
          const x = { t, m: b.label.m, n: r, s, prev: b.label, how: { k: "ride", p: pi, trip: tr, ti: b.ti, i: b.i, j: i, shift } };
          if (add(s, x)) mark(s, x);
        }
        const here = marked.get(s);
        if (!here || p.noOn[i]) continue;
        for (const lab of here) {
          const ready = lab.t + (lab.how.k === "ride" ? WALK.change_s : WALK.board_s);
          let lo = 0, hi = L;
          while (lo < hi) { const mid = (lo + hi) >> 1; if ((T[list[mid] * n + i] + shift) * 60 < ready) lo = mid + 1; else hi = mid; }
          if (lo >= L) continue;
          const bm = bucket(lab.m);
          if (rb.some((b) => b.ti <= lo && bucket(b.label.m) <= bm)) continue;
          for (let q = rb.length - 1; q >= 0; q--) if (lo <= rb[q].ti && bm <= bucket(rb[q].label.m)) rb.splice(q, 1);
          rb.push({ ti: lo, label: lab, i });
        }
      }
    }
    // changes on foot, from the stops a vehicle reached this round
    for (const [s, labs] of [...fresh]) for (const lab of labs) for (const [v, fs, fm, sib] of foot[s]) {
      const x = { t: lab.t + (sib ? Math.max(fs / pace, WALK.change_s - WALK.board_s) : fs / pace), m: lab.m + fm, n: r, s: v, prev: lab, how: { k: "foot", from: s } }; // W211 walkmore: at her pace; W222 integration: between two places of one station never under a change at one place, however fast she walks
      if (add(v, x)) mark(v, x);
    }
    for (const [s, labs] of fresh) {
      const e = egress.get(s);
      if (!e) continue;
      for (const lab of labs) {
        if (lab.how.k === "foot" && lab.prev && egress.has(lab.prev.s)) continue; // walk on from the vehicle's own stop instead
        const t = lab.t + e.s, m = lab.m + e.m;
        if (m > most_m || dest.some((d) => d.t <= t && bucket(d.m) <= bucket(m))) continue; // W211 walkmore: most_m
        for (let q = dest.length - 1; q >= 0; q--) if (dest[q].n === r && t <= dest[q].t && bucket(m) <= bucket(dest[q].m)) dest.splice(q, 1);
        dest.push({ t, m, n: r, label: lab, e });
      }
    }
    // the next round boards from every label new in this one
    for (const [s, labs] of fresh) fresh.set(s, labs.filter((x) => best[s].includes(x)));
    marked = fresh;
  }
  return { dest, scanned };
}

// ---- the plans ---------------------------------------------------------------------------------------------
/** The next trip's departure at stop i after trip index ti of the day's list, minus this one's: the headway (s). */
function headway(tt, list, pi, ti, i, shift) {
  const p = tt.patterns[pi], n = p.st.length, at = (x) => (p.times[list[x] * n + i] + shift) * 60;
  return ti + 1 < list.length ? at(ti + 1) - at(ti) : ti > 0 ? at(ti) - at(ti - 1) : HER.cap_s / HER.half;
}

/** Her score (s): minutes to the door, the changes' expected waits, the walking past `free_m`, the fare; W203 tradeoffs2: each
 *  change's own penalty_s. */
export function herScore(plan) {
  const extra = Math.max(0, plan.walk_m - HER.free_m) / WALK.speed * HER.extra;
  return door(plan) + plan.change_s + extra + plan.fare * HER.usd_s + changes(plan) * HER.penalty_s // W203 walkcards2: door; W203 tradeoffs2: penalty_s
    + RANGES.bike[1] * (plan.stress_s || 0); // W204 bikeshare: a Bluebike's ride on busy streets
}

/**
 * On foot and by T from `from` to `to` ([lon, lat]) leaving at `at` (ms). Returns { plans, at, stats }: her best two or
 * three, best first, or { plans: [], reason }: "ended" or "early" (the feed), "far" (no stop within reach of both ends,
 * and too far to walk).
 */
export function walkPlan(router, tt, from, to, at, opts = {}) {
  const t = performance.now(), stats = {};
  const B = boston(at), d = dayNo(B.date.replaceAll("-", ""));
  if (d > dayNo(tt.feed.end) || d < dayNo(tt.feed.start)) return { plans: [], at, reason: d > dayNo(tt.feed.end) ? "ended" : "early", stats };
  const k = d - dayNo(tt.feed.start), t0 = B.min * 60 + Math.floor((at % 60000) / 1000);
  const pace = opts.pace > 0 ? opts.pace : 1, v = WALK.speed * pace, lim = far(opts.leans); // W211 walkmore (SPEC §395): her walking pace (app/settings.js walkPace()), and how far her lean walks
  const reachS = lim.reach_m / v; // W211 walkmore: lim, v
  const aloneM = Math.max(WALK.alone_m, lim.alone_m), F = walkTree(router, from, Math.max(aloneM, lim.reach_m) / v, 0, pace), R = walkTree(router, to, reachS, 1, pace); // W211 walkmore: lim, pace; a walk the whole way as far as level's or her lean's
  if (!F || !R) return { plans: [], at, reason: "far", stats };
  stats.walk_ms = Math.round(performance.now() - t); stats.settled = [F.settled, R.settled];
  const ent = entrances(router, tt), access = new Map(), egress = new Map();
  for (let s = 0; s < ent.length; s++) {
    let a = null, e = null;
    const acc = tt.stations[s].access_s / pace; // W211 walkmore: its walk inside at her pace
    for (const [ll, j, dm, es, xo] of ent[s]) { // W222 stationwalk (SPEC §434): es, a place's door's own seconds to its platforms (transit.js places()); xo, a way out only
      const fa = F.dist[j] + dm / v, fe = R.dist[j] + dm / v, k = es == null ? 0 : es / pace; // W211 walkmore: v; W222 stationwalk: k, its door's seconds inside
      if (!xo && fa <= reachS && (!a || fa + k < a.walk + a.k)) a = { walk: fa, ll, j, k, in: es == null ? acc : k }; // W222 stationwalk: the door with the least walking outside and in; never in by an exit's gate
      if (fe <= reachS && (!e || fe + k < e.walk + e.k)) e = { walk: fe, ll, j, k, in: es == null ? acc : k }; // W222 stationwalk
    }
    if (a) access.set(s, { s: a.walk + a.in, m: a.walk * v, ent: a }); // W211 walkmore: v; W222 stationwalk: a.in, its door's (else acc)
    if (e) egress.set(s, { s: e.walk + e.in, m: e.walk * v, ent: e }); // W211 walkmore: v; W222 stationwalk: e.in
  }
  const direct = toPoint(router, F, to);
  const alone = direct && direct.s * v <= aloneM ? { s: direct.s, m: direct.s * v, end: direct.end } : null; // W211 walkmore: aloneM, at her pace (its card sure within her lean's alone_m, pickCards())
  stats.stops = [access.size, egress.size];
  if ((!access.size || !egress.size) && !alone) return { plans: [], at, reason: "far", stats };
  const t1 = performance.now();
  const s0 = opts.by ? t0 - byFrom(alone) : t0; // W203 walkcards2: arriving by `at`, the search sets off early enough, and each plan is then her latest run of it
  const days = (shift) => tripsOn(tt, k + (shift ? -1 : 0));
  const run = (s) => search(tt, k, s, access, egress, alone, { prev: s < 4 * 3600, pace, most_m: lim.most_m }); // W203 walkcards2: s (was t0 and B.min, the same leaving at `at`); W211 walkmore: pace, most_m
  let { dest, scanned } = run(s0), got = null;
  if (opts.by) { // W203 walkcards2: then again from just after the latest she could set off by those, for the ways that only work leaving later (a stop further on that its bus passes later), up to BY.passes searches
    got = dest.map((x) => latest(tt, days, x, t0)).filter(Boolean);
    for (let n = 1, s = s0; n < BY.passes; n++) {
      const s1 = Math.max(...got.filter((g) => g.x.label).map((g) => g.start)) + WALK.before_s - WALK.board_s + 60; // a minute past the latest she could still catch those by (the search boards a minute before, Arrive by has her there two)
      if (!(s1 > s)) break;
      const b = run((s = s1)), more = b.dest.map((x) => latest(tt, days, x, t0)).filter((g) => g && g.x.label);
      scanned += b.scanned; got = got.concat(more);
      if (!more.length) break;
    }
  }
  stats.search_ms = Math.round(performance.now() - t1); stats.scanned = scanned; stats.pareto = (got || dest).length;
  const all = got ? got.map(({ x, start }) => ({ ...describe(router, tt, { x, F, R, from, to, at: at + (start - t0) * 1000, t0: start, days, k, pace }), spare_s: Math.round(t0 - x.t) })) // W203 walkcards2: spare_s, at the door before `at`; W211 walkmore: pace
    : dest.map((x) => describe(router, tt, { x, F, R, from, to, at, t0, days, k, pace })); // W189 transittimes: k; W211 walkmore: pace
  if (opts.docks?.length && !opts.by) { const t2 = performance.now(), bikes = bikePlans(router, F, R, opts.docks, { at }); all.push(...bikes); stats.bikes = bikes.length; stats.bike_ms = Math.round(performance.now() - t2); } // W204 bikeshare; 0.1.94's merge: not for Arrive by (W203 walkcards2), whose plans are her latest runs: a Bluebike's leaves at `at`
  const hits = opts.alerts ? all.map((p) => alerted(opts.alerts, p, { bike: false })) : null; // W211 stationcard2: each plan's lines an alert stops
  const plans = hits ? all.filter((_, i) => !hits[i].length) : all; // W78 walkalerts: a storm day's, and the next one weighed
  stats.alerted = all.length - plans.length; // W78 walkalerts
  const pick = { ranges: leaned(RANGES, opts.leans), sky: opts.sky ?? null, alone_m: lim.alone_m, walk: opts.leans?.walk }, n = opts.cards ?? HER.cards; // W211 stationcard2: named, for its pick of them all; W211 walkmore: alone_m; W212 walkfirst: walk, the beam's step
  const why = new Map(); // W211 stationcard2 (SPEC §397): the lines of the plans an alert left out that would have been her cards, for the sheet's line ("Green Line D is suspended: these routes avoid it.")
  if (stats.alerted) for (const p of pickCards(all, n, pick)) { const i = all.indexOf(p); if (hits[i].length) alerted(opts.alerts, p, { bike: false, why }); }
  const cards = pickCards(plans, n, pick), left = [...why.values()].filter((l) => !cards.some((p) => p.legs.some((x) => x.route === l.route))); // W211 stationcard2: none her cards still take (a later train, past the alert)
  stats.ms = Math.round(performance.now() - t);
  return { plans: cards, at, stats, ...(left.length ? { left } : {}), ...(opts.all ? { all: plans } : {}) }; // W198 walkcards: the sky; `all`, every plan found, for sweep-walkcards.mjs; W199 prefs: leaned, Settings' Trade-offs; W211 stationcard2: left
}

/** W203 walkcards2 (SPEC §366): how long before an arrive-by the search sets off: twice the walk the whole way (a plan by T can take
 *  longer than walking and still be some walker's choice, as in the rain), from half an hour to an hour and a half; with no walk, the
 *  most. */
export const BY = { k: 2, min_s: 1800, max_s: 5400, passes: 3 }; // W203 walkcards2: passes, the searches at most (SPEC §366's brute force: 13 of 24 rows of cards the same with one, 18 with these)
const byFrom = (alone) => (alone ? Math.min(BY.max_s, Math.max(BY.min_s, BY.k * alone.s)) : BY.max_s); // W203 walkcards2
/**
 * W203 walkcards2 (SPEC §366): label x's plan on its latest run that has her at the door by T (s): from the last ride back, each the
 * latest trip of its line that makes the next (a change in a station WALK.change_s, on foot its walk then WALK.board_s, the door its
 * walk from the stop), the first one with her at its stop WALK.before_s ahead of it, as Leave by has her; then the labels again from her
 * start. { x, start }: the label and her start (s), or null when no run makes it. A walk the whole way sets off its minutes before T.
 */
function latest(tt, days, x, T) { // W203 walkcards2
  if (!x.label) return { x: { ...x, t: T }, start: T - x.alone.s };
  const chain = [];
  for (let l = x.label; l; l = l.prev) chain.unshift(l);
  const how = chain.map((l) => l.how), gap = chain.map((l) => (l.how.k === "foot" ? l.t - l.prev.t : 0));
  let need = T - x.e.s;
  for (let i = chain.length - 1; i >= 1; i--) {
    if (how[i].k === "foot") { need -= gap[i]; continue; }
    const h = how[i], p = tt.patterns[h.p], n = p.st.length, list = days(h.shift)[h.p], at = (q, j) => (p.times[list[q] * n + j] + h.shift) * 60;
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at(mid, h.j) <= need) lo = mid + 1; else hi = mid; }
    if (!lo) return null;
    how[i] = { ...h, ti: lo - 1, trip: list[lo - 1] };
    need = at(lo - 1, h.i) - (how[i - 1].k === "ride" ? WALK.change_s : i === 1 ? WALK.before_s : WALK.board_s);
  }
  const start = need - how[0].a.s, out = [];
  for (let i = 0; i < chain.length; i++) { // her labels again, forward from her start
    const h = how[i], p = h.k === "ride" ? tt.patterns[h.p] : null;
    const t = !i ? need : p ? (p.times[h.trip * p.st.length + h.j] + h.shift) * 60 : out[i - 1].t + gap[i];
    out.push({ ...chain[i], t, how: h, prev: out[i - 1] || null });
  }
  const x2 = { ...x, t: out.at(-1).t + x.e.s, label: out.at(-1) };
  return x2.t <= T ? { x: x2, start } : null;
}

// W198 walkcards (SPEC §351): the measures a walker weighs, each lower being better
const door = (p) => p.total_s + (p.spare_s || 0); // W203 walkcards2: arriving by a time, her minutes from setting off to it, the time to spare at the door too: the latest to set off is the best
const under = (p) => door(p) - p.out_s, changes = (p) => Math.max(0, p.vehicles - 1); // W203 walkcards2: door
/** W198 walkcards: plan a beats or ties plan b on every measure: the minutes to the door and outside, changes, fare, risk. */
const beats = (a, b) => door(a) <= door(b) && a.out_s <= b.out_s && changes(a) <= changes(b) && a.fare <= b.fare && a.change_s <= b.change_s // W203 walkcards2: door
  && (a.stress_s || 0) <= (b.stress_s || 0) && (a.ride_s || 0) <= (b.ride_s || 0); // W204 bikeshare: a Bluebike's ride on busy streets, and its seconds ridden (in the rain)
/** W198 walkcards: a plan's cost (s) under weights { out, change, risk, usd } (RANGES); her rule's are herScore(). */
export function weigh(p, w) {
  return under(p) + w.out * p.out_s + w.change * changes(p) + w.risk * p.change_s + w.usd * p.fare + Math.max(0, p.walk_m - (w.free_m ?? HER.free_m)) / WALK.speed * HER.extra // W211 walkmore: w.free_m, her lean's
    + (w.bike || 0) * (p.stress_s || 0) + (w.wet || 0) * (p.ride_s || 0); // W204 bikeshare: { bike, wet }, a Bluebike's ride on busy streets and in the rain
}
/**
 * W198 walkcards (SPEC §351): the plans some reasonable walker would take, in her order (herScore()): none that another beats
 * or ties on every measure, and each within `near` of the best under some weighting of the ranges (every low, hers and high:
 * 81), `out` moved by the sky's shift: null (not known), "fine", "wet", "cold" or "hot".
 */
export function reasonable(plans, { ranges = RANGES, sky = null } = {}) {
  const score = ranges.order ? (p) => Math.round(weigh(p, { bike: ranges.bike?.[1] || 0, ...ranges.order })) : (p) => Math.round(herScore(p)), pool = plans.slice().sort((a, b) => score(a) - score(b) || a.total_s - b.total_s); // W199 prefs: a lean's order, weigh() at its middle; W204 bikeshare: a Bluebike's busy streets at her middle
  const live = pool.filter((p, i) => !pool.some((q, j) => q !== p && beats(q, p) && (j < i || !beats(p, q)))); // of two the same, her first
  const shift = ranges.sky[sky] || 0, keep = new Set();
  const bikes = ranges.bike && live.some((p) => p.ride_s) ? ranges.bike : [0], wet = sky === "wet" ? ranges.ride_wet || 0 : 0; // W204 bikeshare: its range only with a Bluebike plan, so the others are weighed as before
  for (const out of ranges.out) for (const change of ranges.change) for (const risk of ranges.risk) for (const usd of ranges.usd) for (const bike of bikes) { // W204 bikeshare: bike
    const w = { out: out + shift, change, risk, usd, bike, wet, free_m: ranges.free_m }, c = live.map((p) => weigh(p, w)), b = c.indexOf(Math.min(...c)); // W204 bikeshare: bike, wet; W211 walkmore: free_m
    live.forEach((p, i) => { if (c[i] <= c[b] + Math.max(ranges.near.s, ranges.near.frac * live[b].total_s)) keep.add(p); }); // near: by the trip's minutes, not the weighed ones (in the rain those swell)
  }
  return live.filter((p) => keep.has(p));
}

/** W201 weather2 (SPEC §360): the skies the weather beam moves: rain or snow on the way, a cold or a heat alert. */
const BAD = ["wet", "cold", "hot"]; // W201 weather2
/** W199 prefs (SPEC §353): `ranges` with Settings' Trade-offs `leans` ({ walk }, tradeoffs.js's step, T and bus -2 to Walking +2):
 *  `out`'s three ÷ its lean (the sky's shift adds after it, in reasonable()), and the cards' order weigh() at that middle;
 *  `ranges` itself at level, so her rule orders them as before. W201 weather2: the weather beam (T and bus -2 to Rain gear +2;
 *  W203 tradeoffs2: On foot's, `leans.footWeather`) divides the bad skies' shifts (BAD) by its lean; the order stays her rule's
 *  unless `walk` or `changes` leans. W203 tradeoffs2 (SPEC §365): `leans.changes` (Quicker -2 to Fewer changes +2) multiplies
 *  `change`'s three by its lean. */
export function leaned(ranges, leans) { // W199 prefs
  const k = walkLean(leans?.walk), kw = lean(leans?.footWeather), kc = lean(leans?.changes); // W201 weather2: kw, the weather beam's; W203 tradeoffs2: On foot's, and kc, Fewer changes'; W211 walkmore: walkLean, harder on the Walking side
  if (k === 1 && kw === 1 && kc === 1) return ranges; // W201 weather2: and the weather's level; W203 tradeoffs2: and Fewer changes'
  const sky = kw === 1 ? ranges.sky : { ...ranges.sky, ...Object.fromEntries(BAD.map((s) => [s, ranges.sky[s] / kw])) }; // W201 weather2: bad weather's shifts ÷ its lean, a fine day's as it is
  const ride_wet = (ranges.ride_wet || 0) / kw; // W204 bikeshare: a ride in the rain, as the bad skies' shifts
  if (k === 1 && kc === 1) return { ...ranges, sky, ride_wet }; // W201 weather2: her rule still orders them; W204 bikeshare: ride_wet
  const out = ranges.out.map((x) => x / k), change = ranges.change.map((x) => x * kc); // W203 tradeoffs2: change
  const free = far(leans).free_m, free_m = free === HER.free_m ? {} : { free_m: free }; // W211 walkmore: on the Walking side, her half again from further on
  return { ...ranges, out, change, sky, ride_wet, ...free_m, order: { out: out[1], change: change[1], risk: ranges.risk[1], usd: ranges.usd[1], ...free_m } }; // W201 weather2: sky; W203 tradeoffs2: change; W204 bikeshare: ride_wet; W211 walkmore: free_m
} // W199 prefs

/** Up to n cards from the Pareto set: her best, then the quickest, then the least outside, each once, of the plans a reasonable
 *  walker would take under this sky (W198 walkcards: reasonable(); was within a flat 15 min of her best). W204 bikeshare: those of
 *  the plans without a Bluebike, as with Consider Bluebikes off, and one Bluebike card when the rule keeps one. W211 walkmore (SPEC
 *  §395, UX rule 44): the places in this order: her best plan by T; the walk the whole way, always within `alone_m` (her lean's,
 *  far()) unless another plan beats it on everything; a Bluebike that earns its card; then the quickest and the least outside; her
 *  best of them all first (the walk or the Bluebike when it leads her rule). `n`: as many as the page fits (app/course.js). W212 walkfirst
 *  (SPEC §399): `walk`, the beam's step; on its Walking side, beside the walk's card in a dry sky, a plan by T only when tradeoffs.js
 *  SOONER's `card` sooner than the walk, and first only when its `first` sooner. */
export function pickCards(plans, n = HER.cards, { ranges = RANGES, sky = null, alone_m = FAR.alone_m[2], walk: k = 0 } = {}) { // W198 walkcards: ranges, sky; W211 walkmore: alone_m; W212 walkfirst: walk, the beam's step
  for (const p of plans) p.score = Math.round(herScore(p));
  const all = plans.some((p) => p.bike) ? reasonable(plans, { ranges, sky }) : [], bike = all.find((p) => p.bike); // W204 bikeshare (SPEC §372): one Bluebike card (another dock a block away is the same choice), her best of those W198's rule keeps among them all
  const alone = plans.find((p) => !p.vehicles && !p.bike), walk = alone && alone.walk_m <= alone_m && !plans.some((q) => q !== alone && beats(q, alone) && !beats(alone, q)) ? alone : null; // W211 walkmore: never a dominated card
  const S = walk && !BAD.includes(sky) && SOONER.card[step(k) + 2], sooner = (p, t) => !t || !p.vehicles || door(walk) - door(p) >= t; // W212 walkfirst (SPEC §399): on the Walking side in a dry sky, beside the walk's card
  const kept = reasonable(plans.filter((p) => !p.bike), { ranges, sky }), near = kept.filter((p) => sooner(p, S)); // W198 walkcards; W204 bikeshare: her cards as with Consider Bluebikes off; W212 walkfirst: of her plans by T, only those that save real time
  const fast = S ? Math.min(...kept.map((p) => p.total_s)) : Infinity; // W212 walkfirst (its review's P2): a plan by T left out may still be quicker than the walk
  const out = [], room = bike ? Math.max(1, n - 1) : n, top = near.find((p) => p.vehicles) || null; // W204 bikeshare: her best without a Bluebike always stays; W211 walkmore: her best plan by T
  const quick = near.length ? near.reduce((a, b) => (b.total_s < a.total_s ? b : a)) : null;
  const least = near.length ? near.reduce((a, b) => (b.out_s < a.out_s - WALK.bucket_m / WALK.speed ? b : a)) : null; // W198 walkcards: outside, walking or waiting (was the walking)
  const lead = S && near[0]?.vehicles && !sooner(near[0], SOONER.first[step(k) + 2]) ? walk : null; // W212 walkfirst: the walk first, unless her best by T saves more
  for (const p of [lead, top, walk, quick, least, ...near]) { // W211 walkmore: the places' order (was her best, the quickest, the least outside); W212 walkfirst: lead
    if (out.length >= room) break; // W204 bikeshare: room
    if (!p || out.includes(p) || out.some((q) => q.key === p.key)) continue;
    out.push(p);
  }
  const i = out.indexOf(lead || near[0]); // W211 walkmore: her best first (the walk, when it leads her rule); W212 walkfirst: or the walk as lead
  if (i > 0) out.unshift(...out.splice(i, 1));
  if (bike) out.splice(bike === all[0] ? 0 : Math.max(0, out.indexOf(top), out.indexOf(walk)) + 1, 0, bike); // W204 bikeshare: first when it is her best of them all, else after hers; W211 walkmore: in its place, after her best by T and the walk (fix pass: after her best by T with no walk's card, was the third place always)
  for (const p of out) p.whys = out.map(() => null); // W211 walkmore: whys[k - 1], each card's reason where the page fits only the first k (null past them)
  for (let k = 1; k <= out.length; k++) for (const p of reasons(out.slice(0, k), fast)) p.whys[k - 1] = p.why; // W212 walkfirst: fast
  return reasons(out, fast);
}
/** W211 walkmore: each card's reason, once, in a word (pickCards()'s, again for the cards the page fits): the quickest; then the
 *  fewest vehicles (her best of them), when the quickest has more; then the least outside (W198 walkcards: was the least walking). A
 *  card with none of these is her runner-up, and says nothing. W212 walkfirst: no card is the quickest when a plan left out (`fast`,
 *  its minutes) is quicker; the fewest vehicles' reason then (the walk's "No waiting"). */
export function reasons(out, fast = Infinity) { // W211 walkmore: out of pickCards(); W212 walkfirst: fast
  if (!out.length) return [];
  const minT = Math.min(...out.map((p) => p.total_s)), minW = Math.min(...out.map((p) => p.out_s)), minN = Math.min(...out.filter((p) => !p.bike).map((p) => p.vehicles)); // W198 walkcards: out_s; W204 bikeshare: a Bluebike is no train or bus
  for (const p of out) p.why = "";
  const give = (why, ok) => { const p = out.find((q) => !q.why && ok(q)); if (p) p.why = why; };
  if (minT <= fast) give("quickest", (p) => p.total_s === minT); // W212 walkfirst: unless a plan left out is quicker
  if (minT > fast || out.find((q) => q.why === "quickest")?.vehicles > minN) give(minN ? "direct" : "walk", (p) => p.vehicles === minN && !p.bike); // only when it sets it apart from the quickest; W204 bikeshare: never a Bluebike's
  if (out.length > 1) give("least", (p) => p.out_s === minW); // W198 walkcards: out_s
  return out;
}

// ---- a bus stop's times (W189 transittimes) -------------------------------------------------------------------
/** W189 transittimes: a tapped stop is the file's stops of its name this near its point on the chart (OSM's names are the MBTA's).
 *  60 m (the lane's 30 m matched 78 % of 2,013 named stops sampled; 60 m, 83 %: the same name, so a nearer pair is one stop). */
export const STOP_M = 60;
/** W192 sltimes (SPEC §341): a tapped stop's OSM `ref` (the GTFS stop code: a kerb stop's id, or one of a station's `kids`)
 *  names it within REF_M of its point: 200 m keeps 99.4 % of the 5,595 refs on the chart that name a stop of the MBTA's feed,
 *  and leaves out the wrong ones, kilometres off (a trolley's "1", a berth's "21", Massport's route "66"). */
export const REF_M = 200;
/** W192 sltimes: Massport's shuttles (ids MASSPORT, `MP:`) name their kerbs in words of their own ("Terminal A - Arrivals", OSM's
 *  "Terminal A - Arrivals Level"), so a tapped stop takes theirs within KERB_M, the same kerb (30 m: OSM's Terminal C arrivals
 *  stop is 29 m from Massport's), unless the two name different levels: Logan's roadways are stacked, and its departures kerbs
 *  are 14-23 m from its arrivals kerbs, where the shuttles pick up. */
export const KERB_M = 30;
/** W219 stationcard3 (SPEC §428): Massport's kerb this near a station's point is its shuttles' (Airport's: 65 m from the Blue Line's). */
export const STATION_KERB_M = 150;
/** W219 stationcard3: a route a station's card lists: its trains, the Silver Line, the shuttles that replace a line (Shuttle-*), and
 *  Massport's; never a local bus whose stop the GTFS puts under it (Harvard's busway), which has its own stop on the map. */
export const atStation = (r) => r.type !== 3 || /^SL/.test(r.short || "") || /^Shuttle-/.test(r.id) || r.id.startsWith(MASSPORT);
const level = (s) => stopName(s).match(/\b(arrivals|departures)\b/)?.[1] || ""; // W192 sltimes
const stopName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9@]+/g, " ").trim();
/**
 * W189 transittimes (SPEC §329): a bus stop's next departures by route from the walker's file, with no request: the stops named
 * `name` within STOP_M of `ll`, and at them each bus route and way's next `n` from `at` (ms), from today's trips, yesterday's
 * past midnight and tomorrow's. { stops: [ids], rows: [{ route, short, line, color, dir, head, times: [ms] }] }, by number.
 * W192 sltimes (SPEC §341): and the stops its `ref` names ("4;60" names two) within REF_M, and Massport's within KERB_M.
 * W222 busstops2 (SPEC §435): where its `ref` names a stop, that stop alone (and Massport's): a stop's card is its own side's buses.
 * W213 buspairs (SPEC §407): `name` may be several, joined by `;` (a pair's `names`); each row says the stop it leaves from (`stop`).
 * W219 stationcard3 (SPEC §428): `station`, a station's GTFS id ("place-sstat"): its own trains, the Silver Line and the shuttles at
 * its stops (atStation), and Massport's within STATION_KERB_M, in place of a stop's buses; and each row's `bikes`, each time's trip's
 * bikes_allowed (the file's `bk`: 1 yes, 2 no, 0 not said), and `heads`, each time's trip's headsign.
 */
export function stopTimes(tt, ll, name, at, { n = 3, ref = "", station = "" } = {}) { // W192 sltimes: ref; W219 stationcard3: station
  const keys = new Set(String(name || "").split(";").map(stopName).filter(Boolean)), kx = 111320 * Math.cos((ll[1] * Math.PI) / 180), near = new Set(), on = []; // W213 buspairs: keys
  const refs = new Set(String(ref || "").split(";").map((r) => r.trim()).filter(Boolean)), lv = level(name); // W192 sltimes
  const named = new Set(); let reffed = false; // W222 busstops2: a stop its ref names is that stop alone, not its twin of the same name across the street
  tt.stations.forEach((s, i) => {
    const m = Math.hypot((s.ll[0] - ll[0]) * kx, (s.ll[1] - ll[1]) * 111320); // W192 sltimes: once a stop
    const byRef = m <= REF_M && (refs.has(s.id) || s.kids?.some((k) => refs.has(k))), kerb = m <= KERB_M && s.id.startsWith(MASSPORT) && (!lv || !level(s.name) || level(s.name) === lv); // W222 busstops2
    if (station ? s.id === station || (m <= STATION_KERB_M && s.id.startsWith(MASSPORT)) : (keys.has(stopName(s.name)) && m <= STOP_M) || byRef || kerb) near.add(i); // W192 sltimes: by ref, and Massport's kerbs; W219 stationcard3: a station by its id
    if (!station && byRef) reffed = true; else if (!station && !kerb && near.has(i)) named.add(i); // W222 busstops2
  });
  if (reffed) for (const i of named) near.delete(i); // W222 busstops2 (SPEC §435): with a ref that names a stop, the name adds none
  tt.patterns.forEach((p, pi) => { if (station ? atStation(tt.routes[p.routeIx]) : tt.routes[p.routeIx].type === 3) for (let i = 0; i < p.st.length - 1; i++) if (near.has(p.st[i]) && !p.noOn[i]) on.push([pi, i]); }); // never at its last stop; W219 stationcard3: a station's
  const B = boston(at), k = dayNo(B.date.replaceAll("-", "")) - dayNo(tt.feed.start), now = B.min * 60 + Math.floor((at % 60000) / 1000), rows = new Map();
  for (const [d, shift] of [[k - 1, -1440], [k, 0], [k + 1, 1440]]) {
    const day = tripsOn(tt, d);
    for (const [pi, i] of on) {
      const p = tt.patterns[pi], r = tt.routes[p.routeIx], m = p.st.length, id = `${p.route}|${p.dir}`;
      const row = rows.get(id) || rows.set(id, { route: p.route, short: r.short || "", line: r.name, color: r.color || "", dir: p.dir, stop: tt.stations[p.st[i]].id, times: new Map() }).get(id); // W213 buspairs: stop
      for (const tr of day[pi]) { const t = (p.times[tr * m + i] + shift) * 60; if (t >= now && !row.times.has(t)) row.times.set(t, [p.head, (Array.isArray(p.bk) ? p.bk[tr] : p.bk) || 0]); } // W219 stationcard3: and its trip's bikes
    }
  }
  const out = [...rows.values()].map(({ times, ...r }) => {
    const ts = [...times.keys()].sort((a, b) => a - b).slice(0, n);
    return { ...r, head: [...new Set(ts.map((t) => times.get(t)[0]))].sort().join("/"), times: ts.map((t) => at + (t - now) * 1000), bikes: ts.map((t) => times.get(t)[1]), heads: ts.map((t) => times.get(t)[0]) }; // W219 stationcard3: bikes, and each time's own head ("Forge Park/495" has a slash of its own)
  }).filter((r) => r.times.length).sort((a, b) => (a.short || a.line).localeCompare(b.short || b.line, "en", { numeric: true }) || a.dir - b.dir);
  return { stops: [...new Set([...near].map((i) => tt.stations[i].id))], rows: out }; // W222 stationwalk: a station's places once (one id)
}

/** A Pareto label as a plan: its legs (walk, wait, ride, change or walk, ..., walk), times as ms, and its totals. */
function describe(router, tt, { x, F, R, from, to, at, t0, days, k, pace = 1 }) { // W189 transittimes: k; W211 walkmore: pace
  const ms = (s) => at + (s - t0) * 1000, legs = [];
  const st = (s) => tt.stations[s];
  let walk_m = x.m, change_s = 0, fare = 0, vehicles = 0, first = true, held = null; // W222 stationwalk: held, a change inside one station's seconds outside, its wait's
  const rides = []; // W203 walkcards2: for fareOf()
  if (!x.label) { // walking the whole way
    const pts = pathTo(router, F, x.alone.end);
    legs.push({ type: "walk", time_s: Math.round(x.t - t0), m: Math.round(x.m), geometry: [...pts, to], out_s: Math.round(x.t - t0) }); // W198 walkcards: out_s
    return { legs, key: "walk", total_s: Math.round(x.t - t0), arrive: ms(x.t), walk_m: Math.round(walk_m), change_s: 0, fare: 0, price: 0, vehicles: 0, lines: [], out_s: Math.round(x.t - t0) }; // W198 walkcards: out_s; W203 walkcards2: price
  }
  const ride = (l) => (l?.how.k === "ride" ? tt.routes[tt.patterns[l.how.p].routeIx] : null); // W198 walkcards: the vehicle a label rode, or null
  const roofed = (s, r) => !!r && SHELTER.has(s.id) && (r.type !== 3 || TUNNEL.has(s.id)); // W198 walkcards: a sheltered station's train, not its buses
  const inside = (s, r, t = s.access_s / pace) => (roofed(s, r) ? t : 0); // W198 walkcards: a walk's seconds between a sheltered station's door and its platform; W211 walkmore: at her pace; W222 stationwalk: t, its door's own
  const chain = [];
  for (let l = x.label; l; l = l.prev) chain.unshift(l);
  const a = chain[0].how.a, s0 = chain[0].s;
  legs.push({ type: "walk", time_s: Math.round(a.s), m: Math.round(a.m), to: st(s0).id, to_name: st(s0).name, geometry: [...pathTo(router, F, a.ent.j), a.ent.ll], out_s: Math.round(a.s - inside(st(s0), ride(chain[1]), a.ent.in)) }); // W198 walkcards: out_s; W222 stationwalk: its door's seconds
  let ready = chain[0].t;
  for (const l of chain.slice(1)) {
    if (l.how.k === "foot") {
      const nx = chain[chain.indexOf(l) + 1], A = st(l.how.from), Bs = st(l.s), next = ride(nx), sib = A.sib?.some(([q]) => q === l.s); // W222 stationwalk: sib, between two places of one station, inside it
      const out = sib ? (roofed(A, ride(l.prev)) && roofed(Bs, next) ? 0 : Math.round(l.t - ready)) : Math.round(l.t - ready - inside(A, ride(l.prev)) - inside(Bs, next)); // W198 walkcards: out_s; W222 stationwalk: sib
      if (sib && next) { held = out; continue; } // W222 stationwalk: no walk leg (the trip's "Change to…" and its timetable, as at one place, never a street course), its seconds the next wait's
      if (sib && nx?.how.k === "foot") continue; // W222 integration: then on foot (by South Station's Silver Line place to the SL4's kerb): no walk leg either, its seconds and metres the next walk's
      let f = l; // W222 integration: that walk from where she got off, before the changes between places folded into it
      while (f.prev.how.k === "foot" && st(f.prev.how.from).sib?.some(([q]) => q === f.prev.s)) f = f.prev;
      legs.push({ type: "walk", change: true, time_s: Math.round(l.t - ready), m: Math.round(l.m - f.prev.m), from: A.id, to: Bs.id, to_name: Bs.name, geometry: [st(f.how.from).ll, Bs.ll], out_s: out }); // W198 walkcards: out_s; W222 stationwalk: out; W222 integration: f
      ready = l.t;
      continue;
    }
    const h = l.how, p = tt.patterns[h.p], n = p.st.length, route = tt.routes[p.routeIx], from_s = st(p.st[h.i]), to_s = st(p.st[h.j]);
    const dep = (p.times[h.trip * n + h.i] + h.shift) * 60, arr = (p.times[h.trip * n + h.j] + h.shift) * 60;
    if (!first) change_s += Math.min(HER.cap_s, HER.half * headway(tt, days(h.shift)[h.p], h.p, h.ti, h.i, h.shift));
    const wait = Math.round(dep - ready), kerb = first && wait > WALK.early_s ? WALK.before_s : wait; // W198 walkcards: the first one mostly indoors, by its Leave by
    legs.push({ type: "wait", station: from_s.id, time_s: wait, out_s: roofed(from_s, route) ? held ?? 0 : kerb }); // W198 walkcards: out_s; W222 stationwalk: held, a change inside its walk's
    held = null; // W222 stationwalk
    legs.push({ type: "train", mode: route.type === 3 ? "bus" : "rail", route: p.route, line: route.name, short: route.short || "", rtype: route.type, color: route.color || "8a8f98",
      dir: p.dir, head: p.head, from: from_s.id, from_name: from_s.name, to: to_s.id, to_name: to_s.name, dep: ms(dep), arr: ms(arr), stops: h.j - h.i, time_s: arr - dep,
      path: p.st.slice(h.i, h.j + 1).map((q) => st(q).ll), ids: p.st.slice(h.i, h.j + 1).map((q) => st(q).id), ...(from_s.ent.length ? {} : { kerb: true }), // W78 walkalerts: ids, its stops', for alerted()
      at: p.st.slice(h.i, h.j + 1).map((_, q) => ms((p.times[h.trip * n + h.i + q] + h.shift) * 60)), names: p.st.slice(h.i, h.j + 1).map((q) => st(q).name), // W211 walkride: each stop's time and name, for the ride followed by its timetable (app/walk-ride.js)
      ...(first ? { next: nextDepartures(tt, k, { route: p.route, dir: p.dir, from: p.st[h.i], to: p.st[h.j], after: dep }).map(ms) } : {}) }); // W189 transittimes: the next two at her stop
    fare = Math.max(fare, route.id.startsWith(MASSPORT) ? 0 : FARE[route.type] ?? 2.4); // W192 sltimes: Massport's shuttles are free
    rides.push({ net: route.net, from: from_s, to: to_s, dep, arr, free: route.id.startsWith(MASSPORT) }); // W203 walkcards2
    vehicles++; first = false; ready = arr;
  }
  const last = chain.at(-1), e = x.e, sl = st(last.s);
  legs.push({ type: "walk", time_s: Math.round(e.s), m: Math.round(e.m), from: sl.id, geometry: [e.ent.ll, ...pathTo(router, R, e.ent.j).reverse()], out_s: Math.round(e.s - inside(sl, ride(last), e.ent.in)) }); // W198 walkcards: out_s; W222 stationwalk: its door's seconds
  const lines = legs.filter((l) => l.type === "train").map((l) => l.route);
  const out_s = legs.reduce((s, l) => s + (l.out_s || 0), 0); // W198 walkcards: the minutes outside, walking and waiting
  const price = fareOf(tt, rides); // W203 walkcards2 (SPEC §366): the GTFS's fare, shown; else null, and her weighing keeps the estimate
  return { legs, key: lines.join(">"), total_s: Math.round(x.t - t0), arrive: ms(x.t), walk_m: Math.round(walk_m), change_s: Math.round(change_s), fare: price ?? fare, price, vehicles, lines, out_s }; // W198 walkcards: out_s; W203 walkcards2: price
}

// ---- a Bluebike leg (W204 bikeshare) ---------------------------------------------------------------------------------
/** W204 bikeshare (SPEC §372): walk to a dock, ride a Bluebike, walk on: from the BIKE.near docks nearest by walking with a bike to
 *  rent (the feed's live count; unknown counts as some), to the BIKE.near nearest the end with a free dock, the BIKE.pairs best
 *  pairs by a straight-line guess ridden on the bike graph (the router's default style, its comfort and time, BIKE.slow on a
 *  Bluebike), each a plan as describe()'s, all of it outside: { bike: true, ride_s, stress_s (the ride's seconds on streets that
 *  aren't calm, bikeshare.js stressM()), fare (pay as you go, bikeshare.js fareOf()) }. */
export function bikePlans(router, F, R, docks, { at }) { // W204 bikeshare
  const v = WALK.speed * (F.pace || 1), reach = BIKE.reach_m / v, kx = 111320 * Math.cos((42.36 * Math.PI) / 180); // W211 walkmore: v, at her walking pace
  const ends = (tree, ok) => docks.filter(ok).map((d) => ({ d, w: toPoint(router, tree, d.ll) })).filter((x) => x.w && x.w.s <= reach).sort((a, b) => a.w.s - b.w.s).slice(0, BIKE.near);
  const picks = ends(F, (d) => d.bikes !== 0 && d.renting !== false), drops = ends(R, (d) => d.docks !== 0 && d.returning !== false), pairs = [];
  for (const a of picks) for (const b of drops) if (a.d.id !== b.d.id) pairs.push({ a, b, s: a.w.s + b.w.s + (1.3 * Math.hypot((a.d.ll[0] - b.d.ll[0]) * kx, (a.d.ll[1] - b.d.ll[1]) * 111320)) / 4 });
  const plans = [];
  for (const { a, b } of pairs.sort((x, y) => x.s - y.s).slice(0, BIKE.pairs)) {
    let r = null;
    try { r = router.route({ from: a.d.ll, to: b.d.ll }); } catch { /* an end off the bike graph */ }
    if (!r?.geometry?.length) continue;
    const ride_s = Math.round(r.time_s * BIKE.slow), stress_s = r.distance_m > 0 ? Math.round((ride_s * stressM(r)) / r.distance_m) : 0, wa = Math.round(a.w.s), wb = Math.round(b.w.s);
    const ebike = a.d.bikes != null && a.d.bikes > 0 && a.d.bikes === a.d.ebikes, fare = bikeFare(ride_s, ebike), t1 = wa + BIKE.unlock_s, total = t1 + ride_s + BIKE.dock_s + wb;
    const legs = [
      { type: "walk", time_s: wa, m: Math.round(a.w.s * v), to: a.d.id, to_name: a.d.name, geometry: [...pathTo(router, F, a.w.end), a.d.ll], out_s: wa },
      { type: "bike", from: a.d.id, from_name: a.d.name, from_ll: a.d.ll, to: b.d.id, to_name: b.d.name, to_ll: b.d.ll, bikes: a.d.bikes, ebike, docks: b.d.docks, fare,
        dep: at + t1 * 1000, arr: at + (t1 + ride_s) * 1000, time_s: BIKE.unlock_s + ride_s + BIKE.dock_s, ride_s, m: r.distance_m, stress_s, geometry: r.geometry, comfort: r.comfort || null, out_s: BIKE.unlock_s + ride_s + BIKE.dock_s },
      { type: "walk", time_s: wb, m: Math.round(b.w.s * v), from: b.d.id, geometry: [b.d.ll, ...pathTo(router, R, b.w.end).reverse()], out_s: wb },
    ];
    plans.push({ legs, key: `bike:${a.d.id}>${b.d.id}`, bike: true, total_s: total, arrive: at + total * 1000, walk_m: legs[0].m + legs[2].m, change_s: 0, fare, vehicles: 1, lines: [], out_s: total, ride_s, stress_s });
  }
  return plans;
} // W204 bikeshare
