// W24 quiet: the one bubble (design/app-ui/SPEC.md §29). arclight, 2026-10-16: "If a button ever does not do anything,
// it should at least emit a short bubble explaining why. No action is just bad UX."
//
// tip(anchor, text, { ms }) shows `text` beside the control `anchor` for `ms` (2.5 s), then fades it. One bubble at a
// time: a new one takes its place. It sits left of a control at the right edge, above one in the lower half of the
// screen, below one in the upper half, else right of it: the first of those that fits inside the safe areas and clears
// the other controls by 8 px, wrapping its words into the gap or sliding past a control in the way if it must. It is a manual popover, so it shows over Settings and the other dialogs too, and it takes
// no taps. The element is app/index.html's #loctip (it began as the location button's answer, W21 locate); say() reads
// its words out (W73 a11y); its look is in app/app.css.
//
// why(control, text) marks a control that can't act now: `aria-disabled="true"` and the words. A tap on it then shows
// the bubble and goes no further (one capture listener on the window, before the control's own handler), so the
// control keeps its look, or a dim one where its CSS gives `[aria-disabled]` one, and always answers. why(control,
// null) makes it live again.
const GAP = 8;
export const CONTROLS = "#bar .tab, #about, #sound, #launch, #readout, #snack, #bar, #stack, #locate, #compass:not(.hide), #layers, #hifive, #cup, #nofix, #dlnote, .csearch, .cturn, .csheet, .bpill, #log-snack, .nsnack, .fcard"; // W26 downloads: #dlnote; W28 launch: exported, for app/tips.js, and the first Launch's card; W50 layers: #layers
let node = null, timer = 0;
let shownFor = null, awayWired = false; // arclight 2026-10-23: a bubble goes away at the next tap elsewhere (and Escape), not on a long timer
/** The bubble's fade, then hidden (the same as its timer's end). */
function fade() {
  if (!node || node.hidden) return;
  clearTimeout(timer); shownFor = null;
  node.classList.remove("on");
  timer = setTimeout(() => { node.hidden = true; if (node.matches?.(":popover-open")) node.hidePopover(); }, 300); // after the fade
}
/** Once: a press anywhere but the bubble or the control that showed it fades the bubble; the press still does what it hits.
 *  Its own control is left alone, so a tap on the same (i) shows it again with no flicker. */
function wireAway() {
  if (awayWired) return;
  awayWired = true;
  addEventListener("pointerdown", (e) => { if (node && !node.hidden && !node.contains(e.target) && !shownFor?.contains?.(e.target)) fade(); }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && node && !node.hidden) fade(); }, true);
}
let sayNode = null, sayTimer = 0; // W73 a11y

/** W73 a11y (SPEC §113): `text` read out by a screen reader, through index.html's #say, a live region there from the first
 *  frame: one made with its words in (a snackbar, a tip) is often skipped. The words go in a moment after it empties, so
 *  the same words twice are read twice, and go again after 8 s. */
export function say(text) { // W73 a11y
  sayNode ??= document.getElementById("say"); // W73 a11y
  if (!sayNode || !text) return; // W73 a11y
  sayNode.textContent = ""; clearTimeout(sayTimer); // W73 a11y
  sayTimer = setTimeout(() => { sayNode.textContent = text; sayTimer = setTimeout(() => { sayNode.textContent = ""; }, 8000); }, 100); // W73 a11y
} // W73 a11y

/** The safe areas, in px: { top, right, bottom, left }. */
export function insets() { // W28 launch: exported, for app/tips.js
  const probe = document.createElement("div");
  probe.className = "inset-probe";
  probe.style.padding = "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const cs = getComputedStyle(probe), px = (v) => parseFloat(v) || 0;
  const r = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  probe.remove();
  return r;
}
const meets = (a, b) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP;
const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility === "visible" ? r : null; };

/**
 * Where the bubble goes beside the box `a`, inside `area` and 8 px clear of the boxes `others`: { side, left, top, maxW,
 * first, clear }. Pure, for the unit tests. `size` is [w, h], or measure(maxW) → [w, h], which lets the words wrap into
 * a gap beside the control (120 px or more). The sides go in order (`first` is the one it would rather take); on each,
 * the spot level with the control or centred on it, else wrapped, else slid along or away from it by up to 200 px past
 * a control in the way, along its edge before away from it. W73 polish: with none clear within 200 px, the same farther
 * off; with nowhere clear, the spot clear of `a` itself that covers the least of the others, so a tip never hides the
 * control it explains; else the first side, held inside the area (`clear` false).
 */
export function place(a, size, area, others = []) {
  const measure = typeof size === "function" ? size : () => size;
  const [w0, h0] = measure(null);
  const cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2, W = area.right - area.left, H = area.bottom - area.top;
  const order = cx > area.left + W * 0.7 ? ["left", "above", "below", "right"] : cy > area.top + H / 2 ? ["above", "left", "right", "below"] : ["below", "left", "right", "above"];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fits = (b) => b.left >= area.left - 0.5 && b.top >= area.top - 0.5 && b.right <= area.right + 0.5 && b.bottom <= area.bottom + 0.5;
  const clear = (b) => !others.some((o) => meets(b, o));
  const boxAt = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
  let fallback = null, loose = null; // W73 polish: loose, the spot clear of the control itself that covers the least of the others
  const cover = (b) => others.reduce((s, o) => s + Math.max(0, Math.min(b.right, o.right) - Math.max(b.left, o.left)) * Math.max(0, Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top)), 0); // W73 polish
  for (const reach of [200, Infinity]) for (const side of order) { // W73 polish: then farther, before it covers anything (a sheet's tip, over the chart above the sheet)
    const flank = side === "left" || side === "right", variants = [[w0, h0, null]];
    if (flank) { // the gap beside it, up to the nearest control level with it
      const near = others.filter((o) => o.top < a.bottom + GAP && o.bottom > a.top - GAP);
      const room = Math.floor(side === "left" ? a.left - GAP - Math.max(area.left, ...near.filter((o) => o.right <= a.left).map((o) => o.right + GAP))
        : Math.min(area.right, ...near.filter((o) => o.left >= a.right).map((o) => o.left - GAP)) - a.right - GAP);
      if (room >= 120 && room < w0) variants.push([...measure(room), room]);
    }
    const spots = [];
    for (const [w, h, maxW] of variants) {
      const bx = flank ? (side === "left" ? a.left - GAP - w : a.right + GAP) : clamp(cx - w / 2, area.left, area.right - w);
      const by = flank ? clamp(cy - h / 2, area.top, area.bottom - h) : side === "above" ? a.top - GAP - h : a.bottom + GAP;
      spots.push({ left: bx, top: by, w, h, maxW, d: maxW ? 0.5 : 0 }); // level and whole first, then wrapped
      if (maxW) continue;
      const xs = [bx, ...others.flatMap((o) => [o.right + GAP, o.left - GAP - w])], ys = [by, ...others.flatMap((o) => [o.bottom + GAP, o.top - GAP - h])];
      for (const x of xs) for (const y of ys) {
        if ((side === "above" && y > by) || (side === "below" && y < by) || (side === "left" && x > bx) || (side === "right" && x < bx)) continue; // never toward it
        const away = flank ? x !== bx : y !== by, d = Math.hypot(x - bx, y - by);
        if (d > 0 && d <= reach) spots.push({ left: x, top: y, w, h, maxW: null, d: d + (away ? 1000 : 0) }); // along its edge before away from it
      }
    }
    spots.sort((p, q) => p.d - q.d);
    for (const sp of spots) {
      const b = boxAt(sp.left, sp.top, sp.w, sp.h);
      if (!fits(b)) continue;
      if (clear(b)) return { side, first: order[0], clear: true, maxW: sp.maxW, left: Math.round(sp.left), top: Math.round(sp.top) };
      if (!meets(b, a) && (!loose || cover(b) < loose.c)) loose = { side, c: cover(b), maxW: sp.maxW, left: sp.left, top: sp.top }; // W73 polish
    }
    fallback ??= { side, w: w0, h: h0, left: spots[0].left, top: spots[0].top };
  }
  if (loose) return { side: loose.side, first: order[0], clear: false, maxW: loose.maxW, left: Math.round(loose.left), top: Math.round(loose.top) }; // W73 polish: never over the control it explains
  return { side: fallback.side, first: order[0], clear: false, maxW: null,
    left: Math.round(clamp(fallback.left, area.left, area.right - fallback.w)), top: Math.round(clamp(fallback.top, area.top, area.bottom - fallback.h)) };
}

/** Show `text` beside `anchor` for `ms`. */
/**
 * W26 hold: a control's box as laid out, without the press's scale or the hold's swell. Both scale it about its centre,
 * so the centre stays put and the size comes from its layout (offsetWidth). An SVG has no layout size: its drawn box.
 */
export function layoutRect(n) {
  const b = n.getBoundingClientRect();
  if (!n.offsetWidth || !n.offsetHeight) return b;
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, w = n.offsetWidth, h = n.offsetHeight;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, width: w, height: h, x: cx - w / 2, y: cy - h / 2 };
}

export function tip(anchor, text, { ms = 2500, sheet = false, own = null } = {}) { // W49 cards: `sheet`, clear of the sheet it's in, for a long one; `own`: the one control whose tap doesn't fade it, when it isn't the anchor (arclight 2026-10-23: a Settings row's (i), so the rest of the row is "elsewhere")
  node ??= document.getElementById("loctip");
  if (!node || !anchor) return;
  const a = layoutRect(anchor); // W26 hold: beside the control, not its swell
  if (node.matches?.(":popover-open")) node.hidePopover(); // shown again, it goes over a dialog opened since
  node.classList.remove("on");
  node.hidden = false;
  node.showPopover?.();
  node.textContent = text; // after it shows, so a screen reader hears the change
  say(text); // W73 a11y: #loctip is no live region now: shown and filled in one go, it was often skipped
  const m = insets(), area = { left: m.left + GAP, top: m.top + GAP, right: innerWidth - m.right - GAP, bottom: innerHeight - m.bottom - GAP };
  const others = anchor.closest("dialog[open]") ? [] // the controls under a dialog don't show
    : [...document.querySelectorAll(CONTROLS)].filter((n) => n !== anchor && (!n.contains(anchor) || (sheet && n.matches(".csheet"))) && !anchor.contains(n)).map(shown).filter(Boolean);
  const measure = (maxW) => { node.style.maxWidth = maxW ? `${maxW}px` : ""; return [node.offsetWidth, node.offsetHeight]; };
  const p = place(a, measure, area, others);
  measure(p.maxW);
  node.style.left = `${p.left}px`;
  node.style.top = `${p.top}px`;
  node.dataset.side = p.side;
  requestAnimationFrame(() => node.classList.add("on"));
  clearTimeout(timer);
  shownFor = own ?? anchor; wireAway(); // arclight 2026-10-23: the next tap elsewhere fades it
  timer = setTimeout(fade, ms);
}

/** W73 plan: the bubble gone at once, if it still says `text` (a "Plotting…" whose wait is over). */
export function untip(text) { // W73 plan
  if (!node || node.hidden || node.textContent !== text) return; // W73 plan
  clearTimeout(timer); shownFor = null; node.classList.remove("on"); node.hidden = true; if (node.matches?.(":popover-open")) node.hidePopover(); // W73 plan
} // W73 plan

let wired = false;
/** Mark `control` as unable to act, with the words a tap on it shows; `text` null makes it live again. */
export function why(control, text) {
  if (!control) return;
  if (text) { control.setAttribute("aria-disabled", "true"); control.dataset.why = text; } else { control.removeAttribute("aria-disabled"); delete control.dataset.why; }
  if (wired) return;
  wired = true;
  addEventListener("click", (e) => {
    const c = e.target.closest?.("[data-why]");
    if (!c || c.getAttribute("aria-disabled") !== "true") return;
    e.preventDefault(); e.stopImmediatePropagation();
    tip(c, c.dataset.why);
  }, true);
}
