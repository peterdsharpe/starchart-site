// W28 launch: first-time tips (design/app-ui/SPEC.md §39). The tester asked for "a little tooltip the first time, and
// then after that you don't", with a way to bring them back deep in Settings.
//
// tipOnce(id, anchor, text) shows `text` in a small bubble beside the control `anchor`, once ever: it is marked seen
// (localStorage "starchart.tip.<id>" = "1") as it shows. One tip at a time: while one shows, another is not shown, and
// waits for its next moment. It goes at the next tap anywhere (W92 panels: no ×; on the tip too) or Escape, with no timeout
// (W112 taps); a tap on the tip only closes it, and the tap elsewhere still acts. It never shows in flight unless
// it is about safety, about reading the flight's readout, or about where a control went in flight ({ flight: true }), nor
// while a search, a sheet, Settings or the Log is open (main.js's gate).
// Settings' "Show tips again" clears every "starchart.tip.*" key.
//
// The tips, each where the app isn't obvious, and each at the moment it applies (main.js):
//   (hold went, W219 placecard, SPEC §427: her row 12; the hold stays, made precise, and the search's hint line names it)
//   compass  the first time the compass shows on the parked chart: a long press tilts the chart. North up, the compass
//            isn't there (a hold there would plan a course), so the tip waits until it is
//   units    at the first Launch, on the readout: what LY and warp are (1 LY is a mile; warp is mph)
//   comfort  the first time a course preview shows a route in the comfort scale: what its colour means, beside its card
//            (W110 looks: her "sometimes it's green. I don't understand why it changes"; { sheet: true })
//   free     the first time a course preview shows a route's transport-free share: what it counts (W49 cards; { sheet: true })
//   (leaveby went with the ride time's picker, W215 ridesheet: the When row's Arrive by says itself)
//   pocket   back on a ride's page after the screen went off (GPS stopped with it): the way to Pocket, which keeps the ride going
//            with the phone in a pocket, on Pocket's round button (W195 pocket; { flight: true }; W210 pocket2: was beside the
//            long-haul button, "Dim screen, then Pocket")
//   buzz     a ride started on Buzz only: the turns buzz only while the screen is on, and the way to Pocket, on its round button,
//            each ride until she has used Pocket once, three rides at most (W208 pocketbuzz; { flight: true, until: "pocketed" });
//            "pocketed" is marked seen as Pocket first comes on (app/mission.js), and shortens the gap's bubble (showTip, app/main.js)
// W177 buttons2 (SPEC §312): sound, gear and settings are gone with the holds they told of (her note 11: no pop-ups on the round
// buttons; note 6: Settings' hold for the theme was counterintuitive; nobulb, SPEC §320: the theme is Settings › Theme's).
// Where a landed flight goes is in the first Launch's card ("Land ends it and saves it to the Log").
// launchCard() is the first Launch with no destination's card, under the same keys ("starchart.tip.launch").
import { place, layoutRect, safeArea, CONTROLS, say } from "./tip.js"; // W73 a11y: say; W152 app-rest O4: safeArea, for insets
import { pick } from "./lingo-mode.js"; // W60 c
import { swipeAway, ALL, TOP } from "./swipe.js"; // W201 gestures
import { el, closeOnBack, backOnTouch } from "./dom.js"; // W152 app-rest J2; J6: closeOnBack; W210 popups3: backOnTouch

export const TIP = "starchart.tip.";
/** W190 testinvariants (SPEC §333): every first-time tip's id, its key TIP + id: the tipOnce ids above with port (course.js), the
 *  first Launch's card and the welcome (app/welcome.js). The e2e suite marks these seen (tests/e2e/helpers.mjs), and a unit
 *  (app/tests/tip.test.mjs) checks every id the app shows is here. */
export const TIPS = [/* W219 placecard: no hold */ "compass", "units", "comfort", "free", /* W215 ridesheet: no leaveby */ "port", "launch", "welcome", "pocket", "buzz", "pocketed"]; // W190 testinvariants; W195 pocket; W208 pocketbuzz: buzz, pocketed
// W25 rest's hold hint was "starchart:hint-hold": a phone (or a test) that saw it keeps it seen
const OLD = { hold: "starchart:hint-hold" };
let gate = () => true, cur = null, card = null;

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

/** Show tip `id` beside `anchor`, once ever. True if it showed. W208 pocketbuzz: `until`, another tip whose being seen ends it,
 *  shown each time asked until then, and never marked itself; `times`, at most that often (0.1.95). */
export function tipOnce(id, anchor, text, { flight = false, sheet = false, until = id, times = Infinity } = {}) { // W49 cards: `sheet`, a tip about a sheet's own control
  const n = shown(id);
  if (seen(until) || n >= times || !showTip(id, anchor, text, { flight, sheet })) return false; // W208 pocketbuzz: showTip; 0.1.95's words review: `times`, at most
  if (until === id) markSeen(id); // W208 pocketbuzz
  else if (times < Infinity) try { localStorage.setItem(`${TIP}${id}.n`, String(n + 1)); } catch { /* storage off */ } // 0.1.95: counted beside its key, so Show tips again clears it too
  return true;
}
/** How often tip `id` with `until` and `times` has shown (0.1.95's words review: the Buzz-only ride's tip, at most 3 times). */
const shown = (id) => { try { return +(localStorage.getItem(`${TIP}${id}.n`) || 0); } catch { return 0; } };
/** W208 pocketbuzz: tipOnce's bubble, whether seen or not: `text` beside `anchor`, through the tips' gate, one at a time; `act`, a
 *  button under the words ({ label, icon, run }), which runs and closes it. True if it showed. */
export function showTip(id, anchor, text, { flight = false, sheet = false, act = null } = {}) { // W208 pocketbuzz: from tipOnce
  if (cur || card || !anchor || !gate(flight, sheet)) return false;
  const n = el("div", "ftip"); // W92 panels: no ×: a tooltip goes at the next tap, anywhere, or Escape (his overlays rule)
  n.dataset.tip = id; // W73 a11y: no role="status": say() reads it
  n.append(el("span", "t", text));
  if (act) { const b = el("button", "dlnow"); b.append(el("i", `i i-${act.icon}`), act.label); b.onclick = () => act.run(); n.append(b); } // W208 pocketbuzz: the gap's Pocket; the tip's own click closes it after
  document.body.append(n);
  say(text); // W73 a11y
  const node = anchor instanceof Node;
  /** Beside the anchor (a control, or the ship's layer: anything with a box), clear of the other controls; again on a resize. */
  const put = () => {
    const area = safeArea(); // W152 app-rest O4: tip.js's
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

  const away = (e) => { if (!n.contains(e.target)) close(); }; // W92 panels: any tap elsewhere, and the tap still acts
  n.onclick = close; // W112 taps: a tap on the tip closes it at its click, so the click stays the tip's and nothing under it acts
  swipeAway(n, { dirs: ALL, close }); // W201 gestures (SPEC §362)
  const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } }; // W92 panels: the tip only, not the sheet under it
  let back = backOnTouch(() => { back = null; close(); }); // W210 popups3 (SPEC §391): Android's back closes the tip, and only it
  function close() {
    back?.destroy(); back = null; // W210 popups3
    clearTimeout(settle);
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
  const text = pick("Launch records the ride. Land saves it to the Log.", // W60 c; W140 words: the card shows only with no destination
    "Record tracks the ride. End saves it to the Log."); // W88 ridemodes: Plain's Record
  c.append(el("p", "", text), x); // W76 look: no row
  let watch = null;
  const away = (e) => { if (!c.contains(e.target)) close(); }; // a tap anywhere else: a second tap on Launch then launches
  const close = () => { watch?.destroy(); watch = null; removeEventListener("pointerdown", away, true); removeEventListener("click", away, true); c.remove(); if (card === c) card = null; };
  addEventListener("pointerdown", away, true);
  addEventListener("click", away, true); // W76 look: and a click with no pointer, as Enter on the bar's Launch, which keeps the focus
  watch = closeOnBack(() => { watch = null; close(); }); // W152 app-rest J6: app/dom.js (watch is null here: declared above)
  x.onclick = close;
  swipeAway(c, { dirs: TOP, close }); // W201 gestures (SPEC §362): it hangs under the top bar
  bar.after(c);
  const go = bar.querySelector("#launch")?.getBoundingClientRect(), box = { width: c.offsetWidth, right: c.offsetLeft + c.offsetWidth }; // as laid out, not mid-animation; W76 look: the tail, over Launch's middle; W196 ui4 (SPEC §347): the card hangs under the top bar, clear of the top group's column, so the tail goes as near Launch's middle as the card reaches
  if (go?.width) c.style.setProperty("--tail", `${Math.round(Math.max(24, Math.min(box.width - 24, box.right - (go.left + go.right) / 2)))}px`);
  say(text); // W76 look: the focus stays on the bar, so a screen reader hears it here, as tipOnce's
  card = c;
  return true;
}
