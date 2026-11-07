// W54 flight (design/app-ui/SPEC.md §70): radiation in flight. arclight, 2026-10-19: "Radiation in twenty minutes."
// ("do the plain version, yes").
//
// - When: in flight, with the Weather layer on and a fresh radar, rain (the radar's 20 dBZ) due at the ship's spot, or on
//   the course ahead when the pilot gets there at their own pace (weather.along()), within WITHIN_MIN minutes.
// - Once a band: a banner and the line "Radiation in twenty minutes." (5-minute steps, 5 to 30), and "Radiation now."
//   when it starts at the ship. A band is over after RESET_MIN minutes with no rain due.
// - The look is every 30 s, and at each new radar frame; the worker does the work (app/weather-worker.js).
// - W102 winter (SPEC §199): an NWS winter warning in effect (app/weather-winter.js), its line once a flight: "Heavy radiation
//   warning." (Plain "Snow warning."), "Ice warning." An advisory or a watch stays on the parked chip.
import { pick } from "./lingo-mode.js"; // W60 c
import { winterLine, winterOn, winterVoice } from "./weather-winter.js"; // W102 winter
export const WITHIN_MIN = 20, RESET_MIN = 10, LOOK_MS = 30000, AHEAD_MIN = 30, STEP_M = 200;
const WORDS = { 5: "five", 10: "ten", 15: "fifteen", 20: "twenty", 25: "twenty-five", 30: "thirty" };
/** The minutes to say: to 5, from 5 to 30. */
export const round5 = (m) => Math.min(30, Math.max(5, Math.round(m / 5) * 5));
/** W60 c: each line whole, SCUL's and Plain's (W60 d's clips say Plain's). */
const LINES = {
  voiceNow: ["Radiation now.", "Rain now."], voiceIn: [(w) => `Radiation in ${w} minutes.`, (w) => `Rain in ${w} minutes.`],
  textNow: ["Radiation now", "Rain now"], textIn: [(n) => `Radiation in ${n} min`, (n) => `Rain in ${n} min`],
};
const say = (k, mode) => (mode ? LINES[k][mode === "meatspace" ? 1 : 0] : pick(LINES[k])); // W60 c: the mode given, else the setting's
/** The spoken line: "Radiation in twenty minutes.", "Radiation now." (Lodestar's clips, design/sound/scripts/voice.py); in
 *  Plain "Rain in twenty minutes.", "Rain now." */
export const radiationVoice = (m, mode) => (m <= 0 ? say("voiceNow", mode) : say("voiceIn", mode)(WORDS[round5(m)])); // W60 c: mode
/** The banner's words: "Radiation in 20 min", "Radiation now"; in Plain "Rain in 20 min", "Rain now". */
export const radiationText = (m, mode) => (m <= 0 ? say("textNow", mode) : say("textIn", mode)(round5(m))); // W60 c: mode

/**
 * Once a band. `update(m, t)`: `m` the minutes to the first rain due (at the spot or on the course), or null for none
 * within the hour; `t` ms. Returns "ahead" or "now" when a line is due, else null. A band says "ahead" once, when rain is
 * due within WITHIN_MIN, and "now" once, when it rains at the ship; it ends after RESET_MIN minutes with none due.
 */
export class RainWatch {
  constructor() { this.band = null; }
  update(m, t) {
    const due = m != null && m <= WITHIN_MIN;
    if (!due) {
      if (this.band && this.band.dry == null) this.band.dry = t;
      if (this.band && t - this.band.dry >= RESET_MIN * 60000) this.band = null;
      return null;
    }
    if (!this.band) this.band = { ahead: false, now: false, dry: null };
    this.band.dry = null;
    if (m <= 0 && !this.band.now) { this.band.now = this.band.ahead = true; return "now"; }
    if (m > 0 && !this.band.ahead) { this.band.ahead = true; return "ahead"; }
    return null;
  }
}

/** The course ahead of `s` as along()'s points, every STEP_M metres to AHEAD_MIN minutes at `v` m/s, from the ship's spot. */
export function aheadPoints(course, s, v, ship) {
  const pts = [{ lonlat: ship, m: 0 }], end = Math.min(course.length, s + Math.max(1, v) * 60 * AHEAD_MIN);
  for (let d = s + STEP_M; d <= end; d += STEP_M) pts.push({ lonlat: course.pointAt(d), m: (d - s) / Math.max(1, v) / 60 });
  return pts;
}

/**
 * Watch the radar in flight. `weather`: app/weather.js's handle (`on`, `onset()`: the minutes to rain at the ship's spot
 * or null, `along(pts)`); `flying()`; `course()`: { course, s, v } or null; `ship()`: [lon, lat] or null; `fire(detail)`.
 */
export function mountRadiation({ weather, flying, course, ship, fire, now = () => Date.now(), every = LOOK_MS }) {
  const watch = new RainWatch();
  let looking = false, said = null; // W102 winter: the winter alert said in this flight
  async function look() {
    if (!flying()) said = null; // W102 winter: landed: a new flight says it again
    if (looking || !flying() || !weather.on) return;
    looking = true;
    try {
      const a = weather.winter, key = a?.level === "warning" && winterOn(a, now()) && a.event; // W102 winter: a warning in effect, once a flight, as it launches or when it comes (an advisory or a watch stays on the chip); an extended or reissued one isn't new
      if (key && key !== said) { said = key; fire({ kind: "radiation", text: winterLine(a), voice: winterVoice(a), data: { stage: "winter", winter: a.kind, level: a.level } }); }
      const here = ship(), spot = here ? await weather.onset() : null;
      let m = spot ?? null;
      const c = course();
      if (c && here) {
        const pts = aheadPoints(c.course, c.s, c.v, here), i = await weather.along(pts);
        if (i >= 0 && (m == null || pts[i].m < m)) m = pts[i].m;
      }
      if (!flying()) return;
      const stage = watch.update(m == null ? null : Math.round(m), now());
      if (stage) fire({ kind: "radiation", text: radiationText(stage === "now" ? 0 : m), voice: radiationVoice(stage === "now" ? 0 : m), data: { stage, min: stage === "now" ? 0 : round5(m) } });
    } finally { looking = false; }
  }
  const timer = setInterval(look, every);
  return { look, watch, stop: () => clearInterval(timer) };
}
