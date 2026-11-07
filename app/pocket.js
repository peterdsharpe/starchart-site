// W195 pocket (design/app-ui/SPEC.md §343): Pocket, a step of W73's long-haul screen (app/mission.js). Android gives a web
// app no GPS while the screen is off, so a ride keeps the screen on; in a pocket a lit screen takes stray touches. Pocketed,
// the screen is black and every touch, click, wheel and key is swallowed here, before any other listener of the app's (this
// module's capture listeners are the window's first: app/main.js imports it first), so a pocket can't press End, move the
// chart or stop the off-course buzz (app/course.js's buzzOff, on any pointerdown). The ride, its calls, its buzzes, GPS and
// the wake lock go on. Out: a 1.5 s hold on the ring, by one still finger (HoldGuard), Back (a CloseWatcher) or Escape. Only
// the person's input is swallowed (isTrusted): the app's own clicks go on, as the ride's end at its pad, which clicks End.
// Measured against synthetic pocket touches in app/tests/pocket.test.mjs.

export const HOLD_MS = 1500;
/** How far the finger may wander during the hold, as in the app's long press (app/press.js): a held fingertip moves a few px; a
 *  pocket's press drifts with the leg. At 20 px (and a 24 px margin) the ring took 0.78 % of the long presses measured, at 10 px 0.13 %. */
export const SLOP_PX = 10;

/**
 * The hold that leaves pocket mode, as pure logic: `down`, `move`, `up` with a pointer's id, point and time; `done(t)` once
 * one pointer has stayed still on the target for `ms`. A pocket's touches come many at once: a second pointer cancels the
 * hold, and none starts again until every pointer has lifted. A hold starts only inside the target (`inside(x, y)`).
 */
export class HoldGuard {
  constructor({ ms = HOLD_MS, slop = SLOP_PX, inside = () => true } = {}) {
    Object.assign(this, { ms, slop, inside });
    this.ids = new Set();
    this.blocked = false;
    this.hold = null; // { id, x, y, t }
  }
  /** `primary`: the first touch with no other on the screen (PointerEvent.isPrimary), which clears any pointer whose up was lost. */
  down(id, x, y, t, primary = false) {
    if (primary) { this.ids.clear(); this.blocked = false; }
    this.ids.add(id);
    if (this.ids.size > 1) { this.hold = null; this.blocked = true; return; }
    if (!this.blocked && this.inside(x, y)) this.hold = { id, x, y, t };
  }
  move(id, x, y) { if (this.hold?.id === id && Math.hypot(x - this.hold.x, y - this.hold.y) > this.slop) this.hold = null; }
  up(id) {
    this.ids.delete(id);
    if (this.hold?.id === id) this.hold = null;
    if (!this.ids.size) this.blocked = false;
  }
  get held() { return !!this.hold; }
  done(t) { return !!this.hold && t - this.hold.t >= this.ms; }
}

// Every input a pocket can make, and what the keyboard sends. Touch and wheel listeners are passive, so no scroll in the app
// waits for the main thread (BRIEF §8); pocketed, `touch-action: none` (app/mission.css) stops a touch's scroll, pinch and pull
// to refresh, and the other defaults (a long press's menu, a selection) are stopped here.
const INPUT = ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave",
  "gotpointercapture", "lostpointercapture", "touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mousemove", "mouseup",
  "mouseover", "mouseout", "click", "dblclick", "auxclick", "contextmenu", "wheel", "keydown", "keyup", "keypress", "selectstart", "dragstart"];
const passive = (type) => type.startsWith("touch") || type === "wheel";
let active = null, tail = null; // tail: the finger that held, after the hold took: its up and click are swallowed too, so none reaches the map
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
 * Pocket mode on: until a hold on `ring` (an element: its box, with `pad` px round it, is the target), Back or Escape, which
 * call `onLeave()` once. `ring.classList` gets "holding" while a hold runs (a disc fills the ring, app/mission.css). Returns `off()`, for
 * leaving by other means (the ride's end); it calls no `onLeave`.
 */
export function pocket({ ring, onLeave, pad = 16, buzz = () => {} }) {
  active?.off();
  const inside = (x, y) => { const r = ring.getBoundingClientRect(); return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; };
  const guard = new HoldGuard({ inside });
  let timer = 0, watch = null;
  const show = () => {
    ring.classList.toggle("holding", guard.held);
    clearTimeout(timer);
    if (guard.held) timer = setTimeout(() => { if (!guard.done(performance.now())) return; tail = { id: guard.hold.id, until: performance.now() + 5000 }; buzz(); leave(); }, guard.ms - (performance.now() - guard.hold.t) + 20);
  };
  const me = {
    feed(e) {
      const t = performance.now();
      if (e.type === "keydown" && e.key === "Escape") return leave();
      if (e.type === "pointerdown") guard.down(e.pointerId, e.clientX, e.clientY, t, e.isPrimary);
      else if (e.type === "pointermove") guard.move(e.pointerId, e.clientX, e.clientY);
      else if (e.type === "pointerup" || e.type === "pointercancel") guard.up(e.pointerId);
      else return;
      if (ring.classList.contains("holding") !== guard.held || e.type === "pointerdown") show();
    },
    off() {
      if (active !== me) return;
      active = null;
      clearTimeout(timer);
      ring.classList.remove("holding");
      const w = watch; watch = null; w?.destroy();
    },
  };
  function leave() { if (active !== me) return; me.off(); onLeave(); }
  active = me;
  try { if (globalThis.CloseWatcher) { watch = new CloseWatcher(); watch.onclose = () => { watch = null; leave(); }; } } catch { /* one per user gesture */ }
  return me.off;
}
