// W28 resume: leaving Starchart never loses a ride or a plan (design/app-ui/SPEC.md §40).
//
// A tester pressed Android's back to answer a message, came back, and his ride was gone: back at the root closes an
// installed web app, and the next open started over. Now:
// - In flight, the first back at the root stays and says that a second one leaves (backGuard). Parked, back leaves
//   as Android expects, since what was open comes back.
// - The flight is kept on this phone (localStorage, synchronous, so it is written as the page goes out of sight):
//   every 15 s in flight, and at once when the page is hidden or closed. The next open carries it on, gap and all,
//   within AWAY_MS of its last fix; later, or if it had landed, it goes to the Log as it was (verdict).
// - Parked, a planned course's preview or the search with its words comes back within PARKED_MS.
// Pure apart from the store, so Node tests it (app/tests/resume.test.mjs). main.js says what to keep and puts it back.

import { lingo } from "./lingo-mode.js"; // W60 c
import { dur } from "./duration.js"; // W68 fixes
export const FLIGHT = "starchart:resume", ROUTE = "starchart:resume-course", PARKED = "starchart:parked";
export const AWAY_MS = 2 * 3600e3; // a flight resumes within 2 h of its last fix
export const PARKED_MS = 30 * 60e3; // a plan or a search, within 30 min
export const BACK_MS = 3000; // a second back within this leaves
export const KEEP_MS = 15000; // in flight, the flight is kept this often, and whenever the page is hidden

const read = (store, key) => { try { return JSON.parse(store.getItem(key)); } catch { return null; } };
const write = (store, key, v) => { try { if (v == null) store.removeItem(key); else store.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

/** The line in flight after a resume: "Flight resumed after 12 min away."; in Plain "Ride resumed after 12 min away." (W60 c). */
export const resumedLine = (ms, mode = lingo()) => { // W60 c: mode
  const away = ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : dur(Math.floor(ms / 60000)); // W68 fixes: "1h 20m"
  return mode === "meatspace" ? `Ride resumed after ${away} away.` : `Flight resumed after ${away} away.`; // W60 c
};

/** What the next open does with a kept flight: "resume", "save" (it had landed, or its last fix is too long ago), or null. */
export function verdict(kept, now = Date.now()) {
  if (!kept?.rec?.id) return null;
  return kept.landed || now - (kept.last || kept.launched) > AWAY_MS ? "save" : "resume";
}

/** The kept flight, with its course put back in it ({route, place, style, via, start, viaStart, s}), or null. */
export function keptFlight(store) {
  const k = read(store, FLIGHT);
  if (!k) return null;
  const c = k.course && read(store, ROUTE);
  return { ...k, course: c && c.route ? { ...c, s: k.course.s || 0 } : null };
}

/** The flight's keeper: keep(rec) writes it (the route only when it changed, since it is the big part); forget() at a
 *  final Land. `rec` is main.js's: {rec, launched, last, metres, trail, tally, course, camera, landed}. */
export function flightKeeper(store) {
  let route;
  return {
    keep(rec) {
      const { course, ...rest } = rec;
      if (course?.route !== route && write(store, ROUTE, course ? { ...course, s: undefined } : null)) route = course?.route;
      return write(store, FLIGHT, { v: 1, at: Date.now(), ...rest, course: course ? { s: course.s } : null });
    },
    forget() { write(store, FLIGHT, null); write(store, ROUTE, null); route = undefined; },
  };
}

/** W40 log: one tab owns a flight. A second tab opened while the first flies (or is in its Undo window) resumed the same
 *  flight, and both landings were saved. The owner holds the flight's Web Lock, LOCK + id, from Launch to the final Land;
 *  a closed or killed tab lets go of it at once. claim(id) takes it if no tab holds it: true, or false when another tab
 *  does. Where there are no Web Locks, claim() is always true, as before. */
export const LOCK = "starchart:flight:";
export function flightLock(locks = globalThis.navigator?.locks) {
  let release = null, held = "";
  return {
    claim(id) {
      if (!locks || held === id) return Promise.resolve(true);
      this.release();
      return new Promise((ok) => locks.request(LOCK + id, { ifAvailable: true }, (lock) => {
        if (!lock) return ok(false);
        held = id; ok(true);
        return new Promise((r) => { release = r; });
      }).catch(() => ok(true)));
    },
    release() { release?.(); release = null; held = ""; },
  };
}
/** W40 log: hold the Web Lock `name` until the returned function is called (nothing without Web Locks). */
export function holdLock(name, locks = globalThis.navigator?.locks) {
  let release = null, done = false;
  locks?.request(name, () => (done ? null : new Promise((r) => { release = r; }))).catch(() => {});
  return () => { done = true; release?.(); };
}
/** W40 log: held while a tab's Undo window would bring a deleted flight back, so another tab's start keeps its track. */
export const UNDO = "starchart:undo";
/** W40 log: the names of the Web Locks some tab holds or waits for (none without Web Locks). */
export async function heldLocks(locks = globalThis.navigator?.locks) {
  const q = await locks?.query?.().catch(() => null);
  return new Set([...(q?.held || []), ...(q?.pending || [])].map((l) => l.name));
}

/** Parked: keep what is open, {plan, search} (either may be null), or nothing. */
export function keepParked(store, open, now = Date.now()) {
  write(store, PARKED, open && (open.plan || open.search) ? { at: now, ...open } : null);
}
/** What was open when the app went out of sight parked, if it was within PARKED_MS; it is read once. */
export function takeParked(store, now = Date.now()) {
  const k = read(store, PARKED);
  write(store, PARKED, null);
  return k && now - k.at <= PARKED_MS && (k.plan || k.search) ? k : null;
}

/**
 * In flight, Android's back at the root: a CloseWatcher (made at Launch, under its tap) takes the first press and
 * say() tells the pilot; for BACK_MS no watcher waits, so a second press leaves; then one waits again. Chrome lets a
 * second press through by design as well. Where there is no CloseWatcher, back works as before. back() is the test
 * hook (Playwright has no back button): true if the press stayed, false if it would leave.
 */
export function backGuard({ say, make = () => (globalThis.CloseWatcher ? new globalThis.CloseWatcher() : null), ms = BACK_MS, timers = globalThis }) {
  let w = null, timer = 0, on = false;
  const arm = () => {
    timer = 0;
    if (!on || w) return;
    try { w = make(); } catch { w = null; }
    if (w) w.onclose = () => { w = null; if (!on) return; say(); timer = timers.setTimeout(arm, ms); };
  };
  const drop = () => { timers.clearTimeout(timer); timer = 0; const x = w; w = null; x?.destroy(); };
  return {
    on() { on = true; if (!timer) arm(); },
    off() { on = false; drop(); },
    get armed() { return !!w; },
    back() { if (!w) return false; w.close(); return true; },
  };
}
