// The Black Box: lifetime light years on this phone, and the star classes they earn (wave 15).
//
// What counts: real GPS flights, from Launch to a final Land (after the Undo window). The demo never
// counts, and nor does parked time. A car ride must not corrupt it (arclight), so the car guard leaves
// out every stretch where the speed stays above 35 mph (15.6 m/s) for more than 20 s. It uses
// hysteresis: a stretch starts above 15.6 m/s and only ends below 25 mph (11.2 m/s), so a car slowing
// for a moment stays one stretch. A short fast descent on a bike is under 20 s, and counts.
//
// The summaries live in localStorage under "starchart.blackbox": a flight is under 1 kB with its
// thumbnail, so years of rides fit in a few hundred kB. localStorage is synchronous, which lets a final
// Land write before the tab can close, and Node can test it with a plain object. The tracks go to
// IndexedDB in 30 s chunks through the logbook worker (app/logbook.js, SPEC §15). The store is v 2 (wave
// 17): each summary has its name and stats; v 1's are read as v 2, named by their stardate.
// Pure apart from the stores, so Node tests it (app/tests/blackbox.test.mjs).
import { metres } from "./geo.js";
import { Chunker, FlightStats, defaultName, GAP_MS } from "./logbook.js"; // W125 tinygap: GAP_MS
import { trailLog, line, scrub, MAX_BYTES, MAX_DETAIL } from "./trail-log.js"; // W74 flightlog

export const LY = 1609.344;
export const CAR = { high_mps: 15.6, low_mps: 11.2, hold_s: 20 };
/** The star classes, by lifetime light years (design/app-ui/ideas, section 7). Our own names, not the club's medals. */
export const CLASSES = [
  { id: "flare", name: "Flare", ly: 50 },
  { id: "nova", name: "Nova", ly: 150 },
  { id: "supernova", name: "Supernova", ly: 400 },
  { id: "quasar", name: "Quasar", ly: 900 },
];
export const KEY = "starchart.blackbox";
/** W74 flightlog (F11, SPEC §129): each flight's log, the trail log's lines (app/trail-log.js) from its Launch to its final Land:
 *  states and events, scrubbed of coordinates, never a position or a place's name. Kept apart from the summaries, for the last
 *  LOGS_KEPT flights, each at most MAX_BYTES (the oldest lines after the first LOG_HEAD go first, so Launch stays). */
export const LOGS = "starchart.blackbox.logs", LOGS_KEPT = 20, LOG_HEAD = 10;
/** W74 flightlog: a log as it is kept: its lines, each a string scrubbed again (a backup's may have been edited), or null. */
export function logLines(v) {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x) => typeof x === "string").map((x) => scrub(x).slice(0, MAX_DETAIL + 40));
  let n = out.reduce((a, x) => a + x.length + 1, 0);
  while (n > MAX_BYTES && out.length > LOG_HEAD) n -= out.splice(LOG_HEAD, 1)[0].length + 1;
  return out.length ? out : null;
}
/** W74 flightlog: the logs kept, by flight id ({} when none, or junk). */
function keptLogs(store) {
  try { const o = JSON.parse(store.getItem(LOGS))?.logs; return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
/** W68 logbulk (SPEC §99): a tiny flight is under 0.05 LY or under 1 minute of moving time (a flight from before W68 has
 *  no moving_s: its whole time). The Log greys its row; Land doesn't keep it (W124 settings3: always). */
export const TINY = { m: 0.05 * LY, s: 60, foot_m: 30 }; // W127 walklog: foot_m, a walk's: 1 minute at FOOT's 0.5 m/s (app/course-logic.js)
/** W127 walklog (SPEC §236): a walk (`foot`) is tiny under TINY.foot_m alone: its moving time counts only from the bike's 1 m/s
 *  (MOVING_MPS), so a slow walk to the corner shop has none, and 30 m is past a standing phone's wander at FOOT's floor. */
export const tiny = (f) => !f.gap && (f.foot ? f.metres < TINY.foot_m : f.metres < TINY.m || (f.moving_s ?? (f.end - f.start) / 1000) < TINY.s); // W125 tinygap: one with an unwatched gap (`gap`) never is: its metres and time miss that part; W127 walklog: foot

/** The class a lifetime of `ly` light years has reached, or null below the first. */
export const classFor = (ly) => CLASSES.filter((c) => c.ly <= ly).at(-1) || null;
/** The next class to reach, or null past the last. */
export const nextClass = (ly) => CLASSES.find((c) => c.ly > ly) || null;

/** Watches one flight's fixes ({lonlat, speed_mps, t} with t in ms) and adds up the metres driven, not ridden. */
export class CarGuard {
  constructor(rules = CAR) {
    this.rules = rules;
    this.done = 0; // metres of closed stretches that were too long
    this.run = null; // the stretch going on: {start, end, m} (ms, ms, metres)
    this.last = null;
  }

  fix(f) {
    const last = this.last;
    if (last && f.t <= last.t) return;
    this.last = f;
    if (!last) return;
    const d = metres(last.lonlat, f.lonlat), dt = (f.t - last.t) / 1000;
    const v = Number.isFinite(f.speed_mps) ? f.speed_mps : d / dt;
    if (this.run) {
      if (v > this.rules.low_mps) { this.run.m += d; this.run.end = f.t; } else this.close();
    } else if (v > this.rules.high_mps) this.run = { start: last.t, end: f.t, m: d };
  }

  close() {
    if (this.run && this.long(this.run)) this.done += this.run.m;
    this.run = null;
  }

  long(run) { return (run.end - run.start) / 1000 > this.rules.hold_s; }

  /** The metres left out so far, the stretch going on included once it is long enough. */
  get excluded() { return this.done + (this.run && this.long(this.run) ? this.run.m : 0); }
}

/**
 * One flight's record, from Launch to a final Land. `counts` is false for the demo, which records nothing.
 * `sink` is the logbook ({put(id, n, chunk), final(id)}) the track goes to, 30 s at a time; `epoch(t)` turns
 * a fix's clock (performance.now()) into epoch ms.
 */
export class Recorder {
  constructor(box, { counts, sink = null, epoch = (t) => t + (globalThis.performance?.timeOrigin || 0), log = trailLog }) { // W74 flightlog: log
    Object.assign(this, { box, counts, sink, epoch, log, guard: null, start: 0, id: "", stats: null, chunks: null, seen: { hi_five: 0, cup_crush: 0 }, base: null, lines: [] });
  }
  launch(now = Date.now()) {
    this.guard = this.counts ? new CarGuard() : null;
    this.footAt = null; this.footEx = 0; // W127 walklog: the metres at which the flight went on foot (0: a walk from Launch), or null; the car guard's metres then
    this.gapM = 0; // W62 cometcard, at the merge: the train legs' metres, which the readout leaves out too
    this.start = now;
    this.id = now.toString(36);
    this.stats = this.guard ? new FlightStats() : null;
    this.chunks = this.guard && this.sink ? new Chunker((n, c) => this.sink.put(this.id, n, c)) : null;
    this.base = { ...this.seen };
    const list = this.log?.list || [], at = list.findLastIndex((e) => e.kind === "flight"); // W74 flightlog: from the Launch just noted (app/main.js)
    this.lines = []; this.seq = at > 0 ? list[at - 1].i : at === 0 ? 0 : (list.at(-1)?.i ?? 0); // none noted (a kept flight saved at the start): none of this page's lines
  }
  /** W74 flightlog (F11): the flight's log so far: the lines kept, with the trail log's entries since. */
  pull() {
    if (!this.guard) return this.lines;
    for (const e of this.log?.list || []) if (e.i > this.seq) { this.lines.push(line(e)); this.seq = e.i; }
    return (this.lines = logLines(this.lines) || []);
  }
  /** A fix while flying (not while landed or parked): {lonlat, speed_mps, t, alt?}; `system` is the town it is in. */
  fix(f, system) {
    if (!this.guard) return;
    if (this.gap) return this.skip(f); // W62 cometcard: between a comet course's two legs
    this.guard.fix(f);
    const g = { t: Math.round(this.epoch(f.t)), lon: f.lonlat[0], lat: f.lonlat[1], alt: Number.isFinite(f.alt) ? f.alt : null, speed_mps: f.speed_mps };
    if (f.match) { g.mlon = f.match.lonlat[0]; g.mlat = f.match.lonlat[1]; } // W21 gps: the matched track (app/match.js), beside the raw fix
    this.stats.fix(g, system);
    this.chunks?.fix(g);
  }
  /** W62 cometcard: a fix on the comet, between a comet course's legs (`gap` set): a gap in the flight, its metres left out as
   *  the car guard's are, with no moving time and nothing in the track. */
  skip(f) {
    const g = this.guard, last = g.last;
    g.close();
    if (last && f.t > last.t) { const d = metres(last.lonlat, f.lonlat); g.done += d; this.gapM = (this.gapM || 0) + d; } // the readout's LY skip it too
    if (!last || f.t > last.t) g.last = f;
    if (this.stats && Number.isFinite(f.t)) this.stats.lastT = Math.round(this.epoch(f.t));
  }
  /** W127 walklog (SPEC §236): on foot from `metres` on, till the final Land (0: at Launch, a walk; later, a ride that went on
   *  foot, its walked metres `foot_m`). Kept as a walk, out of the light years; the first call holds. */
  foot(metres) { if (this.guard && this.footAt == null) Object.assign(this, { footAt: metres, footEx: this.guard.excluded }); } // W127 walklog: footEx, so the walked end's car stretches aren't left out twice
  /** A starchart:event's kind, for the pulsars and black holes passed. */
  event(kind) { this.stats?.event(kind); }
  /** The tallies' counts (hi_five, cup_crush), which run on across flights: a flight counts its own taps. */
  tally(kind, n) { this.seen[kind] = n; }
  /** W28 resume: the flight so far, as plain data, for app/resume.js to keep; `flush` sends the track's last fixes to the
   *  logbook first (the page is going out of sight). Null for the demo. */
  snapshot(flush = false) {
    if (!this.guard) return null;
    if (flush) this.chunks?.flush();
    const { top_mps, climb_m, pulsars, holes, systems, pts, ref, last, moving_s, lastT, plan, plan_s, flew_s, courses, pace, still, stop_s, gap } = this.stats; // W59 pace: moving_s to pace; W86 eta: still, stop_s; W125 tinygap: gap
    return { id: this.id, start: this.start, excluded: this.guard.excluded, footAt: this.footAt, footEx: this.footEx, n: this.chunks?.n ?? 0, seen: { ...this.seen }, base: { ...this.base }, log: this.pull().slice(), // W74 flightlog: log; W127 walklog: footAt, footEx
      stats: { top_mps, climb_m, pulsars, holes, systems: systems.slice(), pts: pts.slice(), ref, last, moving_s, lastT, plan, plan_s, flew_s, courses, pace, still, stop_s, gap } }; // W59 pace; W86 eta; W125 tinygap: gap
  }
  /** W28 resume: carry on the flight a snapshot kept, in a new page: the same id, track, stats and taps. */
  resume(s) {
    this.launch(s.start);
    if (!this.guard) return;
    Object.assign(this, { id: s.id, seen: { ...s.seen }, base: { ...s.base }, footAt: s.footAt ?? null, footEx: s.footEx || 0 }); // W127 walklog: footAt, footEx
    this.lines = logLines(s.log) || []; // W74 flightlog: the log so far, then this page's from its Launch
    this.guard.done = s.excluded || 0; // the car stretches so far; a stretch going on starts again
    Object.assign(this.stats, s.stats);
    if (this.chunks) this.chunks.n = s.n;
  }
  /** The star class this flight would reach, for the landed sticker. */
  crossing(metres) { return this.guard ? this.box.crossing(metres, this.guard.excluded) : null; }
  /** The landing is final: write the flight. Returns it, or null for the demo or a full store (its track then
   *  stays unfinished, so the next start offers it back as cut short). */
  final({ metres, minutes, end = Date.now() }) {
    if (!this.guard) return null;
    this.guard.close();
    this.chunks?.flush();
    if (this.stats.lastT !== null && end - this.stats.lastT > GAP_MS) this.stats.gap = true; // W125 tinygap: no fix from the last one to Land
    const lines = this.pull(); // W74 flightlog
    const tap = (k) => Math.max(0, this.seen[k] - this.base[k]);
    const f = this.box.add({ id: this.id, start: this.start, end, metres, minutes, excluded_m: Math.min(metres, this.guard.excluded),
      hifives: tap("hi_five"), cups: tap("cup_crush"), ...this.stats.summary(),
      ...(this.footAt === 0 ? { foot: true } : this.footAt > 0 ? { foot_m: Math.round(Math.max(0, metres - this.footAt - (this.guard.excluded - this.footEx))) } : {}) }); // W127 walklog
    if (f && this.chunks) this.sink.final(this.id);
    if (f && lines.length) this.box.keepLogs([[f.id, lines]]); // W74 flightlog: best kept; the flight is saved either way
    this.guard = this.stats = this.chunks = null;
    return f;
  }
}

/** A summary as v 2 has it: v 1's gain their stardate name. */
export const migrate = (f) => (f.name ? f : { ...f, name: defaultName(f.start) });

/** The flights on this phone, newest last. */
export class BlackBox {
  constructor(store = globalThis.localStorage) { this.store = store; }

  get flights() {
    try { return (JSON.parse(this.store.getItem(KEY))?.flights || []).map(migrate); } catch { return []; }
  }

  /** Store the flights. False if the store refused (full or off): the box stays as it was. */
  write(flights) {
    try { this.store.setItem(KEY, JSON.stringify({ v: 2, flights })); } catch { return false; }
    this.onwrite?.(); // W73 ghosts: the ghost trails follow the Log (app/ghosts.js)
    return true;
  }

  /** The metres a flight counts: its distance less what the car guard left out. W127 walklog: a walk's none, a ride's walked
   *  end (`foot_m`) left out too. */
  static counted(f) { return f.foot ? 0 : Math.max(0, f.metres - (f.excluded_m || 0) - (f.foot_m || 0)); } // W127 walklog

  get lifetimeLy() { return this.flights.reduce((a, f) => a + BlackBox.counted(f), 0) / LY; }

  /** The class a flight of `metres` (less `excluded_m`) would reach that the lifetime has not yet, or null. */
  crossing(metres, excluded_m = 0) {
    const before = this.lifetimeLy, after = before + Math.max(0, metres - excluded_m) / LY;
    const c = classFor(after);
    return c && c !== classFor(before) ? c : null;
  }

  /** Record a final flight: {start, end} (epoch ms), metres, minutes and excluded_m, and the stats
   *  (systems, hifives, cups, climb_m, top_mps, pulsars, holes, thumb). Returns it with its id and name, or null if
   *  the store is full. W40 log: a flight it already has (the same id, landed again by a second tab) is replaced, not added. */
  add({ id, start, end, metres, minutes, excluded_m = 0, name = defaultName(start), ...stats }) {
    const f = { ...stats, id: id || `${start.toString(36)}-${Math.round(metres)}`, name, start, end, metres: Math.round(metres),
      minutes: Math.round(minutes), excluded_m: Math.round(excluded_m) };
    return this.write([...this.flights.filter((x) => x.id !== f.id), f].sort((a, b) => a.start - b.start)) ? f : null;
  }

  get(id) { return this.flights.find((f) => f.id === id) || null; }

  /** W74 flightlog (F11): a flight's log, its lines, or null. A summary may carry its own `log`: an older Starchart restored a
   *  backup with logs, and kept it with the summary. */
  log(id) { return logLines(keptLogs(this.store)[id]) || logLines(this.get(id)?.log); }
  /** W74 flightlog: the flights, each with its log as `log` where it has one: the Log's backup (app/logsafe.js keeps any field). */
  withLogs() {
    const logs = keptLogs(this.store);
    return this.flights.map(({ log, ...f }) => { const l = logLines(logs[f.id]) || logLines(log); return l ? { ...f, log: l } : f; });
  }
  /** W74 flightlog: keep the logs `entries` ([[id, lines]]), with those kept before, for the newest LOGS_KEPT flights this phone
   *  has. False if the store refused. */
  keepLogs(entries) {
    const logs = keptLogs(this.store);
    for (const [id, l] of entries) { const c = logLines(l); if (c) logs[id] = c; }
    const keep = this.flights.filter((f) => logs[f.id]).slice(-LOGS_KEPT); // newest last; a deleted flight's goes
    try { this.store.setItem(LOGS, JSON.stringify({ v: 1, logs: Object.fromEntries(keep.map((f) => [f.id, logs[f.id]])) })); return true; } catch { return false; }
  }

  /** W67 logsafe: a backup's flights (app/logsafe.js), added where this phone hasn't one by its id, so none counts twice
   *  toward the lifetime. Returns those added ([] when none is new), or null if the store refused. */
  restore(fs) {
    const all = this.flights, ids = new Set(all.map((f) => f.id)), got = fs.map(migrate).filter((f) => !ids.has(f.id) && ids.add(f.id));
    const add = got.map(({ log, ...f }) => f); // W74 flightlog: a flight's log is kept apart from its summary
    if (add.length && !this.write([...all, ...add].sort((a, b) => a.start - b.start))) return null;
    if (got.some((f) => f.log)) this.keepLogs(got.map((f) => [f.id, f.log])); // W74 flightlog: one missing or malformed is left out
    return add;
  }

  /** Rename a flight; an empty name gives it its stardate back. */
  rename(id, name) {
    name = String(name).trim().slice(0, 80);
    this.write(this.flights.map((f) => (f.id === id ? { ...f, name: name || defaultName(f.start) } : f)));
    return this.get(id);
  }

  /** Delete one flight (W68 logbulk: or several, by an array of ids). Returns the undo, which puts them back. */
  remove(id) {
    const ids = new Set([id].flat()), all = this.flights, gone = all.filter((f) => ids.has(f.id)); // W68 logbulk: ids
    if (!gone.length) return () => {};
    this.write(all.filter((f) => !ids.has(f.id)));
    return () => { const now = this.flights, have = new Set(now.map((f) => f.id)); const back = gone.filter((f) => !have.has(f.id)); if (back.length) this.write([...now, ...back].sort((a, b) => a.start - b.start)); }; // W68 logbulk
  }

  /** W68 logbulk (SPEC §99): `key` ("star" or "archived") set on the flights `ids` (true), or taken off (false). Returns the
   *  undo, which puts each flight's own back. */
  mark(ids, key, on) {
    ids = new Set(ids);
    const was = new Map(this.flights.filter((f) => ids.has(f.id)).map((f) => [f.id, !!f[key]]));
    const put = (v) => this.write(this.flights.map((f) => { if (!was.has(f.id)) return f; const { [key]: _, ...g } = f; return v(f.id) ? { ...g, [key]: true } : g; }));
    put(() => on);
    return () => put((id) => was.get(id));
  }

  /** Reset lifetime light years: every flight goes. Returns the undo, which brings them back. */
  reset() {
    const before = this.flights;
    this.write([]);
    return () => {
      const now = this.flights, ids = new Set(now.map((f) => f.id));
      this.write([...before.filter((f) => !ids.has(f.id)), ...now].sort((a, b) => a.start - b.start));
    };
  }
}
