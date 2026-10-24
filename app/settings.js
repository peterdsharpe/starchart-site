// Settings (wave 15; wave 28: a short list of real choices, design/app-ui/SPEC.md §38): the keys, and the Settings
// sheet's rows that are not the flight's own.
//
//   get(key)          the value in localStorage, or the key's default
//   set(key, value)   writes it, then dispatches window "starchart:settings" with { key, value }
//
// The themes and chart lanes read the keys at start and listen for that event; they never import this
// module. The sheet itself is app/index.html's #about-sheet; app/main.js opens it and runs the rows that
// drive the flight (the screen on, motion, the compass and GPS line, the chart on this phone).
import { CLASSES } from "./blackbox.js";
import { hiddenIds, resetHidden, wontShow } from "./notice.js"; // W21 glass; W104 oss2: wontShow
import { tip, why } from "./tip.js"; // W24 quiet
import { longPress } from "./press.js"; // W28 settings: a long press on a row tells more; W88 settings3: Pace's steps no longer tick
import { can as canBuzz } from "./haptics.js"; // W69 motion
import { sweep } from "./delight.js"; // W73 delight: the theme sweep
import { lingo, pick, onLingo } from "./lingo-mode.js"; // W60 a: Words, with ?lingo= for this visit; W60 c: pick, onLingo

/** Every key, with its values (the first is the default). All values are strings. */
export const KEYS = {
  "starchart.theme": ["dark", "light", "system", "sun"], // W73 dark: sun, By the sun (app/theme.js)
  "starchart.tilt": ["flat", "tilted"], // the compass's long press (app/main.js)
  "starchart.sound": ["directions", "all", "off"], // W28 settings: Sound (app/calls.js); Directions by default since W56 voice2 (chatter was 62 % of what was said)
  "starchart.lingo": ["scul", "meatspace"], // W60 a: Words, SCUL or Plain (app/lingo-mode.js reads it; the code's word for Plain is the glossary's)
  "starchart.sound.on": ["directions", "all"], // W28 settings: the mode the sound button's tap comes back to
  "starchart.motion": ["system", "full", "calm"], // W28 settings: Motion (app/main.js); W100 motion: the Calm motion switch, "calm" on, "full" off, absent ("system") the phone's reduced motion
  "starchart:wake": ["1", "0"],
  "starchart.smooth": ["auto", "60", "30"], // W20 chrome; W28 settings: Battery saver is "30", the governor's fps for following and the ambient motion; W56 perf: Auto (60, or a steady 30 when 60 doesn't hold; W102 fps30: 30 in flight while the chart barely moves), the default; Developer's Frame rate picks any
  "starchart.showfps": ["0", "1"], // W20 chrome: Show frame rate
  "starchart.comets": ["on", "off"], // W29 comets: live T trains on the chart (app/comets.js hears starchart:settings); W50 layers: its switch is in Layers
  "starchart.transit": ["off", "on"], // W62 cometcard: Consider comets in routing (W68 settings2), bike plus comet in the course previews (app/comet-card.js KEY; main.js asks app/transit.js)
  "starchart.layer.tlines": ["on", "off"], // W50 layers: the T's lines, the comet tracks (app/layers.js); W55 layers2: with starchart.comets, the one Comets tile
  "starchart.layer.terrain": ["on", "off"], // W50 layers: the hills' tint and steep ground, and 3D when tilted (app/terrain.js)
  "starchart.layer.places": ["on", "off"], // W50 layers: the named places up close, the spot-* layers
  "starchart.layer.weather": ["off", "on"], // W52 weather: the rain radar and its nowcast, off by default (app/weather.js)
  "starchart.layer.anchorages": ["off", "on"], // W56 parking: every anchorage (bike rack) from z14 (app/anchorages.js; W86 map: no capacity)
  "starchart.layer.systems": ["on", "off"], // W56 parking: the towns' glow (system-nebula)
  "starchart.layer.lanes": ["on", "off"], // W59 routes: the streets' bike lanes in cyan, W23 comfort's shading (app/layers.js)
  "starchart.skiptiny": ["on", "off"], // W68 logbulk: Skip tiny flights, a flight under 0.05 LY or 1 minute of moving isn't kept at Land (app/log.js, SPEC §99)
  "starchart.haptics.turns": ["off", "on"], // W69 motion: Turn buzzes, in flight: one long for port, two short for starboard; Android only; W88 settings3: Vibrate on taps (starchart.haptics) went
  "starchart.avatar": ["default", "yellow", "pink", "purple", "blue", "green", "ship", "commuter", "sunny", "racer", "cargo", "arrow"], // W86 avatar: Your color, the marker's; W101 avatars: the avatars (app/avatar.js AVATARS), the colours kept for the migration
  "starchart.pace": ["100", ...Array.from({ length: 17 }, (_, i) => String(70 + 5 * i)).filter((v) => v !== "100")], // W59 pace: % of the router's speed, 70 to 150 in 5s (SPEC §81)
  "starchart.voice": ["lodestar", "vega", "rigel", "mira", "burble"], // W97 voices: Settings › Sound › Voice (app/voices.js VOICES); Lodestar by default
  "starchart.pace.by": ["rides", "hand"], // W86 eta: learned from her rides (app/log.js), until she sets Pace by hand (SPEC §172)
};

/** W59 pace: the pilot's pace as a factor, 1.1 at 110 %: a route's minutes are the router's over it (SPEC §81). */
export const pace = () => +get("starchart.pace") / 100;
/** W59 pace: the nearest pace Settings offers to `pct`, in 5 % steps from 70 to 150. */
export const paceStep = (pct) => Math.max(70, Math.min(150, Math.round(pct / 5) * 5));
/** W86 eta: the pace to set from her rides (`learned`, app/logbook.js learnedPace), or null: none once she has set Pace by hand,
 *  nor the pace it is already, nor while they are within 5 % of it (a median at a step's edge doesn't flip it each landing). */
export const paceToLearn = (learned) => { // W86 eta
  const p = +get("starchart.pace"), to = learned && get("starchart.pace.by") !== "hand" && Math.abs(learned.pct - p) >= 5 ? paceStep(learned.pct) : null; // W86 eta
  return to === p ? null : to; // W86 eta
}; // W86 eta
/** W68 settings2: a hold on Pace's − or + repeats after `first` ms, every `slow` ms, then every `fast` ms once held `fastAt` ms;
 *  (W88 pace: no drag or wheel on the value any more.) */
export const HOLD = { first: 400, slow: 150, fast: 60, fastAt: 1000 };
/** W68 settings2: the wait before a hold's next step, `ms` into the hold (after the first step's `first`). */
export const holdGap = (ms) => (ms < HOLD.fastAt ? HOLD.slow : HOLD.fast);
/** W59 pace: the Pace row's words (W60 gives each a plain version). */
export const WORDS = {
  pace: "Pace",
  motionLine: ["Your droid asks for less motion.", "Your phone asks for less motion."], // W100 motion: [SCUL, Plain]
  paceMore: ["How quick you ride against the plan: every course's minutes follow it. The routes stay the same.", // W60 c: [SCUL, Plain]
    "How quick you ride against the plan. Only the minutes change, never the route."],
  paceShow: (pct) => `${pct} %`,
  paceEffect: (pct) => `20 min route: ${Math.max(1, Math.round(2000 / pct))} min`,
  slower: "Slower", quicker: "Quicker",
  slowest: "70 % is the slowest.", quickest: "150 % is the quickest.",
  info: "More info", // W88 settings3: a row's (i), the same in both modes
  sound: ["Sound and vibration", "Sound"], // W88 settings3: the section's title, where the phone can buzz the turns and where it can't
};

/** W28 settings: the keys before wave 28, read once. Calm chart on is Motion's Calm; the sound's are app/calls.js's.
 *  W100 motion: Follow the phone ("system") is no value any more, but the switch's default: it goes, so the phone decides. */
export function migrate(s = globalThis.localStorage) {
  try {
    const m = s?.getItem("starchart.motion"); // W100 motion
    if (m === "system") s.removeItem("starchart.motion"); // W100 motion
    if (!s || m !== null) return; // W100 motion
    if (s.getItem("starchart:calm") === "1") s.setItem("starchart.motion", "calm");
  } catch { /* storage off: the default */ }
}
migrate();

/** W28 settings: the first-time tips (starchart.tip.*, app/tips.js) and the notices hidden for good (starchart.hide.*). */
export const TIP = "starchart.tip.";
const OLD_HOLD = "starchart:hint-hold"; // merge (W28 settings + launch): the old key of the hold tip
function tipKeys(s = globalThis.localStorage) {
  const out = [];
  try { for (let i = 0; i < (s?.length ?? 0); i++) { const k = s.key(i); if (k?.startsWith(TIP)) out.push(k); } } catch { /* storage off */ }
  return out;
}
/** Show tips again: every tip shows once more, and every hidden notice shows again. Returns how many were cleared. Each tip
 *  reads its key at its next moment (app/tips.js seen()), so it needs no event (W40 settings: the starchart:tips nothing heard went). */
export function resetTips(s = globalThis.localStorage) {
  const keys = tipKeys(s);
  try { if (s?.getItem(OLD_HOLD) != null) keys.push(OLD_HOLD); } catch { /* storage off */ } // merge: W25's hold hint, which tips.js still counts as seen
  try { for (const k of keys) s.removeItem(k); } catch { /* storage off */ }
  return keys.length + resetHidden();
}

export function get(key) {
  let v = null;
  try { v = globalThis.localStorage?.getItem(key); } catch { /* storage off */ }
  const ok = KEYS[key];
  return ok && !ok.includes(v) ? ok[0] : v;
}

export function set(key, value) {
  value = String(value);
  try { globalThis.localStorage?.setItem(key, value); } catch { /* storage off: the change lasts this visit */ }
  globalThis.dispatchEvent?.(new CustomEvent("starchart:settings", { detail: { key, value } }));
  return value;
}

// W104 oss2 (OSS review #20): at LOW_BATTERY or less and not charging, Battery saver turns on by itself, once a visit,
// with an Undo bar; only from Auto, so a rate the pilot picked stands. navigator.getBattery is Chromium's only.
export const LOW_BATTERY = 0.2; // W104 oss2
export const LOW_WORDS = "Battery low: Battery saver on"; // W104 oss2
/** W104 oss2: whether the battery `b` ({level, charging}) turns Battery saver on, with starchart.smooth at `smooth`. */
export const lowBattery = (b, smooth) => !!b && !b.charging && b.level <= LOW_BATTERY && smooth === "auto"; // W104 oss2
/** W104 oss2: watch the battery `b` (a BatteryManager); the first time it runs low, Battery saver on and the Undo bar. */
export function watchBattery(b, { snack = wontShow } = {}) { // W104 oss2
  const check = () => { // W104 oss2
    if (!lowBattery(b, get("starchart.smooth"))) return; // W104 oss2
    b.removeEventListener("levelchange", check); b.removeEventListener("chargingchange", check); // W104 oss2: once a visit
    set("starchart.smooth", "30"); // W104 oss2
    snack(() => set("starchart.smooth", "auto"), LOW_WORDS); // W104 oss2
  }; // W104 oss2
  b.addEventListener("levelchange", check); b.addEventListener("chargingchange", check); // W104 oss2
  check(); // W104 oss2
  return check; // W104 oss2
} // W104 oss2

// ---- the sheet ---------------------------------------------------------------------------------
/** A star class, drawn in code (design/app-ui/ideas, section 7): each class adds to the one before. In
 *  currentColor, so the class's colour comes from the tokens through log.css (the Log shows them, wave 17). */
export function starSVG(id) {
  const i = CLASSES.findIndex((c) => c.id === id) + 1; // 1..4, as on the ideas page
  const n = (x) => +x.toFixed(2);
  const rays = (k, r1, r2, w) => Array.from({ length: k }, (_, j) => {
    const a = (j / k) * Math.PI * 2 - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    return `<line x1="${n(32 + c * r1)}" y1="${n(32 + s * r1)}" x2="${n(32 + c * r2)}" y2="${n(32 + s * r2)}" stroke-width="${w}" stroke-linecap="round"/>`;
  }).join("");
  const r = 9 + i * 2, w = 2.5 + i * 0.3;
  const spark = `<path fill="currentColor" stroke="none" d="M32 ${32 - r}L${n(32 + w)} ${n(32 - w)}L${32 + r} 32L${n(32 + w)} ${n(32 + w)}L32 ${32 + r}L${n(32 - w)} ${n(32 + w)}L${32 - r} 32L${n(32 - w)} ${n(32 - w)}Z"/>`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor">`
    + `<circle class="disc" cx="32" cy="32" r="27" stroke-width="3"/>${spark}`
    + (i >= 2 ? rays(8, 15, 20, 2.5) : "")
    + (i >= 3 ? `<circle cx="32" cy="32" r="22" stroke-width="1.5" opacity=".6"/>` : "")
    + (i >= 4 ? `<path class="beam" d="M32 3v14M32 47v14" stroke-width="3" stroke-linecap="round"/>` : "")
    + `<circle class="glint" cx="${25 - i}" cy="${25 - i}" r="2.4" stroke="none"/></svg>`;
}

/**
 * Wire the sheet's own rows: Sound, Theme, Calm motion (W100 motion), Battery saver, and in About's Developer group Show frame rate and
 * Show tips again. Settings only changes the app: lifetime light years, the star classes and the flights are in the
 * Log (app/log.js, wave 17). `sound` is { mode(), set(v) } (app/calls.js), shared with the sound button.
 */
export function mountSettings({ $ = (id) => document.getElementById(id), sound } = {}) {
  const sheet = $("about-sheet"), gear = $("about");

  // segmented choices: Sound, Theme, Frame rate, Words (W100 motion: Motion is a switch)
  const segs = [["set-sound", "starchart.sound", sound.mode, sound.set], ["theme", "starchart.theme", undefined, (v) => { try { localStorage.setItem("starchart.theme", v); } catch { /* storage off */ } sweep($("theme").querySelector(`[data-v="${v}"]`), () => set("starchart.theme", v)); }], ["frame-rate", "starchart.smooth"], ["set-lingo", "starchart.lingo", lingo]]; // W56 perf: Frame rate; W60 a: Words; W73 delight: Theme sweeps (the choice shows, and ticks, in the tap; the palette follows in the sweep)
  for (const [id, key, read = () => get(key), write = (v) => set(key, v)] of segs) {
    const group = $(id);
    if (!group) continue;
    const show = () => { const v = read(); for (const b of group.querySelectorAll("button")) { b.setAttribute("aria-checked", String(b.dataset.v === v)); b.tabIndex = b.dataset.v === v ? 0 : -1; } }; // W40 settings: one Tab stop, the choice
    show();
    addEventListener("starchart:settings", (e) => { if (e.detail.key === key) show(); }); // the sound button and the gear's hold set them too
    gear?.addEventListener("click", show); // ?muted=1 is this visit's, not a key
    group.addEventListener("click", (e) => {
      const v = e.target.closest("button")?.dataset.v;
      if (!KEYS[key].includes(v)) return;
      write(v); show();
    });
    group.addEventListener("keydown", (e) => { // W40 settings: the arrow keys move the choice, as a radio group's do
      const bs = [...group.querySelectorAll("button")], at = bs.indexOf(e.target.closest("button"));
      const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: bs.length - 1 }[e.key];
      if (to === undefined || at < 0) return;
      e.preventDefault();
      const b = bs[(to + bs.length) % bs.length];
      write(b.dataset.v); show(); b.focus();
    });
  }
  // switches: Battery saver, Show frame rate (W50 layers: Comets went to the Layers sheet, app/layers.js)
  for (const [id, key, on] of [["saver", "starchart.smooth", "30"], ["showfps", "starchart.showfps", "1"], ["transit", "starchart.transit", "on"], ["skiptiny", "starchart.skiptiny", "on"], ["haptic-turns", "starchart.haptics.turns", "on"]]) { // W69 motion: Buzz the turns // W62 cometcard: transit; W88 settings3: Only comets that take ships went (the planner boards only the trains that take bikes then); W68 logbulk: skiptiny
    const sw = $(id);
    if (!sw) continue;
    const off = KEYS[key].find((v) => v !== on);
    sw.checked = get(key) === on;
    sw.onchange = () => set(key, sw.checked ? on : off);
    addEventListener("starchart:settings", (e) => { if (e.detail.key === key) sw.checked = get(key) === on; }); // W56 perf: Frame rate's 30 is Battery saver
  }
  // W69 motion: Buzz the turns where the phone can buzz a pattern (Android); W88 settings3: Vibrate on taps went, and Sound's title says vibration only there
  const hx = canBuzz() === "vibrate"; $("haptic-turns-row")?.toggleAttribute("hidden", !hx); // W88 settings3
  if ($("sound-h")) $("sound-h").textContent = WORDS.sound[hx ? 0 : 1]; // W88 settings3
  // W59 pace: Pace, − 100 % +, 5 % a tap; away from 100 % its line shows a 20 min route at it
  const paceRow = $("pace-row");
  if (paceRow) {
    const out = paceRow.querySelector("output"), effect = paceRow.querySelector("small"), [down, up] = paceRow.querySelectorAll("button");
    paceRow.dataset.more = pick(WORDS.paceMore); onLingo(() => { paceRow.dataset.more = pick(WORDS.paceMore); }); // W60 c
    paceRow.querySelector(".t").textContent = WORDS.pace; paceRow.querySelector(".seg").setAttribute("aria-label", WORDS.pace);
    down.setAttribute("aria-label", WORDS.slower); up.setAttribute("aria-label", WORDS.quicker);
    const seg = paceRow.querySelector(".seg"); // W68 settings2: the value is a slider for the arrow keys; − and + repeat while held; W88 pace: no drag or wheel
    Object.entries({ role: "slider", tabindex: "0", "aria-label": WORDS.pace, "aria-valuemin": "70", "aria-valuemax": "150" }).forEach(([k, v]) => out.setAttribute(k, v)); // W68 settings2
    const show = () => { const p = +get("starchart.pace"); out.textContent = WORDS.paceShow(p); effect.textContent = p === 100 ? "" : WORDS.paceEffect(p); out.setAttribute("aria-valuenow", p); out.setAttribute("aria-valuetext", WORDS.paceShow(p)); }; // W68 settings2: aria-value*
    let said = null; // W68 settings2: the limit's tip, once per hold, drag, wheel or key press (each end's once)
    const step = (d, b) => { const p = +get("starchart.pace"), to = paceStep(p + d); if (to === p) { const w = d < 0 ? WORDS.slowest : WORDS.quickest; if (said !== w) tip(b, w); said = w; return false; } set("starchart.pace.by", "hand"); set("starchart.pace", to); return true; }; // W68 settings2: once; W88 settings3: no tick; W86 eta: by hand, so her rides no longer set it
    let timer = 0, pressed = false; // W68 settings2: a hold repeats, after 400 ms, then quicker
    const stop = () => { clearTimeout(timer); timer = 0; };
    for (const [b, d] of [[down, -5], [up, 5]]) {
      b.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        stop(); said = null; pressed = true; b.setPointerCapture?.(e.pointerId);
        const t0 = performance.now(), again = () => { timer = step(d, b) ? setTimeout(again, holdGap(performance.now() - t0)) : 0; };
        if (step(d, b)) timer = setTimeout(again, HOLD.first);
      });
      for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(t, stop);
      b.addEventListener("pointercancel", () => { pressed = false; }); // no click follows it
      b.onclick = () => { if (pressed) { pressed = false; return; } said = null; step(d, b); }; // the press stepped already; Enter and Space step here
    }
    // W88 pace (arclight, 2026-10-23): no drag or wheel on the value; scrolling Settings over it changed Pace by a lot. − and + (and the keys, once focused) change it
    out.addEventListener("keydown", (e) => { // W68 settings2: a slider's keys
      const d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, Home: -80, End: 80 }[e.key];
      if (!d) return;
      e.preventDefault();
      if (!e.repeat) said = null;
      step(d, out);
    });
    seg.addEventListener("pointerdown", (e) => e.stopPropagation()); // W68 settings2: not the row's long press
    seg.addEventListener("contextmenu", (e) => e.preventDefault());
    sheet.addEventListener("close", stop);
    addEventListener("starchart:settings", (e) => { if (e.detail.key === "starchart.pace") show(); }); // the Log's offer sets it too
    show();
  }
  // Motion says so when the phone asks for reduced motion, which Calm motion follows until she flips it
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const motionLine = () => { const n = $("motion-t"); if (n) n.textContent = reduced?.matches ? pick(WORDS.motionLine) : ""; }; // W100 motion: SCUL's droid
  reduced?.addEventListener?.("change", motionLine);
  onLingo(motionLine); // W100 motion
  motionLine();
  // W100 motion (arclight, 2026-10-23): Calm motion, one switch. Unflipped it shows the phone's reduced motion; a flip is hers from then on
  const calmSw = $("motion"); // W100 motion
  if (calmSw) { // W100 motion
    const show = () => { const v = get("starchart.motion"); calmSw.checked = v === "calm" || (v !== "full" && !!reduced?.matches); }; // W100 motion: as app/main.js calmWanted
    calmSw.onchange = () => set("starchart.motion", calmSw.checked ? "calm" : "full"); // W100 motion
    addEventListener("starchart:settings", (e) => { if (e.detail.key === "starchart.motion") show(); }); // W100 motion
    show(); // W100 motion
  } // W100 motion

  // W28 settings: a long press on a row tells more, in the one bubble (app/tip.js): its data-more, one or two sentences.
  // W88 settings3 (SPEC §175): and its (i), after its name, says the same, since a long press can't be found (her note: "a
  // clickable info icon"). A row that is a button has no data-more, so no button sits in a button. W76's More page went.
  for (const row of sheet.querySelectorAll("[data-more]")) {
    const info = Object.assign(document.createElement("button"), { type: "button", className: "info" }); // W88 settings3
    const say = () => tip(row, row.dataset.more, { ms: 5000, own: info }); // arclight 2026-10-23: a tap anywhere but its (i), the row's own space too, closes it
    longPress(row, say);
    info.setAttribute("aria-label", WORDS.info); info.innerHTML = `<i class="i i-about"></i>`; // W88 settings3
    info.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); say(); }); // W88 settings3: not the label's switch, nor the summary's fold
    const txt = row.querySelector(".txt"), name = txt.querySelector(".t") ?? [...txt.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim()); // W88 settings3
    txt.insertBefore(info, name?.nextSibling ?? null); // W88 settings3
    if (row.tagName === "LABEL" && !row.htmlFor) row.htmlFor = row.querySelector("input").id; // W88 settings3: a label's control is its first labelable descendant, now the (i), unless it names its switch
  }

  // W20 chrome: the folds (Install, About, Developer) open in place, as groups that fold rather than pages, so the sheet
  // keeps one scroll, one back gesture and the × in reach. One open at a time, but for the ones it is inside.
  const folds = [...sheet.querySelectorAll("details.cat, details.deeper")];
  for (const d of folds) d.addEventListener("toggle", () => {
    if (!d.open) { d.querySelector("summary").scrollIntoView({ block: "nearest" }); return; }
    sheet.classList.add("full");
    for (const o of folds) if (o !== d && o.open && !o.contains(d) && !d.contains(o)) o.open = false;
    count();
  });

  // W28 settings: Show tips again, the last row of Developer: clears every starchart.tip.* and starchart.hide.*
  const again = $("tips-again");
  function count() {
    if (!again) return;
    why(again, tipKeys().length + hiddenIds().length ? null : "Nothing to show again yet."); // W24 quiet: a tap with nothing to do says why
  }
  if (again) {
    again.onclick = () => { resetTips(); count(); tip(again, "Tips show again."); };
    addEventListener("starchart:notices", count);
    count();
  }

  // the sheet: full height; it opens from the gear, and closing it in any way puts focus back on the gear
  sheet.addEventListener("close", () => { gear.focus(); for (const d of folds) d.open = false; });
}
