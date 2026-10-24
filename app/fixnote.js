// W20 chrome: what the screen says while GPS has no fix: the line by the location button, the Position row
// in Settings, and the GPS line of the frame overlay. Positions that come but are all too rough to fly on
// (over 50 m: Android's approximate location, in a browser that may use only that) used to read as
// "searching" for ever. arclight met it on the ?perf=1 page, which he opened in a browser tab rather
// than in the installed app.
import { MAX_ACCURACY_M } from "./position.js";
import { dur } from "./duration.js"; // W68 fixes

export const NOFIX_MS = 20000; // no position at all: say so after this long
export const ROUGH_MS = 5000; // only rough ones: say so after this long, since the first fixes are often rough
export const LOST_MS = 5000; // W21 flight: in flight, no fix for this long is GPS lost

/** W21 flight: in flight on GPS, the ms since the last fix (or since Launch, before the first), once that is LOST_MS; else 0. */
export const lostMs = ({ sim, flying, now, since }) => (!sim && flying && now - since >= LOST_MS ? now - since : 0);
/** "12 s", then "3 min", then "1h 20m" (W68 fixes). */
const ago = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : dur(Math.floor(ms / 60000))); // W68 fixes: dur

/** The best accuracy, in metres, of the raw fixes in `log` when none was good enough to use (`fix` null); else null. */
export function roughM(log, fix) {
  if (fix || !log?.length) return null;
  return Math.round(Math.min(...log.map((f) => f.accuracy)));
}

/** The line by the location button, or "" for none. `now` and the log's times are on the pose's clock (ms). */
export function noFixLine({ sim, shown, gps, now, log, fix }) {
  if (sim || shown || gps !== "waiting") return "";
  const r = roughM(log, fix);
  if (r !== null && now - log[0].t >= ROUGH_MS) return `Only a rough position, ±${r} m. Is precise location on for this browser?`;
  return now >= NOFIX_MS ? "No GPS fix yet." : "";
}

/** W21 glass: the line as a notice (app/notice.js): { id, text }, or id "" for none. Each of the two has its own id,
 *  so hiding "No GPS fix yet." for good still lets the rough-position line through. */
export function noFixNotice(o) {
  const text = noFixLine(o);
  if (o.lost && !text.startsWith("Only")) return { id: "gps-lost", text: `${o.shown ? "GPS lost" : "No GPS fix yet"} · ${ago(o.lost)}` }; // W21 flight
  return { id: !text ? "" : text.startsWith("Only") ? "rough-position" : "no-fix", text };
}

/** W21 flight: back from a screen lock or the background after `ms` mid-flight, on GPS: the calls and the track stopped. */
export const screenOffLine = (ms) => `Screen off ${ago(ms)}: no calls or track.`; // W29 polish: the trail shows the gap

/** W21 flight: the Position row's words in flight with no fix for `lost` ms. */
export const lostWords = (lost) => `GPS lost: no fix for ${ago(lost)}.`;

/** The Position row's words while GPS waits. */
export function waitingWords(log, fix) {
  const r = roughM(log, fix);
  return r === null ? "GPS, searching." : `GPS, rough position only (±${r} m). Is precise location on for this browser?`;
}

/** The frame overlay's GPS line: the state, and the last position's accuracy and age. */
export function gpsLine({ gps, log, now }) {
  const f = log?.at(-1);
  if (!f) return `gps      ${gps}, no position yet`;
  const age = Math.max(0, Math.round((now - f.t) / 1000));
  return `gps      ${gps}, ±${Math.round(f.accuracy)} m ${age} s ago${f.accuracy > MAX_ACCURACY_M ? ": too rough" : ""}`;
}
