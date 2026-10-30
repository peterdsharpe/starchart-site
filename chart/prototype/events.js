// The Starchart event engine: watches the ship move along a course and announces moments.
// It knows nothing about MapLibre: the page hands it a `world` adapter that answers questions
// about the chart near the ship, so the same logic can move to the Android app.
//
// Every event is dispatched as
//   window.dispatchEvent(new CustomEvent("starchart:event", {detail: {kind, text, voice, data}}))
// See chart/EVENTS.md for the kinds.

const LY = 1609.344;

export function metres(a, b) {
  const dy = (b[1] - a[1]) * 111320;
  const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** The nearest point of segment ab to p: [distance in metres, t along ab from 0 to 1] (lon/lat, small-area approximation). */
function project(p, a, b) {
  const k = 111320 * Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * 111320;
  const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * 111320;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return [Math.hypot(ax + t * dx, ay + t * dy), t];
}

/** Distance in metres from point p to segment ab. */
export const pointSegment = (p, a, b) => project(p, a, b)[0];

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygonGeom(p, g) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((rings) => pointInRing(p, rings[0]) && !rings.slice(1).some((h) => pointInRing(p, h)));
}

/** A course: coordinates with cumulative distance and per-point way tags. */
export class Course {
  constructor(feature) {
    this.props = feature.properties;
    this.coords = feature.geometry.coordinates;
    this.cum = [0];
    for (let i = 1; i < this.coords.length; i++) this.cum.push(this.cum[i - 1] + metres(this.coords[i - 1], this.coords[i]));
    this.length = this.cum[this.cum.length - 1];
    // way tags and node tags for each segment i -> i+1
    this.tags = new Array(this.coords.length).fill("");
    this.nodeTags = new Array(this.coords.length).fill("");
    let from = 0;
    for (const s of this.props.stretches || []) {
      for (let i = from; i < Math.max(s.to, from + 1) && i < this.coords.length; i++) this.tags[i] = s.tags;
      if (s.nodetags) this.nodeTags[s.to] = s.nodetags;
      from = Math.max(s.to, from);
    }
    this.stops = this.props.stops || []; // W86 stops: the stop signs met on the course, [lon, lat] (the router's, instructions.js toCourse)
    this.lanes = this.props.lanes || []; // W93 busstop: the stretches ridden on a painted or shared bike lane on a street, [from_m, to_m] (toCourse)
    this.crossings = this.props.crossings || []; // W128 crashes: the high-crash crossings on the course, [lon, lat] (app/crossings.js); set later when its file comes in
  }
  index(s) {
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }
  at(s) {
    s = Math.max(0, Math.min(this.length, s));
    const i = this.index(s);
    const a = this.coords[i], b = this.coords[Math.min(i + 1, this.coords.length - 1)];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = Math.min(1, (s - this.cum[i]) / seg);
    return {
      i,
      lonlat: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      ele: (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t,
      heading: this.heading(s),
      tags: this.tags[i],
    };
  }
  /** Heading in degrees, smoothed over the next ~25 m so the chart does not twitch. */
  heading(s) {
    const p = this.pointAt(Math.max(0, s - 8)), q = this.pointAt(Math.min(this.length, s + 25));
    const k = Math.cos((p[1] * Math.PI) / 180);
    return ((Math.atan2((q[0] - p[0]) * k, q[1] - p[1]) * 180) / Math.PI + 360) % 360;
  }
  pointAt(s) {
    const i = this.index(s);
    const a = this.coords[i], b = this.coords[Math.min(i + 1, this.coords.length - 1)];
    const t = Math.min(1, (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  /** Points of the course between s0 and s1 metres. */
  slice(s0, s1) {
    const out = [this.pointAt(s0)];
    for (let i = this.index(s0) + 1; i < this.coords.length && this.cum[i] < s1; i++) out.push(this.coords[i]);
    out.push(this.pointAt(s1));
    return out;
  }
  distanceTo(p, s0, s1) {
    const pts = this.slice(s0, s1);
    let best = Infinity, bestS = s0, acc = s0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [d, t] = project(p, pts[i], pts[i + 1]), len = metres(pts[i], pts[i + 1]);
      if (d < best) { best = d; bestS = acc + t * len; } // the nearest point, not the segment's start (events-4)
      acc += len;
    }
    return { d: best, s: bestS };
  }
  /**
   * The stretches of the course on a bike path, from its own way tags, as [{start, end}] in metres.
   * Runs shorter than `min` are left out, then gaps shorter than `gap` are bridged (navigation-7).
   */
  wormholeRuns(min = 150, gap = 150) {
    const runs = [];
    for (let i = 0; i < this.coords.length - 1; i++) {
      if (!isWormholeTags(this.tags[i])) continue;
      const last = runs.at(-1);
      if (last && last.end === this.cum[i]) last.end = this.cum[i + 1];
      else runs.push({ start: this.cum[i], end: this.cum[i + 1] });
    }
    const out = [];
    for (const r of runs.filter((x) => x.end - x.start >= min)) {
      const last = out.at(-1);
      if (last && r.start - last.end < gap) last.end = r.end;
      else out.push({ ...r });
    }
    return out;
  }
  climb(s0, s1) {
    return this.at(s1).ele - this.at(s0).ele;
  }
}

/** A wormhole is a bike path: a cycleway, or a path-like way designated for bikes (not a street). */
export const isWormholeTags = (t) => /highway=cycleway/.test(t || "") ||
  (/highway=(path|footway|track|pedestrian|bridleway)/.test(t || "") && /bicycle=designated/.test(t || ""));

function bearing(a, b) {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

/** Bearing of the part of a line geometry nearest to p. */
function lineBearingNear(p, g) {
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  let best = Infinity, br = null;
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) {
    const d = pointSegment(p, l[i], l[i + 1]);
    if (d < best) { best = d; br = bearing(l[i], l[i + 1]); }
  }
  return br;
}

/** The light-year line's plain variants, in turn ({n}: "Six light years", {lc}: "six light years"). */
const LY_VOICE = ["{n}.", "{n} flown.", "That's {lc}.", "{n} so far."];
const NUMBERS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen"];
/** W60 d: the engine's own lines in Plain (mode "meatspace"); "" is silent. The pack's kinds speak from `plain_voice`. */
/** W86 stops: a stop sign ahead, in both modes: the club has no term for one (scratch/scul-read). */
export const STOP_LINE = "Stop sign ahead.";
/** W93 busstop: a bus stop beside the bike lane: the club's sandworm is a bus (a transport is a car), and Plain says bus. */
export const BUS_LINE = { scul: "Sandworm nest ahead.", meatspace: "Bus stop ahead." };
/** W128 crashes: a crossing with a strong record of bike crashes (chart/crashes/README.md), in both modes: the club has no term. */
export const CROSS_LINE = "High-crash crossing ahead.";
const CROSS_M = 20; // W128 crashes: a crossing's centre this near the course line is ridden through
const BUS_M = 15; // W93 busstop: a bus stop this near the course line is beside its lane
const STREET = (r) => r.properties.bike !== "wormhole" && !r.properties.tunnel && r.properties.kind !== "transport_lane" && !["cycleway", "path", "footway", "track", "steps", "pedestrian", "construction"].includes(r.properties.class); // W93 busstop: not under the stop nor a motorway beside it
const PLAIN = { conn: "", wormhole_enter: "Onto a bike path.", wormhole_exit: "End of the bike path.", byway_enter: "", touchdown: "You have arrived." };

const SCAN = 20; // metres of flight between looks at the chart, whatever the frame rate (events-8)
const AGAIN = 1000; // a rotary or light passed again after this much flight is announced again (events-3)
const HOLD = 40; // on a live course, a new system or quadrant counts once it has held this far on good fixes (wave 21)
const QUAD_MARGIN = 50; // and a new quadrant's label must be this much nearer than the last one's
const RUN_M = 200; // W21 flight: a light this near the last one announced is part of its run: the effect and pill, no voice
const PAD_QUIET = 200; // W21 flight: on a live course, the launchpad's own system and quadrant are said after this much flight

export class EventEngine {
  /**
   * @param {Course} course
   * @param {object} lingo   chart/lingo/lingo-pack.json
   * @param {object} world   chart/prototype/world.js, or anything with its queries:
   *                         {ready?(lonlat), systemsAt(lonlat), features(layer, kinds, lonlat, m), roadsNear(lonlat, m)}
   * @param {object} [opts]  {courseSet}: the pilot set a course, so the launch hands the conn to the Navigator. W60 d: {mode}:
   *                         the lingo mode, "scul" or "meatspace" (Plain), or a function that returns it, read at every line
   */
  constructor(course, lingo, world, emit, { courseSet = false, mode = "scul" } = {}) {
    this.course = course;
    this.courseSet = courseSet;
    this.mode = mode;
    this.lingo = lingo;
    this.world = world;
    this.emit = emit || ((e) => window.dispatchEvent(new CustomEvent("starchart:event", { detail: e })));
    // A planned course knows its bike-path runs ahead of time (navigation-7). A live course grows as
    // the pilot flies, so it is asked again at each scan (app/live-course.js).
    this.runs = course.live ? null : course.wormholeRuns();
    this.reset();
  }

  reset() {
    this.s = 0;
    this.lastScan = -SCAN;
    this.system = null;
    this.quadrant = null;
    this.quadrantAt = null;
    this.announced = new Map(); // key -> s at which it was announced
    this.inWormhole = null;
    this.lastLY = 0;
    this.nextGwellCheck = 0;
    this.byway = null;
    this.started = false;
    this.history = [];
    this.turns = new Map(); // voice slot -> lines said, for the variants' rotation
    this.pending = {}; // slot -> {key, s}: a live course's system or quadrant, not yet held for HOLD
    this.lastPulsar = null; // W21 flight: the last light announced, for the run rule
    this.lastStop = null; // W86 stops: the last stop sign announced, for the same rule
    this.atPad = {}; // W21 flight: slot -> the launchpad's system or quadrant, said at PAD_QUIET unless a change came first
  }

  /** W21 flight: take over the memory of `old`, the engine this one replaces on the same flight (a re-plot): where
   *  the ship is, and what was said, its distances moved to this course's `s`, so nothing is said twice. */
  carry(old, s = 0) {
    Object.assign(this, { system: old.system, quadrant: old.quadrant, quadrantAt: old.quadrantAt, turns: new Map(old.turns), lastPulsar: old.lastPulsar, lastStop: old.lastStop }); // W86 stops: lastStop
    for (const [key, at] of old.announced) if (key !== "touchdown") this.announced.set(key, at - old.s + s);
  }

  /**
   * May the system or quadrant change to `key` at s? At once on a planned course, and on a live one the
   * first time. Otherwise the new one must have held for HOLD metres, and a scan from a poor fix never
   * changes it, so a GPS jump across a town line or between two squares says nothing (wave 21).
   */
  /** On a live course, a new quadrant label must be QUAD_MARGIN nearer than the one we are in (wave 21). */
  nearer(p) {
    return !this.course.live || !this.quadrantAt || metres(p, this.nearestAt) + QUAD_MARGIN < metres(p, this.quadrantAt);
  }

  settle(slot, key, s, here, current) {
    if (!this.course.live || !current) return true;
    if (here.poor) return false;
    const p = this.pending[slot];
    if (!p || p.key !== key) { this.pending[slot] = { key, s }; return false; }
    return s - p.s >= HOLD;
  }

  /** Join a flight already under way at s metres: learn where we are without announcing it. */
  resume(s) {
    this.started = true;
    this.lastLY = Math.floor(s / LY);
    this.lastScan = s - SCAN;
    this.priming = true;
  }

  say(kind, text, voice, data = {}) {
    if (this.priming && ["system_enter", "quadrant_enter"].includes(kind)) return;
    const e = { kind, text, voice, data: { ...data, along_m: Math.round(this.s) } };
    this.history.push(e);
    if (!this.silent) this.emit(e);
  }

  fill(t, f) {
    const base = f.base || f.name || "";
    return t.replace("{base}", base).replace("{name}", f.name || base).replace("{ref}", f.ref || "");
  }

  /** W60 d: is the engine speaking Plain now? */
  get plain() { return (typeof this.mode === "function" ? this.mode() : this.mode) === "meatspace"; }

  /** The voice line for slot i of a kind. A slot may list plain variants, "A | B | C": they take turns, so the
   *  same words never come twice in a row (wave 13), starting from the first. Safety lines have one variant. W60 d: in Plain,
   *  the kind's `plain_voice`, with the plain name ({name}), and silence for a kind that has none. */
  voiceFor(kind, i = 0, f = {}) {
    if (this.plain) {
      const v = this.lingo.kinds[kind]?.plain_voice || [], name = f.name || f.base;
      return v.length && (name || !/\{name\}/.test(v[Math.min(i, v.length - 1)])) ? this.fill(v[Math.min(i, v.length - 1)], f) : "";
    }
    const v = this.lingo.kinds[kind]?.voice || [];
    const line = v.length ? this.fill(this.rotate(kind + ":" + i, v[Math.min(i, v.length - 1)].split(" | ")), f) : "";
    return line.replace(/\bthe The /g, "the "); // a base that keeps its article: "Entering the Port Quadrant."
  }

  rotate(key, variants) {
    const n = this.turns.get(key) || 0;
    this.turns.set(key, n + 1);
    return variants[n % variants.length];
  }

  labelFor(kind, f) {
    const k = this.lingo.kinds[kind];
    if (!k) return f.name || "";
    if (!f.name && !f.base) return k.unnamed || k.label.replace(/\{[a-z]+\}\s?/g, "").trim();
    return this.fill(k.label, f);
  }

  /** Has `key` not been announced in the last `gap` metres? */
  fresh(key, s, gap) {
    const last = this.announced.get(key);
    return last === undefined || s - last >= gap;
  }

  once(key, s, gap = 400) {
    if (!this.fresh(key, s, gap)) return false;
    this.announced.set(key, s);
    return true;
  }

  /** Advance the ship to s metres along the course. */
  update(s) {
    const c = this.course;
    this.s = s;
    if (!this.started) {
      this.started = true;
      // At the launchpad "NAVI AWAY!" is the Mission Leader's: Starchart only hands over the conn when a course is set.
      if (this.courseSet) this.say("launch", "Course set", this.plain ? PLAIN.conn : "Navigator, you have the conn.", { title: c.props.title }); // W60 d
      else this.say("launch", "Launch", "", { title: c.props.title });
    }
    // light-year milestones
    const ly = Math.floor(s / LY);
    if (ly > this.lastLY) {
      this.lastLY = ly;
      const words = ["", "One light year", "Two light years", "Three light years", "Four light years", "Five light years",
        "Six light years", "Seven light years", "Eight light years", "Nine light years", "Ten light years", "Eleven light years",
        "Twelve light years", "Thirteen light years", "Fourteen light years", "Fifteen light years"][ly] || `${ly} light years`;
      const said = this.plain ? (NUMBERS[ly] ? `${NUMBERS[ly]} mile${ly === 1 ? "" : "s"}.` : "") // W60 d: "Six miles."
        : this.rotate("light_year", LY_VOICE).replace("{n}", words).replace("{lc}", words.toLowerCase());
      this.say("light_year", words, said, { light_years: ly }); // no "tonight": rides happen by day too
    }
    // The chart near the ship, every 20 m of the course, once the world has the tiles there. A scan
    // more than 400 m behind the ship (after a seek, or tiles that were slow to come) is skipped.
    if (s < this.lastScan || s - this.lastScan > 400) this.lastScan = s - SCAN;
    while (this.lastScan + SCAN <= s) {
      const x = this.lastScan + SCAN, here = c.at(x);
      if (this.world.ready && !this.world.ready(here.lonlat)) break;
      this.world.ready?.(c.at(x + 600).lonlat); // ask for the tiles ahead
      this.lastScan = x;
      this.scanWormhole(here, x);
      this.scanSystems(here, x);
      this.scanAhead(here, x);
      this.scanStops(x); // W86 stops
      this.scanBusStops(here, x); // W93 busstop
      this.scanCrossings(x); // W128 crashes
      this.scanByway(here, x);
      this.scanGwell(x);
      if (this.priming && this.system) this.priming = false;
    }
    if (s >= PAD_QUIET) for (const slot of ["system", "quadrant"]) { // W21 flight: the launchpad's, once it has been flown from
      const f = this.atPad[slot];
      this.atPad[slot] = null;
      if (f && f === this[slot]) this.enter(slot, f, s);
    }
    if (c.length - s < 30 && this.once("touchdown", s, 1e9)) this.say("touchdown", "Touchdown", this.plain ? PLAIN.touchdown : "Touchdown.", {}); // W60 d
  }

  /** Wormholes, from the course's own way tags (30 m in, 30 m out), with names from the chart. */
  scanWormhole(here, s) {
    // a live course's run counts once 30 m of it were flown on a bike path, not just crossed (wave 21)
    const run = (this.runs || this.course.wormholeRuns()).find((r) => s >= r.start + 30 && s < r.end + 30 && (this.inWormhole || !(r.on < 30)));
    if (run && !this.inWormhole) {
      const f = this.wormholeAt(s, 100) || {};
      this.inWormhole = { name: f.name || f.route || null, base: f.base || f.route || null };
      this.say("wormhole_enter", this.labelFor("wormhole", this.inWormhole),
        this.inWormhole.base ? this.voiceFor("wormhole", 0, this.inWormhole) : this.plain ? PLAIN.wormhole_enter : "Entering a wormhole.", this.inWormhole); // W60 d
    } else if (run && !this.inWormhole.base && run.end - s > 150) {
      // a nameless stretch bridged into a named one (navigation-7): say the name when it comes
      const f = this.wormholeAt(s, 0);
      if (f) {
        this.inWormhole = { name: f.name || f.route, base: f.base || f.route };
        this.say("wormhole_enter", this.labelFor("wormhole", this.inWormhole), this.voiceFor("wormhole", 0, this.inWormhole), this.inWormhole);
      }
    } else if (!run && this.inWormhole) {
      const w = this.inWormhole;
      this.inWormhole = null;
      this.say("wormhole_exit", w.base ? this.labelFor("wormhole", w) : "Wormhole",
        w.base ? this.voiceFor("wormhole", 1, w) : this.plain ? PLAIN.wormhole_exit : "Leaving the wormhole.", w); // W60 d
    }
  }

  /** The properties of the first named bike path within 20 m of the course from s to s + ahead metres. */
  wormholeAt(s, ahead) {
    for (let d = 0; d <= ahead; d += SCAN) {
      const road = this.world.roadsNear(this.course.at(s + d).lonlat, 20)
        .find((r) => r.properties.bike === "wormhole" && (r.properties.base || r.properties.route));
      if (road) return road.properties;
    }
    return null;
  }

  /** The nearest quadrant label within max metres that lies in the ship's own town. */
  nearestQuadrant(p, max) {
    const town = this.system?.name;
    let best = null, bd = max;
    for (const f of this.world.features("places", ["quadrant"], p, max)) {
      const d = metres(p, f.geometry.coordinates);
      if (d >= bd || (town && !this.world.systemsAt(f.geometry.coordinates).some((x) => x.kind === "system" && x.name === town))) continue;
      bd = d;
      best = f.properties;
      this.nearestAt = f.geometry.coordinates; // where the label is, for a live course's hysteresis (wave 21)
    }
    return best;
  }

  scanSystems(here, s) {
    const found = this.world.systemsAt(here.lonlat);
    const sys = found.find((f) => f.kind === "system");
    if (sys && sys.name === this.system?.name) this.pending.system = null;
    if (sys && sys.name !== this.system?.name && this.settle("system", sys.name, s, here, this.system)) {
      this.atPad.system = this.course.live && !this.system && s < PAD_QUIET ? sys : null; // W21 flight: the pilot knows the launchpad
      this.system = sys;
      if (!this.atPad.system) this.enter("system", sys, s);
    }
    const q = this.nearestQuadrant(here.lonlat, 700);
    if (q && q.name === this.quadrant?.name) this.pending.quadrant = null;
    if (!q) this.quadrant = this.quadrantAt = null; // no quadrant label of this town within reach: the HUD shows none (events-6)
    else if (q.name !== this.quadrant?.name && this.nearer(here.lonlat) && this.settle("quadrant", q.name, s, here, this.quadrant)) {
      this.atPad.quadrant = this.course.live && !this.quadrant && s < PAD_QUIET ? q : null; // W21 flight
      this.quadrant = q;
      this.quadrantAt = this.nearestAt;
      if (!this.atPad.quadrant) this.enter("quadrant", q, s);
    }
  }

  /** Say a system or quadrant entered. A course along a town line crosses it again and again: each is announced once per
   *  2000 m (events-5). */
  enter(slot, f, s) {
    if (this.once(slot + ":" + f.name, s, 2000)) this.say(slot + "_enter", this.labelFor(slot, f), this.voiceFor(slot, 0, f), f);
  }

  scanAhead(here, s) {
    const c = this.course;
    const s1 = Math.min(c.length, s + 160);
    const near = this.world.features("pois", ["black_hole", "pulsar"], here.lonlat, 450)
      .concat(this.world.features("places", ["constellation"], here.lonlat, 450));
    for (const f of near) {
      const p = f.geometry.coordinates;
      const kind = f.properties.kind;
      const reach = kind === "black_hole" ? 25 + (f.properties.radius_m || 10) : kind === "pulsar" ? 14 : 90;
      const { d, s: at } = c.distanceTo(p, s + (kind === "pulsar" ? 30 : 20), kind === "constellation" ? Math.min(c.length, s + 300) : s1);
      if (d > reach) continue;
      const key = kind + ":" + p.map((x) => x.toFixed(4)).join(",");
      const props = f.properties;
      const ahead_m = Math.round(at - this.s);
      if (kind === "black_hole") {
        if (this.once(key, s, AGAIN)) {
          this.say("black_hole_ahead", this.labelFor("black_hole", props), this.voiceFor("black_hole", props.base ? 1 : 0, props), // the fact, then stop: no advice on every rotary
            { ...props, ahead_m, lonlat: p });
        }
      } else if (kind === "pulsar") {
        // one announcement per intersection (pulsars within 60 m count as one), and at most one per 150 m;
        // a light held back by the 150 m rule is still announced at the next scan (events-2). W21 flight: on a run of
        // lights, each within RUN_M of the one announced before it, only the first is said (arclight's pick, 2a)
        const cell = "pulsar:" + (p[0] * 1500).toFixed(0) + "," + (p[1] * 2000).toFixed(0);
        if (this.fresh("pulsar-any", s, 150) && this.once(cell, s, AGAIN)) {
          this.announced.set("pulsar-any", s);
          const run = !!this.lastPulsar && metres(this.lastPulsar, p) < RUN_M;
          this.lastPulsar = p;
          this.say("pulsar_ahead", "Pulsar ahead", run ? "" : this.voiceFor("pulsar", 0, props), { ahead_m, lonlat: p, run });
        }
      } else if (kind === "constellation" && (props.rank || 1) < 4 && this.once(key, s, 1e9)) {
        this.say("constellation", this.labelFor("constellation", props), this.voiceFor("constellation", 0, props), { ...props, lonlat: p });
      }
    }
  }

  /** W86 stops: the course's stop signs, each only from the approach it faces (the router's), called as pulsars are: 30–160 m
   *  ahead, one per junction and again after AGAIN, at most one per 150 m, and on a run (each within RUN_M of the stop sign
   *  said before it) the pill without the voice. */
  scanStops(s) {
    const c = this.course;
    for (const p of c.stops || []) { // a live course (app/live-course.js) has none
      if (metres(p, c.pointAt(s)) > 170) continue; // beyond the window as the crow flies
      const { d, s: at } = c.distanceTo(p, s + 30, Math.min(c.length, s + 160));
      if (d > 14) continue;
      const cell = "stop:" + (p[0] * 1500).toFixed(0) + "," + (p[1] * 2000).toFixed(0);
      if (!this.fresh("stop-any", s, 150) || !this.once(cell, s, AGAIN)) continue;
      this.announced.set("stop-any", s);
      const run = !!this.lastStop && metres(this.lastStop, p) < RUN_M;
      this.lastStop = p;
      this.say("stop_ahead", "Stop sign ahead", run ? "" : STOP_LINE, { ahead_m: Math.round(at - this.s), lonlat: p, run });
    }
  }

  /** W93 busstop: a bus stop (the tiles' sandworm_nest, z15 with near=1) within BUS_M of the course line 60–160 m ahead, where the
   *  course rides a painted or shared lane (Course.lanes) and the street nearest the stop runs along the course: once a stop, and
   *  at most one per 150 m (the two sides of a junction are one). A stop 3 m or more to the left is the other way's, unless the
   *  street is one-way. None on a live course, a walk or a path: they have no lanes. */
  scanBusStops(here, s) {
    const c = this.course;
    if (!c.lanes?.some(([a, b]) => a <= s + 160 && b >= s + 60)) return; // no lane in the window; a live course (app/live-course.js) has none
    for (const f of this.world.features("pois", ["sandworm_nest"], here.lonlat, 180)) {
      const p = f.geometry.coordinates;
      const { d, s: at } = c.distanceTo(p, s + 60, Math.min(c.length, s + 160));
      if (d > BUS_M || !c.lanes.some(([a, b]) => at >= a && at <= b)) continue;
      const key = "bus:" + p.map((x) => x.toFixed(5)).join(",");
      if (!this.fresh(key, s, 1e9) || !this.fresh("bus-any", at, 150)) continue; // before the streets are read
      const road = this.world.roadsNear(p, BUS_M + 5).find(STREET);
      const along = road && Math.abs(((lineBearingNear(p, road.geometry) - c.heading(at) + 540) % 180) - 90); // 90: the street runs along the course, either way
      if (!road || along < 60) continue; // the stop is on a cross street
      const q = c.pointAt(at), h = (c.heading(at) * Math.PI) / 180; // the cross product of the heading and the stop's offset: metres to the left
      const left = Math.sin(h) * (p[1] - q[1]) * 111320 - Math.cos(h) * (p[0] - q[0]) * 111320 * Math.cos((q[1] * Math.PI) / 180);
      if (left >= 3 && !road.properties.oneway) continue; // across a two-way street: the other way's stop (a lane on the left is a one-way street's)
      this.announced.set(key, s).set("bus-any", at); // the 150 m between the stops, not the scans that said them
      this.say("bus_stop_ahead", "Sandworm nest ahead", BUS_LINE[this.plain ? "meatspace" : "scul"], { ahead_m: Math.round(at - this.s), lonlat: p });
    }
  }

  /** W128 crashes: a high-crash crossing (Course.crossings) within CROSS_M of the course line 60–160 m ahead, as a bus stop is
   *  called: once a crossing on a course (a re-plot's engine carries it), and at most one per 150 m. None on a live course. */
  scanCrossings(s) {
    const c = this.course;
    for (const p of c.crossings || []) { // a live course (app/live-course.js) has none
      if (metres(p, c.pointAt(s)) > 180) continue; // beyond the window as the crow flies
      const { d, s: at } = c.distanceTo(p, s + 60, Math.min(c.length, s + 160));
      const key = "crossing:" + p.map((x) => x.toFixed(5)).join(",");
      if (d > CROSS_M || !this.fresh(key, s, 1e9) || !this.fresh("crossing-any", at, 150)) continue;
      this.announced.set(key, s).set("crossing-any", at);
      this.say("crossing_ahead", "High-crash crossing", CROSS_LINE, { ahead_m: Math.round(at - this.s), lonlat: p });
    }
  }

  scanByway(here, s) {
    // on the bridge, not under it: the bridge must run along the ship's heading
    const roads = this.world.roadsNear(here.lonlat, 8).filter((r) => {
      if (r.properties.kind !== "hyperspace_byway" && r.properties.kind !== "hyper_wormhole") return false;
      const b = lineBearingNear(here.lonlat, r.geometry);
      const diff = Math.abs(((b - here.heading + 540) % 360) - 180);
      return b !== null && (diff < 30 || diff > 150);
    });
    const r = roads[0];
    if (!r) { this.byway = null; return; }
    const f = r.properties;
    const key = "byway:" + (f.name || f.osm_id || f.kind);
    if (key === this.byway) return;
    this.byway = key; // a second bridge straight after the first has another key (events-9)
    if (this.once(key, s, 600)) {
      const k = this.lingo.kinds[f.kind];
      this.say("byway_enter", this.labelFor(f.kind, f), f.name ? this.voiceFor(f.kind, 0, f) : this.plain ? PLAIN.byway_enter : `Engaging ${k.unnamed}.`, f); // events-10; W60 d
    }
  }

  scanGwell(s) {
    if (s < this.nextGwellCheck) return;
    const c = this.course;
    const ahead = Math.min(c.length, s + 220);
    const climb = c.climb(s + 20, ahead);
    const grade = (climb / Math.max(1, ahead - s - 20)) * 100;
    if (climb >= 6 && grade >= 2.5) {
      this.say("negi_g_well", "Negi g-well ahead", this.voiceFor("g_well", 0), { climb_m: Math.round(climb), grade_pct: +grade.toFixed(1), chevron: "▲" });
      this.nextGwellCheck = s + 400;
    } else if (climb <= -6 && grade <= -2.5) {
      this.say("posi_g_well", "Posi g-well", this.voiceFor("g_well", 1), { climb_m: Math.round(climb), grade_pct: +grade.toFixed(1), chevron: "▼" });
      this.nextGwellCheck = s + 400;
    }
  }
}
