// The Log's tracks (wave 17, SPEC §15 Storage): the fixes of each flight in 30 s chunks, the route's
// thumbnail, a flight's stats, its stardate name and its GPX. Pure apart from Logbook, the client of the
// logbook worker (app/logbook-worker.js), so Node tests the rest (app/tests/logbook.test.mjs).
//
// A chunk is 30 s of fixes {t (epoch ms), lon, lat, alt (m or null)}: the first fix as a Float64Array
// [t, lon, lat, alt or NaN], then an Int32Array of deltas, four per later fix: ms, lon and lat in 1e-7°,
// and altitude in dm (NO_ALT when the fix has none). 16 bytes a fix. Since wave 21 a chunk may have `m` as
// well, an Int16Array of two per fix: where the ship was drawn (the road it held, app/match.js), east and
// north of the fix in dm, so the Log draws the matched track and keeps the raw fixes. Older chunks have none.
import { stardate } from "../chart/prototype/clock.js";
import { lingo } from "./lingo-mode.js"; // W60 c
import { metres } from "./geo.js";

export const CHUNK_MS = 30000;
export const NO_ALT = -2147483648;
const E7 = 1e7;

/** Pack fixes (at least one) into a chunk {head, d}. */
export function encodeChunk(fixes) {
  const f0 = fixes[0], head = new Float64Array([f0.t, f0.lon, f0.lat, f0.alt ?? NaN]);
  const d = new Int32Array((fixes.length - 1) * 4);
  let t = f0.t, x = Math.round(f0.lon * E7), y = Math.round(f0.lat * E7), z = f0.alt == null ? 0 : Math.round(f0.alt * 10);
  for (let i = 1, j = 0; i < fixes.length; i++, j += 4) {
    const f = fixes[i], fx = Math.round(f.lon * E7), fy = Math.round(f.lat * E7);
    d[j] = Math.round(f.t - t); d[j + 1] = fx - x; d[j + 2] = fy - y;
    t += d[j]; x = fx; y = fy;
    if (f.alt == null) d[j + 3] = NO_ALT;
    else { const fz = Math.round(f.alt * 10); d[j + 3] = fz - z; z = fz; }
  }
  if (!fixes.some((f) => f.mlon != null)) return { head, d };
  const m = new Int16Array(fixes.length * 2), clamp = (v) => (Math.abs(v) <= 32767 ? v : 0); // more than 3 km off: the fix
  fixes.forEach((f, i) => {
    if (f.mlon == null) return;
    const k = 111320 * Math.cos((f.lat * Math.PI) / 180) * 10;
    m[2 * i] = clamp(Math.round((f.mlon - f.lon) * k));
    m[2 * i + 1] = clamp(Math.round((f.mlat - f.lat) * 1113200));
  });
  return { head, d, m };
}

/** The fixes of a chunk, as encodeChunk was given them (to 1e-7°, 1 ms and 1 dm). */
export function decodeChunk({ head, d, m }) {
  const out = [{ t: head[0], lon: head[1], lat: head[2], alt: Number.isNaN(head[3]) ? null : head[3] }];
  let t = head[0], x = Math.round(head[1] * E7), y = Math.round(head[2] * E7), z = Number.isNaN(head[3]) ? 0 : Math.round(head[3] * 10);
  for (let j = 0; j < d.length; j += 4) {
    t += d[j]; x += d[j + 1]; y += d[j + 2];
    let alt = null;
    if (d[j + 3] !== NO_ALT) { z += d[j + 3]; alt = z / 10; }
    out.push({ t, lon: x / E7, lat: y / E7, alt });
  }
  if (m) out.forEach((f, i) => { f.mlon = f.lon + m[2 * i] / (111320 * Math.cos((f.lat * Math.PI) / 180) * 10); f.mlat = f.lat + m[2 * i + 1] / 1113200; });
  return out;
}

/** The track as the Log draws it: each fix at its matched spot where one was kept, with the fix itself as `raw`. */
export const drawnTrack = (fixes) => fixes.map((f) => (f.mlon == null ? f : { ...f, lon: f.mlon, lat: f.mlat, raw: [f.lon, f.lat] }));

/** W29 polish: no fix for this long means Starchart wasn't watching (closed and resumed, or the screen was off): a gap. */
export const GAP_MS = 30000;
/** W29 polish: the track's lines of [lon, lat], broken where no fix came for GAP_MS, as the live trail breaks (app/trail.js). */
export function trackLines(fixes, gap = GAP_MS) {
  const lines = [];
  for (const [i, f] of fixes.entries()) {
    if (!i || f.t - fixes[i - 1].t > gap) lines.push([]);
    lines.at(-1).push([f.lon, f.lat]);
  }
  return lines.filter((l) => l.length >= 2);
}

/** Collects one flight's fixes and hands each 30 s of them to put(n, chunk); flush() sends the rest. */
export class Chunker {
  constructor(put, ms = CHUNK_MS) { Object.assign(this, { put, ms, n: 0, buf: [] }); }
  fix(f) {
    if (this.buf.length && f.t <= this.buf.at(-1).t) return;
    if (this.buf.length && f.t - this.buf[0].t >= this.ms) this.flush();
    this.buf.push(f);
  }
  flush() {
    if (!this.buf.length) return;
    this.put(this.n++, encodeChunk(this.buf));
    this.buf = [];
  }
}

/** A flight's default name: its stardate, YYMMDDx.HHMMSS (arclight, 2026-10-15). */
export const defaultName = (start) => stardate(new Date(start));

/** W27 friction: a flight's title. The name the pilot gave it, else the ride: "To Davis" after a course, else the systems
 *  flown ("Boston", "Boston to Cambridge"), else the stardate it is stored under (W60 c: in Plain, its day and time). W40 log: the GPX file has it too, and the
 *  stardate in its <desc>. */
export function rideName(f, mode = lingo()) { // W60 c: mode
  if (f.name && f.name !== defaultName(f.start)) return f.name;
  if (f.dest) return `To ${f.dest}`;
  const s = f.systems || [];
  return s.length > 1 ? `${s[0]} to ${s.at(-1)}` : s[0] || (mode === "meatspace" ? whenFmt().format(f.start) : defaultName(f.start)); // W60 c: Plain's is the day and time
}
// W76 start (SPEC §137): the formatters are made on first use, not as the module loads: the first one a page makes loads ICU's
// dates, about 66 ms at CPU ×4, which held the start. Once the app is ready, idle time makes one, so the first Log open doesn't pay.
let WHEN, CLOCK; // W76 start
const whenFmt = () => (WHEN ||= new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })); // W60 c: "Mon, Oct 19, 7:30 PM"
const clockFmt = () => (CLOCK ||= new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })); // W73 logsafe: "7:30 PM", for gpxName
globalThis.addEventListener?.("starchart:ready", () => (globalThis.requestIdleCallback || setTimeout)(() => whenFmt().format(0), { timeout: 10000 }), { once: true }); // W76 start

/** The route as at most `n` points, kept by how much each one shapes it (Douglas–Peucker, ranked). */
export function simplify(pts, n = 64) {
  if (pts.length <= n) return pts.slice();
  const rank = new Float64Array(pts.length);
  rank[0] = rank[pts.length - 1] = Infinity;
  const k = Math.cos((pts[0][1] * Math.PI) / 180), stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = pts[a], dx = (pts[b][0] - ax) * k, dy = pts[b][1] - ay, len = Math.hypot(dx, dy) || 1e-12;
    let best = -1, at = a + 1;
    for (let i = a + 1; i < b; i++) {
      const px = (pts[i][0] - ax) * k, py = pts[i][1] - ay;
      const dist = Math.abs(px * dy - py * dx) / len;
      if (dist > best) { best = dist; at = i; }
    }
    rank[at] = best;
    stack.push([a, at], [at, b]);
  }
  const keep = [...rank.keys()].sort((i, j) => rank[j] - rank[i]).slice(0, n).sort((i, j) => i - j);
  return keep.map((i) => pts[i]);
}

/** A thumbnail for the summary: the route at 64 points as integer 1e-4° steps [lon0, lat0, dlon, dlat, ...]. */
export function packThumb(pts) {
  const out = [];
  let x = 0, y = 0;
  for (const [lon, lat] of simplify(pts, 64)) {
    const qx = Math.round(lon * 1e4), qy = Math.round(lat * 1e4);
    out.push(qx - x, qy - y);
    x = qx; y = qy;
  }
  return out;
}
export function unpackThumb(t = []) {
  const pts = [];
  for (let i = 0, x = 0, y = 0; i + 1 < t.length; i += 2) { x += t[i]; y += t[i + 1]; pts.push([x / 1e4, y / 1e4]); }
  return pts;
}

/** A small chalk drawing of the route, as SVG markup, `size` px square; the launch point a phosphor dot. */
export function thumbSVG(pts, size = 56) {
  const box = `<svg class="thumb" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">`;
  if (pts.length < 2) return box + `<circle cx="${size / 2}" cy="${size / 2}" r="3" class="dot"/></svg>`;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const x0 = Math.min(...lons), y0 = Math.min(...lats), k = Math.cos((((y0 + Math.max(...lats)) / 2) * Math.PI) / 180);
  const w = (Math.max(...lons) - x0) * k, h = Math.max(...lats) - y0, sc = (size - 12) / Math.max(w, h, 1e-9);
  const ox = (size - w * sc) / 2, oy = (size - h * sc) / 2;
  const xy = pts.map(([x, y]) => `${(ox + (x - x0) * k * sc).toFixed(1)},${(size - oy - (y - y0) * sc).toFixed(1)}`);
  const [fx, fy] = xy[0].split(",");
  return box + `<polyline points="${xy.join(" ")}" class="route"/><circle cx="${fx}" cy="${fy}" r="3" class="dot"/></svg>`;
}

/** W59 pace: moving time counts a fix's step at `MOVING_MPS` or more (about 2 mph), and no step over `MOVING_GAP_S`. */
export const MOVING_MPS = 1, MOVING_GAP_S = 30;
/** W74 flightlog (F10): `pts` is only the thumbnail's (packThumb keeps 64), so it keeps at most MAX_PTS, simplified to half when
 *  over: a 4-hour flight's 15 s save (Recorder.snapshot) stays flat. The track itself, in the logbook, keeps every fix. */
export const MAX_PTS = 1000;
/** One flight's numbers as it flies: top speed, climb, the systems, pulsars and black holes passed. W59 pace: its moving time,
 *  and planned against flown: `plan(time_s, pace)` at a course's launch, `reached()` at its touchdown. */
export class FlightStats {
  constructor() {
    Object.assign(this, { top_mps: 0, climb_m: 0, pulsars: 0, holes: 0, systems: [], pts: [], ref: null, last: null, dest: "",
      moving_s: 0, lastT: null, plan: null, plan_s: 0, flew_s: 0, courses: 0, pace: 0, still: 0, stop_s: 0 }); // W59 pace; W86 eta: still, stop_s
  }
  /** W27 friction: the course flown, by its destination's name; the last one set counts. */
  course(dest) { if (dest) this.dest = dest; }
  /** W59 pace: a course launched: the router's minutes for it (before pace), and the pace then; a new one replaces it. */
  planned(time_s, pace = 1) { this.plan = time_s > 0 ? { s: time_s, pace, from: this.moving_s, stop: 0 } : null; this.still = 0; } // W86 eta: stop, its longest
  /** W59 pace: its touchdown: the plan, and the moving time since its launch, add to the flight's. */
  reached() {
    const p = this.plan;
    this.plan = null;
    if (!p) return;
    this.plan_s += p.s; this.flew_s += this.moving_s - p.from; this.courses++;
    this.pace ||= p.pace;
    this.stop_s = Math.max(this.stop_s, p.stop || 0); // W86 eta
  }
  /** A fix {lon, lat, alt, speed_mps}; `system` is the town the ship is in, if known. */
  fix(f, system) {
    if (Number.isFinite(f.speed_mps) && f.speed_mps > this.top_mps) this.top_mps = f.speed_mps;
    const dt = this.lastT === null ? 0 : (f.t - this.lastT) / 1000; // W59 pace: moving time
    if (dt > 0 && dt <= MOVING_GAP_S && f.speed_mps >= MOVING_MPS) this.moving_s += dt;
    if (dt > 0) this.still = dt <= MOVING_GAP_S && f.speed_mps >= MOVING_MPS ? 0 : this.still + dt; // W86 eta: the stop going on, a gap in it
    if (this.plan && this.still > (this.plan.stop || 0)) this.plan.stop = this.still; // W86 eta: a course's longest stop
    if (Number.isFinite(f.t)) this.lastT = f.t;
    if (f.alt != null) { // GPS heights wander by metres: count a rise once it is 3 m above the lowest point since
      if (this.ref === null || f.alt < this.ref) this.ref = f.alt;
      else if (f.alt - this.ref >= 3) { this.climb_m += f.alt - this.ref; this.ref = f.alt; }
    }
    if (system && !this.systems.includes(system)) this.systems.push(system);
    const p = [f.lon, f.lat];
    if (!this.last || metres(this.last, p) >= 10) { this.pts.push(p); this.last = p; if (this.pts.length > MAX_PTS) this.pts = simplify(this.pts, MAX_PTS / 2); } // W74 flightlog: capped (F10)
  }
  event(kind) {
    if (kind === "pulsar_ahead") this.pulsars++;
    else if (kind === "black_hole_ahead") this.holes++;
  }
  summary() {
    return { top_mps: +this.top_mps.toFixed(1), climb_m: Math.round(this.climb_m), pulsars: this.pulsars, holes: this.holes,
      systems: this.systems.slice(), thumb: packThumb(this.pts), moving_s: Math.round(this.moving_s), ...(this.dest ? { dest: this.dest } : {}), // W27 friction: dest; W68 logbulk: moving_s, for the tiny rule
      ...(this.courses ? { plan_s: Math.round(this.plan_s), flew_s: Math.round(this.flew_s), courses: this.courses, pace: this.pace, stop_s: Math.round(this.stop_s) } : {}) }; // W59 pace: only a course flown to its pad; W86 eta: stop_s
  }
}

/** W59 pace (SPEC §81): planned against flown, over the flights flown on a course to its pad: `courses`, how much `quicker`
 *  than planned (in %, at the pace each was planned at; below 0 slower), and `pct`, the pace (in %) that would have planned
 *  them right. Null under `PACE_MIN` flights. A flight flown at under half or over twice its plan (walked, or a train) is left out. */
export const PACE_MIN = 3;
export function paceOf(flights) {
  const fs = flights.filter((f) => f.plan_s > 0 && f.flew_s >= 60 && f.plan_s / f.flew_s >= 0.5 && f.plan_s / f.flew_s <= 2);
  if (fs.length < PACE_MIN) return null;
  const sum = (k) => fs.reduce((a, f) => a + k(f), 0), flew = sum((f) => f.flew_s);
  return { courses: sum((f) => f.courses || 1), quicker: Math.round((sum((f) => f.plan_s / (f.pace || 1)) / flew - 1) * 100), pct: (100 * sum((f) => f.plan_s)) / flew };
}

/** W86 eta (SPEC §172): the pace her rides say, learned with no switch: the median of plan over flown (the pace, in %, that would
 *  have planned each right) over the last `n` flights flown on a course, from `min` of them. A short one (planned under `plan_s`),
 *  one with a stop of over `stop_s` (a café) and paceOf's outliers (walked, or a train) are left out. Null under `min`. */
export const LEARN = { min: 3, n: 5, plan_s: 300, stop_s: 300 }; // W86 eta
export function learnedPace(flights) { // W86 eta
  const fs = flights.filter((f) => f.plan_s >= LEARN.plan_s && f.flew_s >= 60 && f.plan_s / f.flew_s >= 0.5 && f.plan_s / f.flew_s <= 2 && !(f.stop_s > LEARN.stop_s)).slice(-LEARN.n); // W86 eta
  if (fs.length < LEARN.min) return null; // W86 eta
  const r = fs.map((f) => (100 * f.plan_s) / f.flew_s).sort((a, b) => a - b), m = r.length >> 1; // W86 eta
  return { pct: r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2, rides: fs.length }; // W86 eta
} // W86 eta

/** The summary of a flight from its fixes alone: a flight cut short, kept at the next start. */
export function statsFrom(fixes) {
  const s = new FlightStats();
  let m = 0;
  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i], prev = fixes[i - 1];
    const d = prev ? metres([prev.lon, prev.lat], [f.lon, f.lat]) : 0, dt = prev ? (f.t - prev.t) / 1000 : 0;
    m += d;
    s.fix({ ...f, speed_mps: dt > 0 ? d / dt : null });
  }
  return { metres: m, stats: s.summary() };
}

/** W67 logsafe: the fixes in runs, broken where no fix came for `gap` ms (a resume, the screen off, a comet course's train leg,
 *  which records nothing), as trackLines breaks the Log's line. */
export function trackRuns(fixes, gap = GAP_MS) {
  const runs = [];
  for (const [i, f] of fixes.entries()) {
    if (!i || f.t - fixes[i - 1].t > gap) runs.push([]);
    runs.at(-1).push(f);
  }
  return runs;
}
/** W67 logsafe (SPEC §96): "Trim the ends" leaves out every fix within `TRIM_M` of the track's first and last fix, and of home
 *  (`home`, [lon, lat], if set): a GPX shared to a club chat or Strava doesn't show the rider's door. A run cut in the middle
 *  (passing home) is two runs, so no line joins across the gap. Times stay as they were. */
export const TRIM_M = 200;
export function trimRuns(runs, home = null, r = TRIM_M) {
  const at = (f) => [f.raw?.[0] ?? f.lon, f.raw?.[1] ?? f.lat], all = runs.flat();
  if (!all.length) return [];
  const ends = [at(all[0]), at(all.at(-1)), ...(home ? [home] : [])], out = [];
  for (const run of runs) {
    let cur = null;
    for (const f of run) {
      if (ends.some((p) => metres(p, at(f)) < r)) { cur = null; continue; }
      if (!cur) out.push((cur = []));
      cur.push(f);
    }
  }
  return out;
}

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The track as GPX 1.1: one <trk>, a <trkpt> per raw fix with its <time> and <ele>, the name and stardate in <metadata>.
 *  W67 logsafe: a <trkseg> for each run (trackRuns), so a gap isn't a straight line; `trim`, the ends trimmed (trimRuns).
 *  W67 routefile: `wpt`, a course's turns [{ lonlat, name }], as <wpt>; a course's points have no time. */
export function gpx(f, fixes, { trim = false, home = null, wpt = [], mode = lingo() } = {}) { // W73 logsafe: mode
  const name = rideName(f, mode), { start } = f; // W40 log: the ride's name, as the Log shows it; W73 logsafe: mode
  const pt = (f) => `<trkpt lat="${(f.raw?.[1] ?? f.lat).toFixed(7)}" lon="${(f.raw?.[0] ?? f.lon).toFixed(7)}">${f.alt == null ? "" : `<ele>${f.alt.toFixed(1)}</ele>`}${f.t == null ? "" : `<time>${new Date(f.t).toISOString()}</time>`}</trkpt>`; // W67 routefile: a plan has no times
  const runs = trim ? trimRuns(trackRuns(fixes), home) : trackRuns(fixes); // W67 logsafe
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Starchart" xmlns="http://www.topografix.com/GPX/1/1">\n`
    + `<metadata><name>${esc(name)}</name>${mode === "meatspace" ? "" : `<desc>Stardate ${defaultName(start)}</desc>`}<time>${new Date(start).toISOString()}</time></metadata>\n`
    + wpt.map((w) => `<wpt lat="${w.lonlat[1].toFixed(7)}" lon="${w.lonlat[0].toFixed(7)}"><name>${esc(w.name)}</name></wpt>\n`).join("") // W67 routefile
    + `<trk><name>${esc(name)}</name>${runs.map((r) => `<trkseg>\n${r.map(pt).join("\n")}\n</trkseg>`).join("")}</trk>\n</gpx>\n`; // W67 logsafe: runs
}
/** The GPX file's name: "2026-10-10 Saturnight demo mission.gpx", in local time. */
export function gpxName(f, mode = lingo()) { // W73 logsafe: mode
  const d = new Date(f.start), p = (n) => String(n).padStart(2, "0"); // W40 log: the ride's name, as the Log shows it
  const name = rideName(f, mode), when = name === whenFmt().format(f.start) ? clockFmt().format(f.start) : name; // W73 logsafe: Plain's day-and-time name gives only the time, so the date shows once
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${String(when).replace(/[\\/:*?"<>|]+/g, "-")}.gpx`; // W73 logsafe: when
}

/** The logbook worker's client: every call is a promise; the worker owns IndexedDB ("starchart", store "tracks"). */
export class Logbook {
  constructor(url = new URL("./logbook-worker.js", import.meta.url)) {
    this.calls = new Map();
    this.seq = 0;
    try {
      this.worker = new Worker(url, { type: "module" }); // W67 logsafe: a module, for the backup (app/logsafe.js)
      this.worker.onmessage = ({ data }) => { const c = this.calls.get(data.seq); this.calls.delete(data.seq); data.error ? c?.reject(new Error(data.error)) : c?.resolve(data.result); };
    } catch { this.worker = null; }
  }
  call(op, args = {}, transfer = []) {
    if (!this.worker) return Promise.reject(new Error("no logbook worker"));
    const seq = ++this.seq;
    return new Promise((resolve, reject) => { this.calls.set(seq, { resolve, reject }); this.worker.postMessage({ seq, op, ...args }, transfer); });
  }
  /** Store chunk n of a flight. W40 log: a chunk the store refused (full) calls onfail(id), once a flight. */
  put(id, n, { head, d, m }) {
    return this.call("put", { id, n, head, d, m }, m ? [head.buffer, d.buffer, m.buffer] : [head.buffer, d.buffer])
      .catch(() => { if (!(this.failed ??= new Set()).has(id)) { this.failed.add(id); this.onfail?.(id); } });
  }
  /** Mark a flight's chunks final: its summary is written. */
  final(id) { return this.call("final", { id }).catch(() => {}); }
  /** Every fix of a flight, in order ([] when none are stored). */
  async fixes(id) {
    const chunks = await this.call("chunks", { id }).catch(() => []);
    return chunks.flatMap(decodeChunk);
  }
  /** Delete a flight's chunks. */
  drop(id) { return this.call("drop", { id }).catch(() => {}); }
  /** The flights with chunks: [{id, final}]. */
  flights() { return this.call("flights").catch(() => []); }
  /** W67 logsafe: the Log's backup, a gzipped Blob, of the summaries `flights` and their tracks, with the lifetime `totals`. */
  backup(flights, totals) { return this.call("backup", { flights, totals, made: Date.now() }); }
  /** W67 logsafe: a backup `file` restored: {flights, skipped}, the summaries of the flights it added (neither in `have` nor
   *  stored), or {bad: "newer" | "not"}. */
  restore(file, have) { return this.call("restore", { file, have }); }
  /** W73 ghosts (SPEC §121): the ghost trails of the flights `ids`, oldest first, kept as the set MapLibre's worker reads:
   *  {bounds, n}, and `data`, the GeoJSON, when `direct` or where it couldn't be kept. */
  ghosts(ids, direct = false) { return this.call("ghosts", { ids, direct }); }
}
