// W69 motion (design/app-ui/SPEC.md §107, design/ART.md's Motion): the UI's motion that CSS can't play alone, and its ticks.
// Everything here only moves transform and opacity, and nothing waits for it: the change is made at once, and the motion
// plays over it. Calm and the phone's reduced motion keep the fades and drop the glides (body.calm, set by app/main.js).
//   - a segmented control's highlight glides from the old choice to the new one
//   - a star that fills bursts
//   - Pace's value rolls up or down as it changes
//   - a list that changes slides its rows, so a row that goes collapses (the Log's Delete, Archive and Undo)
//   - a switch, a choice and a selection tick (app/haptics.js)
//   - iOS gives :active, the press-in, only to a page that listens for touches
import { tick } from "./haptics.js";

const still = () => document.body.classList.contains("calm"); // W76 look: app/main.js sets it from Settings' Motion, the phone's reduced motion unless Full
const token = (name, d) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || d;
const SEG = ".seg", ON = { "aria-checked": "true", "aria-current": "true" };

/** A segmented control's highlight, from `from`'s place and width to `to`'s: its ::before, as one transform. */
export function glide(from, to, ms = token("--t-small", 200)) {
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (!b.width || !a.width || still()) return null;
  const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease-standard").trim() || "ease-out";
  try {
    return to.animate({ transform: [`translateX(${(a.left - b.left).toFixed(1)}px) scaleX(${(a.width / b.width).toFixed(3)})`, "none"] },
      { duration: ms, easing: ease, pseudoElement: "::before" });
  } catch { return null; } // a browser without pseudo-element animations: the highlight moves at once
}

/** A star that fills: one burst (motion.css's .burst), for its length; or another class's one beat. */
export function burst(node, ms = token("--t-sheet", 320), cls = "burst") {
  if (still()) return;
  node.classList.remove(cls); void node.offsetWidth; // once more, if it was playing
  node.classList.add(cls);
  clearTimeout(node.burstT);
  node.burstT = setTimeout(() => node.classList.remove(cls), ms + 120);
}

/**
 * A list that changes, as one motion (FLIP): `change()` runs at once, then each row of `root` (`rows`, keyed by its
 * data-id) slides from where it was to where it is, so a row that went leaves a gap that closes, and a new row grows into
 * its gap. Only rows near the screen move. Returns what `change()` returns.
 * The rows' transforms are set each frame from here, not by a compositor animation: Chrome won't start a touch scroll on
 * an element whose transform animates there, and a drag right after a delete must scroll (nothing waits). It's a few
 * style writes a frame for 200 ms, no layout, and a touch, a wheel or the page's next change ends it at once.
 */
export function flip(root, change, { rows = "[data-id]", box = (n) => n.closest("li") ?? n } = {}) {
  stopFlip?.();
  if (!root || root.hidden || still()) return change();
  const H = innerHeight, near = (r) => r.height > 0 && r.bottom > -H / 2 && r.top < H * 1.5;
  const before = new Map();
  for (const n of root.querySelectorAll(rows)) { const b = box(n), r = b.getBoundingClientRect(); if (near(r)) before.set(n.dataset.id, r); }
  const out = change();
  if (!before.size) return out;
  const moves = []; // [node, dy (px) or null for a new row]
  for (const n of root.querySelectorAll(rows)) {
    const b = box(n), r = b.getBoundingClientRect();
    if (!near(r)) continue;
    const was = before.get(n.dataset.id);
    if (!was) moves.push([b, null]);
    else if (Math.abs(was.top - r.top) > 0.5) moves.push([b, was.top - r.top]);
  }
  if (!moves.length) return out;
  const ms = token("--t-small", 200), t0 = performance.now(), ease = (t) => 1 - (1 - t) ** 3; // about --ease-standard
  const draw = (t) => {
    const k = ease(t);
    for (const [b, dy] of moves) {
      if (dy === null) { b.style.transformOrigin = "50% 0"; b.style.transform = t < 1 ? `scaleY(${(0.4 + 0.6 * k).toFixed(3)})` : ""; b.style.opacity = t < 1 ? k.toFixed(3) : ""; }
      else b.style.transform = t < 1 ? `translateY(${(dy * (1 - k)).toFixed(1)}px)` : "";
    }
  };
  let raf = 0;
  const end = () => { cancelAnimationFrame(raf); draw(1); for (const t of ["pointerdown", "touchstart", "wheel"]) root.removeEventListener(t, end, true); stopFlip = null; };
  for (const t of ["pointerdown", "touchstart", "wheel"]) root.addEventListener(t, end, { capture: true, passive: true });
  stopFlip = end;
  const frame = () => { const t = Math.max(0, Math.min(1, (performance.now() - t0) / ms)); if (t >= 1) return end(); draw(t); raf = requestAnimationFrame(frame); }; // its own clock: a frame's timestamp can be before t0
  draw(0);
  raf = requestAnimationFrame(frame);
  return out;
}
let stopFlip = null;

// A change ticks only in the task of a tap or a key (so not a long press's, which buzzes for itself, nor the app's own), and
// once per tap, however many changes it makes (Battery saver sets Frame rate too).
let tapping = false, ticked = false;
const live = () => tapping;
const once = () => { if (ticked) return; ticked = true; tick(); };
/** A tap's tick, for a change motion.js doesn't see (the Log's selection): only in a tap's task, and once. */
export const tapTick = () => { if (tapping) once(); };

export function mountMotion(root = document) {
  root.addEventListener("touchstart", () => {}, { passive: true });
  const tap = () => { if (tapping) return; tapping = true; setTimeout(() => { tapping = ticked = false; }, 0); };
  for (const t of ["click", "keydown"]) root.addEventListener(t, tap, true);
  root.addEventListener("change", (e) => { if (tapping && e.target.matches?.('input[type="checkbox"]')) once(); });
  const seen = (records) => {
    const segs = new Map();
    for (const r of records) {
      const n = r.target, on = n.getAttribute(r.attributeName) === ON[r.attributeName] || (r.attributeName === "aria-pressed" && n.getAttribute("aria-pressed") === "true");
      const was = r.oldValue === "true";
      if (on === was) continue;
      if (r.attributeName === "aria-pressed") { if (on && n.matches(".star")) { burst(n); if (live()) once(); } else if (on && n.matches("#layerspick .tile")) burst(n, token("--t-small", 200), "pick"); continue; } // a Layers tile settles into its ring
      const seg = n.closest(SEG);
      if (!seg) continue;
      const s = segs.get(seg) ?? {};
      if (on) s.to = n; else s.from = n;
      segs.set(seg, s);
    }
    for (const { from, to } of segs.values()) {
      if (!to) continue;
      if (!to.getClientRects().length) continue; // a hidden one, set by another control (the Sound button sets Settings' Sound)
      if (from) glide(from, to);
      if (live()) once();
    }
  };
  // Pace's value rolls: a quicker pace comes up from below, a slower one down from above
  for (const out of document.querySelectorAll(".seg.pace output")) {
    let last = parseFloat(out.textContent);
    new MutationObserver(() => {
      const v = parseFloat(out.textContent);
      if (v !== last && last === last && !still()) out.animate({ transform: [`translateY(${v > last ? 8 : -8}px)`, "none"], opacity: [0.35, 1] }, { duration: token("--t-small", 200), easing: getComputedStyle(document.documentElement).getPropertyValue("--ease-enter").trim() || "ease-out" });
      last = v;
    }).observe(out, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver(seen).observe(root.body ?? root, { subtree: true, attributes: true, attributeFilter: ["aria-checked", "aria-current", "aria-pressed"], attributeOldValue: true });
}
