// The realistic simulation (W12 feedback item 13, R14): a rider on a route, and what their phone
// would report. Seeded and deterministic, on simulated time (seconds from the start).
//
//   const ride = new RideSim(routeFeature, { seed: 1 });
//   ride.truth(t)                          // where the rider really is: {lonlat, s, speed, heading}
//   ride.advance(t, onFix, onCompass)      // every sensor reading up to t, in time order
//
// The truth: a speed profile with acceleration, braking for turns and stops at some pulsars
// (traffic signals), on the route with its corners rounded, as a bike rides them.
// The readings, from the truth only:
//   fixes at 1 Hz, with correlated noise of sigma 3-8 m that varies along the route, an accuracy,
//     a Doppler speed and a noisy course that is null when slow, the occasional poor fix, and
//     dropouts of 2-5 s
//   with { multipath: true } (wave 21), the urban canyon on top: bursts of 20-60 m offsets lasting
//     2-10 s, mostly to one side of the road as tall buildings do, whose accuracy says only a little
//     of it, and the occasional single wild fix of 80-250 m; the Doppler speed and course stay true,
//     as a receiver's do (multipath bends the pseudoranges far more than their rates)
//   compass readings at 30 Hz: the direction of travel, plus a mount offset, the magnetic
//     declination, noise and a slow wander; slow or stopped, the noise doubles and the accuracy
//     worsens to about 22° (a phone held or knocked at a light, cars alongside; R7 gives 5-15° of
//     noise and iOS accuracies of 10-25°), so the beam widens as on a real phone
// Nothing downstream sees the truth or the route: the readings go through app/pose.js exactly as
// real sensors do.
import { metres, bearing, angleDiff, wrap360 } from "./geo.js";

export const RIDE = {
  dt: 0.1, // s, the truth's step
  cruise: 5, // m/s (warp 11), +-0.6 along the route
  accel: 0.7, brake: 1.2, hardBrake: 2.5, // m/s^2
  round: 4, // m: corners are rounded by a moving average this wide each way, done twice
  stopChance: 0.4, dwell: [5, 25], // at a pulsar: the chance of a red light, and how long it lasts (s)
  fixSigma: [3, 8], fixTau: 8, // m, s: GPS noise and how long it stays correlated
  badFix: 0.01, dropoutEvery: 150, dropout: [2, 5], // per fix; s; s
  compassHz: 30, mount: 6, compassNoise: 3, // Hz, degrees, degrees
  compassSlow: 1.5, slowNoise: 2, slowAccuracy: 10, // m/s; below it the noise is up to x2 and the accuracy up to 10° worse
  declination: -13.9, // the same constant as app/pose.js: magnetic = true - declination
  // the multipath mode (wave 21): a burst starts on about one fix in 30 (s, m), mostly on one side; wild fixes
  burstEvery: 30, burstLength: [2, 10], burstOffset: [20, 60], burstSide: 0.8, wildEvery: 120, wildOffset: [80, 250],
};

/** A seeded uniform random number generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal deviate from a uniform generator. */
export function gauss(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** A route as a polyline with distances along it. */
class Line {
  constructor(coords) {
    this.pts = coords.map((c) => [c[0], c[1]]);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + metres(this.pts[i - 1], this.pts[i]));
    this.length = this.cum[this.cum.length - 1];
  }
  index(s) {
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  at(s) {
    s = Math.max(0, Math.min(this.length, s));
    const i = this.index(s), a = this.pts[i], b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const k = Math.min(1, (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1));
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  bearing(s0, s1) { return bearing(this.at(s0), this.at(s1)); }
}

export class RideSim {
  constructor(route, { seed = 1, ...opts } = {}) {
    const feature = route.type === "FeatureCollection" ? route.features[0] : route;
    this.o = { ...RIDE, ...opts };
    this.line = new Line(feature.geometry.coordinates);
    const plan = rng(seed), phase = () => plan() * 2 * Math.PI;
    this.phase = { cruise: phase(), sigma: phase(), w1: phase(), w2: phase(), acc: phase() };
    this.stops = this.planStops(feature.properties || {}, plan);
    this.simulate();
    this.fixRand = rng(seed * 7919 + 1);
    this.compassRand = rng(seed * 104729 + 2);
    this.nextFix = 1;
    this.nextCompass = 0;
    this.err = [0, 0];
    this.dropLeft = 0;
    // its own generator, so a ride without multipath has the same fixes as before
    this.mp = this.o.multipath ? { rand: rng(seed * 31337 + 3), left: 0, along: 0, side: 0, off: 0, sideBias: 0 } : null;
    if (this.mp) this.mp.sideBias = this.mp.rand() < 0.5 ? -1 : 1;
  }

  /** The pulsars (traffic signals) on the route, and which of them are red: [{s, dwell}]. */
  planStops(props, rand) {
    const out = [];
    for (const st of props.stretches || []) {
      if (!/traffic_signals/.test(st.nodetags || "")) continue;
      const s = this.line.cum[Math.min(st.to, this.line.cum.length - 1)];
      if (out.length && s - out[out.length - 1].s < 60) continue; // one intersection
      out.push({ s, red: rand() < this.o.stopChance, dwell: this.o.dwell[0] + rand() * (this.o.dwell[1] - this.o.dwell[0]) });
    }
    return out.filter((p) => p.red);
  }

  /** The speed limits ahead: the turns, the red lights and the end: [{s, v, stop, dwell}], by s. */
  limits() {
    const L = this.line, out = [];
    for (let i = 1; i < L.pts.length - 1; i++) {
      const s = L.cum[i];
      const turn = Math.abs(angleDiff(L.bearing(s, s + 12), L.bearing(s - 12, s)));
      if (turn >= 20) out.push({ s, v: turn >= 75 ? 2.8 : turn >= 45 ? 3.5 : 4.3 });
    }
    for (const p of this.stops) out.push({ s: p.s, v: 0, stop: true, dwell: p.dwell });
    out.push({ s: L.length, v: 0, stop: true, dwell: 10, end: true });
    return out.sort((a, b) => a.s - b.s);
  }

  /** The route resampled every metre with its corners rounded: the path a bike really takes. */
  roundCorners() {
    const n = Math.floor(this.line.length) + 1, w = this.o.round;
    let a = Array.from({ length: n }, (_, i) => this.line.at(i));
    for (let pass = 0; pass < 2; pass++) {
      a = a.map((_, i) => {
        let x = 0, y = 0, m = 0;
        for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { x += a[j][0]; y += a[j][1]; m++; }
        return [x / m, y / m];
      });
    }
    return a;
  }

  /** Where the rider is at s metres along the route (s indexes the route, not the rounded path). */
  ridden(s) {
    const r = this.rounded, f = Math.max(0, Math.min(r.length - 1, s)), i = Math.min(r.length - 2, Math.floor(f)), k = f - i;
    return [r[i][0] + (r[i + 1][0] - r[i][0]) * k, r[i][1] + (r[i + 1][1] - r[i][1]) * k];
  }

  /** Fly the whole ride once, at dt, into arrays. */
  simulate() {
    const o = this.o, L = this.line, dt = o.dt;
    const lim = this.limits();
    const lon = [], lat = [], speed = [], heading = [], along = [];
    this.rounded = this.roundCorners();
    let x = this.ridden(0), h = bearing(x, this.ridden(1)), v = 0, s = 0, dwell = 3, first = 0, done = false;
    this.stopTimes = [];
    while (!done) {
      if (dwell > 0) {
        dwell -= dt;
        v = 0;
      } else {
        while (first < lim.length && (lim[first].done || lim[first].s < s - 2)) first++;
        let target = o.cruise + 0.6 * Math.sin((2 * Math.PI * s) / 1500 + this.phase.cruise);
        for (let i = first; i < lim.length && lim[i].s < s + 60; i++) {
          const c = lim[i];
          if (c.done || c.s < s - 1) continue;
          target = Math.min(target, Math.sqrt(c.v * c.v + 2 * o.brake * Math.max(0, c.s - s - (c.stop ? 1 : 0))));
          if (c.stop && c.s - s < 1 && v < 0.8) { // stopped at the line
            c.done = true;
            v = 0;
            target = 0;
            dwell = c.dwell;
            this.stopTimes.push(along.length * dt);
            if (c.end) done = true;
            break;
          }
        }
        v = v < target ? Math.min(target, v + o.accel * dt) : Math.max(target, v - o.hardBrake * dt);
        s = Math.min(L.length, s + v * dt);
        x = this.ridden(s);
        if (v > 0) h = bearing(this.ridden(s - 0.5), this.ridden(s + 0.5));
      }
      lon.push(x[0]); lat.push(x[1]); speed.push(v); heading.push(h); along.push(s);
      if (s >= L.length || lon.length > 1e6) done = true; // past the end without stopping: end anyway
    }
    for (let i = 0; i < 100; i++) { lon.push(x[0]); lat.push(x[1]); speed.push(0); heading.push(h); along.push(s); } // and rest
    Object.assign(this, { lon, lat, speed, heading, along, duration: (lon.length - 1) * dt });
  }

  /** The rider's true state at t seconds. Fills `out` if given. */
  truth(t, out = { lonlat: [0, 0], s: 0, speed: 0, heading: 0 }) {
    const f = Math.max(0, Math.min(this.duration, t)) / this.o.dt;
    const i = Math.min(this.lon.length - 2, Math.floor(f)), k = f - i;
    out.lonlat[0] = this.lon[i] + (this.lon[i + 1] - this.lon[i]) * k;
    out.lonlat[1] = this.lat[i] + (this.lat[i + 1] - this.lat[i]) * k;
    out.s = this.along[i] + (this.along[i + 1] - this.along[i]) * k;
    out.speed = this.speed[i] + (this.speed[i + 1] - this.speed[i]) * k;
    out.heading = wrap360(this.heading[i] + angleDiff(this.heading[i + 1], this.heading[i]) * k);
    return out;
  }

  /** Emit every reading up to t seconds, in time order: onFix(rawFix) and onCompass(reading), times in ms. */
  advance(t, onFix, onCompass) {
    const step = 1 / this.o.compassHz;
    while (Math.min(this.nextFix, this.nextCompass) <= t) {
      if (this.nextCompass <= this.nextFix) {
        const r = this.compassAt(this.nextCompass);
        this.nextCompass += step;
        onCompass(r);
      } else {
        const f = this.fixAt(this.nextFix);
        this.nextFix += 1;
        if (f) onFix(f);
      }
    }
  }

  fixAt(t) {
    const o = this.o, rand = this.fixRand, tr = this.truth(t);
    const [lo, hi] = o.fixSigma;
    const sigma = (lo + hi) / 2 + ((hi - lo) / 2) * Math.sin((2 * Math.PI * tr.s) / 1800 + this.phase.sigma);
    const rho = Math.exp(-1 / o.fixTau), q = Math.sqrt(1 - rho * rho);
    this.err[0] = rho * this.err[0] + q * sigma * gauss(rand);
    this.err[1] = rho * this.err[1] + q * sigma * gauss(rand);
    if (this.dropLeft > 0) { this.dropLeft--; return null; }
    if (rand() < 1 / o.dropoutEvery) { this.dropLeft = o.dropout[0] - 1 + Math.floor(rand() * (o.dropout[1] - o.dropout[0] + 1)); return null; }
    let [ex, ey] = this.err, accuracy = Math.round(sigma * 1.5 * (1 + 0.1 * gauss(rand)) * 10) / 10;
    if (rand() < o.badFix) { // under trees or between tall buildings: a poor fix, and it says so
      const a = rand() * 2 * Math.PI;
      ex += 40 * Math.sin(a); ey += 40 * Math.cos(a);
      accuracy = 55 + Math.round(rand() * 35);
    }
    if (this.mp) {
      const m = this.mp, r = m.rand, [b0, b1] = o.burstOffset;
      if (m.left <= 0 && r() < 1 / o.burstEvery) {
        m.left = o.burstLength[0] + Math.floor(r() * (o.burstLength[1] - o.burstLength[0] + 1));
        m.side = r() < o.burstSide ? m.sideBias : -m.sideBias;
        m.off = b0 + r() * (b1 - b0);
        m.along = (r() - 0.5) * 0.6 * m.off;
      }
      if (m.left > 0) { // the reflection holds from fix to fix, wandering a little
        m.left--;
        const h = tr.heading * Math.PI / 180, off = m.off * (1 + 0.1 * gauss(r));
        ex += off * m.side * Math.cos(h) + m.along * Math.sin(h);
        ey += -off * m.side * Math.sin(h) + m.along * Math.cos(h);
        accuracy = Math.round((accuracy + off * 0.3 * r()) * 10) / 10;
      } else if (r() < 1 / o.wildEvery) {
        const a = r() * 2 * Math.PI, d = o.wildOffset[0] + r() * (o.wildOffset[1] - o.wildOffset[0]);
        ex += d * Math.sin(a); ey += d * Math.cos(a);
        accuracy = Math.round((accuracy + 10 * r()) * 10) / 10;
      }
    }
    const lonlat = [tr.lonlat[0] + ex / (111320 * Math.cos((tr.lonlat[1] * Math.PI) / 180)), tr.lonlat[1] + ey / 111320];
    const speed = Math.max(0, tr.speed + 0.15 * gauss(rand));
    const course = speed < 1 ? null : wrap360(tr.heading + (1.5 + 6 / Math.max(1, tr.speed)) * gauss(rand));
    return { lonlat, accuracy, speed, course, t: t * 1000, stamp: t * 1000 };
  }

  compassAt(t) {
    const o = this.o, tr = this.truth(t), p = this.phase;
    const wander = 3 * Math.sin((2 * Math.PI * t) / 47 + p.w1) + 2 * Math.sin((2 * Math.PI * t) / 131 + p.w2);
    const slow = Math.max(0, 1 - tr.speed / o.compassSlow); // 0 riding, 1 stopped
    const noise = o.compassNoise * (1 + (o.slowNoise - 1) * slow);
    const magnetic = wrap360(tr.heading + o.mount - o.declination + wander + noise * gauss(this.compassRand));
    const accuracy = Math.round(12 + 4 * Math.sin((2 * Math.PI * t) / 300 + p.acc) + o.slowAccuracy * slow);
    return { magnetic, accuracy, t: t * 1000, kind: "sim" };
  }
}
