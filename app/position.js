// Position sources for flight mode: real GPS, or the demo mission replayed (brief §8: one small,
// fakeable module for time and position). Both give the frame loop the same pose:
//   {lonlat, heading, warp, s, elapsed}
// s is metres flown, warp is mph, elapsed is earth seconds since launch.
// The filtering is in pure functions at the top, so Node can test it (app/tests/position.test.mjs).

import { LiveCourse } from "./live-course.js";
import { metres, bearing, destination, angleDiff } from "./geo.js";

export { metres, bearing, destination, angleDiff };

const MPH = 0.44704; // metres per second at warp 1
export const MAX_ACCURACY_M = 50; // fixes worse than this are dropped
export const STOPPED_MPS = 1; // below about warp 2 the course over ground is noise: keep the last heading
export const MAX_MPS = 25; // faster than this between two fixes is a jump, not a bike (warp 56)
export const GLIDE_MS = 1000; // the ship eases onto each new fix over this long, so it never jumps
export const PREDICT_MS = 2000; // and flies on along its heading for at most this long without a fix

/** A Geolocation position as a plain fix. */
export function fixFrom(pos) {
  const c = pos.coords;
  return {
    lonlat: [c.longitude, c.latitude],
    accuracy: c.accuracy,
    t: pos.timestamp,
    speed: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
    heading: Number.isFinite(c.heading) ? c.heading : null,
  };
}

/** Is this fix good enough to fly on? Drops poor accuracy, stale or repeated fixes, and jumps. */
export function acceptFix(fix, last, maxAccuracy = MAX_ACCURACY_M) {
  if (!fix || !fix.lonlat.every(Number.isFinite)) return false;
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > maxAccuracy) return false;
  if (!last) return true;
  const dt = (fix.t - last.t) / 1000;
  if (!(dt > 0)) return false;
  return metres(last.lonlat, fix.lonlat) / dt <= MAX_MPS;
}

/** Ground speed in m/s: the receiver's own if it gives one, else distance over time. */
export function groundSpeed(fix, last) {
  if (fix.speed !== null) return fix.speed;
  if (!last) return 0;
  const dt = (fix.t - last.t) / 1000;
  return dt > 0 ? metres(last.lonlat, fix.lonlat) / dt : 0;
}

/** The course over ground for this fix, or null when it cannot be told (stopped, or no movement). */
export function courseOverGround(fix, last, speed) {
  if (speed < STOPPED_MPS) return null;
  if (fix.heading !== null) return fix.heading;
  if (last && metres(last.lonlat, fix.lonlat) >= 2) return bearing(last.lonlat, fix.lonlat);
  return null;
}

/** Smooth the heading on the circle. When stopped (cog null) the last heading stays. */
export function smoothHeading(prev, cog, alpha = 0.5) {
  if (cog === null || cog === undefined) return prev;
  if (prev === null || prev === undefined) return cog;
  return (prev + angleDiff(cog, prev) * alpha + 360) % 360;
}

/**
 * The GPS filter: accepted fixes in, a gliding pose out. `now` is the frame clock (ms).
 * push() returns {accepted, moving}; pose(now) is where the ship should be drawn.
 */
export class GpsFilter {
  constructor({ maxAccuracy = MAX_ACCURACY_M } = {}) {
    this.maxAccuracy = maxAccuracy;
    this.fix = null; // the last accepted fix
    this.heading = null;
    this.speed = 0;
    this.jumps = 0; // jumps dropped in a row
    this.fixes = 0; // fixes accepted since the last restart
    this.from = null; // where the ship was drawn when the last fix arrived
    this.arrived = 0;
  }

  push(fix, now) {
    let ok = acceptFix(fix, this.fix, this.maxAccuracy);
    // Three jumps in a row mean the last accepted fix was the bad one: start again from here.
    if (!ok && this.fix && Number.isFinite(fix.accuracy) && fix.accuracy <= this.maxAccuracy && fix.t > this.fix.t) {
      if (++this.jumps >= 3) { this.jumps = 0; this.fixes = 0; this.fix = null; this.from = null; ok = true; }
    }
    if (!ok) return { accepted: false, moving: false };
    this.jumps = 0;
    const last = this.fix;
    this.from = this.from ? [...this.pose(now).lonlat] : fix.lonlat; // where the ship is drawn now, before it changes
    const v = groundSpeed(fix, last);
    this.speed = this.fixes++ > 1 ? (this.speed + v) / 2 : v;
    this.heading = smoothHeading(this.heading, courseOverGround(fix, last, v));
    this.fix = fix;
    this.arrived = now;
    return { accepted: true, moving: this.speed >= STOPPED_MPS };
  }

  /**
   * The drawn position: eases from where the ship was onto the fix flown on by dead reckoning.
   * Called every frame, so it fills one object instead of making a new one (brief §8, rule 3).
   */
  pose(now) {
    if (!this.fix) return null;
    const age = Math.max(0, now - this.arrived);
    const lead = this.speed >= STOPPED_MPS && this.heading !== null ? (Math.min(age, PREDICT_MS) / 1000) * this.speed : 0;
    const [fx, fy] = this.fix.lonlat;
    const h = ((this.heading || 0) * Math.PI) / 180;
    const tx = fx + (lead * Math.sin(h)) / (111320 * Math.cos((fy * Math.PI) / 180)), ty = fy + (lead * Math.cos(h)) / 111320;
    const k = Math.min(1, age / GLIDE_MS);
    const from = this.from || this.fix.lonlat;
    const out = (this.out ??= { lonlat: [0, 0], heading: 0, speed: 0 });
    out.lonlat[0] = from[0] + (tx - from[0]) * k;
    out.lonlat[1] = from[1] + (ty - from[1]) * k;
    out.heading = this.heading ?? 0;
    out.speed = this.speed < STOPPED_MPS || age > PREDICT_MS * 2 ? 0 : this.speed; // stopped reads warp 0
    return out;
  }
}

/** Why GPS cannot be used here, or null if it can be tried. */
export function gpsProblem({ secure = globalThis.isSecureContext, geolocation = globalThis.navigator?.geolocation } = {}) {
  if (!secure) return "insecure";
  if (!geolocation) return "unavailable";
  return null;
}

/**
 * Real GPS: watchPosition with high accuracy. `onStatus(status, detail)` reports
 * "waiting" | "ok" | "poor" | "denied" | "unavailable" | "insecure".
 */
export function gpsSource({ geolocation = navigator.geolocation, onStatus = () => {}, onFix = () => {}, clock = () => performance.now() } = {}) {
  const filter = new GpsFilter();
  const course = new LiveCourse();
  let watch = null, started = null, pose = null;
  const src = {
    kind: "gps",
    course,
    filter,
    status: "waiting",
    get s() { return course.s; },
    start() {
      const problem = gpsProblem({ geolocation });
      if (problem) { set(problem); return; }
      set("waiting");
      watch = geolocation.watchPosition((p) => {
        const fix = fixFrom(p);
        const { accepted, moving } = filter.push(fix, clock());
        if (!accepted) { if (src.status !== "ok") set("poor", fix.accuracy); return; }
        if (started === null) started = clock();
        if (moving || !course.pts.length) course.push(fix.lonlat, filter.heading ?? 0, onFix(fix.lonlat) || "");
        else course.turn(filter.heading ?? course.headingNow);
        set("ok", fix.accuracy);
      }, (err) => set(err.code === 1 ? "denied" : err.code === 3 ? "waiting" : "unavailable", err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    },
    stop() { if (watch !== null) geolocation.clearWatch(watch); watch = null; },
    /** The pose for this frame, or null before the first good fix. */
    tick(dt, now = clock()) {
      const p = filter.pose(now);
      if (!p) return null;
      pose ??= { lonlat: p.lonlat, heading: 0, warp: 0, s: 0, elapsed: 0 };
      pose.lonlat = p.lonlat;
      pose.heading = p.heading;
      pose.warp = p.speed / MPH;
      pose.s = course.s;
      pose.elapsed = (now - started) / 1000;
      return pose;
    },
  };
  function set(status, detail) { src.status = status; onStatus(status, detail); }
  return src;
}

/** The demo mission, replayed by the prototype's flight model at `speed`× (a chart/prototype Flight). */
export function simSource(course, flight) {
  const pose = { lonlat: course.at(0).lonlat, heading: course.at(0).heading, warp: 0, s: 0, elapsed: 0 };
  return {
    kind: "sim",
    course,
    flight,
    status: "ok",
    get s() { return flight.s; },
    start() { flight.playing = true; },
    stop() { flight.playing = false; },
    tick(dt) {
      flight.step(dt);
      const here = course.at(flight.s);
      pose.lonlat = here.lonlat;
      pose.heading = here.heading;
      pose.warp = flight.warp;
      pose.s = flight.s;
      pose.elapsed = flight.elapsed;
      return pose;
    },
  };
}
