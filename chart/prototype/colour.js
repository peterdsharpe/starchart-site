// Colour lines: Lodestar's rare asides, from design/sound/voice/colour-bank.json. Voice only, no banner.
// One chatter per flight. It hears the engine's events (chart/EVENTS.md) and a tick every second or so,
// and says a line only when every rule allows it (wave 13):
//   - the level caps lines per flight and spaces them: light 2, 25 min apart; regular 5, 10 min apart;
//   - never within 45 s of a safety or navigation line, and not while another line is likely playing;
//   - at most one line per category per flight;
//   - no line again within the last 30 flights (a history in `store`); else the least recently played wins.
// Wave 20 adds three tick moments: a club fun fact, at most once a flight, in a quiet stretch at a random
// time 20 to 60 minutes in; the month, once a flight after 20 minutes; and more hours of the clock. A count of
// quadrants, wormholes, constellations or byways is of different ones, as systems already were.
//
//   const chatter = createChatter({ bank, store: localStorage, level: "light", now: () => performance.now(), say });
//                                                  // level: a name, or a function that returns one
//   chatter.onEvent(e)                               // every chart event, as dispatched
//   chatter.tick({ elapsed_s, ly, clock, quiet_s })  // clock: a Date; quiet_s: seconds since any line
//
// `say(entry)` speaks entry.text and returns (or resolves to) its length; 0 or false means it was dropped,
// and then it does not count.

export const LEVELS = { off: { max: 0, gap_s: 0, chance: 0 }, light: { max: 2, gap_s: 25 * 60, chance: 0.4 }, regular: { max: 5, gap_s: 10 * 60, chance: 0.6 } };
/** Lines that must be heard clearly: no colour within 45 s of them, before or after. */
export const FIXED = new Set(["launch", "black_hole_ahead", "pulsar_ahead", "negi_g_well", "course_turn", "touchdown",
  "transport_lane", "buoy_field", "space_junk", "tracks_ahead", "stop_ahead", "bus_stop_ahead"]); // W67 graph3: tracks_ahead; W86 stops; W93 busstop
const CLEAR_S = 45, AFTER_LINE_S = 6, HOLD_S = 150, RUN_END_S = 50, RECENT = 30, KEY = "starchart.colour";
/** The hours that have lines: a moment in the first hour after each, once a flight. */
export const HOURS = ["21:00", "22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00"];
/** A club fact waits for a quiet stretch (no line for FACT_QUIET_S) between FACT_FROM_S and FACT_TO_S, from a random start. */
export const FACT_FROM_S = 20 * 60, FACT_TO_S = 60 * 60, FACT_QUIET_S = 4 * 60;
/** Places counted once each in a flight: the fifth quadrant is five different ones. */
const DISTINCT = new Set(["quadrant_enter", "wormhole_enter", "constellation", "byway_enter"]);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The days of the season calendar for a date; `calendar` adds the ones the club announces ({century: "2026-09-26"}). */
export function seasonDays(d, calendar = {}) {
  const y = d.getFullYear(), ymd = (m, day) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const nthSat = (m, n) => { const first = new Date(y, m - 1, 1).getDay(); return 1 + ((6 - first + 7) % 7) + 7 * (n - 1); };
  const today = ymd(d.getMonth() + 1, d.getDate());
  const lastOctSat = nthSat(10, 1) + 7 * Math.floor((31 - nthSat(10, 1)) / 7);
  const days = {
    alphamission: [ymd(4, nthSat(4, 1))], betamission: [ymd(4, nthSat(4, 2))], scul_day: [ymd(6, nthSat(6, 1))],
    omegamission: [ymd(11, nthSat(11, 1))], hallowheels: [ymd(10, 31), ymd(10, lastOctSat)],
  };
  for (const [k, v] of Object.entries(calendar)) days[k] = [v].flat();
  return Object.keys(days).filter((k) => days[k].includes(today));
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:00`;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Does a bank trigger match a moment? A list matches any value; `min_x` means moment.x >= it; `quiet_s` is a minimum too. */
export function matches(trigger, m) {
  return Object.entries(trigger).every(([k, want]) => {
    if (k.startsWith("min_")) return (m[k.slice(4)] ?? -Infinity) >= want;
    if (k === "quiet_s") return (m.quiet_s ?? -Infinity) >= want;
    return Array.isArray(want) ? want.includes(m[k]) : m[k] === want;
  });
}

export function createChatter({ bank, store, level = "light", now = () => Date.now(), say, random = Math.random, calendar = {} }) {
  const lines = Array.isArray(bank) ? bank : bank.lines;
  // `level` may be a function, so a change in Settings takes effect at once, mid-flight
  const levelRules = () => LEVELS[typeof level === "function" ? level() : level] || LEVELS.light;
  const saved = (() => { try { return JSON.parse(store?.getItem(KEY)) || {}; } catch { return {}; } })();
  const hist = { flight: (saved.flight || 0) + 1, played: saved.played || {}, seq: saved.seq || 0 };
  const save = () => { try { store?.setItem(KEY, JSON.stringify(hist)); } catch {} };
  save(); // this flight counts, whether or not it says anything

  const sec = () => now() / 1000;
  const fl = { said: [], categories: new Set(), counts: {}, systems: new Set(), seen: {}, fired: new Set() };
  // the club fact's earliest moment: anywhere in the first two thirds of its window, so it never comes at a set time
  const factAt = FACT_FROM_S + Math.floor(random() * (FACT_TO_S - FACT_FROM_S) * 2 / 3);
  let lastFixed = -Infinity, lastLine = -Infinity, pending = [];
  const runs = { climb: null, drop: null, pulsars: null };

  const eligible = (m) => lines.filter((l) => !fl.categories.has(l.category) && matches(l.trigger, m)
    && hist.flight - (hist.played[l.id]?.flight ?? -Infinity) > RECENT);

  /** The least recently played candidate; ties go to a weighted draw. */
  function pick(cands) {
    const age = (l) => hist.played[l.id]?.seq ?? -1;
    const oldest = Math.min(...cands.map(age));
    const pool = cands.filter((l) => age(l) === oldest);
    let r = random() * pool.reduce((a, l) => a + (l.weight ?? 1), 0);
    for (const l of pool) if ((r -= l.weight ?? 1) < 0) return l;
    return pool.at(-1);
  }

  /** A moment worth a line: kept for a while, until the rules let it speak; most are let go by chance. */
  function moment(m, t = sec()) {
    const rules = levelRules();
    if (!rules.max || !lines.some((l) => matches(l.trigger, m))) return;
    if (random() >= rules.chance) return;
    pending.push({ m, at: t });
  }

  function clear(t, state) {
    const rules = levelRules();
    if (fl.said.length >= rules.max) return false;
    if (t - (fl.said.at(-1) ?? -Infinity) < rules.gap_s) return false;
    if (t - lastFixed < CLEAR_S || t - lastLine < AFTER_LINE_S) return false;
    return !(state?.ahead_s < CLEAR_S); // the app may say how soon the next fixed line is due
  }

  async function speak(l, t) {
    const prev = hist.played[l.id];
    fl.said.push(t); fl.categories.add(l.category);
    hist.played[l.id] = { flight: hist.flight, seq: ++hist.seq };
    lastLine = t;
    save();
    let ok;
    try { ok = await say(l); } catch { ok = 0; }
    if (!ok) { // dropped by the voice queue: it never played
      fl.said.splice(fl.said.indexOf(t), 1); fl.categories.delete(l.category);
      if (prev) hist.played[l.id] = prev; else delete hist.played[l.id];
      save();
    }
    return ok;
  }

  function endRuns(t) {
    const r = runs;
    if (r.climb && t - r.climb.last >= RUN_END_S) { moment({ event: "g_well_top", climb_m: r.climb.m }, t); r.climb = null; }
    if (r.drop && t - r.drop.last >= RUN_END_S) { moment({ event: "posi_run", drop_m: r.drop.m }, t); r.drop = null; }
    if (r.pulsars && t - r.pulsars.last >= RUN_END_S) {
      if (r.pulsars.n >= 2) moment({ event: "pulsar_string", pulsars: r.pulsars.n }, t);
      r.pulsars = null;
    }
  }

  return {
    flight: hist.flight,
    get said() { return fl.said.length; },

    onEvent(e) {
      const t = sec(), kind = e?.kind, data = e?.data || {};
      if (!kind || kind === "colour") return;
      if (FIXED.has(kind)) lastFixed = t;
      if (e.voice) lastLine = t;
      fl.counts[kind] = (fl.counts[kind] || 0) + 1;
      let count = fl.counts[kind];
      if (kind === "system_enter") { fl.systems.add(data.name); count = fl.systems.size; }
      if (DISTINCT.has(kind)) { (fl.seen[kind] ||= new Set()).add(data.name ?? data.osm_id ?? count); count = fl.seen[kind].size; }
      if (kind === "hi_five" || kind === "cup_crush") count = data.count ?? count;
      if (kind === "negi_g_well") runs.climb = { m: (runs.climb?.m || 0) + (data.climb_m || 0), last: t };
      if (kind === "posi_g_well") runs.drop = { m: (runs.drop?.m || 0) - (data.climb_m || 0), last: t };
      if (kind === "pulsar_ahead") runs.pulsars = { n: (runs.pulsars?.n || 0) + 1, last: t };
      if (kind === "system_enter" && fl.systems.size !== count) return;
      moment({ event: kind, ...data, count }, t);
    },

    tick(state = {}) {
      const t = sec();
      endRuns(t);
      const el = state.elapsed_s ?? 0;
      const once = (key, m) => { if (!fl.fired.has(key)) { fl.fired.add(key); moment(m, t); } };
      if (el >= 3600) once("h" + Math.floor(el / 3600), { flight_h: Math.floor(el / 3600) });
      if (el >= 300 && state.clock instanceof Date) {
        const c = state.clock, h = hhmm(c);
        if (HOURS.includes(h)) once("c" + h, { clock: h, day: DAYS[c.getDay()] });
        if (c.getDay() === 6 && c.getHours() >= 18) once("saturnight", { saturnight: true });
      }
      if (el >= 600 && state.clock instanceof Date) for (const d of seasonDays(state.clock, calendar)) once("d" + d, { date: d });
      if (el >= 1200 && state.clock instanceof Date) once("month", { month: MONTHS[state.clock.getMonth()] });
      const quiet = state.quiet_s ?? t - Math.max(lastLine, lastFixed);
      if (el >= factAt && el < FACT_TO_S && quiet >= FACT_QUIET_S) once("fact", { fact: true });
      if (el >= 900 && quiet >= 900) once("q" + Math.floor(el / 900), { quiet_s: quiet });

      pending = pending.filter((p) => t - p.at < HOLD_S);
      if (!pending.length || !clear(t, state)) return null;
      for (const [i, p] of pending.entries()) {
        const cands = eligible(p.m);
        if (!cands.length) continue;
        pending.splice(i, 1);
        const l = pick(cands);
        speak(l, t);
        return l;
      }
      pending = [];
      return null;
    },
  };
}
