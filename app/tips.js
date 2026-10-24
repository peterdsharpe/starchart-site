// W28 launch: first-time tips (design/app-ui/SPEC.md §39). The tester asked for "a little tooltip the first time, and
// then after that you don't", with a way to bring them back deep in Settings.
//
// tipOnce(id, anchor, text) shows `text` in a small bubble beside the control `anchor`, once ever: it is marked seen
// (localStorage "starchart.tip.<id>" = "1") as it shows. One tip at a time: while one shows, another is not shown, and
// waits for its next moment. It goes at the next tap anywhere (W92 panels: no ×; on the tip too) or Escape, or after 10 s. It never shows in flight unless
// it is about safety, about reading the flight's readout, or about where a control went in flight ({ flight: true }), nor
// while a search, a sheet, Settings or the Log is open (main.js's gate).
// Settings' "Show tips again" clears every "starchart.tip.*" key.
//
// The tips, each where the app isn't obvious, and each at the moment it applies (main.js):
//   hold     the first time the chart parks on the pilot's ship: a long press on the chart sets a course
//   sound    after the first tap on the sound button: a long press gives the sound choices
//   compass  the first time the compass shows on the parked chart: a long press tilts the chart. North up, the compass
//            isn't there (a hold there would plan a course), so the tip waits until it is
//   units    at the first Launch, on the readout: what LY and warp are (1 LY is a mile; warp is mph)
//   gear     the first time Settings closes: a long press on the gear switches Dark and Daystar
//   settings at a Launch after units' (or the first, in Plain), on Sound: in flight the gear is away, and Sound's hold has
//            Settings at the chooser's foot (W75 chrome, SPEC §131; { flight: true })
//   free     the first time a course preview shows a route's transport-free share: what it counts (W49 cards; { sheet: true })
//   leaveby  at a preview after free's: a tap on the ride time picks an arrive-by and says when to leave (W102 leaveby; { sheet: true })
// Where a landed flight goes is in the first Launch's card ("Land ends it and saves it to the Log").
// launchCard() is the first Launch with no destination's card, under the same keys ("starchart.tip.launch").
import { place, layoutRect, insets, CONTROLS, say } from "./tip.js"; // W73 a11y: say
import { pick } from "./lingo-mode.js"; // W60 c

export const TIP = "starchart.tip.";
// W25 rest's hold hint was "starchart:hint-hold": a phone (or a test) that saw it keeps it seen
const OLD = { hold: "starchart:hint-hold" };
const GAP = 8, TIP_MS = 10_000;
let gate = () => true, cur = null, card = null;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
/** Whether tip `id` has been seen. With storage off, every tip counts as seen, so none repeats at each visit. */
export function seen(id) {
  try { return localStorage.getItem(TIP + id) === "1" || (!!OLD[id] && localStorage.getItem(OLD[id]) === "1"); } catch { return true; }
}
export function markSeen(id) { try { localStorage.setItem(TIP + id, "1"); } catch { /* storage off */ } }
/** main.js: `fn(safety, sheet)` says whether a tip may show now; `sheet`, for a tip inside the open sheet (W49 cards). */
export function tipGate(fn) { gate = fn; }

/** An × of 44 px, as the notices' (app/notice.js). */
function closeButton(label) {
  const x = el("button", "nx");
  x.setAttribute("aria-label", label);
  x.append(el("i", "i i-close"));
  return x;
}

/** Show tip `id` beside `anchor`, once ever. True if it showed. */
export function tipOnce(id, anchor, text, { flight = false, sheet = false } = {}) { // W49 cards: `sheet`, a tip about a sheet's own control
  if (cur || card || !anchor || seen(id) || !gate(flight, sheet)) return false;
  markSeen(id);
  const n = el("div", "ftip"); // W92 panels: no ×: a tooltip goes at the next tap, anywhere, or Escape (his overlays rule)
  n.dataset.tip = id; // W73 a11y: no role="status": say() reads it
  n.append(el("span", "t", text));
  document.body.append(n);
  say(text); // W73 a11y
  const node = anchor instanceof Node;
  /** Beside the anchor (a control, or the ship's layer: anything with a box), clear of the other controls; again on a resize. */
  const put = () => {
    const m = insets(), area = { left: m.left + GAP, top: m.top + GAP, right: innerWidth - m.right - GAP, bottom: innerHeight - m.bottom - GAP };
    const others = [...document.querySelectorAll(CONTROLS)].filter((c) => !node || (c !== anchor && (!c.contains(anchor) || (sheet && c.matches(".csheet"))) && !anchor.contains(c))) // W49 cards: a sheet's tip, over the chart
      .map((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility === "visible" ? r : null; }).filter(Boolean);
    const measure = (maxW) => { n.style.maxWidth = maxW ? `${maxW}px` : ""; return [n.offsetWidth, n.offsetHeight]; };
    const p = place(node ? layoutRect(anchor) : anchor.getBoundingClientRect(), measure, area, others);
    measure(p.maxW);
    n.style.left = `${p.left}px`;
    n.style.top = `${p.top}px`;
    n.dataset.side = p.side;
  };
  put();
  const again = () => requestAnimationFrame(() => requestAnimationFrame(put)); // once the chart has drawn at the new size
  addEventListener("resize", again);
  const settle = setTimeout(put, 350); // and once a bar sliding in (300 ms) has settled

  const away = () => close(); // W92 panels: any tap, on the tip too, and the tap still acts
  const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } }; // W92 panels: the tip only, not the sheet under it
  const timer = setTimeout(() => close(), TIP_MS);
  function close() {
    clearTimeout(timer); clearTimeout(settle);
    removeEventListener("resize", again);
    removeEventListener("pointerdown", away, true);
    removeEventListener("keydown", esc, true); // W92 panels
    n.remove();
    if (cur?.n === n) cur = null;
  }
  addEventListener("pointerdown", away, true);
  addEventListener("keydown", esc, true); // W92 panels
  cur = { id, n, close };
  return true;
}
/** Close the tip showing (only tip `id`, when given). */
export function closeTip(id) { if (cur && (!id || cur.id === id)) cur.close(); }

/**
 * W28 launch: the first Launch with no destination, once ever: a small card above the bar says what Launch does. True if
 * it showed (the caller then waits for the pilot's pick); false once seen. W76 look (D14b): the card is its sentence and its
 * ×, its tail on the bar's Launch, right under it: the bar's own Where to? and Launch are the pick, not a second pair on the card.
 * Its ×, Back or a tap or click anywhere else closes it; a tap on Launch then launches, and one on Where to? opens the search.
 */
export function launchCard(bar) { // W76 look: the bar's buttons are the pick
  if (seen("launch") || !bar) return false;
  markSeen("launch");
  closeTip();
  const c = el("section", "fcard"), x = closeButton("Close");
  c.setAttribute("role", "dialog");
  c.setAttribute("aria-label", pick("Launch with no destination", "Record with no destination")); // W60 c; W88 ridemodes: Plain's Record
  const text = pick("With no destination, Launch records the ride. Land ends it and saves it to the Log.", // W60 c
    "Record tracks the ride, with no destination. End stops it and saves it to the Log."); // W88 ridemodes: Plain's Record
  c.append(el("p", "", text), x); // W76 look: no row
  let watch = null;
  const away = (e) => { if (!c.contains(e.target)) close(); }; // a tap anywhere else: a second tap on Launch then launches
  const close = () => { watch?.destroy(); watch = null; removeEventListener("pointerdown", away, true); removeEventListener("click", away, true); c.remove(); if (card === c) card = null; };
  addEventListener("pointerdown", away, true);
  addEventListener("click", away, true); // W76 look: and a click with no pointer, as Enter on the bar's Launch, which keeps the focus
  if (window.CloseWatcher) { try { watch = new CloseWatcher(); watch.onclose = () => { watch = null; close(); }; } catch { /* one per user gesture */ } }
  x.onclick = close;
  const go = bar.querySelector("#launch")?.offsetWidth; // W76 look: the tail, over Launch's middle: Launch ends the bar, and the card's right is the bar's, at any size
  if (go) c.style.setProperty("--tail", `${Math.round(go / 2)}px`);
  bar.after(c);
  say(text); // W76 look: the focus stays on the bar, so a screen reader hears it here, as tipOnce's
  card = c;
  return true;
}
