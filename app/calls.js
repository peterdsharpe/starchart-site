// Sound (wave 28; the Calls of wave 18 before it): one choice of three, design/app-ui/SPEC.md §38.
//
//   starchart.sound = all (the default) | directions | off
//
//   - Off is silent running: no effects, no voice.
//   - Directions: Lodestar says the lines a pilot rides by, the course and the hazards (DIRECTIONS below).
//   - All, "Directions with chatter": every line, and the colour lines at one rate (app/chatter.js).
//   - W86 settings: the sounds that answer a tap (TAPS below) play only in All, so Directions is spoken directions and the
//     chimes that tell of the road; Plain calls All "All sounds".
//
// A tap on the sound button switches between Off and the last mode that was on (starchart.sound.on); a long press
// opens the chooser (mountSoundPick). A mode keeps every banner and effect; it decides only which lines are spoken,
// in the speech path (spoken(), design/sound/sfx.js's setVoiceFilter). Without a course there are no turns, so a
// pilot riding with a group hears the hazards, and the chatter if they chose it.
//
// The keys before wave 28 are read once (migrateSound): muted becomes off, chatter off becomes directions, and
// anything else all.
import { KEYS, get, set } from "./settings.js";
import { layoutRect } from "./tip.js"; // W26 hold
import { pick } from "./lingo-mode.js"; // W86 settings: Plain's "All sounds"

export const SOUND = "starchart.sound", SOUND_ON = "starchart.sound.on"; // their values are in app/settings.js KEYS
/** The three modes, as the chooser and Settings show them: `short` fits Settings' row at 320 px. */
export const MODES = [
  { v: "off", label: "Off", short: "Off" },
  { v: "directions", label: "Directions", short: "Directions" },
  { v: "all", label: "Directions with chatter", short: "With chatter", plain: "All sounds" }, // W86 settings: plain, Plain's label and short
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
  // bike paths and bridges
  wormhole_enter: "chatter", wormhole_exit: "chatter", byway_enter: "chatter",
  wormhole: "chatter", hyper_wormhole: "chatter", hyperspace_byway: "chatter",
  // where you are
  system_enter: "chatter", quadrant_enter: "chatter", constellation: "chatter",
  system: "chatter", quadrant: "chatter", galaxy: "chatter", asteroid_belt: "chatter", heavy_nebula: "chatter",
  grenade_depot: "chatter", shore_leave: "chatter", fort: "chatter",
  // the odometer, and Lodestar's asides
  light_year: "chatter", colour: "chatter",
  daystar_set: "chatter", // W73 dark: lights on at sunset, once a flight (app/dusk.js); chatter, so no cue by default (arclight: "facts only")
};

/**
 * W86 settings: the sounds that answer a tap, played only in All ("Directions with chatter", Plain's "All sounds"): Launch's
 * lift-off (its line stays a direction), a card picked, Land's sound, the tallies and the sound button's own cue. The chimes
 * that tell of the road (a hazard ahead, a re-plot, back on course, the touchdown at the course's end) stay in Directions.
 */
export const TAPS = new Set(["launch", "card_pick", "arrive", "sticker_slap", "christening", "hi_five", "cup_crush", "silent_running"]);

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
/** The keys before wave 28 to starchart.sound, once: muted is off, chatter off is directions, anything else all. */
export function migrateSound(s = store()) {
  try {
    if (!s || s.getItem(SOUND) !== null) return;
    if (s.getItem("starchart.chatter") === null && s.getItem("starchart.muted") === null) return; // a new install: the default, Directions (W56 voice2)
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
/** The sound button's tap: Off, or back to the last mode that was on. */
export const toggleSound = () => setSound(soundMode() === "off" ? get(SOUND_ON) : "off");
/** W34 cues: what the tap did, for its bubble: "Sound off." or "Sound on: Directions." */
export const soundWords = (m = soundMode()) => { const x = MODES.find((y) => y.v === m); return m === "off" ? "Sound off." : `Sound on: ${x ? modeLabel(x) : m}.`; }; // W86 settings: modeLabel

/** Is a line of this kind spoken now? Read at every line, so a change takes effect at once. Off is silent running
 *  (the mute), so here it answers as the mode it comes back to. Unknown kinds are spoken. */
export function spoken(kind) {
  const m = soundMode() === "off" ? get(SOUND_ON) : soundMode();
  return m === "all" || KIND_GROUP[kind] !== "chatter";
}
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

/** W75 chrome (SPEC §131): the chooser's foot in flight, and the tip that says where Settings went (one word in both modes). */
export const WORDS = { settings: "Settings", tip: "Hold Sound for Settings.", hold: "Hold for the sound choices and Settings." }; // W75 chrome: hold is Sound's aria-description in flight

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

/**
 * The chooser a long press on the sound button opens: the three modes, above the button (in the bar's corner or in
 * flight's right column). A pick closes it; so do its ×, a tap outside it, Escape and Android's back gesture.
 * W75 chrome: with `settings`, a Settings row at its foot opens Settings; app/calls.css shows it in flight only, where
 * the gear is away.
 */
export function mountSoundPick({ button, settings = null }) {
  let pop = null, watch = null;
  const close = () => {
    if (!pop || pop.hidden) return;
    if (pop.contains(document.activeElement)) button.focus(); // W75 chrome: a keyboard's focus goes back to Sound
    pop.hidden = true;
    watch?.destroy(); watch = null;
  };
  const show = () => { for (const b of pop.querySelectorAll("[role=radio]")) { b.setAttribute("aria-checked", String(b.dataset.v === soundMode())); b.querySelector(".txt").textContent = modeLabel(MODES.find((m) => m.v === b.dataset.v)); } }; // W86 settings: the label in the Words mode now
  function place() { // W40 maplayout: from open(), and again at a resize
    const r = layoutRect(button); // W26 hold: not its swell, which a long press opens this in
    pop.style.setProperty("--above", `${innerHeight - r.top + 6}px`);
    pop.style.setProperty("--right", `${innerWidth - r.right}px`);
    pop.style.setProperty("--foot", `${innerHeight - r.bottom}px`); // W75 chrome: in flight, beside the button (calls.css)
    pop.style.setProperty("--beside", `${innerWidth - r.left + 8}px`); // W75 chrome
  }
  function open() {
    if (!pop) {
      const list = el("div", { className: "group", role: "radiogroup", ariaLabel: "Sound" },
        ...MODES.map((m) => {
          const b = el("button", { className: "row", type: "button" }, el("span", { className: "txt", textContent: modeLabel(m) }), el("i", { className: "i i-check" }));
          b.dataset.v = m.v;
          b.setAttribute("role", "radio");
          b.onclick = () => { setSound(m.v); show(); close(); };
          return b;
        }));
      pop = el("div", { id: "soundpick", role: "dialog", ariaLabel: "Sound", hidden: true },
        el("button", { className: "x", ariaLabel: "Close", innerHTML: '<i class="i i-close"></i>', onclick: () => close() }), el("h2", { textContent: "Sound" }), list); // W92 panels: the × first, so it stays at the top as the card scrolls (calls.css)
      if (settings) pop.append(el("button", { className: "row set", type: "button", onclick: () => { close(); button.focus(); settings(); } }, // W75 chrome: Settings gives the focus back to Sound
        el("i", { className: "i i-gear" }), el("span", { className: "txt", textContent: WORDS.settings }), el("span", { className: "val", ariaHidden: "true", textContent: "›" }))); // W75 chrome
      document.body.append(pop);
      addEventListener("pointerdown", (e) => { if (!pop.hidden && !pop.contains(e.target) && !button.contains(e.target)) close(); }, true);
      addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      addEventListener("starchart:settings", (e) => { if (e.detail.key === SOUND) show(); });
      addEventListener("resize", () => { if (!pop.hidden) place(); }); // W40 maplayout: a turn of the phone moves the button
    }
    show();
    place();
    pop.hidden = false;
    if (window.CloseWatcher && !watch) { try { watch = new CloseWatcher(); watch.onclose = () => { watch = null; close(); }; } catch { /* one per user gesture */ } }
  }
  return { open, close, get pop() { return pop; } };
}
