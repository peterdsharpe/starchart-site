// The star trail (wave 16): the path flown since Launch, drawn under the ship. It grows by a point
// at each fix while the ship moves, so the chart's source is re-sent once a second at most and never
// per frame. A point that only carries a straight run on replaces the run's end, but only while every
// point of the run stays within STRAIGHT_M of the line that would replace it, so curves keep their shape
// (arclight, 2026-10-16: the old test looked at the newest point alone, so a gentle bend became chords
// about 70 m long). Past MAX_POINTS, the oldest half is simplified the same way at a coarser tolerance,
// which keeps its shape too. The input is the GPS gently smoothed (app/match.js's Smoother: each fix
// blended with where the Doppler speed and course say the ship is), not the road-snapped spot.
import { metres } from "./geo.js";

export const STEP_M = 4; // a fix this close to the last point adds nothing (GPS jitter at a light)
export const STRAIGHT_M = 0.5; // a run's points this close to the line that replaces them are dropped
export const MAX_POINTS = 6000; // past this, the oldest half is simplified at a coarser tolerance
export const RUN_MAX = 400; // a straight run this long keeps a corner, which bounds the work a fix does
export const EASE = 1; // how far each fix moves the trail's end toward it: 1, as the input is smoothed already

/** How far b lies from the line a–c, in metres (small-area approximation, as geo.js). */
export function offLine(a, b, c) {
  const k = Math.cos((a[1] * Math.PI) / 180) * 111320;
  const bx = (b[0] - a[0]) * k, by = (b[1] - a[1]) * 111320, cx = (c[0] - a[0]) * k, cy = (c[1] - a[1]) * 111320;
  const len = Math.hypot(cx, cy);
  return len ? Math.abs(bx * cy - by * cx) / len : Math.hypot(bx, by);
}

/** Douglas–Peucker over [lon, lat] points, keeping both ends: every dropped point within tol metres of the kept line. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
  keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    let far = -1, d = tol;
    for (let k = i + 1; k < j; k++) { const e = offLine(pts[i], pts[k], pts[j]); if (e > d) { d = e; far = k; } }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

export class Trail {
  constructor({ step = STEP_M, straight = STRAIGHT_M, max = MAX_POINTS, ease = EASE } = {}) {
    Object.assign(this, { step, straight, max, ease });
    this.clear();
  }

  clear() { this.pts = []; this.at = null; this.run = []; this.thin = 2 * this.straight; this.before = []; } // W28 resume: before

  /** W28 resume: the lines flown before a gap (the app closed mid-flight); the trail goes on as a new line, so the gap shows. */
  gap() { const b = this.before.concat(this.pts.length >= 2 ? [this.pts] : []); this.clear(); this.before = b; }
  /** W28 resume: every line, for app/resume.js to keep. */
  get lines() { return this.before.concat(this.pts.length ? [this.pts] : []); }

  /** Add a fix's [lon, lat]. Returns true when the line changed. */
  push(lonlat) {
    const a = this.at, k = this.ease;
    this.at = a ? [a[0] + (lonlat[0] - a[0]) * k, a[1] + (lonlat[1] - a[1]) * k] : [lonlat[0], lonlat[1]];
    const P = this.pts, n = P.length, p = this.at;
    if (n && metres(P[n - 1], p) < this.step) return false;
    // P[n - 1] is the run's end, which may still move; this.run holds the points it stands for since the corner P[n - 2].
    const anchor = n >= 2 ? P[n - 2] : null;
    if (anchor && this.run.length < RUN_MAX && this.run.every((q) => offLine(anchor, q, p) < this.straight)) P[n - 1] = p;
    else { P.push(p); this.run = []; }
    this.run.push(p);
    while (this.pts.length > this.max) { // the oldest half, coarser each time it comes to this, so a long flight stays in budget
      const Q = this.pts, half = Q.length >> 1;
      this.pts = simplify(Q.slice(0, half + 1), this.thin).concat(Q.slice(half + 1));
      this.thin *= 2;
    }
    return true;
  }

  /** The trail as GeoJSON for a line source with lineMetrics, or an empty collection under two points. `end`, the ship
   *  as drawn, closes it, so the line runs out from under the ship whatever the smoothing did. */
  geojson(end = null) {
    const c = end && this.pts.length && metres(this.pts[this.pts.length - 1], end) >= 1 ? this.pts.concat([end]) : this.pts;
    const lines = c.length < 2 ? this.before : this.before.concat([c]); // W28 resume: a gap is a gap, not a straight line
    return !lines.length ? { type: "FeatureCollection", features: [] } : lines.length > 1 ? { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }
      : { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: lines[0] } };
  }
}
