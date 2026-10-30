// A course that grows as you fly: the path behind the ship from real GPS fixes, plus a straight
// look-ahead along the heading. It has the same shape as chart/prototype/events.js's Course
// (length, props, at, pointAt, heading, slice, distanceTo, climb), so the prototype's EventEngine
// can announce systems, pulsars, black holes and bridges in free flight, with no course set.

import { metres, bearing, destination } from "./geo.js";
import { isWormholeTags, pointSegment } from "../chart/prototype/events.js";

export const AHEAD_M = 200; // how far ahead the engine looks (it scans 160 m ahead, and touchdown never fires)
export const KEEP_M = 2000; // how much of the path behind the ship is kept
// Leaving a bike path (wave 21): only after this far and this long off it, longer than a multipath burst,
// so a GPS jump can't make a leave-then-enter pair; and a point from a fix worse than POOR_M never
// changes whether you are on one.
export const LEAVE_M = 70;
export const LEAVE_S = 10;
export const POOR_M = 25;

export class LiveCourse {
  constructor({ ahead = AHEAD_M, keep = KEEP_M, from = 0 } = {}) { // W28 resume: from, the metres flown before the app closed
    this.ahead = ahead;
    this.from = from;
    this.keep = keep;
    this.pts = [];
    this.cum = []; // metres flown at each point, from the launch (not from the oldest kept point)
    this.tags = []; // OSM-style way tags for the segment from each point, e.g. "highway=cycleway"
    this.acc = []; // each point's fix accuracy (m), time (ms), and whether it keeps the state, for the hysteresis
    this.ts = [];
    this.keeps = [];
    this.headingNow = 0;
    this.props = { title: "Free flight", instructions: [] };
  }

  /** Metres flown to the last fix. */
  get s() { return this.cum.length ? this.cum[this.cum.length - 1] : this.from; } // W28 resume: from
  /** The course ends a look-ahead past the ship, so the engine never thinks it has landed. */
  get length() { return this.s + this.ahead; }

  push(lonlat, heading, tags = "", { accuracy = 0, t = 0, keep = false } = {}) {
    const n = this.pts.length;
    this.cum.push(n ? this.cum[n - 1] + metres(this.pts[n - 1], lonlat) : this.from); // W28 resume: from
    this.pts.push(lonlat);
    this.tags.push(tags);
    this.acc.push(accuracy);
    this.ts.push(t);
    this.keeps.push(keep);
    this.headingNow = heading;
    while (this.cum.length > 2 && this.cum[1] < this.s - this.keep) { for (const a of [this.pts, this.cum, this.tags, this.acc, this.ts, this.keeps]) a.shift(); }
  }

  /** A new heading without moving (stopped at a light, say). */
  turn(heading) { this.headingNow = heading; }

  index(s) {
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  pointAt(s) {
    const n = this.pts.length;
    if (!n) return [0, 0];
    if (s >= this.s) return destination(this.pts[n - 1], this.headingNow, Math.min(s, this.length) - this.s);
    if (s <= this.cum[0]) return this.pts[0];
    const i = this.index(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const t = (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  heading(s) {
    if (s >= this.s - 1 || this.pts.length < 2) return this.headingNow;
    const i = this.index(s);
    return bearing(this.pts[i], this.pts[i + 1]);
  }

  at(s) {
    const i = this.pts.length ? (s >= this.s ? this.pts.length - 1 : this.index(s)) : 0;
    return { i, lonlat: this.pointAt(s), ele: 0, heading: this.heading(s), tags: this.tags[i] || "", poor: this.acc[i] > POOR_M };
  }

  slice(s0, s1) {
    const out = [this.pointAt(s0)];
    for (let i = this.index(s0) + 1; i < this.pts.length && this.cum[i] < s1; i++) if (this.cum[i] > s0) out.push(this.pts[i]);
    out.push(this.pointAt(s1));
    return out;
  }

  /** The nearest approach to p between s0 and s1: {d: metres off the course, s: where along it}. */
  distanceTo(p, s0, s1) {
    const pts = this.slice(s0, s1);
    let best = Infinity, bestS = s0, acc = s0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointSegment(p, pts[i], pts[i + 1]);
      const len = metres(pts[i], pts[i + 1]);
      if (d < best) { best = d; bestS = acc + Math.sqrt(Math.max(0, metres(pts[i], p) ** 2 - d * d)); }
      acc += len;
    }
    return { d: best, s: Math.min(bestS, s1) };
  }

  /** The engine asks a live course for its bike-path runs at every scan, not once (events.js). */
  get live() { return true; }

  /**
   * The bike-path runs flown so far, from each segment's tags, as [{start, end, on}] in metres, where
   * `on` is how far of it was flown on a bike path. Nothing is known ahead, so there is no minimum
   * length: 30 m on one, and you are in. A gap that ended before it was LEAVE_M and LEAVE_S long (before
   * the engine could have said you left) is bridged, and a point
   * from a poor fix, or one pushed with `keep` (app/match.js forCourse), keeps the state before it (wave 21). The last run reaches to the look-ahead while
   * you ride it, and until you have been off it for both LEAVE_M and LEAVE_S.
   */
  wormholeRuns() {
    const runs = [], n = this.pts.length;
    let on = false, gap = -1; // gap: the first point off the last run
    for (let i = 0; i < n; i++) {
      if (!(this.acc[i] > POOR_M) && !this.keeps[i]) on = isWormholeTags(this.tags[i]);
      const last = runs.at(-1);
      if (!on) { if (last && gap < 0) gap = i; continue; }
      const end = i + 1 < n ? this.cum[i + 1] : this.length, flown = (i + 1 < n ? this.cum[i + 1] : this.s) - this.cum[i];
      if (last && (gap < 0 || (this.cum[i - 1] - this.cum[gap] < LEAVE_M || this.ts[i - 1] - this.ts[gap] < LEAVE_S * 1000))) { last.end = end; last.on += flown; }
      else runs.push({ start: this.cum[i], end, on: flown });
      gap = -1;
    }
    const last = runs.at(-1);
    if (last && gap >= 0 && (this.s - this.cum[gap] < LEAVE_M || this.ts[n - 1] - this.ts[gap] < LEAVE_S * 1000)) last.end = this.length;
    return runs;
  }

  /** No elevation from GPS yet: the g-well moments need a terrain model (later). */
  climb() { return 0; }
}
