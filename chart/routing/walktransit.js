// W73 walk (design/app-ui/SPEC.md §119): on foot and by T, for a walker (arclight's wife: "a half-mile walk is nothing;
// a bus to the train is a second thing to miss"). The planner over every mode's timetable (chart/transit/build_timetable.py
// --all) and the bike graph walked, pure JS with no DOM: it runs in the routing worker (worker.js's `walk` message) and in
// Node's tests.
//
//   const tt = readTimetable(buffer);                 // transit.js's reader, the walker's file
//   walkPlan(router, tt, from, to, at)  -> { plans, at, stats } or { plans: [], reason }   plans: her best two or three
//   walkRoute(router, from, to)       -> a walk as router.route()'s course, its turns and the walker's time (W79 walkgo)
//   walkPlan(..., { alerts })           W78 walkalerts: less any plan a storm day's alert stops (transit.js alerted(), V3's
//                                       ALERTS reply), before the cards are picked
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
import { boston } from "../../app/comet-bikes.js";
import { alerted } from "./transit.js"; // W78 walkalerts

/** The walker's numbers. */
export const WALK = {
  speed: 1.4, // m/s on the flat (W72 walktransit, dd1)
  steps: 0.7, // m/s on steps
  signal_s: 15, // a pulsar crossed on foot, on average (dd1: 4-12 a long leg, worth 1-3 min)
  reach_m: 2000, // the longest walk to or from a stop the search looks at
  alone_m: 3500, // the longest walk the whole way it offers
  foot_m: 400, // a change on foot between two stops
  detour: 1.2, // such a change's straight line to the street's (dd1: median 1.15 on the graph)
  board_s: 60, // on the platform or at the kerb a minute before the vehicle
  change_s: 120, // between platforms inside a station
  rounds: 4, // at most four vehicles
  most_m: 3200, // the most walking in one plan
  bucket_m: 50, // walking compared in steps of this, so near-equal walks don't multiply the labels
};
/** Her rule (W72 walktransit §2.3). */
export const HER = { half: 0.5, cap_s: 1200, free_m: 1600, extra: 0.5, usd_s: 120, slack_s: 900, cards: 3 };
/** CharlieCard fares by GTFS route type, in dollars (fare_products.txt, Oct 2026); a change within two hours pays only the
 *  difference, so a plan pays its dearest leg. Commuter Rail and ferries vary by zone: these are the inner zones'. */
export const FARE = { 0: 2.4, 1: 2.4, 2: 2.4, 3: 1.7, 4: 2.4 };

const dayNo = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12) / 86400000);
const N_BLOCKED = 4, B_STEPS = 6;

/** The trips of service day `k` per pattern, sorted as the file has them (by departure at the first stop). */
function tripsOn(tt, k) {
  tt.walkDays ||= new Map();
  if (tt.walkDays.has(k)) return tt.walkDays.get(k);
  const on = tt.services.map((bits) => k >= 0 && k >> 3 < bits.length && (bits[k >> 3] >> (k & 7)) & 1);
  const out = tt.patterns.map((p) => { const a = []; for (let i = 0; i < p.n; i++) if (on[p.svc[i]]) a.push(i); return Int32Array.from(a); });
  if (tt.walkDays.size > 3) tt.walkDays.delete(tt.walkDays.keys().next().value);
  tt.walkDays.set(k, out);
  return out;
}

// ---- walking on the graph ------------------------------------------------------------------------------
const trees = new WeakMap(); // router -> two slots of { dist, pred, done }
/**
 * Walking seconds from `ll` to every junction within `bound` s, with the edge each was reached by (pred, -1 at a seed).
 * The walk to the graph (the snap's gap) and the part of the snapped way are in the seeds.
 */
export function walkTree(router, ll, bound, slot = 0) {
  const N = router.N, { outStart, out, hd, zone, s } = router;
  let sc = trees.get(router);
  if (!sc) trees.set(router, (sc = [0, 1].map(() => ({ dist: new Float64Array(N), pred: new Int32Array(N), done: new Uint8Array(N) }))));
  const { dist, pred, done } = sc[slot];
  dist.fill(Infinity); pred.fill(-1); done.fill(0);
  const p = router.snap(ll);
  if (!p) return null;
  const L = s.len[p.e], gap = p.d / WALK.speed, sp = (d) => (router.bike(d) === B_STEPS ? WALK.steps : WALK.speed);
  const seeds = [[s.from[p.e], gap + (L * p.t) / sp(2 * p.e + 1), 2 * p.e + 1, 1 - p.t], [s.to[p.e], gap + (L * (1 - p.t)) / sp(2 * p.e), 2 * p.e, p.t]];
  let hf = new Float64Array(1 << 14), hq = new Int32Array(1 << 14), n = 0, settled = 0;
  const push = (f, v) => {
    if (n === hf.length) { const a = new Float64Array(2 * n), b = new Int32Array(2 * n); a.set(hf); b.set(hq); hf = a; hq = b; }
    let i = n++;
    while (i > 0) { const q = (i - 1) >> 1; if (hf[q] <= f) break; hf[i] = hf[q]; hq[i] = hq[q]; i = q; }
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
    if (s.node_flags[u] & N_BLOCKED && pred[u] >= 0) continue;
    for (let k = outStart[u], k1 = outStart[u + 1]; k < k1; k++) {
      const d = out[k], v = hd[d], c = du + s.len[d >> 1] / sp(d) + (zone[v] >= 0 && zone[v] !== zone[u] ? WALK.signal_s : 0);
      if (c < dist[v]) { dist[v] = c; pred[v] = d; push(c, v); }
    }
  }
  return { dist, pred, snap: p, seeds, settled, ll };
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
export function walkRoute(router, from, to) { // W79 walkgo
  const F = walkTree(router, from, (2 * WALK.alone_m) / WALK.speed, 0), b = F && router.snap(to), s = router.s;
  if (!b) return null;
  const a = F.snap, L = s.len[b.e], viaFrom = F.dist[s.from[b.e]] + (L * b.t) / WALK.speed, viaTo = F.dist[s.to[b.e]] + (L * (1 - b.t)) / WALK.speed;
  let time = Math.min(viaFrom, viaTo), legs;
  if (a.e === b.e && (a.d + Math.abs(a.t - b.t) * L) / WALK.speed <= time) { // along the one way
    time = (a.d + Math.abs(a.t - b.t) * L) / WALK.speed;
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
  return { ...router.describe(legs, { at: b.at, walk: 0, place: to }, Math.round(time), { at: a.at, walk: a.d, place: from }), time_s: Math.round(time + b.d / WALK.speed), style: "foot" };
}

/** Walking seconds and metres from the tree's start to a point `ll` on the graph (its snap's ends), or null. */
function toPoint(router, tree, ll) {
  const p = router.snap(ll), s = router.s;
  if (!p) return null;
  const L = s.len[p.e];
  const a = tree.dist[s.from[p.e]] + (L * p.t) / WALK.speed, b = tree.dist[s.to[p.e]] + (L * (1 - p.t)) / WALK.speed;
  const end = a <= b ? s.from[p.e] : s.to[p.e], t = Math.min(a, b) + p.d / WALK.speed;
  return Number.isFinite(t) ? { s: t, end, snap: p } : null;
}

const doors = new WeakMap(); // timetable -> { router, ent: per station [[lonlat, junction, metres]] }
/** Each stop's entrances on this graph: the file's snapped junction where it still fits, else snapped again. */
function entrances(router, tt) {
  const c = doors.get(tt);
  if (c && c.router === router) return c.ent;
  const { s } = router;
  const ent = tt.stations.map((st) => st.ent.map(([lon, lat, j, d]) => {
    const ll = [lon, lat], at = (v) => router.metres(ll, [s.lon[v] * 1e-6, s.lat[v] * 1e-6]);
    if (j != null && j < router.N && Math.abs(at(j) - d) < 1.5) return [ll, j, d];
    const p = router.snap(ll);
    if (!p) return null;
    const a = s.from[p.e], b = s.to[p.e], v = at(a) <= at(b) ? a : b;
    return [ll, v, at(v)];
  }).filter(Boolean));
  doors.set(tt, { router, ent });
  return ent;
}

/** Stop-to-stop changes on foot within WALK.foot_m: per stop [[stop, seconds, metres]], built once a file. */
function footpaths(tt) {
  if (tt.foot) return tt.foot;
  const S = tt.stations.length, cell = WALK.foot_m, X = new Float64Array(S), Y = new Float64Array(S), grid = new Map();
  const kx = 111320 * Math.cos((42.36 * Math.PI) / 180);
  tt.stations.forEach((st, i) => { X[i] = st.ll[0] * kx; Y[i] = st.ll[1] * 111320; const k = `${Math.floor(X[i] / cell)},${Math.floor(Y[i] / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  tt.foot = Array.from({ length: S }, (_, i) => {
    const out = [], cx = Math.floor(X[i] / cell), cy = Math.floor(Y[i] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
      const m = Math.hypot(X[i] - X[j], Y[i] - Y[j]) * WALK.detour;
      if (j !== i && m <= cell * WALK.detour) out.push([j, m / WALK.speed + tt.stations[i].access_s + tt.stations[j].access_s, m]);
    }
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
export function search(tt, k, t0, access, egress, alone = null, { prev = false, rounds = WALK.rounds } = {}) {
  const S = tt.stations.length, P = tt.patterns, foot = footpaths(tt);
  const sets = [{ trips: tripsOn(tt, k), shift: 0 }];
  if (prev) sets.push({ trips: tripsOn(tt, k - 1), shift: -1440 });
  if (!tt.byStation) {
    tt.byStation = Array.from({ length: S }, () => []);
    P.forEach((p, pi) => p.st.forEach((s, i) => tt.byStation[s].push([pi, i])));
  }
  const best = new Array(S), dest = [];
  if (alone) dest.push({ t: t0 + alone.s, m: alone.m, n: 0, label: null, e: null, alone });
  const pruned = (t, m) => m > WALK.most_m || dest.some((d) => d.t <= t && bucket(d.m) <= bucket(m));
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
    for (const [s, labs] of [...fresh]) for (const lab of labs) for (const [v, fs, fm] of foot[s]) {
      const x = { t: lab.t + fs, m: lab.m + fm, n: r, s: v, prev: lab, how: { k: "foot", from: s } };
      if (add(v, x)) mark(v, x);
    }
    for (const [s, labs] of fresh) {
      const e = egress.get(s);
      if (!e) continue;
      for (const lab of labs) {
        if (lab.how.k === "foot" && lab.prev && egress.has(lab.prev.s)) continue; // walk on from the vehicle's own stop instead
        const t = lab.t + e.s, m = lab.m + e.m;
        if (m > WALK.most_m || dest.some((d) => d.t <= t && bucket(d.m) <= bucket(m))) continue;
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

/** Her score (s): minutes to the door, the changes' expected waits, the walking past `free_m`, the fare. */
export function herScore(plan) {
  const extra = Math.max(0, plan.walk_m - HER.free_m) / WALK.speed * HER.extra;
  return plan.total_s + plan.change_s + extra + plan.fare * HER.usd_s;
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
  const reachS = WALK.reach_m / WALK.speed;
  const F = walkTree(router, from, WALK.alone_m / WALK.speed, 0), R = walkTree(router, to, reachS, 1);
  if (!F || !R) return { plans: [], at, reason: "far", stats };
  stats.walk_ms = Math.round(performance.now() - t); stats.settled = [F.settled, R.settled];
  const ent = entrances(router, tt), access = new Map(), egress = new Map();
  for (let s = 0; s < ent.length; s++) {
    let a = null, e = null;
    for (const [ll, j, dm] of ent[s]) {
      const fa = F.dist[j] + dm / WALK.speed, fe = R.dist[j] + dm / WALK.speed;
      if (fa <= reachS && (!a || fa < a.walk)) a = { walk: fa, ll, j };
      if (fe <= reachS && (!e || fe < e.walk)) e = { walk: fe, ll, j };
    }
    const acc = tt.stations[s].access_s;
    if (a) access.set(s, { s: a.walk + acc, m: a.walk * WALK.speed, ent: a });
    if (e) egress.set(s, { s: e.walk + acc, m: e.walk * WALK.speed, ent: e });
  }
  const direct = toPoint(router, F, to);
  const alone = direct && direct.s * WALK.speed <= WALK.alone_m ? { s: direct.s, m: direct.s * WALK.speed, end: direct.end } : null;
  stats.stops = [access.size, egress.size];
  if ((!access.size || !egress.size) && !alone) return { plans: [], at, reason: "far", stats };
  const t1 = performance.now();
  const { dest, scanned } = search(tt, k, t0, access, egress, alone, { prev: B.min < 4 * 60 });
  stats.search_ms = Math.round(performance.now() - t1); stats.scanned = scanned; stats.pareto = dest.length;
  const days = (shift) => tripsOn(tt, k + (shift ? -1 : 0));
  const all = dest.map((x) => describe(router, tt, { x, F, R, from, to, at, t0, days }));
  const plans = opts.alerts ? all.filter((p) => !alerted(opts.alerts, p, { bike: false }).length) : all; // W78 walkalerts: a storm day's, and the next one weighed
  stats.alerted = all.length - plans.length; // W78 walkalerts
  stats.ms = Math.round(performance.now() - t);
  return { plans: pickCards(plans, opts.cards ?? HER.cards), at, stats };
}

/** Up to n cards from the Pareto set: her best, then the quickest, then the least walking, each once, within her slack. */
export function pickCards(plans, n = HER.cards) {
  for (const p of plans) p.score = Math.round(herScore(p));
  const pool = plans.slice().sort((a, b) => a.score - b.score || a.total_s - b.total_s);
  if (!pool.length) return [];
  const top = pool[0], near = pool.filter((p) => p.score <= top.score + HER.slack_s);
  const quick = near.reduce((a, b) => (b.total_s < a.total_s ? b : a));
  const least = near.reduce((a, b) => (b.walk_m < a.walk_m - WALK.bucket_m ? b : a));
  const out = [];
  for (const p of [top, quick, least, ...near]) {
    if (out.length >= n) break;
    if (out.includes(p) || out.some((q) => q.key === p.key)) continue;
    out.push(p);
  }
  // each reason once, in a word: the quickest; then the fewest vehicles (her best of them), when the quickest has more; then the
  // least walking. A card with none of these is her runner-up, and says nothing.
  const minT = Math.min(...out.map((p) => p.total_s)), minW = Math.min(...out.map((p) => p.walk_m)), minN = Math.min(...out.map((p) => p.vehicles));
  for (const p of out) p.why = "";
  const give = (why, ok) => { const p = out.find((q) => !q.why && ok(q)); if (p) p.why = why; };
  give("quickest", (p) => p.total_s === minT);
  if (out.find((q) => q.why === "quickest")?.vehicles > minN) give(minN ? "direct" : "walk", (p) => p.vehicles === minN); // only when it sets it apart from the quickest
  if (out.length > 1) give("least", (p) => p.walk_m === minW);
  return out;
}

/** A Pareto label as a plan: its legs (walk, wait, ride, change or walk, ..., walk), times as ms, and its totals. */
function describe(router, tt, { x, F, R, from, to, at, t0, days }) {
  const ms = (s) => at + (s - t0) * 1000, legs = [];
  const st = (s) => tt.stations[s];
  let walk_m = x.m, change_s = 0, fare = 0, vehicles = 0, first = true;
  if (!x.label) { // walking the whole way
    const pts = pathTo(router, F, x.alone.end);
    legs.push({ type: "walk", time_s: Math.round(x.t - t0), m: Math.round(x.m), geometry: [...pts, to] });
    return { legs, key: "walk", total_s: Math.round(x.t - t0), arrive: ms(x.t), walk_m: Math.round(walk_m), change_s: 0, fare: 0, vehicles: 0, lines: [] };
  }
  const chain = [];
  for (let l = x.label; l; l = l.prev) chain.unshift(l);
  const a = chain[0].how.a, s0 = chain[0].s;
  legs.push({ type: "walk", time_s: Math.round(a.s), m: Math.round(a.m), to: st(s0).id, to_name: st(s0).name, geometry: [...pathTo(router, F, a.ent.j), a.ent.ll] });
  let ready = chain[0].t;
  for (const l of chain.slice(1)) {
    if (l.how.k === "foot") {
      const A = st(l.how.from), Bs = st(l.s);
      legs.push({ type: "walk", change: true, time_s: Math.round(l.t - ready), m: Math.round(l.m - l.prev.m), from: A.id, to: Bs.id, to_name: Bs.name, geometry: [A.ll, Bs.ll] });
      ready = l.t;
      continue;
    }
    const h = l.how, p = tt.patterns[h.p], n = p.st.length, route = tt.routes[p.routeIx], from_s = st(p.st[h.i]), to_s = st(p.st[h.j]);
    const dep = (p.times[h.trip * n + h.i] + h.shift) * 60, arr = (p.times[h.trip * n + h.j] + h.shift) * 60;
    if (!first) change_s += Math.min(HER.cap_s, HER.half * headway(tt, days(h.shift)[h.p], h.p, h.ti, h.i, h.shift));
    legs.push({ type: "wait", station: from_s.id, time_s: Math.round(dep - ready) });
    legs.push({ type: "train", mode: route.type === 3 ? "bus" : "rail", route: p.route, line: route.name, short: route.short || "", rtype: route.type, color: route.color || "8a8f98",
      dir: p.dir, head: p.head, from: from_s.id, from_name: from_s.name, to: to_s.id, to_name: to_s.name, dep: ms(dep), arr: ms(arr), stops: h.j - h.i, time_s: arr - dep,
      path: p.st.slice(h.i, h.j + 1).map((q) => st(q).ll), ids: p.st.slice(h.i, h.j + 1).map((q) => st(q).id), ...(from_s.ent.length ? {} : { kerb: true }) }); // W78 walkalerts: ids, its stops', for alerted()
    fare = Math.max(fare, FARE[route.type] ?? 2.4);
    vehicles++; first = false; ready = arr;
  }
  const last = chain.at(-1), e = x.e, sl = st(last.s);
  legs.push({ type: "walk", time_s: Math.round(e.s), m: Math.round(e.m), from: sl.id, geometry: [e.ent.ll, ...pathTo(router, R, e.ent.j).reverse()] });
  const lines = legs.filter((l) => l.type === "train").map((l) => l.route);
  return { legs, key: lines.join(">"), total_s: Math.round(x.t - t0), arrive: ms(x.t), walk_m: Math.round(walk_m), change_s: Math.round(change_s), fare, vehicles, lines };
}
