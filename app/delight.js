// W73 delight (design/app-ui/SPEC.md §124): seven small delights from the W73 design review's §3, each behind one
// constant below, so any one can be kept or dropped by itself. Each moves only transform and opacity (or a MapLibre
// paint value), makes a sound only through Sound (design/sound/sfx.js: Off is silent, Plain plays its own set), and in
// Calm or the phone's reduced motion turns into a quick fade (--t-press) or nothing.
//
//   draw      a route card picked: its course draws itself from you to the pad in --t-sheet, --ease-enter, and the
//             camera stays (app/course-flow.js; the plotted route's own 0.6 s draw-on is W23's). Calm: a fade.
//   odometer  the readout's LY (mi) and minutes roll their changed digits up, an odometer with no overshoot. Calm: a fade.
//   detents   the weather slider ticks once for each radar frame it crosses (one tick an input, ART's rule 8).
//   backOn    an off-course heads-up that clears without a re-plot: the course glows once and course_set plays.
//   sounds    the rendered sounds wired: course_set on a picked card, reroute when a re-plot lands, sticker_slap (or
//             christening at a new star class) with the landing sticker in place of arrive. Plain keeps arrive.
//   sweep     a Theme choice in Settings sweeps the new palette out from the button, in --t-sheet. Calm: a crossfade.
//   tally     a hi-five or cup-crush tap ticks (none in Plain).
import { tick } from "./haptics.js";

export const DELIGHT = { draw: true, odometer: true, detents: true, backOn: true, sounds: true, sweep: true, tally: true };

const g = globalThis;
export const still = () => !!g.document?.body?.classList.contains("calm"); // W190 statefacts (SPEC §331): body.calm alone, which follows the phone's reduced motion live (app/main.js calmed)
const css = (name, d) => (g.document ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : "") || d;
const ms = (name, d) => parseFloat(css(name, "")) || d;

// ---- sounds: through sfx.onChartEvent, so Sound's modes and Silent running decide; no banner, no chatter ----
let sfx = null;
/** main.js gives the sound module once it is in. */
export const setSfx = (s) => { sfx = s; };
/** The last effects asked for, newest last (for tests: Sound may still mute them). */
export const heard = [];
/** Play one of the rendered effects (an sfx.js name), if Sound allows; `on`, the delight it belongs to. Returns whether it asked. */
export function chime(kind, on = DELIGHT.sounds) {
  if (!on || !sfx) return false;
  sfx.onChartEvent({ kind });
  heard.push(kind); if (heard.length > 20) heard.shift();
  return true;
}
/** The landing's sound: the sticker's slap (a christening at a new star class) in SCUL when a sticker slaps; else arrive. */
export const landSound = (slap, plain) => (DELIGHT.sounds && slap && !plain ? slap : "arrive");

// ---- odometer ----
/** The digits of `next` that roll after `prev`: from the first that differs to the end, or none (a reset, a shorter or
 *  longer number, a smaller one). [{ i, was }] */
export function rolled(prev, next) {
  if (typeof prev !== "string" || prev.length !== next.length || !(parseFloat(next) > parseFloat(prev))) return [];
  let i = 0;
  while (i < next.length && prev[i] === next[i]) i++;
  const out = [];
  for (let k = i; k < next.length; k++) if (/\d/.test(next[k]) && /\d/.test(prev[k]) && next[k] !== prev[k]) out.push({ i: k, was: prev[k] });
  return out;
}
/** Each element's text, as app/main.js's writer sets it, rolls its changed digits: the new one comes up from below and
 *  the old one (a ::before, so the text stays the number) leaves upward, in --t-small with --ease-standard. */
export function odometer(els) {
  if (!DELIGHT.odometer || typeof MutationObserver === "undefined") return;
  for (const el of els) {
    if (!el) continue;
    let last = el.textContent;
    new MutationObserver(() => {
      const next = el.textContent;
      if (next === last) return; // our own spans
      const roll = rolled(last, next);
      last = next;
      if (!roll.length || document.visibilityState === "hidden") return el.classList.remove("rolling"); // W173 delightflake: a change mid-roll to a number that doesn't roll (9.99 to 10.00, a reset) ends the roll: the last one's end checks its own text
      const calm = still(), at = new Map(roll.map((r) => [r.i, r.was]));
      const parts = [...next].map((c, i) => {
        if (!at.has(i)) return document.createTextNode(c);
        const s = document.createElement("span");
        s.className = "od"; s.dataset.was = at.get(i); s.textContent = c;
        return s;
      });
      el.replaceChildren(...parts);
      el.classList.add("rolling");
      const anims = parts.filter((p) => p.nodeType === 1).map((s) => (calm
        ? s.animate({ opacity: [0.35, 1] }, { duration: ms("--t-press", 120), easing: "linear" })
        : s.animate({ transform: ["translateY(100%)", "none"] }, { duration: ms("--t-small", 200), easing: css("--ease-standard", "ease-out") })));
      Promise.all(anims.map((a) => a.finished)).then(() => { if (el.textContent === next) el.classList.remove("rolling"); }, () => {});
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
}

// ---- detents ----
/** The weather slider's detents: call with the radar frame (a whole number) at each input; a tick when it changes. */
export function detents() {
  let last = null;
  const step = (k) => {
    if (!DELIGHT.detents || !Number.isFinite(k)) return false;
    const was = last; last = k;
    return was !== null && was !== k ? tick() : false;
  };
  step.reset = () => { last = null; };
  return step;
}

// ---- back on course: the course glows once ----
const GLOW = "course-glow";
/** The course's glow brightens and settles back, by MapLibre paint transitions (no DOM, no per-frame work). */
export function glowCourse(map) {
  if (!map?.getLayer?.(GLOW)) return false;
  const calm = still(), op = map.getPaintProperty(GLOW, "line-opacity") ?? 1, tr = map.getPaintProperty(GLOW, "line-opacity-transition");
  const up = calm ? ms("--t-press", 120) : ms("--t-small", 200), down = calm ? ms("--t-press", 120) : ms("--t-sheet", 320) * 2;
  map.setPaintProperty(GLOW, "line-opacity-transition", { duration: up, delay: 0 });
  map.setPaintProperty(GLOW, "line-opacity", typeof op === "number" ? Math.min(1, op * 2.2 + 0.25) : 1);
  setTimeout(() => {
    if (!map.getLayer(GLOW)) return;
    map.setPaintProperty(GLOW, "line-opacity-transition", { duration: down, delay: calm ? 0 : 160 });
    map.setPaintProperty(GLOW, "line-opacity", op);
    setTimeout(() => { if (map.getLayer(GLOW)) map.setPaintProperty(GLOW, "line-opacity-transition", tr ?? { duration: 300, delay: 0 }); }, down + 200);
  }, up);
  map.triggerRepaint?.();
  return true;
}
/** Off course, then back on the same course with no re-plot: the glow and course_set. */
export function backOnCourse(map) {
  if (!DELIGHT.backOn) return false;
  glowCourse(map);
  chime("course_set", true); // "locked in" again: its chirp, whatever DELIGHT.sounds says
  return true;
}

// ---- the theme sweep ----
/** Run `change` (the Theme choice) inside a view transition whose new picture sweeps out from `from` (the button) as a
 *  growing circle, in --t-sheet with --ease-enter; Calm crossfades in --t-press. No view transitions, or the setting
 *  off: the change at once. The frame gaps it shows are kept on window.__sweepCost (app-delight.spec.mjs reads them). */
let sweeping = null, skipped = false, wired = false, latest = 0;
export function sweep(from, change) {
  const doc = g.document, n = ++latest;
  if (!DELIGHT.sweep || !doc?.startViewTransition || doc.visibilityState === "hidden") return change();
  // a tap during the sweep: Chromium gives a view transition's input to the root (::view-transition { pointer-events:
  // none } doesn't change that), so a press there ends the sweep at once; a touch's click then finds the control under
  // it, and a mouse's click, still on the root, is passed on to it
  if (!wired) {
    wired = true;
    doc.addEventListener("pointerdown", (e) => { skipped = !!sweeping && e.target === doc.documentElement; if (skipped) sweeping.skipTransition(); }, true);
    doc.addEventListener("click", (e) => {
      if (!skipped || e.target !== doc.documentElement) return;
      skipped = false;
      const el = doc.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== doc.documentElement) { e.stopImmediatePropagation(); el.click(); }
    }, true);
  }
  const r = from?.getBoundingClientRect?.(), x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const calm = still(), root = doc.documentElement;
  root.classList.add("sweeping");
  let vt;
  // a later choice drops this one's change: a transition skipped by the next one still runs its callback, after that tap
  try { vt = sweeping = doc.startViewTransition(() => { if (n === latest) change(); }); } catch { root.classList.remove("sweeping"); return change(); }
  const gaps = []; let t0 = 0, run = true, anim = null;
  const frame = (t) => { if (t0) gaps.push(t - t0); t0 = t; if (run) requestAnimationFrame(frame); };
  vt.ready.then(() => {
    requestAnimationFrame(frame);
    const opts = { pseudoElement: "::view-transition-new(root)", fill: "both" };
    if (calm) anim = root.animate({ opacity: [0, 1] }, { ...opts, duration: ms("--t-press", 120), easing: "linear" });
    else anim = root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${Math.ceil(R)}px at ${x}px ${y}px)`], opacity: [1, 1] }, { ...opts, duration: ms("--t-sheet", 320), easing: css("--ease-enter", "ease-out") });
  }).catch(() => {});
  // the class goes only once the transition has ended: gone while its pictures still show, the browser's own crossfade would start
  vt.finished.catch(() => {}).finally(() => {
    run = false; anim?.cancel(); // its fill held the picture to the end; the pictures are gone now
    if (sweeping === vt) { sweeping = null; root.classList.remove("sweeping"); } // a quicker second tap's sweep keeps it
    const s = gaps.slice(1).sort((a, b) => a - b);
    g.__sweepCost = { frames: gaps.length, max: s.at(-1) ?? 0, p95: s[Math.floor(s.length * 0.95)] ?? 0, calm };
  });
  return vt;
}

// ---- the tally tick ----
/** A tally's +1 (a starchart:event of kind hi_five or cup_crush, in the tap's task): one tick, none in Plain. */
export const tallyTick = (kind, plain) => (DELIGHT.tally && !plain && (kind === "hi_five" || kind === "cup_crush") ? tick() : false);
