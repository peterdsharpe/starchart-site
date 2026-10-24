// The ship's computer: what the HUD says, from the pose and the event engine. Pure, so Node can test
// it; the controllers (chart/prototype/app.js, app/main.js) write the text four times a second.
import { stardate } from "./clock.js";

const LY = 1609.344;

/**
 * The HUD's words. pose: {warp, s, elapsed} or null; engine: the EventEngine (system, quadrant,
 * labelFor); when: the stardate's Date.
 */
export function hudWords(pose, engine, mode, when) {
  const sys = engine.system, quad = engine.quadrant, meat = mode === "meatspace";
  return {
    warp: String(pose ? Math.round(pose.warp) : 0),
    ly: (pose ? pose.s / LY : 0).toFixed(2),
    mins: String(pose ? Math.floor(pose.elapsed / 60) : 0),
    stardate: stardate(when),
    system: meat ? (sys?.name || "") : sys ? engine.labelFor("system", sys) : "Uncharted space",
    quadrant: quad ? (meat ? quad.name : engine.labelFor("quadrant", quad)) : "",
  };
}

/** A text writer that touches the DOM only when a value changes: put(id, text). */
export function writer(byId = (id) => document.getElementById(id)) {
  const shown = {};
  return (id, v) => { if (shown[id] !== v) { shown[id] = v; byId(id).textContent = v; } };
}

/**
 * The tally buttons: a tap counts, pops the count and glows the tile, with a brief "+1" (class "plus"; W34 cues),
 * and dispatches the event, which only plays the sound (no banner). A long press takes one back, with a brief "−1"
 * (class "minus") and no dialog. ids: {hi_five: "hifive", cup_crush: "cup"}; along() is metres flown; onCount(kind, n, el)
 * runs on each change (the app's badges and accessible names).
 */
export function tallies(along, byId = (id) => document.getElementById(id), { onCount = () => {}, onEmpty = () => {}, holdMs = 600, longPress = null } = {}) { // W24 quiet: onEmpty; W26 hold: longPress(node, fn, { ms })
  const n = { hi_five: 0, cup_crush: 0 };
  const LABEL = { hi_five: "Hi-five", cup_crush: "Cup crushed:" };
  const flash = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const sign = (el, cls) => { el.classList.remove(cls === "plus" ? "minus" : "plus"); flash(el, cls); }; // W34 cues: the +1 or the −1, the last one only
  const shows = []; // W25 rest: reset()
  for (const [kind, id] of [["hi_five", "hifive"], ["cup_crush", "cup"]]) {
    const el = byId(id);
    const show = () => { byId(id + "-n").textContent = n[kind]; el.dataset.n = n[kind]; onCount(kind, n[kind], el); };
    let timer = 0, held = false;
    const back = () => { if (n[kind] > 0) { n[kind]--; show(); sign(el, "minus"); } else onEmpty(kind, el); }; // W24 quiet: none to take back
    if (longPress) longPress(el, back, { ms: holdMs }); // W26 hold: the app's, with its ring and pop; it drops the click that ends it
    else {
      el.onpointerdown = () => {
        held = false;
        clearTimeout(timer);
        timer = setTimeout(() => { held = true; back(); }, holdMs); // a long press is not a tap
      };
      el.onpointerup = el.onpointerleave = el.onpointercancel = () => clearTimeout(timer);
      el.oncontextmenu = (e) => e.preventDefault();
    }
    el.onclick = (e) => {
      e.stopPropagation();
      if (held) { held = false; return; }
      const count = ++n[kind];
      show();
      flash(el, "pop");
      sign(el, "plus"); // W34 cues
      dispatchEvent(new CustomEvent("starchart:event", { detail: { kind, text: `${LABEL[kind]} ${count}`, voice: "",
        data: { count, along_m: Math.round(along()) } } }));
    };
    show();
    shows.push(show); // W25 rest
  }
  Object.defineProperty(n, "reset", { value: () => { n.hi_five = n.cup_crush = 0; for (const show of shows) show(); } }); // W25 rest: each flight's buttons start at zero (flight B1)
  Object.defineProperty(n, "set", { value: (counts) => { for (const k of ["hi_five", "cup_crush"]) n[k] = counts?.[k] || 0; for (const show of shows) show(); } }); // W28 resume: a resumed flight's counts
  return n;
}
