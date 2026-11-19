// W73 dark (design/app-ui/SPEC.md §120): riding after dark. Daylight saving ends on 1 Nov, and sunset at the Fort moves
// from 5:40 PM to 4:38 PM, so a daily rider's way home is in the dark for five months.
//
// - The preview's arrival says when the daystar sets, only when it sets during the ride ("Daystar sets 4:38"; app/course.js).
// - In flight, one moment at sunset: a banner and "The daystar has set. Lasers on." Once a flight, only for a flight that set
//   out by day, and only With chatter: never in Directions (the default), in Calm or with Sound off (mountDusk). arclight:
//   "facts only, no cue by default".
// - Theme's "By the sun" (app/theme.js, which reckons the sun the same way in its own classic script).
//
// The sun is reckoned at one fixed point, the Fort, as the radar is: no position is used, and across the region the time
// differs by under a minute.
import { isDay } from "./weather-logic.js";
import { pick } from "./lingo-mode.js";

export const SKY = [-71.13946, 42.3596]; // the Fort (app/main.js FORT)
export const LOOK_MS = 30000; // the moment's look, in flight
const STEP_MS = 10 * 60000; // the search's stride: no day or night is that short in Boston

/** The words, [SCUL, Plain]. */
export const WORDS = {
  card: [(at) => `Daystar sets ${at}`, (at) => `Sunset ${at}`],
  banner: ["Lasers on", "Lights on"], // with the daystar glyph, a sun on the horizon: one line at 320 px
  voice: ["The daystar has set. Lasers on.", "Sunset. Lights on."], // design/sound/voice: daystar_set and p_sunset_lights_on
};

/** The first sunset in (t0, t1] (ms), to the second, or null: the day turning to night, by weather-logic.js's isDay. */
export function sunsetIn(t0, t1, at = SKY) {
  if (!(t1 > t0)) return null;
  for (let a = t0, day = isDay(a, at); a < t1;) {
    const b = Math.min(t1, a + STEP_MS), dayB = isDay(b, at);
    if (day && !dayB) {
      let lo = a, hi = b;
      while (hi - lo > 1000) { const m = (lo + hi) / 2; if (isDay(m, at)) lo = m; else hi = m; }
      return Math.round(hi);
    }
    a = b; day = dayB;
  }
  return null;
}

/** The preview's line beside its arrival, or "": when the daystar sets between `now` and `arrive` (ms). `clock(ms)`
 *  writes the time, as the arrival's; the sunset is rounded to its nearest minute, as almanacs give it. */
export function cardLine(now, arrive, clock) {
  const t = sunsetIn(now, arrive);
  return t == null ? "" : pick(WORDS.card)(clock(Math.round(t / 60000) * 60000));
}

/**
 * Once a flight. `look(t, flying)` at each look: true when the moment is due, the first look at night after a look by day in
 * the same flight. A flight that sets out after dark never gets it; nor does one whose sunset passes while `quiet` (Calm,
 * Sound off, or Directions): the moment is at sunset or not at all.
 */
export class DuskWatch {
  constructor() { this.flight = null; }
  look(t, flying, quiet = false) {
    if (!flying) { this.flight = null; return false; }
    const day = isDay(t, SKY);
    if (!this.flight) { this.flight = { day, said: false }; return false; }
    const due = this.flight.day && !day && !this.flight.said;
    this.flight.day = day;
    if (!due) return false;
    this.flight.said = true;
    return !quiet;
  }
}

/** By the sun's hold (app/theme.js): a turn within `within` s at the speed along the course (1 m/s at least), in flight. */
export const turnNear = ({ flying, turnIn, speed }, within = 20) => !!flying && turnIn != null && turnIn <= within * Math.max(1, speed || 0);

/** The moment in flight. `flying()`; `quiet()`: Calm, Sound off, or Sound without chatter; `fire(detail)`: a starchart:event. */
export function mountDusk({ flying, quiet, fire, now = () => Date.now(), every = LOOK_MS }) {
  const watch = new DuskWatch();
  const look = () => {
    if (watch.look(now(), flying(), quiet())) fire({ kind: "daystar_set", text: pick(WORDS.banner), voice: pick(WORDS.voice), data: {} });
  };
  const timer = setInterval(look, every);
  return { look, watch, stop: () => clearInterval(timer) };
}
