// W54 flight (design/app-ui/SPEC.md §70): radiation in flight. arclight, 2026-10-19: "Radiation in twenty minutes."
// ("do the plain version, yes").
//
// - When: in flight, with the Weather layer on and a fresh radar, rain (the radar's 20 dBZ) due at the ship's spot, or on
//   the course ahead when the pilot gets there at their own pace (weather.along()), within WITHIN_MIN minutes.
// - Once a band: a banner and the line "Radiation in twenty minutes." (5-minute steps, 5 to 30), and "Radiation now."
//   when it starts at the ship. A band is over after RESET_MIN minutes with no rain due.
// - W201 weather2 (SPEC §360), his row of 11-07: "Tell me ahead of time ... Tell me how long it'll last ... tell me if it'll be
//   light, moderate, or heavy". The line tells the story whole: when, how hard (the map's three steps) and how long (the radar's,
//   and past its end the forecast's: weather.story(), weather.alongStory()): "Rain in five minutes. Light, for about ten
//   minutes." Once a band, and again only when the story changes (RainWatch): no "now" when it comes as said.
// - The look is every 30 s, and at each new radar frame; the worker does the work (app/weather-worker.js).
// - W102 winter (SPEC §199): an NWS winter warning in effect (app/weather-winter.js), its line once a flight: "Heavy radiation
//   warning." (Plain "Snow warning."), "Ice warning." An advisory or a watch stays on the parked chip.
import { pick } from "./lingo-mode.js"; // W60 c
import { winterLine, winterOn, winterVoice } from "./weather-winter.js"; // W102 winter
import { STRENGTHS, lastsLine } from "./weather-logic.js"; // W201 weather2
import { clockAt } from "./course-logic.js"; // W201 weather2: "likely until about 9:00"
export const WITHIN_MIN = 20, RESET_MIN = 10, LOOK_MS = 30000, AHEAD_MIN = 30, STEP_M = 200;
const WORDS = { 5: "five", 10: "ten", 15: "fifteen", 20: "twenty", 25: "twenty-five", 30: "thirty", 35: "thirty-five", 40: "forty", 45: "forty-five", 50: "fifty", 55: "fifty-five" }; // W201 weather2: to 55, the lengths
/** The minutes to say: to 5, from 5 to 30. */
export const round5 = (m) => Math.min(30, Math.max(5, Math.round(m / 5) * 5));
/** W60 c: each line whole, SCUL's and Plain's (W60 d's clips say Plain's). */
const LINES = {
  voiceNow: ["Radiation now.", "Rain now."], voiceIn: [(w) => `Radiation in ${w} minutes.`, (w) => `Rain in ${w} minutes.`],
  textNow: ["Radiation now", "Rain now"], textIn: [(n) => `Radiation in ${n} min`, (n) => `Rain in ${n} min`],
};
const say = (k, mode) => (mode ? LINES[k][mode === "meatspace" ? 1 : 0] : pick(LINES[k])); // W60 c: the mode given, else the setting's
/** W201 weather2: the hours "likely until about nine." says, by the clock's hour. */
const HOURS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
/** W201 weather2: how long, as the voice says it (the clips of design/sound/scripts/voice.py RAIN_CLIPS); "" for `more`, which no
 *  clip says, so the strength alone. */
export function lastsVoice(l) {
  if (!l) return "";
  if (l.until) return `likely until about ${HOURS[new Date(l.until).getHours() % 12]}`;
  if (l.day) return "likely the rest of the day";
  if (l.hour) return "for an hour or more";
  return l.min ? `for about ${WORDS[l.min]} minutes` : "";
}
const startOf = (s) => (typeof s === "number" ? s : s.start); // W201 weather2: the minutes, or a story { start, step, lasts }
/** The spoken line: "Radiation in twenty minutes.", "Radiation now." (Lodestar's clips, design/sound/scripts/voice.py); in
 *  Plain "Rain in twenty minutes.", "Rain now.". W201 weather2: for a story (RainWatch's), its strength and length after it:
 *  "Rain in five minutes. Light, for about ten minutes.", "Radiation now. Heavy, likely until about nine." */
export const radiationVoice = (s, mode) => { // W60 c: mode
  const m = startOf(s), head = m <= 0 ? say("voiceNow", mode) : say("voiceIn", mode)(WORDS[round5(m)]);
  if (typeof s === "number" || s.step == null) return head;
  const how = STRENGTHS[s.step], tail = lastsVoice(s.lasts); // W201 weather2
  return `${head} ${how[0].toUpperCase()}${how.slice(1)}${tail ? `, ${tail}` : ""}.`; // W201 weather2
};
/** The banner's words: "Radiation in 20 min", "Radiation now"; in Plain "Rain in 20 min", "Rain now". W201 weather2: for a
 *  story, as the chip's line says it: "Rain in 5 min, light, for about 10 min". */
export const radiationText = (s, mode) => { // W60 c: mode
  const m = startOf(s), head = m <= 0 ? say("textNow", mode) : say("textIn", mode)(round5(m));
  if (typeof s === "number" || s.step == null) return head;
  return [head, STRENGTHS[s.step], lastsLine(s.lasts, (ms) => clockAt(new Date(ms)))].filter(Boolean).join(", "); // W201 weather2
};

/** W201 weather2: a story's start or end that moves this far (by the clock) is a new story; a band's lines this far apart at least. */
export const SHIFT_MIN = 10, RESAY_MIN = 5;
/** W201 weather2: a story as the clock reads it, so the minutes counting down don't change it: its start and end (ms), its step and
 *  its length's kind (and hour). Raining at the ship, its start is when it came (`wet`, ms), not the clock moving on. */
const told = (s, t, wet) => { const from = t + Math.max(0, s.start) * 60000, l = s.lasts || {}; return { at: wet ?? from, end: from + (s.dur ?? 0) * 60000, step: s.step, kind: l.until ? "until" : l.day ? "day" : l.hour ? "hour" : l.more ? "more" : "min", until: l.until }; };
const near = (a, b) => Math.abs(a - b) < SHIFT_MIN * 60000;
const LENGTHS = new Set(["hour", "min", "more"]); // W201 weather2 (its second review's P1): the radar's lengths, which can count down into one another
const same = (a, b) => a.step === b.step && near(a.at, b.at) && (a.kind === b.kind
  ? (a.kind === "until" ? a.until === b.until : a.kind === "min" || a.kind === "more" ? near(a.end, b.end) : true)
  : LENGTHS.has(a.kind) && LENGTHS.has(b.kind) && near(a.end, b.end)); // "for an hour or more" counting down to "for about 55 min" is the same rain when its end hasn't moved

/**
 * Once a band. `update(s, t)`: `s` the first rain due (at the spot or on the course): its story { start (minutes), dur, step,
 * lasts } (W201 weather2: weather.story()'s; or the minutes alone), or null for none within the hour; `t` ms. Returns "ahead" or
 * "now" when a line is due, else null. A band says it once, when rain is due within WITHIN_MIN; W201 weather2: and again only when
 * the story changes (its start or end moved SHIFT_MIN minutes, its strength or the kind of its length; not the minutes counting
 * down, nor its coming as said), at most every RESAY_MIN minutes. It ends after RESET_MIN minutes with none due.
 */
export class RainWatch {
  constructor() { this.band = null; }
  update(s, t) {
    if (typeof s === "number") s = { start: s }; // W201 weather2: the minutes alone, a story with nothing more to tell
    const due = s != null && s.start <= WITHIN_MIN;
    if (!due) {
      if (this.band) this.band.wet = null; // W201 weather2 (its second review's P2): a dry spell with no rain due ends the rain's start, as a pause past 5 min does
      if (this.band && this.band.dry == null) this.band.dry = t;
      if (this.band && t - this.band.dry >= RESET_MIN * 60000) this.band = null;
      return null;
    }
    if (!this.band) this.band = { said: null, at: -Infinity, dry: null, wet: null }; // W201 weather2: the story said, and when; when the rain came to the ship
    this.band.dry = null;
    this.band.wet = s.start <= 0 ? this.band.wet ?? t : s.start <= 5 ? this.band.wet : null; // W201 weather2 (its review's P1): raining here, the same story as long as it lasts, a pause of 5 min or less too (onsetOf()'s gap)
    const now = told(s, t, this.band.wet);
    if (this.band.said && (same(this.band.said, now) || t - this.band.at < RESAY_MIN * 60000)) return null; // W201 weather2
    this.band.said = now; this.band.at = t;
    return s.start <= 0 ? "now" : "ahead";
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
 * or null, `along(pts)`; W201 weather2: `story()` and `alongStory(pts)`, the story there); `flying()`; `course()`: { course, s, v }
 * or null; `ship()`: [lon, lat] or null; `fire(detail)`; W201 weather2: `warm(line)`, its lazy clips fetched.
 */
export function mountRadiation({ weather, flying, course, ship, fire, now = () => Date.now(), every = LOOK_MS, warm = () => {} }) { // W201 weather2: warm(line), sfx.js's
  const watch = new RainWatch();
  let looking = false, said = null, warmed = ""; // W102 winter: the winter alert said in this flight; W201 weather2: the line whose clips were fetched
  async function look() {
    if (!flying()) said = null; // W102 winter: landed: a new flight says it again
    if (looking || !flying() || !weather.on) return;
    looking = true;
    try {
      const a = weather.winter, key = a?.level === "warning" && winterOn(a, now()) && a.event; // W102 winter: a warning in effect, once a flight, as it launches or when it comes (an advisory or a watch stays on the chip); an extended or reissued one isn't new
      if (key && key !== said) { said = key; fire({ kind: "radiation", text: winterLine(a), voice: winterVoice(a), data: { stage: "winter", winter: a.kind, level: a.level } }); }
      const here = ship();
      let s = here ? await weather.story() : null; // W201 weather2: the story at the spot (was its minutes, onset())
      const c = course();
      if (c && here) {
        const a = await weather.alongStory(aheadPoints(c.course, c.s, c.v, here)); // W201 weather2: and where the course meets it
        if (a && (s == null || a.story.start < s.start)) s = a.story;
      }
      if (!flying()) return;
      if (s) s = { ...s, start: Math.round(s.start) };
      if (s && s.start <= 60 && `${s.step}|${lastsVoice(s.lasts)}` !== warmed) { warmed = `${s.step}|${lastsVoice(s.lasts)}`; warm(radiationVoice(s)); } // W201 weather2: its lazy clips (voice.py RAIN_CLIPS) fetched before it's due, once a story
      const stage = watch.update(s, now());
      if (stage) fire({ kind: "radiation", text: radiationText(s), voice: radiationVoice(s), data: { stage, min: stage === "now" ? 0 : round5(s.start), step: s.step, lasts: s.lasts, short: radiationText(s.start) } }); // W201 weather2: the story, and its head alone where the whole would reach the ship (banners.js PillQueue)
    } finally { looking = false; }
  }
  const timer = setInterval(look, every);
  return { look, watch, stop: () => clearInterval(timer) };
}
