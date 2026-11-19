// W201 gestures (design/app-ui/SPEC.md §362), his row 7 of 2026-11-07: "all popups should be slideable to dismiss on phone".
//
// swipeAway(node, { dirs, close, when }) lets a finger swipe `node` away, the ways in `dirs` ("down", "up", "left", "right": a
// sheet down, a panel at the top up, a popup, bubble or Undo bar down or sideways, as suits its place), as well as closing it as
// before: it follows the finger along the first way the finger goes past SLOP px, and on release glides off the screen and calls
// `close()` (the overlay's own way out, so it closes just as its × or a tap away does), or glides back to its place when the
// swipe was short. A touch screen's only (touch events, not a mouse's), and only while `when()` says so.
// - The map never moves: the overlay takes the touch, and once the swipe is its own its touchmoves are cancelled (no pan, no
//   scroll). A touch that starts in a control with a drag of its own (a slider, a text box, data-noswipe) is left alone, as is a
//   swipe the other way, or one a scrolled part under the finger would scroll (a sheet's list, back to its top first).
// - The offset is a transform added to the overlay's own (WAAPI, composite "add"), so its placing and its entrance stay as
//   they are. The glides take 200 to 400 ms (BRIEF §7.8), in Calm too: they say where it went.
export const SLOP = 8; // px before a touch is a swipe, and which way it goes
export const FAR = 0.4, FAR_MAX = 120; // a swipe this far (of the overlay's size that way, at most FAR_MAX px) sends it away…
export const FLING = 0.5, FLING_MIN = 24; // …as does a flick at FLING px/ms over FLING_MIN px or more
export const GLIDE = [200, 400]; // ms: BRIEF §7.8's glides
export const ALL = ["down", "up", "left", "right"], BOTTOM = ["down", "left", "right"], TOP = ["up", "left", "right"]; // a popup over the chart; a bar at the foot; one at the top

/** The way a touch moved by (dx, dy) goes, once it's SLOP px from where it began: "down", "up", "left" or "right", else null. */
export function way(dx, dy, slop = SLOP) {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? "down" : "up") : dx > 0 ? "right" : "left";
}

/** Whether a swipe `d` px along its way, ending at `v` px/ms that way, sends away an overlay `size` px across that way. */
export const away = (d, v, size) => d >= Math.min(FAR * size, FAR_MAX) || (v >= FLING && d >= FLING_MIN);

/** The glide's length for `left` px more at the finger's `v` px/ms, held to GLIDE. */
export const glideMs = (left, v = 0) => Math.round(Math.max(GLIDE[0], Math.min(GLIDE[1], left / Math.max(v, 1e-3))));

const AXIS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const OWN = "input, textarea, select, [data-noswipe], .cstrip"; // a drag of its own: a slider, a text box, the heights' strip (its finger cursor)
const EASE = "cubic-bezier(.2, 0, 0, 1)"; // --ease-standard (design/tokens.css)

/** Whether a part between `t` and `node` (both included) would scroll for a finger going `w`: it isn't at that end yet. */
export function scrolls(t, w, node) { // W203 preview2: exported, for the preview's drag anywhere (app/course.js)
  for (let n = t; n && n.nodeType === 1; n = n === node ? null : n.parentElement) {
    const y = w === "down" || w === "up", cs = getComputedStyle(n), o = y ? cs.overflowY : cs.overflowX;
    if (!/auto|scroll/.test(o)) continue;
    if (y ? n.scrollHeight <= n.clientHeight + 1 : n.scrollWidth <= n.clientWidth + 1) continue;
    if (w === "down" ? n.scrollTop > 0 : w === "up" ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : w === "right" ? n.scrollLeft > 0 : n.scrollLeft + n.clientWidth < n.scrollWidth - 1) return true;
  }
  return false;
}

/** Let a finger swipe `node` away (above). Returns a function that stops it. */
export function swipeAway(node, { dirs = ["down"], close, when = () => true }) {
  let g = null, drag = null; // the touch at hand: { id, x, y, w, pts }; the offset's animation
  const tr = (x, y) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const put = (x, y) => {
    const k = [{ transform: tr(x, y) }, { transform: tr(x, y) }];
    if (drag) drag.effect.setKeyframes(k); else drag = node.animate(k, { duration: 1, fill: "forwards", composite: "add" });
  };
  const start = (e) => {
    if (g?.w) return; // W201 gestures fix: a second finger mid-swipe; the swipe goes on with the first, to its end
    g = null;
    if (e.touches.length !== 1 || e.target.closest?.(OWN) || !when()) return;
    const p = e.touches[0];
    g = { id: p.identifier, x: p.clientX, y: p.clientY, w: null, pts: [[e.timeStamp, 0]] };
  };
  const move = (e) => {
    const p = g && [...e.changedTouches].find((t) => t.identifier === g.id);
    if (!p) return;
    const dx = p.clientX - g.x, dy = p.clientY - g.y;
    if (!g.w) {
      const w = way(dx, dy);
      if (!w) return;
      if (!dirs.includes(w) || scrolls(e.target, w, node)) { g = null; return; } // not this overlay's: a scroll, or the other way
      g.w = w; g.both = dirs.includes(w === "left" ? "right" : w === "right" ? "left" : ""); // sideways both ways, when it goes either
    }
    if (e.cancelable) e.preventDefault(); // the swipe is the overlay's: no scroll, no pan
    const [ax, ay] = AXIS[g.w], along = dx * ax + dy * ay, d = g.both ? along : Math.max(0, along); // never the other way, but back to its place
    g.d = d; g.pts.push([e.timeStamp, d]); if (g.pts.length > 6) g.pts.shift();
    put(ax * d, ay * d);
  };
  const end = (e) => {
    if (!g || ![...e.changedTouches].some((t) => t.identifier === g.id)) return;
    const s = g; g = null;
    if (!s.w) return; // a tap: the overlay's own
    const [t1, d1] = s.pts.at(-1), [t0, d0] = s.pts.find(([t]) => t1 - t <= 100) ?? s.pts[0];
    const v = t1 > t0 ? (d1 - d0) / (t1 - t0) : 0, sign = s.d < 0 ? -1 : 1, d = Math.abs(s.d), vd = v * sign; // `both`: whichever side it went
    const [ax, ay] = AXIS[s.w].map((a) => a * sign), r = node.getBoundingClientRect(), size = ay ? r.height : r.width;
    const from = [ax * d, ay * d];
    if (e.type === "touchend" && away(d, vd, size)) { // off the screen, by its own edge
      const left = ay > 0 ? innerHeight - r.top : ay < 0 ? r.bottom : ax > 0 ? innerWidth - r.left : r.right;
      const ms = glideMs(left, vd), out = node.animate([{ transform: tr(...from) }, { transform: tr(ax * (d + left), ay * (d + left)) }], { duration: ms, easing: EASE, fill: "forwards", composite: "add" });
      drag?.cancel(); drag = null;
      out.onfinish = () => { // closed, its own exit playing off the screen; in its place again once that's done, or at once when it changes (shown again)
        close();
        const back = () => { clearTimeout(t); seen.disconnect(); out.cancel(); }, seen = new MutationObserver(back), t = setTimeout(back, 400);
        seen.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
      };
    } else if (d > 0) {
      const back = node.animate([{ transform: tr(...from) }, { transform: tr(0, 0) }], { duration: GLIDE[0], easing: EASE, composite: "add" });
      drag?.cancel(); drag = null;
      back.onfinish = () => back.cancel();
    } else { drag?.cancel(); drag = null; }
  };
  const on = [["touchstart", start, { passive: true }], ["touchmove", move, { passive: false }], ["touchend", end], ["touchcancel", end]];
  for (const [t, f, o] of on) node.addEventListener(t, f, o);
  return () => { for (const [t, f, o] of on) node.removeEventListener(t, f, o); };
}

// W210 popups3 (design/app-ui/SPEC.md §391), her row 34 of 2026-11-09: "When the weather panel is open, tapping once on the map
// outside of the panel should close it. It should still be possible to drag and zoom the map while the panel stays open."
/** Close a panel over the chart (`node`) on a tap outside it, never on a drag or a pinch of the chart (UX rule 38). A press on the
 *  chart (`chart(target)`) closes it as it ends, when it was one finger that moved under SLOP px, and that tap only closes it (its
 *  click is eaten, as a peek's is, SPEC §225); a press on anything else outside it, a control, closes it at once and goes on to
 *  act, as before. `open()` says whether it's up; `keep(target)`, what never closes it (its own button, which toggles it).
 *  Returns a function that stops it. */
export function tapAway(node, { close, open = () => !node.hidden, keep = () => false, chart = (t) => !!t?.closest?.(".maplibregl-canvas-container"), on = globalThis }) {
  const down = new Map(); // the fingers (or the mouse) on the chart now: pointerId → where each began
  let tap = false, ate = -Infinity; // whether the press at hand is still a tap; when a tap closed the panel (its click is eaten)
  const press = (e) => {
    ate = -Infinity;
    if (!open() || node.contains(e.target) || keep(e.target)) return;
    if (!chart(e.target)) return close();
    tap = down.size === 0; // a second finger: a pinch
    down.set(e.pointerId, [e.clientX, e.clientY]);
  };
  const move = (e) => { const p = down.get(e.pointerId); if (p && Math.hypot(e.clientX - p[0], e.clientY - p[1]) >= SLOP) tap = false; }; // a drag
  const lift = (e) => {
    if (!down.delete(e.pointerId)) return;
    if (e.type === "pointerup" && tap && !down.size && open()) { close(); ate = e.timeStamp; }
    tap = false;
  };
  const click = (e) => { if (e.timeStamp - ate < 500 && chart(e.target)) { ate = -Infinity; e.preventDefault(); e.stopImmediatePropagation(); } };
  const ons = [["pointerdown", press], ["pointermove", move], ["pointerup", lift], ["pointercancel", lift], ["click", click]];
  for (const [t, f] of ons) on.addEventListener(t, f, true);
  return () => { for (const [t, f] of ons) on.removeEventListener(t, f, true); };
}
