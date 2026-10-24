// A long press (wave 18, design/app-ui/SPEC.md §18; W26 hold: what it shows, §33): 500 ms on a control, then a 10 ms buzz where the phone
// has one, and the click that ends the press does nothing more. A short press keeps the control's own tap.
// The finger may wander 10 px. Android's long-press context menu and iOS's callout (calls.css) are held back.
import { haptic } from "./haptics.js"; // W69 motion; W88 settings3: haptic("hold")
export const LONG_MS = 500;
/** W84 roadtap (SPEC §164): the hold on the course's line and on its stops, 15 % shorter than LONG_MS. */
export const LINE_MS = 425;
/** The 10 ms buzz that answers a long press, where the phone has one; W25 course: the chart's holds give it too. */
export const buzz = () => haptic("hold"); // W69 motion; W88 settings3: the hold's own buzz, the one left outside a ride (app/haptics.js)

/** W26 hold: the time before a hold shows anything, so a tap leaves no mark (SPEC §33). */
export const QUIET_MS = 150;
const POP_MS = 320; // the pop's swell and glow (states.css), then it goes
const POP_SWELL = 1.45; // W40 maplayout: the pop's widest, as a share of the ring (states.css, @keyframes cpop)
const popT = new WeakMap(); // a control's pop, to restart

/**
 * W26 hold: what every hold shows (SPEC §33, the styles in states.css). On the chart (`x`, `y`, the finger's point): the
 * orange ring that grows there from 150 ms until `ms`. On a control (`node`): a white ring round its icon, as long. `take()`
 * is the moment the hold takes: the ring goes, a pop (a quick swell and glow, of the control too) says so, and the phone
 * buzzes. `end()` is a hold let go early: the ring goes and leaves no mark. Only the first of the two counts.
 */
export function holdMark({ x = 0, y = 0, node = null, ms = LONG_MS } = {}) {
  let size = 0, done = false;
  if (node) { // round the control's icon, a little wider than the control
    const b = node.getBoundingClientRect(), i = (node.querySelector(".i, .dial") ?? node).getBoundingClientRect();
    x = i.left + i.width / 2; y = i.top + i.height / 2; size = Math.max(44, Math.min(b.width, b.height)) + 12;
    // W40 maplayout: by the screen's edge (the bar's gear and Sound), smaller, so the pop's 1.45 swell stays on the screen
    const room = Math.min(x, y, innerWidth - x, innerHeight - y);
    size = Math.max(Math.min(size, (2 * room) / POP_SWELL), Math.max(i.width, i.height) + 8);
  }
  const mark = (cls) => {
    const m = Object.assign(document.createElement("div"), { className: node ? `${cls} on` : cls });
    Object.assign(m.style, { left: `${x}px`, top: `${y}px` }, size ? { width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px 0 0 ${-size / 2}px` } : {});
    return document.body.appendChild(m);
  };
  const ring = mark("cpress");
  ring.style.animationDuration = `${Math.max(0, ms - QUIET_MS)}ms`;
  const end = () => { if (done) return false; done = true; ring.remove(); return true; };
  const take = () => {
    if (!end()) return;
    buzz();
    const pop = mark("cpop");
    setTimeout(() => pop.remove(), POP_MS);
    if (!node) return;
    node.classList.remove("held"); void node.offsetWidth; // the control swells too, once more if it was
    node.classList.add("held");
    clearTimeout(popT.get(node));
    popT.set(node, setTimeout(() => node.classList.remove("held"), POP_MS));
  };
  return { take, end };
}

/** Call `onLong(event)` after a 500 ms press on `node`. Returns a function that removes the listeners. W26 hold: the press
 *  shows holdMark()'s ring round `node`, then its pop. */
export function longPress(node, onLong, { ms = LONG_MS } = {}) {
  let timer = 0, x = 0, y = 0, fired = false, mark = null;
  const cancel = () => { clearTimeout(timer); timer = 0; mark?.end(); mark = null; };
  const down = (e) => {
    if (e.button > 0) return;
    cancel();
    fired = false;
    x = e.clientX; y = e.clientY;
    mark = holdMark({ node, ms });
    timer = setTimeout(() => {
      timer = 0;
      fired = true;
      mark.take(); // and the buzz
      mark = null;
      onLong(e);
    }, ms);
  };
  const move = (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel(); };
  const click = (e) => { if (fired) { fired = false; e.preventDefault(); e.stopImmediatePropagation(); } };
  const menu = (e) => e.preventDefault();
  const on = [["pointerdown", down], ["pointermove", move], ["pointerup", cancel], ["pointercancel", cancel], ["pointerleave", cancel], ["contextmenu", menu]];
  for (const [t, f] of on) node.addEventListener(t, f);
  node.addEventListener("click", click, true); // before the control's own click
  return () => { cancel(); for (const [t, f] of on) node.removeEventListener(t, f); node.removeEventListener("click", click, true); };
}
