// W20 chrome: what the screen says while GPS has no fix: the line by the location button, the Position row
// in Settings, and the GPS line of the frame overlay. Positions that come but are all too rough to fly on
// (over 50 m: Android's approximate location, in a browser that may use only that) used to read as
// "searching" for ever. arclight met it on the ?perf=1 page, which he opened in a browser tab rather
// than in the installed app.
import { MAX_ACCURACY_M } from "./position.js";
import { dur } from "./duration.js"; // W68 fixes

export const NOFIX_MS = 15000; // no position at all: say so after this long (W150 gpshelp: was 20 s), and the steps open
export const FIND_MS = 2000; // W150 gpshelp: no position yet: "Finding your position…" from this long (a quick fix never flashes it)
export const ROUGH_MS = 5000; // only rough ones: say so after this long, since the first fixes are often rough
export const LOST_MS = 5000; // W21 flight: in flight, no fix for this long is GPS lost
export const NO_SIGNAL = "No GPS signal yet.", FINDING = "Finding your position…"; // W150 gpshelp

/** W21 flight: in flight on GPS, the ms since the last fix (or since Launch, before the first), once that is LOST_MS; else 0. */
export const lostMs = ({ sim, flying, now, since }) => (!sim && flying && now - since >= LOST_MS ? now - since : 0);
/** "12 s", then "3 min", then "1h 20m" (W68 fixes). */
const ago = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : dur(Math.floor(ms / 60000))); // W68 fixes: dur

/** The best accuracy, in metres, of the raw fixes in `log` when none was good enough to use (`fix` null); else null. */
export function roughM(log, fix) {
  if (fix || !log?.length) return null;
  return Math.round(Math.min(...log.map((f) => f.accuracy)));
}

/** The line by the location button, or "" for none. `now` and the log's times are on the pose's clock (ms); `since`, when GPS
 *  started (W150 gpshelp: after the welcome, or Try again). */
export function noFixLine({ sim, shown, gps, now, log, fix, since = 0 }) {
  if (sim || shown || gps !== "waiting") return "";
  const r = roughM(log, fix);
  if (r !== null && now - log[0].t >= ROUGH_MS) return `Only a rough position, ±${r} m. Is precise location on for this browser?`;
  return now - since >= NOFIX_MS ? NO_SIGNAL : now - since >= FIND_MS ? FINDING : ""; // W150 gpshelp: her "no GPS signal yet"; looking, meanwhile
}

/** W21 glass: the line as a notice (app/notice.js): { id, text }, or id "" for none. Each of the two has its own id,
 *  so hiding "No GPS signal yet." for good still lets the rough-position line through. */
export function noFixNotice(o) {
  const text = noFixLine(o);
  if (o.lost && !text.startsWith("Only")) return { id: "gps-lost", text: `${o.shown ? "GPS lost" : "No GPS signal yet"} · ${ago(o.lost)}` }; // W21 flight
  return { id: !text ? "" : text.startsWith("Only") ? "rough-position" : text === FINDING ? "finding" : "no-fix", text }; // W150 gpshelp: finding
}

/** W150 gpshelp: where to allow location for this site, in each browser of the install guide (app/install.js detect()'s tab). */
const ALLOW = {
  "chrome-android": "In Chrome, tap the icon left of the address, then Permissions, then Location.",
  "edge-android": "In Edge, tap the icon left of the address, then allow Location.",
  samsung: "In Samsung Internet, tap the icon left of the address, then allow Location.",
  "firefox-android": "In Firefox, tap the lock left of the address, then allow Location.",
  ios: "In Safari, tap ⋯ (or aA) by the address, then Website Settings, and allow Location.",
  "ios-chrome": "In the iPhone's Settings, tap Apps, then Chrome, then Location, and allow it.",
  chrome: "In Chrome, click the icon left of the address, then allow Location.",
  edge: "In Edge, click the icon left of the address, then allow Location.",
  firefox: "In Firefox, click the icon left of the address, then allow Location.",
  "safari-mac": "In Safari, open Settings, then Websites, then Location, and allow this site.",
};
/** W150 gpshelp (her note: "either say that it's loading, or include suggestions on how to fix it"): the no-location sheet's
 *  words for `cause` ("denied" | "unavailable" | "timeout": 15 s and no position | "insecure"): { why, steps }, steps short, in
 *  the order to try them, before Try again. `tab` and `platform` are app/install.js detect()'s, `installed` the app on the home
 *  screen, `plain` Plain's words. */
export function noGpsHelp(cause, { tab = "", platform = "", installed = false, plain = false } = {}) {
  const device = platform === "computer" ? "computer" : plain ? "phone" : "droid";
  const turnOn = platform === "ios" ? `Turn on Location Services in your ${device}'s Settings, under Privacy & Security.` : `Turn on Location in your ${device}'s settings.`;
  const allow = installed ? `Allow location for Starchart in your ${device}'s settings.` : ALLOW[tab] ?? "Allow location for this site in your browser's settings.";
  const outside = "Step outside, or near a window.";
  if (cause === "insecure") return { why: "GPS needs a secure page (https). This page was opened over plain http, so the browser keeps the position from it.", steps: [] };
  if (cause === "denied") return { why: `Location isn't allowed for Starchart. Your position never leaves this ${device}.`, steps: [turnOn, allow] }; // W76 privacy (D1): the privacy line
  if (cause === "unavailable") return { why: `This ${device} gave no position.`, steps: [turnOn, outside] };
  if (cause === "timeout") return { why: NO_SIGNAL, steps: [turnOn, outside] };
  return null;
}

/** W21 flight: back from a screen lock or the background after `ms` mid-flight, on GPS: the calls and the track stopped. */
export const screenOffLine = (ms) => `Screen off ${ago(ms)}: no calls or track.`; // W29 polish: the trail shows the gap

/** W21 flight: the Position row's words in flight with no fix for `lost` ms. */
export const lostWords = (lost) => `GPS lost: no signal for ${ago(lost)}.`; // W150 gpshelp: signal

/** The Position row's words while GPS waits (W150 gpshelp: "no signal yet", was "searching"). */
export function waitingWords(log, fix) {
  const r = roughM(log, fix);
  return r === null ? "GPS, no signal yet." : `GPS, rough position only (±${r} m). Is precise location on for this browser?`;
}

/** The frame overlay's GPS line: the state, and the last position's accuracy and age. */
export function gpsLine({ gps, log, now }) {
  const f = log?.at(-1);
  if (!f) return `gps      ${gps}, no position yet`;
  const age = Math.max(0, Math.round((now - f.t) / 1000));
  return `gps      ${gps}, ±${Math.round(f.accuracy)} m ${age} s ago${f.accuracy > MAX_ACCURACY_M ? ": too rough" : ""}`;
}
