// W195 pocket (design/app-ui/SPEC.md §343): Pocket, the ride's black screen (app/mission.js). Android gives a web app no GPS
// while the screen is off, so a ride keeps the screen on; in a pocket a lit screen takes stray touches. Pocketed, the screen is
// black and every touch, click, wheel and key is swallowed here, before any other listener of the app's (this module's capture
// listeners are the window's first: app/main.js imports it first), so a pocket can't press End, move the chart or stop the
// off-course buzz (app/course.js's buzzOff, on any pointerdown). The ride, its calls, its buzzes, GPS and the wake lock go on.
// Out: Back (a CloseWatcher; W217 ridechrome: twice within 3 s, as fullscreen went), Escape, or W210 pocket2 (SPEC §386, her row 3): the ring slid up its track (SlideGuard), was a
// 1.5 s hold; W213 pocket3 (SPEC §404, her row 8.2): with no rest first, the track longer instead. Only the person's input is
// swallowed (isTrusted): the app's own clicks go on, as the ride's end at its pad, which clicks End. Measured against synthetic
// pocket touches in app/tests/pocket.test.mjs.

/** W210 pocket2: how far up the ring slides to unlock. W213 pocket3 (SPEC §404): a slide that moves at once, with no rest on the ring
 *  first (her row 8.2), the shortest no more often taken by a pocket's touches than the 1.5 s hold (app/tests/pocket.test.mjs); was 80
 *  after a 150 ms rest. W217 ridechrome (SPEC §419, her row 14): about 30 % longer, was 180. */
export const SLIDE_PX = 234;
/** W217 ridechrome: a screen too short for the whole slide (a small phone on its side) draws the longest track that fits, and the slide is
 *  the track drawn (pocket()), never shorter than this: 0.1.103's. */
export const SLIDE_MIN = 180;
/** Gloves: contact lost this long mid-slide keeps the ring where it is, and a touch on it there carries on. */
export const GRACE_MS = 300;
/** The slide is done within this long of the touch, and keeps to the ring's column (its radius and margin either side). */
export const SLIDE_MS = 3000, BAND_PX = 52;
/** W217 ridechrome (SPEC §419, her row 14): Pocket asks for no fullscreen (Chrome's "To exit full screen" notice can't be hidden), which
 *  made a pocket's first Back only leave fullscreen. So now the first Back keeps Pocket and says so, and a second within this long leaves. */
export const BACK_MS = 3000;

/**
 * W210 pocket2: the slide that leaves pocket mode, as pure logic: `down`, `move`, `up` with a pointer's id, point and time. A
 * touch on the ring (`inside(x, y)`, the ring at home) takes it at once (W213 pocket3: was after a 150 ms rest), and it follows the
 * finger up (`at`, px); past `length` it is `done()`. Let go early and it goes home, after `grace` ms in which a touch on the ring
 * where it stands carries on. A pocket's touches come many at once: a second pointer drops the ring, and none starts again
 * until every pointer has lifted. `state`: "" (home), "held" (following) or "lost".
 */
export class SlideGuard {
  constructor({ length = SLIDE_PX, grace = GRACE_MS, ms = SLIDE_MS, band = BAND_PX, inside = () => true } = {}) {
    Object.assign(this, { length, grace, ms, band, inside });
    this.ids = new Set();
    this.blocked = false;
    this.s = null; // { id, x0, y0, base, t, lost }
    this.at = 0;
    this.ok = false;
  }
  /** `primary`: the first touch with no other on the screen (PointerEvent.isPrimary), which clears any pointer whose up was lost. */
  down(id, x, y, t, primary = false) {
    if (primary) { this.ids.clear(); this.blocked = false; }
    this.expire(t);
    this.ids.add(id);
    if (this.ids.size > 1) { this.drop(); this.blocked = true; return; }
    if (this.blocked) return;
    if (this.s) { // contact lost a moment ago: a touch on the ring where it stands carries on
      if (this.inside(x, y + this.at)) { Object.assign(this.s, { id, x0: x, y0: y, base: this.at, lost: null }); return; }
      this.drop();
    }
    if (this.inside(x, y)) this.s = { id, x0: x, y0: y, base: 0, t, lost: null };
  }
  move(id, x, y, t) {
    const s = this.s;
    if (!s || s.id !== id || s.lost !== null) return;
    if (Math.abs(x - s.x0) > this.band || t - s.t > this.ms) return this.drop();
    this.at = Math.max(0, Math.min(this.length, s.base + s.y0 - y));
    if (this.at >= this.length) this.ok = true;
  }
  up(id, t) {
    this.ids.delete(id);
    if (this.s?.id === id && this.s.lost === null) { if (this.at > 0) this.s.lost = t; else this.drop(); } // W213 pocket3: still home, nothing to keep
    if (!this.ids.size) this.blocked = false;
  }
  /** Contact lost longer than the grace: the ring goes home. True if it went. */
  expire(t) { if (this.s?.lost != null && t - this.s.lost > this.grace) { this.drop(); return true; } return false; }
  drop() { this.s = null; this.at = 0; }
  get state() { return !this.s ? "" : this.s.lost !== null ? "lost" : "held"; }
  done() { return this.ok; }
}

// Every input a pocket can make, and what the keyboard sends. Touch and wheel listeners are passive, so no scroll in the app
// waits for the main thread (BRIEF §8); pocketed, `touch-action: none` (app/mission.css) stops a touch's scroll, pinch and pull
// to refresh, and the other defaults (a long press's menu, a selection) are stopped here.
const INPUT = ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave",
  "gotpointercapture", "lostpointercapture", "touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mousemove", "mouseup",
  "mouseover", "mouseout", "click", "dblclick", "auxclick", "contextmenu", "wheel", "keydown", "keyup", "keypress", "selectstart", "dragstart"];
const passive = (type) => type.startsWith("touch") || type === "wheel";
let active = null, tail = null; // tail: the finger that slid, after the slide took: its up and click are swallowed too, so none reaches the map
for (const type of INPUT) globalThis.addEventListener?.(type, (e) => {
  if (!e.isTrusted) return; // the app's own, never a pocket's: the ride's end at its pad clicks End (app/course.js autoland)
  if (!active && tail && performance.now() > tail.until) tail = null;
  if (!active && !tail) return;
  e.stopImmediatePropagation();
  if (e.cancelable && !passive(type)) e.preventDefault();
  if (active) return active.feed(e);
  if (e.type === "pointerup" && e.pointerId === tail.id) tail.until = performance.now() + 400; // the click that follows
}, { capture: true, passive: passive(type) });

/**
 * Pocket mode on: until the ring (an element at the foot of `track`; its box there, with `pad` px round it, is where a slide
 * starts) is slid up the track, Back twice within BACK_MS (the first calls `onBack(true)`, and `onBack(false)` once the time is past or
 * Pocket ends) or Escape, which call `onLeave()` once. The ring stands `--at` px up (app/mission.css) and has
 * the class of its state ("held", "lost"): lit whole from the touch (W213 pocket3: was half, then whole after the rest), her "I could
 * see at a glance whether I am able to swipe". Returns `off()`, for leaving by other means (the ride's end); it calls no `onLeave`.
 */
export function pocket({ track, ring, onLeave, onBack = () => {}, pad = 16, buzz = () => {} }) { // W217 ridechrome: onBack
  active?.off();
  const inside = (x, y) => { const r = track.getBoundingClientRect(), h = ring.offsetHeight; return x >= r.left - pad && x <= r.right + pad && y >= r.bottom - h - pad && y <= r.bottom + pad; };
  const guard = new SlideGuard({ inside });
  let timer = 0, watch = null, backAt = 0; // W217 ridechrome: backAt, the first Back's timer while it counts
  const show = () => {
    ring.style.setProperty("--at", `${guard.at}px`);
    for (const c of ["held", "lost"]) ring.classList.toggle(c, guard.state === c);
  };
  const me = {
    feed(e) {
      const t = performance.now();
      if (e.type === "keydown" && e.key === "Escape") return leave();
      if (e.type === "pointerdown") { guard.length = Math.max(SLIDE_MIN, Math.min(SLIDE_PX, Math.round(track.offsetHeight - ring.offsetHeight))); guard.down(e.pointerId, e.clientX, e.clientY, t, e.isPrimary); } // W217 ridechrome: the track as drawn
      else if (e.type === "pointermove") guard.move(e.pointerId, e.clientX, e.clientY, t);
      else if (e.type === "pointerup" || e.type === "pointercancel") guard.up(e.pointerId, t);
      else return;
      if (guard.done()) { tail = { id: e.pointerId, until: t + 5000 }; buzz(); return leave(); }
      clearTimeout(timer);
      if (guard.state === "lost") timer = setTimeout(() => { if (guard.expire(performance.now())) show(); }, guard.grace + 20); // the ring glides home
      show();
    },
    off() {
      if (active !== me) return;
      active = null;
      clearTimeout(timer);
      guard.drop(); show();
      if (backAt) { clearTimeout(backAt); backAt = 0; onBack(false); } // W217 ridechrome
      const w = watch; watch = null; w?.destroy();
    },
  };
  function leave() { if (active !== me) return; me.off(); onLeave(); }
  /** W217 ridechrome: Back (Android's, through the watcher): the second within BACK_MS leaves; the first says so and watches again. */
  function back() {
    if (active !== me) return;
    if (backAt) return leave();
    onBack(true);
    backAt = setTimeout(() => { backAt = 0; if (active === me) onBack(false); }, BACK_MS);
    watchBack();
  }
  const watchBack = () => { try { if (globalThis.CloseWatcher) { watch = new CloseWatcher(); watch.onclose = () => { watch = null; back(); }; } } catch { /* one per user gesture */ } }; // W217 ridechrome: back(), was leave()
  active = me;
  show();
  watchBack();
  return me.off;
}
