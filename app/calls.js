// Sound (wave 28; the Calls of wave 18 before it): one choice of three, design/app-ui/SPEC.md §38.
//
//   starchart.sound = all (the default) | directions | off
//
//   - Off is silent running: no effects, no voice.
//   - Directions: Lodestar says the lines a pilot rides by, the course and the hazards (DIRECTIONS below).
//   - All, "Directions with chatter": every line, and the colour lines at one rate (app/chatter.js).
//   - W86 settings: the sounds that answer a tap (TAPS below) play only in All, so Directions is spoken directions and the
//     chimes that tell of the road; Plain calls All "All sounds".
//   - W128 navcalls (SPEC §237): on the screen, in both modes, Off, Basic directions (directions) and Detailed directions (all);
//     Detailed also says "Still on course." on a long steady stretch (kind on_course).
//
// W177 buttons2 (SPEC §312), her notes 3 and 11: a tap on the sound button steps Off, Basic, Detailed and back to Off
// (cycleSound), in flight as parked; its icon shows the mode, with no bubble, no chooser and no Settings row, and going to
// Basic or Detailed plays its short cue (CUES), Off none. Before, a tap was Off or the last mode on, and a long press opened
// a chooser of the three (W28; W75 chrome: with Settings at its foot in flight). A mode keeps every banner and effect; it decides only which lines are spoken,
// in the speech path (spoken(), design/sound/sfx.js's setVoiceFilter). Without a course there are no turns, so a
// pilot riding with a group hears the hazards, and the chatter if they chose it.
//
// The keys before wave 28 are read once (migrateSound): muted becomes off, chatter off becomes directions, and
// anything else all.
import { KEYS, get, set } from "./settings.js";
import { pick } from "./lingo-mode.js"; // W86 settings: Plain's "All sounds"

export const SOUND = "starchart.sound", SOUND_ON = "starchart.sound.on"; // their values are in app/settings.js KEYS
/** The three modes, as Settings shows them (W177 buttons2: and the sound button steps through): `short` fits Settings' row at 320 px. */
export const MODES = [
  { v: "off", label: "Off", short: "Off" },
  { v: "directions", label: "Basic directions", short: "Basic" }, // W128 navcalls (SPEC §237): her words, in both modes; the stored values stay
  { v: "all", label: "Detailed directions", short: "Detailed" }, // W128 navcalls: was "Directions with chatter" (Plain's "All sounds")
];
/** W86 settings: a mode's label in the Words mode: Plain's All is "All sounds". */
export const modeLabel = (m, short = false) => (m.plain ? pick(short ? m.short : m.label, m.plain) : short ? m.short : m.label);

/**
 * Every spoken kind, as directions or chatter. Directions: the course (turns, off course, "you have the conn",
 * touchdown, which is course complete) and the hazards (pulsars, black holes, transport lanes and the rest, g-wells).
 * Chatter: places, light years, wormholes and byways; and the colour lines, which app/chatter.js says only in All.
 * app/tests/calls.test.mjs reads every spoken kind from its source and fails if one is missing here.
 */
export const KIND_GROUP = {
  // the course (app/course.js, and the engine's lines for a set course)
  course_turn: "directions", launch: "directions", touchdown: "directions", starpath: "directions",
  // the hazards: the safety lines, and the surfaces and roads to watch for
  black_hole_ahead: "directions", pulsar_ahead: "directions", black_hole: "directions", pulsar: "directions",
  transport_lane: "directions", buoy_field: "directions", space_dust: "directions", space_walk: "directions", deep_space: "directions",
  negi_g_well: "directions", posi_g_well: "directions", g_well: "directions",
  radiation: "directions", steps_ahead: "directions", // W54 flight: the rain ahead, and steps on the course
  space_junk: "directions", tracks_ahead: "directions", // W67 graph3: a barrier and tracks on the course
  stop_ahead: "directions", // W86 stops: a stop sign on the course
  bus_stop_ahead: "directions", // W93 busstop: a bus stop beside the bike lane
  crossing_ahead: "directions", // W128 crashes: a high-crash crossing on the course
  // bike paths and bridges
  wormhole_enter: "chatter", wormhole_exit: "chatter", byway_enter: "chatter",
  wormhole: "chatter", hyper_wormhole: "chatter", hyperspace_byway: "chatter",
  // where you are
  system_enter: "chatter", quadrant_enter: "chatter", constellation: "chatter",
  system: "chatter", quadrant: "chatter", galaxy: "chatter", asteroid_belt: "chatter", heavy_nebula: "chatter",
  grenade_depot: "chatter", shore_leave: "chatter", fort: "chatter",
  // the odometer, and Lodestar's asides
  light_year: "chatter", colour: "chatter",
  on_course: "chatter", // W128 navcalls: "Still on course.", Detailed only
  daystar_set: "chatter", // W73 dark: lights on at sunset, once a flight (app/dusk.js); chatter, so no cue by default (arclight: "facts only")
};

/**
 * W86 settings: the sounds that answer a tap, played only in All ("Directions with chatter", Plain's "All sounds"): Launch's
 * lift-off (its line stays a direction), a card picked (W160 smallui: nothing plays it now, §287), Land's sound and the
 * tallies. The chimes that tell of the road (a hazard ahead, a re-plot, back on course, the touchdown at the course's end)
 * stay in Directions. W177 buttons2: the sound button's own cue is CUES', in both modes on.
 */
export const TAPS = new Set(["launch", "card_pick", "arrive", "sticker_slap", "christening", "hi_five", "cup_crush"]);
/** W177 buttons2 (SPEC §312), her note 11: "no sound when the voice setting goes to mute. Just play sounds when it goes to basic
 *  directions and detailed directions": each mode's cue, as design/sound/sfx.js effects with their start in s; Off has none.
 *  Basic is the unmute's glide up; Detailed the same glide and a blip on top, one step more. */
export const CUES = { off: [], directions: [["silent_running_off", 0]], all: [["silent_running_off", 0], ["ui_tap", 0.3]] };

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
/** The keys before wave 28 to starchart.sound, once: muted is off, chatter off is directions, anything else all. */
export function migrateSound(s = store()) {
  try {
    if (!s || s.getItem(SOUND) !== null) return;
    if (s.getItem("starchart.chatter") === null && s.getItem("starchart.muted") === null) return; // a new install: the default (W56 voice2: Directions; W157 landmarks: Detailed again)
    const directions = s.getItem("starchart.chatter") === "off";
    s.setItem(SOUND_ON, directions ? "directions" : "all");
    s.setItem(SOUND, s.getItem("starchart.muted") === "1" ? "off" : directions ? "directions" : "all");
  } catch { /* storage off: the default */ }
}
migrateSound();

let visit = null; // ?muted=1: off for this visit, until the pilot picks
/** Start this visit silent, without keeping it (?muted=1). */
export const muteVisit = () => { visit = "off"; };
/** The mode now: "off", "directions" or "all". */
export const soundMode = () => visit ?? get(SOUND);
/** Set the mode; one that is on is the one a tap on the sound button comes back to. */
export function setSound(v) {
  if (!KEYS[SOUND].includes(v)) return soundMode();
  visit = null;
  if (v !== "off") set(SOUND_ON, v);
  return set(SOUND, v);
}
/** W177 buttons2 (SPEC §312): the sound button's tap, the next of Off, Basic and Detailed, round again. */
export const cycleSound = () => setSound(MODES[(MODES.findIndex((m) => m.v === soundMode()) + 1) % MODES.length].v);
/** W177 buttons2: the sound button's name for a screen reader, the mode it shows: "Sound: Basic directions". */
export const soundWords = (m = soundMode()) => { const x = MODES.find((y) => y.v === m); return `Sound: ${x ? modeLabel(x) : m}`; }; // W86 settings: modeLabel

/** Is a line of this kind spoken now? Read at every line, so a change takes effect at once. Off is silent running
 *  (the mute), so here it answers as the mode it comes back to. Unknown kinds are spoken. */
export function spoken(kind) {
  const m = soundMode() === "off" ? get(SOUND_ON) : soundMode();
  return m === "all" || KIND_GROUP[kind] !== "chatter";
}
/** W157 landmarks (SPEC §279): is Detailed on (or the mode Off comes back to)? Its turns name a landmark (app/landmarks.js). */
export const detailed = () => (soundMode() === "off" ? get(SOUND_ON) : soundMode()) === "all";
/** W86 settings: does a kind's effect play now? A spoken kind's, unless it answers a tap (TAPS) and the mode isn't All. */
export function sounded(kind) {
  const m = soundMode() === "off" ? get(SOUND_ON) : soundMode();
  return spoken(kind) && (m === "all" || !TAPS.has(kind));
}

/**
 * W60 d: the lingo mode's own lines, kept for flights with no signal. build.json `voice` lists each mode's eager lines; the
 * service worker's install precaches the mode the page last chose (cache "starchart.lingo", key "mode"), and keeps any
 * line it left out the first time one is fetched (sw.js). So this tells it the mode, then fetches that mode's lines it
 * doesn't have yet, one at a time: after a change of mode the new mode's lines come down once, and a SCUL pilot never
 * downloads Plain's, nor the reverse. `url(p)`: a path's address in the app. A newer call stops an older one. Resolves to
 * the number fetched.
 */
let warming = 0;
export async function warmVoice(mode, { build, url = (p) => p, get = (u) => fetch(u), store = globalThis.caches } = {}) {
  const id = ++warming, m = mode === "meatspace" ? "meatspace" : "scul";
  if (!store) return 0;
  await keepLingo(m, { url, store });
  let n = 0;
  for (const p of build?.voice?.[m] || []) {
    if (id !== warming) break;
    if (await store.match(url(p)) || await store.match(url(`voice-cache/${build.files[p]}`))) continue; // precached, or kept
    try { if ((await get(url(p))).ok) n++; } catch { break; } // no signal: the rest wait for the next time
  }
  return n;
}

/** W60 d: tell the service worker's next install the lingo mode (before it registers, so a first install knows it too). */
export async function keepLingo(mode, { url = (p) => p, store = globalThis.caches } = {}) {
  await (await store?.open("starchart.lingo"))?.put(url("mode"), new Response(mode === "meatspace" ? "meatspace" : "scul"));
}
