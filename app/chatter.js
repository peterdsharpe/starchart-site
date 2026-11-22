// The colour lines in flight (wave 15): Lodestar's rare asides, from chart/prototype/colour.js.
//
// One chatter per flight. It hears every starchart:event, and a tick once a second while flying, which
// stops at Land (and starts again on Undo). Its level is read at every moment, so a change in Settings takes
// effect at once: W28 settings, "light" while Sound is Directions with chatter, else "off" (app/main.js). Its lines go to sfx.js as kind "colour", never as a
// starchart:event, so they get no banner (chart/EVENTS.md).
//
// The clock is the phone's own, so Saturnight lines work. The club's dates (Century, Founder's Day,
// HONK!) wait for the mission feed, so no calendar is passed and those lines stay quiet.
import { createChatter } from "../chart/prototype/colour.js";

/**
 * bank: a promise of colour-bank.json; level(): "off" | "light" (W28 settings: Regular went); say(line): resolves to its
 * length (0 if dropped); state(): { elapsed_s, ly } for the tick. W60 d: lingo(): the lingo mode; in Plain ("meatspace") the
 * colour lines are off, read at every moment as the level is: each one is a SCUL joke or aside.
 */
export function flightChatter({ bank, store, level: chosen, say, state, now = () => performance.now(), every = 1000, target = globalThis, lingo = () => "scul" }) {
  let chatter = null, timer = 0, flight = 0;
  const level = () => (lingo() === "meatspace" ? "off" : chosen()); // W60 d
  const tick = () => chatter?.tick({ ...state(), clock: new Date() });
  target.addEventListener?.("starchart:event", (e) => chatter?.onEvent(e.detail));
  const api = {
    /** Launch: a new chatter, ticking. */
    launch() {
      const id = ++flight;
      chatter = null;
      bank.then((b) => { if (id === flight) chatter = createChatter({ bank: b, store, level, now, say }); }).catch(() => {});
      api.resume();
    },
    /** Land: stop ticking; the flight may still be undone. */
    pause() { clearInterval(timer); timer = 0; },
    /** Undo: the same chatter ticks on. */
    resume() { clearInterval(timer); timer = setInterval(tick, every); },
    /** The landing is final. */
    end() { api.pause(); flight++; chatter = null; },
    get chatter() { return chatter; },
    get ticking() { return !!timer; },
  };
  return api;
}

/**
 * For tests: say one colour line now, from a throwaway chatter with its own history, at a forced level and
 * with every chance taken. It touches nothing of the flight's chatter or the stored history.
 * `event` is a chart event with no voice ({ kind: "light_year", data: { light_years: 1 } }).
 */
export async function sayColourNow({ bank, say, level = "regular", event }) {
  const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const c = createChatter({ bank: await bank, store, level, say, random: () => 0, now: () => performance.now() });
  c.onEvent(event);
  return c.tick({});
}
