// Where the ship is and which way it points: the app's one source of truth for both (BRIEF §8, one
// fakeable module for time and position). Real sensors (app/sensors/) or the realistic simulation
// (app/sim.js) feed the same pipeline: a fix filter, a heading fusion and a display smoothing.
// None of it knows the route: nothing here looks ahead (W12 R14).
//
//   const pose = createPose({ source: "gps" | "sim", sim: { speed: 1, seed: 1, route, multipath } });
//   await pose.start();   // from a tap: asks for location and, on iOS, motion permission
//   pose.sample(t)        // the drawn pose at frame time t (ms), or null before the first fix
//   pose.on("fix" | "status" | "visibility", fn)
//   pose.debug()          // raw values for a diagnostics overlay
//
// In sim mode every time (fix.t, fix_age_ms) is on the simulated clock, which runs at sim.speed x.
// The filtering, fusion and smoothing are pure functions at the top, so Node tests them
// (app/tests/pose.test.mjs).
import { metres, destination, angleDiff, wrap360 } from "./geo.js";
import { acceptFix, courseOverGround, MAX_ACCURACY_M } from "./position.js";
import { gpsSensor } from "./sensors/gps.js";
import { compassSensor } from "./sensors/compass.js";
import { RideSim } from "./sim.js";

const RAD = Math.PI / 180;

// Magnetic declination as a regional constant: WMM2025 for Boston (42.36, -71.06) on 2026-10-14,
// -13.93° (13.9° west), from the npm package geomagnetism@0.2.0 (scratch/research/R7-sensors.md §2).
// It drifts about +0.07°/yr and varies about 0.1° across the metro area, far below compass noise.
// true = magnetic + declination. The learned offset (below) absorbs what is left.
export const DECLINATION_DEG = -13.9;

export const SLOW_MPS = 1.5; // below this the GPS course is noise: the compass, or hold
export const FAST_MPS = 3; // above this the GPS course is the truth, and the compass offset is learned
export const OFFSET_TAU_S = 10; // the learned offset's time constant
export const COMPASS_TAU_S = 0.2; // the compass's own low-pass
export const COMPASS_GOOD_DEG = 25; // a compass worse than this is not used on its own
export const COMPASS_UNKNOWN_DEG = 20; // Android gives no accuracy: assume this
export const COURSE_FRESH_MS = 2500; // a course older than this is not used
export const COURSE_GAIN = 0.4; // how far each new course moves the compass-carried one
export const COARSE_M = 200; // fixes this coarse, twice running, mean Precise Location is off (iOS)
export const FIX_FRESH_MS = 3000; // no fix for this long: not moving, as far as we know

export const HORIZON_S = 0.67; // the display predicts this far ahead (= 2 / POS_OMEGA, the chase's lag)
export const MAX_LEAD_S = 1.5; // and never extrapolates a fix further than this
export const NO_LEAD_MPS = 1; // nor at all below this
export const YAW_FULL_DPS = 45; // at this turn rate the prediction is off
export const SNAP_M = 30; // further than this from the target: jump there
export const POS_OMEGA = 3; // rad/s, the position's critically damped chase
export const HEAD_OMEGA = 2.5; // rad/s, the bearing's: heavier than the position's
export const HALFWIDTH_TAU_S = 0.5;
export const BLEND_S = 1.5; // the drawn ship eases onto a matched road, and off it, over this long (wave 21)
export const SWITCH_M = 8; // and across to another road, when the match moves further than this

// ---- the heading fusion: a complementary filter in angle space --------------------------------------

/** The fusion's state. */
export function fusionState() {
  return {
    compass: null, compassX: 0, compassY: 0, compassT: -Infinity, compassAcc: null, // smoothed, true north
    compassRaw: null, // the latest reading, unsmoothed: turns carried by it are not delayed by the low-pass
    offset: 0, learned: 0, learnT: null, disagree2: 15 * 15, // learned compass offset (deg) and RMS disagreement²
    course: null, courseRaw: null, courseT: -Infinity, compassAtCourse: null, speed: 0, heading: null,
  };
}

/** Blend two angles: a at w = 0, b at w = 1, by the short way round. */
export const blendAngles = (a, b, w) => wrap360(a + angleDiff(b, a) * w);

/** A compass reading in (degrees from true north, accuracy in degrees or null, t in ms): low-pass on sin and cos. */
export function compassStep(f, trueDeg, accuracy, t) {
  const dt = (t - f.compassT) / 1000, x = Math.sin(trueDeg * RAD), y = Math.cos(trueDeg * RAD);
  if (f.compass === null || !(dt < 1)) { f.compassX = x; f.compassY = y; }
  else {
    const k = 1 - Math.exp(-Math.max(0, dt) / COMPASS_TAU_S);
    f.compassX += (x - f.compassX) * k;
    f.compassY += (y - f.compassY) * k;
  }
  f.compass = wrap360(Math.atan2(f.compassX, f.compassY) / RAD);
  f.compassRaw = trueDeg;
  f.compassT = t;
  f.compassAcc = accuracy == null ? COMPASS_UNKNOWN_DEG : accuracy < 0 ? 180 : accuracy;
  return f;
}

export const compassGood = (f, t) => f.compass !== null && t - f.compassT < 1000 && f.compassAcc <= COMPASS_GOOD_DEG;

/**
 * A filtered fix's course (degrees, or null) and speed (m/s) in. Above FAST_MPS, while riding
 * straight, the course is the truth: learn the compass's offset from it (the frame, the mount, and
 * whether the compass was magnetic or true), as a running mean at first, then with a time constant
 * of OFFSET_TAU_S.
 */
export function courseStep(f, course, speed, t) {
  f.speed = speed;
  if (course === null || course === undefined) return f;
  const good = compassGood(f, t);
  const straight = f.compassAtCourse === null || Math.abs(angleDiff(f.compassRaw, f.compassAtCourse)) < 20;
  if (speed > FAST_MPS && good && straight) {
    const err = angleDiff(course, f.compassRaw + f.offset);
    const dt = f.learnT === null ? 1 : Math.min(3, (t - f.learnT) / 1000);
    const slow = 1 - Math.exp(-dt / OFFSET_TAU_S);
    f.offset = angleDiff(f.offset + err * Math.max(slow, 1 / (f.learned + 1)), 0);
    f.disagree2 += (err * err - f.disagree2) * slow;
    f.learned++;
    f.learnT = t;
  }
  // The course reference: each new course corrects the last one carried forward by the compass,
  // by a share COURSE_GAIN, so a noisy Doppler course is smoothed without lagging a turn.
  const carried = good && f.compassAtCourse !== null && t - f.courseT < COURSE_FRESH_MS;
  f.course = carried ? wrap360(f.course + angleDiff(f.compassRaw, f.compassAtCourse)) : course;
  if (carried) f.course = wrap360(f.course + angleDiff(course, f.course) * COURSE_GAIN);
  f.courseRaw = course;
  f.courseT = t;
  f.compassAtCourse = good ? f.compassRaw : null;
  return f;
}

/**
 * The fused heading at t: {heading, source, halfwidth}.
 *   below SLOW_MPS: the compass (plus its learned offset) if it is good, else hold the last heading
 *   SLOW_MPS..FAST_MPS: a blend of the compass and the course
 *   above FAST_MPS: the last course, turned by as much as the compass has turned since
 * The half-width of the beam follows the compass's accuracy and its disagreement with the course.
 */
export function fuse(f, t, out = {}) {
  const good = compassGood(f, t);
  const C = good ? wrap360(f.compass + f.offset) : null;
  let K = null;
  if (f.course !== null && t - f.courseT < COURSE_FRESH_MS) {
    K = good && f.compassAtCourse !== null ? wrap360(f.course + angleDiff(f.compassRaw, f.compassAtCourse)) : f.course;
  }
  const w = Math.min(1, Math.max(0, (f.speed - SLOW_MPS) / (FAST_MPS - SLOW_MPS)));
  const courseHW = 4 + 15 / Math.max(1, f.speed);
  const compassHW = good ? Math.max(f.compassAcc, Math.sqrt(f.disagree2)) : 90;
  if (K !== null && w > 0 && (w >= 1 || C === null)) { out.heading = K; out.source = "course"; out.halfwidth = courseHW; }
  else if (K !== null && w > 0) { out.heading = blendAngles(C, K, w); out.source = "blend"; out.halfwidth = compassHW + (courseHW - compassHW) * w; }
  else if (C !== null) { out.heading = C; out.source = "compass"; out.halfwidth = compassHW; }
  else if (f.heading !== null) { out.heading = f.heading; out.source = "hold"; out.halfwidth = 45; }
  else { out.heading = null; out.source = "none"; out.halfwidth = 180; }
  out.halfwidth = Math.min(90, Math.max(6, out.halfwidth));
  f.heading = out.heading;
  return out;
}

/** W157 avatars5 (SPEC §277): her note, 2026-10-25, "The beam of light in front of the avatar is sometimes wider sometimes narrower. I
 *  cannot tell why ... I very much prefer the narrower beam." The heading beam is BEAM_DEG wide, always (was twice the half-width,
 *  30° to 90°). Too unsure to point, a half-width past BEAM_OFF_DEG (holding the last heading is 45°), it goes, and comes back
 *  only at BEAM_ON_DEG or less, so it doesn't flicker; none with no heading. */
export const BEAM_DEG = 30, BEAM_OFF_DEG = 40, BEAM_ON_DEG = 30;
/** Whether the beam shows, for the heading's source and half-width, `was` whether it showed. */
export const beamOn = (source, halfwidth, was) => source !== "none" && (was ? halfwidth < BEAM_OFF_DEG : halfwidth <= BEAM_ON_DEG);

// ---- the display: a critically damped chase of a short prediction --------------------------------------

/** The drawn pose's state: position (lon/lat) and velocity (m/s east, north); heading and its rate. */
export function displayState() {
  return { on: false, lon: 0, lat: 0, ve: 0, vn: 0, h: null, hv: 0, yaw: 0, prev: null, hw: 180, t: null };
}

/** Where the display aims: the fix flown on along `dir` for its age plus the horizon, capped. */
export function target(fix, dir, yaw, t, out = [0, 0]) {
  let lead = 0;
  if (fix.speed >= NO_LEAD_MPS && dir !== null) {
    const age = Math.max(0, (t - fix.t) / 1000);
    const k = Math.max(0, 1 - Math.abs(yaw) / YAW_FULL_DPS); // turning hard: predict less, or not at all
    lead = fix.speed * Math.min(age + HORIZON_S, MAX_LEAD_S) * k;
  }
  const p = lead > 0 ? destination(fix.lonlat, dir, lead) : fix.lonlat;
  out[0] = p[0];
  out[1] = p[1];
  return out;
}

const STEP_S = 1 / 60;

/**
 * Move the drawn pose to frame time t (ms). fix: {lonlat, speed, t}; heading and halfwidth from
 * fuse(). The position chases target() and snaps when it is SNAP_M away; the heading chases the
 * fused heading, with no prediction at all, so it can lag a turn but never lead it.
 */
export function displayStep(d, fix, heading, halfwidth, t) {
  const dt = d.t === null ? 0 : Math.max(0, Math.min(5, (t - d.t) / 1000));
  d.t = t;
  if (heading !== null && d.prev !== null && dt > 0) {
    d.yaw += (angleDiff(heading, d.prev) / dt - d.yaw) * (1 - Math.exp(-dt / 0.3));
  }
  d.prev = heading;
  const dir = heading ?? d.h;
  const tgt = target(fix, dir, d.yaw, t, (d.tgt ??= [0, 0]));
  const kx = 111320 * Math.cos(tgt[1] * RAD), ky = 111320;
  let ex = (tgt[0] - d.lon) * kx, ey = (tgt[1] - d.lat) * ky;
  const n = Math.ceil(dt / STEP_S), h = n ? dt / n : 0, w = POS_OMEGA, wh = HEAD_OMEGA;
  if (!d.on || Math.hypot(ex, ey) > SNAP_M) {
    d.on = true;
    d.lon = tgt[0];
    d.lat = tgt[1];
    const v = fix.speed >= NO_LEAD_MPS && dir !== null ? fix.speed : 0;
    d.ve = v * Math.sin((dir ?? 0) * RAD);
    d.vn = v * Math.cos((dir ?? 0) * RAD);
    ex = ey = 0;
  }
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    d.ve += (w * w * (ex - mx) - 2 * w * d.ve) * h;
    d.vn += (w * w * (ey - my) - 2 * w * d.vn) * h;
    mx += d.ve * h;
    my += d.vn * h;
  }
  d.lon += mx / kx;
  d.lat += my / ky;
  if (heading !== null && d.h === null) { d.h = heading; d.hv = 0; }
  else if (d.h !== null) {
    for (let i = 0; i < n; i++) {
      const e = heading === null ? 0 : angleDiff(heading, d.h);
      d.hv += (wh * wh * e - 2 * wh * d.hv) * h;
      d.h = wrap360(d.h + d.hv * h);
    }
  }
  d.hw = d.hw === 180 || !dt ? halfwidth : d.hw + (halfwidth - d.hw) * (1 - Math.exp(-dt / HALFWIDTH_TAU_S));
  return d;
}

// ---- the pipeline, without the browser ------------------------------------------------------------

/** Raw fixes and compass readings in, on one clock (ms); the drawn pose out. */
export class PoseCore {
  constructor() {
    this.f = fusionState();
    this.d = displayState();
    this.fused = { heading: null, source: "none", halfwidth: 180 };
    this.fix = null; // the last fix that passed: {lonlat, accuracy, speed, course, t}
    this.jumps = 0;
    this.coarse = 0;
    this.precise = true;
    this.log = []; // the last raw fixes, for debug(): {lonlat, accuracy, t, ok}
    // Wave 21: a matcher (app/match.js) the app sets once it has a world. Each fix's match goes out on the
    // fix as `match`, and the drawn ship aims at it: the road it holds, else the smoothed fix, blended.
    this.matcher = null;
    this.match = null;
    this.onRoad = 0; // the blend, 0 (the smoothed fix) to 1 (the matched road)
    this.compassRaw = null;
    this.out = { lonlat: [0, 0], accuracy_m: null, speed_mps: 0, heading_deg: null, heading_source: "none",
      heading_halfwidth_deg: 180, fix_age_ms: null, moving: false };
  }

  /** A raw fix {lonlat, accuracy, speed, course, t}. Returns the filtered fix for the engine, or null if dropped. */
  pushFix(raw) {
    this.coarse = raw.accuracy > COARSE_M ? this.coarse + 1 : 0;
    if (raw.accuracy <= MAX_ACCURACY_M) this.precise = true;
    else if (this.coarse >= 2) this.precise = false;
    const last = this.fix;
    let ok = acceptFix(raw, last);
    // Three jumps in a row mean the last fix we took was the bad one: start again from here.
    if (!ok && last && raw.accuracy <= MAX_ACCURACY_M && raw.t > last.t && ++this.jumps >= 3) ok = true;
    this.log.push({ lonlat: raw.lonlat, accuracy: raw.accuracy, t: raw.t, ok });
    if (this.log.length > 60) this.log.shift();
    if (!ok) return null;
    const prev = this.jumps >= 3 ? null : last;
    this.jumps = 0;
    const dt = prev ? (raw.t - prev.t) / 1000 : 0;
    const speed = raw.speed ?? (prev && dt > 0 ? metres(prev.lonlat, raw.lonlat) / dt : 0);
    const course = courseOverGround({ lonlat: raw.lonlat, heading: raw.course ?? null }, prev, speed);
    this.fix = { lonlat: raw.lonlat, accuracy: raw.accuracy, speed, course, t: raw.t };
    courseStep(this.f, course, speed, raw.t);
    const out = { lonlat: raw.lonlat, accuracy_m: raw.accuracy, speed_mps: speed, course_deg: course, t: raw.t, alt: raw.alt ?? null }; // W17 log: alt
    if (this.matcher) out.match = this.match = this.matcher.push(out);
    return out;
  }

  /**
   * Where the display aims at t for a match: the smoothed fix, eased toward the road over BLEND_S, and
   * back. A new fix's aim more than SWITCH_M from where the last one would have flown to (the match moved
   * to another road) starts from there and eases across over BLEND_S, so the ship glides and never snaps.
   */
  aim(m, t) {
    const dt = this.aimT === undefined ? 0 : Math.max(0, Math.min(1, (t - this.aimT) / 1000));
    this.aimT = t;
    this.onRoad = Math.max(0, Math.min(1, this.onRoad + (m.on ? dt : -dt) / BLEND_S));
    const a = m.smooth, b = m.lonlat, w = this.onRoad, p = (this.aimAt ??= [0, 0]);
    const x = a[0] + (b[0] - a[0]) * w, y = a[1] + (b[1] - a[1]) * w;
    const c = (this.carry ??= { m: null, dx: 0, dy: 0, k: 0, x: 0, y: 0, t: 0 });
    if (c.m !== m) { // a new fix
      const fx = this.fix, run = c.m && fx.speed >= NO_LEAD_MPS && fx.course !== null ? fx.speed * Math.max(0, (fx.t - c.t) / 1000) : 0;
      const from = c.m ? (run ? destination([c.x, c.y], fx.course, run) : [c.x, c.y]) : [x, y];
      const gap = metres(from, [x, y]);
      if (gap > SWITCH_M && gap < 200) { c.dx = from[0] - x; c.dy = from[1] - y; c.k = 1; } else c.k = 0;
      c.m = m; c.t = fx.t;
    } else c.k = Math.max(0, c.k - dt / BLEND_S);
    p[0] = x + c.dx * c.k; p[1] = y + c.dy * c.k;
    c.x = p[0]; c.y = p[1];
    return p;
  }

  /** A compass reading {magnetic, accuracy, t}: degrees from magnetic north. */
  pushCompass(r) {
    this.compassRaw = r;
    compassStep(this.f, wrap360(r.magnetic + DECLINATION_DEG), r.accuracy, r.t);
  }

  /** The drawn pose at t (ms), or null before the first fix. Fills and returns the same object each frame. */
  sample(t) {
    const fx = this.fix;
    if (!fx) return null;
    const age = t - fx.t, fresh = age < FIX_FRESH_MS;
    if (!fresh) this.f.speed = 0; // no news for a while: don't fly on, and trust the compass
    const fu = fuse(this.f, t, this.fused);
    const sp = (this.dfix ??= { lonlat: fx.lonlat, speed: 0, t: 0 });
    sp.lonlat = this.match ? this.aim(this.match, t) : fx.lonlat; sp.speed = fresh ? fx.speed : 0; sp.t = fx.t;
    const d = displayStep(this.d, sp, fu.heading, fu.halfwidth, t);
    const o = this.out;
    o.lonlat[0] = d.lon; o.lonlat[1] = d.lat;
    o.accuracy_m = fx.accuracy;
    o.speed_mps = sp.speed;
    o.heading_deg = d.h;
    o.heading_source = fu.source;
    o.heading_halfwidth_deg = d.hw;
    o.fix_age_ms = age;
    o.moving = fresh && fx.speed >= NO_LEAD_MPS;
    return o;
  }
}

// ---- the pose, with sensors -----------------------------------------------------------------------

const DEMO = new URL("../chart/routing/demo/saturnight-demo-mission.geojson", import.meta.url);

/**
 * The ship's pose from real sensors (source "gps") or the simulation ("sim"; sim.route is a GeoJSON
 * route, by default the demo mission, sim.speed the time multiplier, sim.seed its seed).
 * `win` and `now` are for tests.
 */
export function createPose({ source = "gps", sim = {}, win = globalThis, now = () => performance.now() } = {}) {
  const core = new PoseCore();
  const fns = { fix: new Set(), status: new Set(), visibility: new Set(), compass: new Set() }; // W77 rest: compass, each reading (main.js's sleeping chart looks at a turn)
  const emit = (kind, v) => { for (const fn of fns[kind]) fn(v); };
  const status = { gps: "waiting", compass: "unavailable", precise: true };
  const setStatus = (patch) => {
    if (Object.keys(patch).every((k) => status[k] === patch[k])) return;
    Object.assign(status, patch);
    emit("status", { ...status });
  };
  const onRaw = (raw) => {
    const f = core.pushFix(raw);
    const recent = core.fix && raw.t - core.fix.t < 10000;
    setStatus({ gps: f || (status.gps === "ok" && recent) ? "ok" : "waiting", precise: core.precise });
    if (f) emit("fix", f);
  };
  const isSim = source === "sim";
  const speed = Math.max(0.1, +sim.speed || 1);
  let ride = null, simT = 0, last = null, running = false, pump = null, started = false;
  let gps = null, compass = null;
  if (!isSim) {
    gps = gpsSensor({ geolocation: win.navigator?.geolocation, secure: win.isSecureContext, now, onFix: onRaw,
      // A timeout, or a moment with no position (iOS's kCLErrorLocationUnknown), within 10 s of a fix keeps the status it
      // had: a blink of "unavailable" turned the location button into the no-location help (W15 chart). W27 friction: after
      // any fix, a rough one too ("waiting" stays "waiting"), not only after one good enough for "ok".
      onStatus: (s) => setStatus({ gps: ["waiting", "unavailable"].includes(s) && ["ok", "waiting"].includes(status.gps) && core.log.length && now() - core.log.at(-1).t < 10000 ? status.gps : s }) });
    compass = compassSensor({ win, now, onReading: (r) => { core.pushCompass(r); emit("compass"); } /* W77 rest: emit */, onStatus: (s) => setStatus({ compass: s }) });
    status.compass = compass.status;
  }

  /** The sim's clock: it runs only while started and visible, at `speed`x, and at most 1 s per step. */
  const advance = (t) => {
    if (!running) { last = t; return; }
    if (t <= last) return; // a frame time from before the last pump: already counted
    simT += (Math.min(1000, t - last) / 1000) * speed;
    last = t;
    ride.advance(simT, onRaw, (r) => core.pushCompass(r));
  };
  const resume = () => {
    if (isSim) {
      running = true;
      last = now();
      if (!pump) { pump = setInterval(() => advance(now()), 100); pump?.unref?.(); } // fixes and statuses flow without frames too
    } else {
      gps.start();
      compass.start();
    }
  };
  const pause = () => {
    if (isSim) { advance(now()); running = false; clearInterval(pump); pump = null; }
    else { gps.stop(); compass.stop(); }
  };
  const onVisibility = () => {
    const visible = win.document.visibilityState !== "hidden";
    if (started) (visible ? resume : pause)();
    emit("visibility", { visible }); // the hook for the wake lock: request it again when visible
  };

  return {
    source,
    /** Start the sensors. Call it from a tap: on iOS, motion permission must be asked for then. */
    async start() {
      if (started) return;
      started = true;
      win.document?.addEventListener?.("visibilitychange", onVisibility);
      if (isSim) {
        if (!ride) ride = new RideSim(sim.route || (await (await fetch(DEMO)).json()), { seed: sim.seed ?? 1, multipath: !!sim.multipath }); // W21 gps
        setStatus({ compass: "ok" });
        if (started) resume();
        return;
      }
      const asked = compass.requestPermission(); // first, while the tap still counts
      gps.start();
      if (await asked && started && win.document?.visibilityState !== "hidden") compass.start();
    },
    stop() {
      if (!started) return;
      pause();
      started = false;
      win.document?.removeEventListener?.("visibilitychange", onVisibility);
    },
    /** The drawn pose at frame time t (ms): see PoseCore.sample. */
    sample(t) {
      if (isSim) { advance(t); return core.sample(simT * 1000); }
      return core.sample(t);
    },
    on(kind, fn) { fns[kind].add(fn); return () => fns[kind].delete(fn); },
    get status() { return { ...status }; },
    /** Raw values for a diagnostics overlay (?debug=1). */
    debug() {
      const f = core.f;
      return {
        source, status: { ...status },
        fixes: core.log,
        compass: { reading: core.compassRaw, true: f.compass, accuracy: f.compassAcc, raw: compass?.raw ?? null },
        fusion: { offset: f.offset, learned: f.learned, disagreement: Math.sqrt(f.disagree2), course: f.course, courseRaw: f.courseRaw,
          speed: f.speed, ...core.fused },
        display: { heading: core.d.h, yaw: core.d.yaw, halfwidth: core.d.hw },
        match: core.match ? { on: core.match.on, road: core.match.props?.name ?? core.match.props?.kind ?? null, blend: core.onRoad } : null, // W21 gps
        sim: ride ? { t: simT, speed, truth: ride.truth(simT) } : null,
      };
    },
    core, // for tests and the dev page
  };
}
