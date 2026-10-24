// W73 ghosts (design/app-ui/SPEC.md §121): ghost trails, the pure part. Each kept flight's track, as the Log draws it,
// simplified once to GHOST_M for the chart and kept beside the Log (app/logbook-worker.js); the Log's own tracks stay raw.
// No imports, so the logbook worker, MapLibre's workers (app/ghosts-worker.mjs) and Node's tests (app/tests/ghosts.test.mjs) load it.

/** How far (m) a ghost trail may stray from its track: about the GPS's own wander, and a few px at z17. */
export const GHOST_M = 5;
/** The cached lines' version: a change to the simplification bumps it, and each flight's line is made again. */
export const GHOST_V = 1;
/** The newest flight's ghost and the oldest's (the style's ghost-trail multiplies the feature's opacity by 1.3). */
export const NEWEST = 0.5, OLDEST = 0.22;

/** The line `pts` ([lon, lat]) with no point more than `tol` m off it (Douglas–Peucker, by distance, not by count). */
export function simplifyTo(pts, tol = GHOST_M) {
  if (pts.length < 3) return pts.slice();
  const ky = 111320, kx = ky * Math.cos((pts[0][1] * Math.PI) / 180), keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a][0] * kx, ay = pts[a][1] * ky, dx = pts[b][0] * kx - ax, dy = pts[b][1] * ky - ay, len2 = dx * dx + dy * dy;
    let best = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * kx - ax, py = pts[i][1] * ky - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0; // to the segment, so a there-and-back keeps its far end
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > best) { best = d; at = i; }
    }
    if (best <= tol) continue;
    keep[at] = 1;
    stack.push([a, at], [at, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

const q = (v) => Math.round(v * 1e5) / 1e5; // 1e-5°, about a metre: the JSON stays short
/** A flight's ghost: its lines (trackLines' runs of [lon, lat]), each simplified and rounded; runs under two points go. */
export function ghostLines(lines, tol = GHOST_M) {
  return lines.map((l) => simplifyTo(l, tol).map(([x, y]) => [q(x), q(y)])).filter((l) => l.length >= 2);
}

/** The `ghosts` source's data from each flight's lines, oldest first: one feature a flight, fainter the older it is, and the
 *  box round them all ([[w, s], [e, n]], or null when there are none). */
export function ghostCollection(flights) {
  const fs = flights.filter((l) => l?.length), n = fs.length, box = [[Infinity, Infinity], [-Infinity, -Infinity]];
  const features = fs.map((lines, i) => {
    for (const l of lines) for (const [x, y] of l) { box[0][0] = Math.min(box[0][0], x); box[0][1] = Math.min(box[0][1], y); box[1][0] = Math.max(box[1][0], x); box[1][1] = Math.max(box[1][1], y); }
    const opacity = +(n < 2 ? NEWEST : OLDEST + ((NEWEST - OLDEST) * i) / (n - 1)).toFixed(3);
    const geometry = lines.length > 1 ? { type: "MultiLineString", coordinates: lines } : { type: "LineString", coordinates: lines[0] };
    return { type: "Feature", properties: { opacity }, geometry };
  });
  return { data: { type: "FeatureCollection", features }, bounds: n ? box : null };
}

/** The ghosts' own database, "starchart-ghosts", store "lines": each flight's lines by its id ({v, lines}), and the set the
 *  chart draws under SET ({v, data}). Its own, so the Log's "starchart" keeps its version and its backup, and an older
 *  Starchart in another tab opens that as before; a lost one only costs the making again. */
export const SET = "@set";
let db = null;
export function openGhosts() {
  db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("starchart-ghosts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("lines");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { db = null; reject(r.error); };
  });
  return db;
}
