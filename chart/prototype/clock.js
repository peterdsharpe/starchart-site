// Time and position: the one place the prototype reads a clock or moves the ship (brief §8,
// "Build for testing"). A test swaps in a fake `now` and steps the flight by hand; a scene seeks
// straight to a moment, and the earth minutes and stardate come out right.

const MPH = 0.44704; // metres per second at warp 1

/** A clock that can be real (performance.now) or fake (a test advances it). */
export function makeClock(now = () => performance.now()) {
  let fake = null;
  return {
    now: () => (fake === null ? now() : fake),
    /** Freeze the clock at t ms; later calls to advance() move it. */
    freeze(t = 0) { fake = t; },
    advance(ms) { if (fake !== null) fake += ms; },
  };
}

/** The last Saturnight before `d`, at 21:30 local time: the demo mission's launch. */
export function lastSaturnight(d = new Date()) {
  const t = new Date(d);
  t.setDate(t.getDate() - ((t.getDay() + 1) % 7));
  t.setHours(21, 30, 0, 0);
  if (t > d) t.setDate(t.getDate() - 7); // a Saturday before 21:30: tonight is still to come
  return t;
}

/** Stardate YYMMDDx.HHMMSS, with m t w r f s x for Monday..Sunday (brief §6.4). */
export function stardate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}${"xmtwrfs"[d.getDay()]}.${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * A simulated flight along a course: the ship's position s (metres along it), its warp (mph),
 * and the simulated earth seconds flown. step(dt) moves it by dt real seconds at `speed`×.
 */
export class Flight {
  constructor(course, { speed = 5, isWormhole = () => false } = {}) {
    this.course = course;
    this.speed = speed;
    this.isWormhole = isWormhole;
    this.s = 0;
    this.warp = 0;
    this.elapsed = 0; // simulated earth seconds
    this.playing = true;
  }

  targetWarp(at) {
    const c = this.course;
    const here = c.at(at);
    let v = this.isWormhole(here.tags) ? 12.5 : 11;
    const grade = (c.climb(at, Math.min(c.length, at + 40)) / 40) * 100;
    v -= grade * 1.3;
    const ins = (c.props.instructions || []).find((i) => i.along_m > at - 10 && i.along_m < at + 35);
    if (ins) v = Math.min(v, ins.turn === "black_hole" ? 8 : 7.5);
    if (c.length - at < 80) v = Math.min(v, 4 + (c.length - at) / 20);
    return Math.max(3.5, Math.min(18, v));
  }

  /** Advance by dt real seconds. Returns true while the flight is under way. */
  step(dt) {
    const c = this.course;
    if (this.playing && this.s < c.length) {
      this.warp += (this.targetWarp(this.s) - this.warp) * Math.min(1, dt * 1.5 * Math.sqrt(this.speed));
      this.s = Math.min(c.length, this.s + this.warp * MPH * dt * this.speed);
      this.elapsed += dt * this.speed;
      if (this.s >= c.length) { this.warp = 0; return false; }
      return true;
    }
    this.warp += (0 - this.warp) * Math.min(1, dt * 3);
    return false;
  }

  /** Fly ahead to s metres (or to t simulated seconds) at once, with the same flight model. */
  seek({ s = null, t = null } = {}) {
    const keep = [this.speed, this.playing];
    this.speed = 1;
    this.playing = true;
    const dt = 0.5;
    while (this.s < this.course.length && (s !== null ? this.s < s : this.elapsed < t)) this.step(dt);
    if (s !== null) this.s = Math.min(s, this.course.length);
    [this.speed, this.playing] = keep;
  }

  reset() { this.s = 0; this.warp = 0; this.elapsed = 0; this.playing = true; }
}
