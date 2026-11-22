// W222 ontrain (design/app-ui/SPEC.md §433), her rows 11 and 7 of 2026-11-12: "On the Commuter Rail, Starchart loses track of the ride"
// (picture 05: on the train out of North Station at 19 mph, "Missed: straight onto Federal Street"), and "On a train during a walk, the
// avatar jumps back and forth between stations". A ride's line was its stops joined straight, and the Commuter Rail's tracks run 300 m
// from that line at the median between two stops (1.7 km at the 90th percentile; the subway's 39 m): out of the watch's 250 m, the train
// was never her ride, and the map drew it where it isn't. Now a ride's line is its tracks: the T's lines as the map draws them (W144
// tlines, chart/style/tlines-v1.geojson), the shortest way along them from each stop to the next; straight where there's none (a bus, a
// boat, the lines not read yet). One line for all: the watch (walk-ride.js), her avatar on board (ridePlace), the leg on the map
// (comet-card.js trainLines) and the camera's fit (trip.js legPoints). No DOM here.
//
//   useTracks(read), warmTracks(), setTracks(json), onTracks(f) -> how to read the T's lines (main.js), read them now, them, who redraws
//   rideLine(l)               -> { pts, cm, sm, key }: ride leg `l`'s line, its points' and its stops' metres along it, "track" or "path"
//   pointAt(line, s)          -> { ll, heading }: the point `s` metres along it, and the way it goes there
import { metres, bearing } from "./geo.js";

export const LINE = {
  snap_m: 400, // a stop's place on its tracks: the nearest point of its family's lines this near (North Station's point is 138 m off them)
  join_m: 200, // one T line's end joins another's nearest point this near (W144 tlines joins them at their ends; simplified, 3-70 m off)
  bend: 2, // the way between two stops is at most this much longer than the straight line between them, and join_m: else straight (the GTFS shapes: 1.74 at most, North Station to Chelsea; the subway 1.24)
};
let tracks = null, readTracks = null;
const graphs = new Map(), lines = new WeakMap(), heard = [], KX = 111320 * Math.cos((42.36 * Math.PI) / 180), KY = 110540;
/** main.js: how to read the T's lines, once a ride's line is first asked for (a plan with a train or a bus, a ride). */
export const useTracks = (read) => { readTracks = read; };
/** `f()` once the T's lines are read: what drew a line straight before draws it again. */
export const onTracks = (f) => { heard.push(f); };
/** The T's lines, by family (build_tlines.py's `line`: Red, Orange, Blue, Green, Mattapan, Commuter Rail); null, none. */
export function setTracks(json) {
  tracks = {}; graphs.clear();
  for (const f of json?.features || []) if (f.geometry?.type === "LineString") (tracks[f.properties?.line] ||= []).push(f.geometry.coordinates);
  if (json) for (const f of heard) try { f(); } catch { /* one listener's throw is its own */ }
}
const familyOf = (route = "") => (route.startsWith("CR-") ? "Commuter Rail" : route.startsWith("Green-") ? "Green" : /^(Red|Orange|Blue|Mattapan)$/.test(route) ? route : null);
/** Read them now if they aren't (main.js, once the map is first idle): a line asked for meanwhile is straight till they come. */
export function warmTracks() {
  if (tracks || !readTracks) return;
  const read = readTracks;
  readTracks = null;
  Promise.resolve().then(read).then(setTracks, () => {}); // unread (no copy, offline on a first visit): every line straight, as before
}
function linesOf(route) {
  const fam = familyOf(route);
  if (fam) warmTracks();
  return (fam && tracks?.[fam]) || null;
}
/** The nearest point within `max` m of `p` (metres, KX/KY) on the lines of graph `g`; `each`, the nearest on each line but `skip`. */
function nearest(g, p, max, skip = -1, each = false) {
  const best = new Map();
  for (const [a, b, k] of g.segs) {
    if (k === skip) continue;
    const A = g.xy[a], B = g.xy[b], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, u = L2 ? Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / L2)) : 0;
    const x = A[0] + u * dx, y = A[1] + u * dy, d = Math.hypot(p[0] - x, p[1] - y), key = each ? k : 0;
    if (d <= max && !(best.get(key)?.d <= d)) best.set(key, { a, b, d, p: [x, y], ll: [x / KX, y / KY] });
  }
  return each ? [...best.values()] : best.get(0) || null;
}
/** A family's lines as a graph: each line's points in order, and each line's two ends joined to the nearest point of every other line
 *  within LINE.join_m (build_tlines.py joins a line at its ends to the one it leaves; simplified, a few metres to tens of metres off). */
function graphOf(ls) {
  let g = graphs.get(ls);
  if (g) return g;
  g = { ll: [], xy: [], adj: [], segs: [] };
  const add = (p) => { g.ll.push(p); g.xy.push([p[0] * KX, p[1] * KY]); g.adj.push([]); return g.ll.length - 1; };
  const link = (a, b) => { const w = Math.hypot(g.xy[a][0] - g.xy[b][0], g.xy[a][1] - g.xy[b][1]); g.adj[a].push(b, w); g.adj[b].push(a, w); };
  const ends = [];
  ls.forEach((c, k) => { const i0 = g.ll.length; c.forEach((p, i) => { add(p); if (i) { link(i0 + i - 1, i0 + i); g.segs.push([i0 + i - 1, i0 + i, k]); } }); ends.push([i0, k], [g.ll.length - 1, k]); });
  for (const [e, k] of ends) for (const q of nearest(g, g.xy[e], LINE.join_m, k, true)) { const n = add(q.ll); link(n, q.a); link(n, q.b); link(e, n); }
  graphs.set(ls, g);
  return g;
}
/** The shortest way on graph `g` from `s` to `t` (nearest()'s points): { m, pts }, its metres and its points from s's to t's. */
function wayOf(g, s, t) {
  const dist = new Float64Array(g.ll.length).fill(Infinity), from = new Int32Array(g.ll.length).fill(-1), hv = [], hi = [], to = (p, i) => Math.hypot(p[0] - g.xy[i][0], p[1] - g.xy[i][1]);
  const push = (v, i) => { let k = hv.length; hv.push(v); hi.push(i); while (k) { const q = (k - 1) >> 1; if (hv[q] <= v) break; hv[k] = hv[q]; hi[k] = hi[q]; k = q; } hv[k] = v; hi[k] = i; };
  const pop = () => { const top = hi[0], v = hv.pop(), i = hi.pop(); let k = 0; if (hv.length) { for (let c = 1; c < hv.length; k = c, c = 2 * k + 1) { if (c + 1 < hv.length && hv[c + 1] < hv[c]) c++; if (hv[c] >= v) break; hv[k] = hv[c]; hi[k] = hi[c]; } hv[k] = v; hi[k] = i; } return top; };
  for (const i of [s.a, s.b]) if (to(s.p, i) < dist[i]) { dist[i] = to(s.p, i); push(dist[i], i); }
  let best = s.a === t.a && s.b === t.b ? Math.hypot(s.p[0] - t.p[0], s.p[1] - t.p[1]) : Infinity, end = -1;
  while (hv.length && hv[0] < best) {
    const v = hv[0], i = pop();
    if (v > dist[i]) continue;
    if ((i === t.a || i === t.b) && v + to(t.p, i) < best) { best = v + to(t.p, i); end = i; }
    for (let k = 0, e = g.adj[i]; k < e.length; k += 2) if (v + e[k + 1] < dist[e[k]]) { dist[e[k]] = v + e[k + 1]; from[e[k]] = i; push(dist[e[k]], e[k]); }
  }
  if (best === Infinity) return null;
  const pts = [];
  for (let i = end; i >= 0; i = from[i]) pts.push(g.ll[i]);
  return { m: best, pts: [s.ll, ...pts.reverse(), t.ll] };
}
/** Ride leg `l`'s line: `pts` from the stop she boards at to hers, `cm` each point's metres along it, `sm` each stop's (onLine()'s), `key`
 *  "track" on its tracks, each stop at its nearest point of them, else "path" (its stops joined straight, as the map draws the leg); on
 *  tracks, `flat` each pair of stops joined straight (no way on them). */
export function rideLine(l) {
  const ls = linesOf(l.route), had = lines.get(l);
  if (had && had.ls === ls) return had.line;
  let line;
  if (!ls) { const sm = along(l.path); line = { pts: l.path, cm: sm, sm, key: "path" }; } else {
    const g = graphOf(ls), snap = l.path.map((p) => nearest(g, [p[0] * KX, p[1] * KY], LINE.snap_m)), pts = [snap[0]?.ll ?? l.path[0]], ends = [0], flat = [];
    for (let i = 1; i < l.path.length; i++) {
      const w = snap[i - 1] && snap[i] && wayOf(g, snap[i - 1], snap[i]), on = !!w && w.m <= LINE.bend * metres(l.path[i - 1], l.path[i]) + LINE.join_m;
      pts.push(...(on ? w.pts.slice(1) : [snap[i]?.ll ?? l.path[i]])); ends.push(pts.length - 1); flat.push(!on);
    }
    const cm = along(pts);
    line = { pts, cm, sm: ends.map((k) => cm[k]), key: "track", flat };
  }
  lines.set(l, { ls, line });
  return line;
}
/** The point `s` metres along `line`, and the way the line goes there. */
export function pointAt({ pts, cm }, s) {
  const n = pts.length - 1;
  let i = 1;
  while (i < n && (cm[i] < s || cm[i] === cm[i - 1])) i++;
  if (n < 1 || !(cm[i] > cm[i - 1])) return { ll: pts[n].slice(), heading: null };
  const a = pts[i - 1], b = pts[i], f = Math.min(1, Math.max(0, (s - cm[i - 1]) / (cm[i] - cm[i - 1])));
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b) };
}
/** Each point's metres along `pts` (walk-ride.js onLine()'s: flat near each point). */
const along = (pts) => pts.reduce((o, p, i) => { if (i) { const a = pts[i - 1], kx = 111320 * Math.cos((a[1] * Math.PI) / 180); o.push(o[i - 1] + Math.hypot((p[0] - a[0]) * kx, (p[1] - a[1]) * 110540)); } return o; }, [0]);
