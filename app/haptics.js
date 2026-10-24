// W69 motion (design/app-ui/SPEC.md §107): haptics, one small vocabulary for the whole app.
//
//   hold        a long press taking: 10 ms, so the finger knows the hold took (W88 settings3: the one buzz outside a ride)
//   port        in flight, a turn to the left: one long buzz ("left is long"); off by default (Settings › Sound › Vibrate at turns)
//   starboard   in flight, a turn to the right: two short ones
//   off         in flight, the off-course heads-up: three short ones, once a spell; with the turns' row (W76 look, D14d)
//
// W88 settings3 (SPEC §175): taps no longer buzz, nor Launch, Land and Undo, and Vibrate on taps (starchart.haptics) went:
// the screen already answers a tap, so the buzz told nothing. tick() and pulse() stay, as nothing, for their callers.
// Where it buzzes: Android (Chrome), through navigator.vibrate. Elsewhere nothing can: iOS has no vibration API, and its
// hidden-switch haptic, which served only taps, went with them.
// It never buzzes in the background, nor before the first tap. No browser exposes the phone's own touch-feedback setting.
export const TURNS = "starchart.haptics.turns"; // its values are app/settings.js KEYS'; W88 settings3: KEY, Vibrate on taps', went
export const PATTERNS = { hold: 10, port: [220], starboard: [70, 90, 70], off: [50, 70, 50, 70, 50] }; // W76 look: off; W88 settings3: hold, and no tick or pulse

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
