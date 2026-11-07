// W69 motion (design/app-ui/SPEC.md §107): haptics, one small vocabulary for the whole app.
//
//   hold        a long press taking: 10 ms, so the finger knows the hold took (W88 settings3: the one buzz outside a ride)
//   port        in flight (a ride or a walk), a turn to the left: one long buzz ("left is long"); off by default (Settings › Sound › Vibrate at turns)
//   starboard   in flight, a turn to the right: two short ones
//   off         in flight, the off-course heads-up: many short ones (W157 avatars5: five, was three, close to starboard's two; W166 haptics2: six, quicker than starboard's),
//               with the turns' row (W76 look, D14d); W128 navcalls: again
//               every 5 s until back on course, Keep course, a touch or the page back in view (app/course.js)
//
// W88 settings3 (SPEC §175): taps no longer buzz, nor Launch, Land and Undo, and Vibrate on taps (starchart.haptics) went:
// the screen already answers a tap, so the buzz told nothing. tick() and pulse() stay, as nothing, for their callers.
// Where it buzzes: Android (Chrome), through navigator.vibrate. Elsewhere nothing can: iOS has no vibration API, and its
// hidden-switch haptic, which served only taps, went with them.
// It never buzzes in the background, nor before the first tap. No browser exposes the phone's own touch-feedback setting.
export const TURNS = "starchart.haptics.turns"; // its values are app/settings.js KEYS'; W88 settings3: KEY, Vibrate on taps', went
// W166 haptics2 (SPEC §293, her note: "barely perceptible", off route "just feels like two buzzes"): felt in a pocket. The web
// has no strength, only time, so the turns' pulses are long: Android's own notification buzz is 350 ms twice, 250 ms apart
// (AOSP config_defaultNotificationVibePattern), and its haptics guide says a motor rings at least 50 ms after a pulse, and a gap is
// felt from 50 ms. Port 600 ms; starboard two 200 ms, 200 ms apart; off six 150 ms, 100 ms apart: a run, never "two".
// Chrome on Android never buzzes with the ringer on silent (VibrationManagerAndroid.java), and says nothing: Settings says so.
export const PATTERNS = { hold: 10, port: [600], starboard: [200, 200, 200], off: [150, 100, 150, 100, 150, 100, 150, 100, 150, 100, 150] }; // W76 look: off; W88 settings3: hold, and no tick or pulse; W157 avatars5: off, five short (was three); W166 haptics2: longer

const g = globalThis;
const read = (k, d) => { try { return g.localStorage?.getItem(k) ?? d; } catch { return d; } };

/** How this browser can buzz: "vibrate" (Android), "switch" (iOS's switch haptic, on a touch screen), or "" (nothing). */
export function can(env = g) {
  if (typeof env.navigator?.vibrate === "function") return "vibrate";
  const touch = env.matchMedia?.("(pointer: coarse)").matches;
  return touch && env.HTMLInputElement && "switch" in env.HTMLInputElement.prototype ? "switch" : "";
}

/** Buzz `kind` (a PATTERNS key). Returns whether it asked the phone to. */
export function haptic(kind, env = g) {
  const pattern = PATTERNS[kind];
  if (pattern === undefined) return false;
  if (kind !== "hold" && read(TURNS, "off") !== "on") return false; // W76 look: the heads-up buzzes with the turns, never without; W88 settings3: a hold always
  const doc = env.document;
  if (doc && doc.visibilityState && doc.visibilityState !== "visible") return false; // never in the background
  const ua = env.navigator?.userActivation;
  try {
    if (can(env) === "vibrate") return ua && !ua.hasBeenActive ? false : env.navigator.vibrate(pattern) !== false; // Chrome refuses before the first tap; W88 settings3: no iOS switch
  } catch { /* not allowed here */ }
  return false;
}

/** A turn's side, for its buzz: "port" for any left, "starboard" for any right, "" for the rest (straight on, arrive). */
export const turnSide = (turn = "") => (/left/.test(turn) ? "port" : /right/.test(turn) ? "starboard" : "");

export const tick = () => false; // W88 settings3: a tap's buzz went (SPEC §175)
export const pulse = () => false; // W88 settings3: Launch's, Land's and Undo's went
