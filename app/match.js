// Holding the road (wave 21): where on the bike network the ship is, from the pose's filtered fixes.
//
//   const match = new Matcher(world);  // chart/prototype/world.js: its z15 roads
//   match.push(fix)                    // -> {lonlat, on, props, d, smooth}
//
// Two steps, both on each fix (1 Hz), never per frame:
//   Smoother: the last spot flown on by the Doppler speed and course, then pulled a share of the way to
//     the new fix. A fix far from that is a jump (multipath near tall buildings) and pulls far less, but
//     the longer the fixes disagree, the more they are believed, so the smoother never stays lost. Doppler
//     velocities are far less bent by multipath than positions are.
//   RoadMatcher: an online hidden Markov model in the Newson–Krumm style over the smoothed spot. The
//     states are the roads within REACH_M, plus one for off the network (a park, a plaza, a parking lot).
//     The emission is the distance, scaled by the fix's accuracy; the transition favours staying on the
//     same road or one that meets it near the last spot, moving about as far as the Doppler speed says,
//     along the direction of travel. No lag: each fix's best state is used at once.
// `on` is false off the network, and `lonlat` is then the smoothed spot. Pure apart from the world it is
// given, so Node tests it (app/tests/match.test.mjs).
import { destination } from "./geo.js";

export const REACH_M = 30; // candidates: the roads this close to the smoothed spot
export const GAIN = 0.35; // how far each fix pulls the smoothed spot toward it
export const GATE_M = 8; // a fix further than this plus half its accuracy from where it should be pulls less,
// by the square of the ratio, so a jump (multipath near tall buildings) hardly moves the spot
export const TRUST_M = 10; // a fix with a worse accuracy pulls less too: by (TRUST_M / accuracy)²
export const OUTLIER_S = 12; // the fixes disagreeing for this long (past a multipath burst) double the gate, then faster
export const RESET_S = 20; // a gap in the fixes this long: start again (a shorter one is flown through on the Doppler)
export const SIGMA_M = [6, 20]; // the emission's spread: the accuracy within these bounds, since GPS errors last
// several seconds, so ten fixes in a row off to one side are far less than ten times the evidence
export const UNSURE_M = 20; // off a bike path, but one this close (or within 1.5 x the accuracy): can't tell (forCourse)
export const PATH_FIRST = 0.5; // a pilot is likelier on the bike path than on the road beside it
export const MARGIN = 3; // the road shown changes only when another is this much likelier, or it is gone
export const OFF_SIGMAS = 2.5; // off the network is as likely as a road this many spreads away
export const SWITCH = 1; // the cost of moving to a road that meets the last one near the last spot
export const JUMP = 6; // and to one that does not (a path beside the street)
export const LEAVE = 3; // the cost of leaving the network, or joining it
export const TRAVEL_M = 4; // the spread of the distance moved, against the Doppler speed's
export const HEADING_DEG = 25; // the spread of the road's direction against the course's
const KEEP = 8; // the states kept from fix to fix
const AHEAD_M = 400; // the tiles within this are asked for at each fix
const RAD = Math.PI / 180;

/** Local metres around a point: x east, y north. */
const frame = (p) => ({ lon: p[0], lat: p[1], kx: 111320 * Math.cos(p[1] * RAD), ky: 111320 });
const toXY = (F, q) => [(q[0] - F.lon) * F.kx, (q[1] - F.lat) * F.ky];
const toLL = (F, x, y) => [F.lon + x / F.kx, F.lat + y / F.ky];

/** The nearest point of a road's geometry to (px, py) in frame F: {d, x, y, b (bearing, 0-180)}. */
function nearest(F, g, px, py) {
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  let best = { d: Infinity, x: 0, y: 0, b: 0 };
  for (const l of lines) {
    let [ax, ay] = toXY(F, l[0]);
    for (let i = 1; i < l.length; i++) {
      const [bx, by] = toXY(F, l[i]), dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(px - x, py - y);
      if (d < best.d) best = { d, x, y, b: ((Math.atan2(dx, dy) / RAD) + 360) % 180 };
      ax = bx; ay = by;
    }
  }
  return best;
}

export class Smoother {
  constructor() { this.reset(); }
  reset() { this.at = null; this.t = 0; this.out = 0; }

  /** A filtered fix {lonlat, accuracy_m, speed_mps, course_deg, t} in; the smoothed [lon, lat] out. */
  push(f) {
    const dt = (f.t - this.t) / 1000;
    if (!this.at || !(dt > 0) || dt > RESET_S) { this.reset(); this.at = f.lonlat.slice(); this.t = f.t; return this.at; }
    this.t = f.t;
    const moving = f.speed_mps >= 1 && f.course_deg !== null && f.course_deg !== undefined;
    const pred = moving ? destination(this.at, f.course_deg, f.speed_mps * dt) : this.at;
    const F = frame(pred), [ex, ey] = toXY(F, f.lonlat), e = Math.hypot(ex, ey);
    const acc = f.accuracy_m || 0, base = GATE_M + acc / 2;
    this.out = e > base ? this.out + dt : 0;
    const gate = base * (1 + (this.out / OUTLIER_S) ** 2); // fixes that go on disagreeing are believed, little by little
    const k = GAIN * Math.min(1, (TRUST_M / acc) ** 2) * Math.min(1, (gate / e) ** 2);
    this.at = toLL(F, ex * k, ey * k);
    return this.at;
  }
}

export class RoadMatcher {
  constructor(world) { this.world = world; this.reset(); }
  reset() { this.states = null; this.last = null; this.shown = undefined; }

  /**
   * The smoothed spot p, its fix f ({accuracy_m, speed_mps, course_deg, t}): the best state,
   * {on, lonlat, props, d, pathNear}. A world without the tiles here yet gives {on: false}, and the
   * states carry on to the next fix.
   */
  push(p, f) {
    const w = this.world;
    w?.ready?.(p, AHEAD_M); // ask for the tiles around, before they are needed
    if (!w || (w.ready && !w.ready(p, REACH_M + 20))) return { on: false, lonlat: p, props: null, d: Infinity, pathNear: Infinity }; // not yet: hold the states
    const F = frame(p), sigma = Math.min(SIGMA_M[1], Math.max(SIGMA_M[0], f.accuracy_m || 0));
    const dt = this.last ? Math.max(0, (f.t - this.last.t) / 1000) : 0;
    const travel = (f.speed_mps || 0) * dt, course = f.speed_mps >= 2 ? f.course_deg ?? null : null;
    const cands = [{ road: null, x: 0, y: 0, d: Infinity, emit: 0.5 * OFF_SIGMAS * OFF_SIGMAS }];
    let pathNear = Infinity;
    for (const road of w.roadsNear(p, REACH_M)) {
      const n = nearest(F, road.geometry, 0, 0);
      if (road.properties.bike === "wormhole") pathNear = Math.min(pathNear, n.d);
      let emit = 0.5 * (n.d / sigma) ** 2 + (road.properties.bike === "wormhole" ? 0 : PATH_FIRST);
      if (course !== null) {
        const a = Math.abs(((course - n.b) % 180 + 180) % 180), off = Math.min(a, 180 - a);
        emit += Math.min(4, 0.5 * (off / HEADING_DEG) ** 2);
      }
      cands.push({ road, x: n.x, y: n.y, d: n.d, emit });
    }
    const prev = this.states && dt < RESET_S ? this.states : null;
    for (const c of cands) {
      if (!prev) { c.score = c.emit; continue; }
      let best = Infinity;
      for (const s of prev) {
        let cost;
        if (!s.road && !c.road) cost = 0;
        else if (!s.road || !c.road) cost = LEAVE;
        else {
          const [sx, sy] = toXY(F, s.lonlat), moved = Math.hypot(c.x - sx, c.y - sy);
          cost = 0.5 * ((moved - travel) / TRAVEL_M) ** 2;
          if (s.road !== c.road && !sameRoad(s.road, c.road)) cost += nearest(F, c.road.geometry, sx, sy).d <= 8 ? SWITCH : JUMP;
          cost = Math.min(cost, JUMP + LEAVE); // never worse than jumping off and on again
        }
        best = Math.min(best, s.score + cost);
      }
      c.score = best + c.emit;
    }
    cands.sort((a, b) => a.score - b.score);
    const floor = cands[0].score;
    this.states = cands.slice(0, KEEP).map((c) => ({ road: c.road, score: c.score - floor, lonlat: c.road ? toLL(F, c.x, c.y) : p }));
    this.last = { t: f.t };
    const was = this.shown; // the road shown at the last fix, null off the network, undefined at first
    const held = was !== undefined && this.states.find((x) => x.road === was || (x.road && was && sameRoad(x.road, was)));
    const b = held && held.score < MARGIN ? held : this.states[0];
    this.shown = b.road;
    return { on: !!b.road, lonlat: b.lonlat, props: b.road?.properties ?? null, d: b.road ? Math.hypot(...toXY(F, b.lonlat)) : Infinity, pathNear };
  }
}

/** The same road cut at a tile's edge: the same properties. W23 comfort: or cut where its comfort changes (tiles v7);
 * W26 comfort: or its grade, speed or lanes (tiles v8); W37 sidepath: or its protected lanes alongside (tiles v9). */
const PIECEWISE = new Set(["comfort", "grade", "mph", "lanes", "sidepath"]);
function sameRoad(a, b) {
  const p = a.properties, q = b.properties;
  if (p === q) return true;
  for (const k in p) if (p[k] !== q[k] && !PIECEWISE.has(k)) return false;
  for (const k in q) if (!(k in p) && !PIECEWISE.has(k)) return false;
  return true;
}

/** Both steps: a filtered fix in, {lonlat, on, props, d, smooth} out. */
export class Matcher {
  constructor(world) { this.smoother = new Smoother(); this.roads = new RoadMatcher(world); }
  reset() { this.smoother.reset(); this.roads.reset(); }
  push(f) {
    const smooth = this.smoother.push(f);
    return { ...this.roads.push(smooth, f), smooth };
  }
}

/** The tags the live course keeps for a matched fix (app/live-course.js): a bike path is a cycleway. */
export const matchTags = (m) => (m.on && m.props?.bike === "wormhole" ? "highway=cycleway" : "");

/**
 * What the live course keeps for a filtered fix f: [lonlat, tags, {accuracy, t, keep}]. With a match, the
 * matched spot and its road's tags; `keep` when it is not on a bike path but one is within the fix's
 * accuracy (or UNSURE_M), so it can't tell which it is on and changes nothing. Without one, the fix and
 * tagsAt(lonlat), as before wave 21.
 */
export function forCourse(f, tagsAt) {
  const m = f.match, opts = { accuracy: f.accuracy_m, t: f.t, keep: false };
  if (!m) return [[f.lonlat[0], f.lonlat[1]], tagsAt([f.lonlat[0], f.lonlat[1]]), opts];
  const tags = matchTags(m);
  opts.keep = !tags && m.pathNear <= Math.max(UNSURE_M, 1.5 * (f.accuracy_m || 0));
  return [m.lonlat.slice(), tags, opts];
}
