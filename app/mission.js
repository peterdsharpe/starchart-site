// W73 mission (design/app-ui/SPEC.md §122): mission nights, for a prototype. In flight:
// - **Burn up:** in free flight (no course), one tap plots the Fort (SCUL only; W219 favs3: no home, so Plain has none), as the
//   in-flight preview with Fly it. Its comet card is asked in flight too, planned from now, so after midnight a comet
//   that has stopped running for the night earns no card.
// - W195 pocket (SPEC §343): **Pocket**: the screen goes all black but a faint ring, and ignores every touch (app/pocket.js) until
//   Back, Escape or the ring slid up; the chart stops drawing (main.js's frame loop treats it as covered, as the Log), while GPS,
//   the track, the calls, the buzzes and the wake lock run on. The wake lock is held, whatever Keep the screen on says; without
//   one it says why and stays out. Land, or the ride ending by itself at its destination, ends it.
// - W208 pocketbuzz (SPEC §383): Pocket asked for fullscreen at its tap, so a pocket's edge swipe showed the system bars rather than
//   going home or back. W217 ridechrome (SPEC §419, her row 14): no more, as Chrome says "To exit full screen, drag from the top and
//   touch the back button" each time and a page can't hide it; a pocket's Back is guarded without it (app/pocket.js: a second Back
//   within 3 s leaves). The gap's bubble (app/main.js) comes in by pocketIn().
// - W210 pocket2 (SPEC §386, her rows 1 to 3, theirs both): Pocket is the ride's round button (touch screens only), at the top
//   of its column (app/home.css), one tap from the ride; the long-haul screen (W73's "Dim screen", its button and its large
//   numbers) went: nobody used it. The ring unlocks by a slide up its track, not a hold.
import { pick, onLingo } from "./lingo-mode.js";
import { el } from "./dom.js"; // W152 app-rest J2
import { own as ownScreen, sync as syncScreen } from "./screen.js"; // W190 screenstate (SPEC §330)
import { pocket, SLIDE_PX, SLIDE_MIN } from "./pocket.js"; // W195 pocket; W210 pocket2: SLIDE_PX, the track's length; W217 ridechrome: SLIDE_MIN
import { buzz } from "./press.js"; // W195 pocket: the buzz as the way out takes (W210 pocket2: the slide)
import { touch } from "./haptics.js"; // W200 small8
import { markSeen } from "./tips.js"; // W208 pocketbuzz: "pocketed", Pocket used once

export const WORDS = {
  burn: "Burn up", // W219 favs3 (SPEC §425): SCUL's alone, as nothing is home: Plain has no button (was "Head home")
  pocket: ["Pocket droid", "Pocket"], // W195 pocket: SCUL's "pocket droid", the phone (CULTURE.md)
  slide: ["Slide the ring up to show the chart", "Slide the ring up to show the map"], // W210 pocket2: was "Hold to show …"; 0.1.98's words review: the ring, since a swipe anywhere else does nothing
  back: ["Press Back again to show the chart", "Press Back again to show the map"], // 0.1.104's words read: with its verb, as the slide's line has one // W217 ridechrome: in the slide's place for 3 s after a first Back (app/pocket.js BACK_MS)
};

/** Where Burn up goes: the Fort (not in Plain, which has no Fort pick), else nowhere. W219 favs3 (SPEC §425), her row 1b: no home, so
 *  no favourite she named Home (W216 homefav's) nor the old key's place (W73's): a name is never a switch. */
export const burnTarget = ({ fort, plain }) => (plain ? null : fort) || null; // W219 favs3: was home, else the Fort

/** Burn up shows in free flight only, with somewhere to go, and not while Pocket covers the chart. A comet course is a course on
 *  the train too, between its legs, where `active` (a bike leg's) is false and `leg` stays. */
export const burnShown = ({ flying, active, leg, target, pocket }) => flying && !active && !leg && !!target && !pocket; // W210 pocket2: pocket, was the long-haul screen

export function mountMission({ flight, nav, onCover = () => {}, awake = async () => null, explain = () => {}, $ = (id) => document.getElementById(id) }) { // W195 pocket: awake(on), the wake lock held for Pocket (null, or why not); explain(node, text), a bubble
  const button = (id, icon) => { const b = el("button", "btn mission"); b.id = id; b.hidden = true; b.append(el("i", `i i-${icon}`), el("span", "lbl")); return b; };
  const burn = button("burnup", "hangar"), pk = button("pocket", "pocket"); // W210 pocket2: Pocket's round button, in the ride's column (was the long-haul screen's)
  pk.dataset.round = ""; // W190 testinvariants: a round button (app/index.html's data-round)
  const screen = el("section", "");
  screen.id = "pocketed"; screen.hidden = true; screen.tabIndex = -1; // W210 pocket2: was #haul; focused, so Escape reaches it
  screen.setAttribute("role", "dialog"); screen.setAttribute("aria-modal", "true");
  const track = el("div", "track"), ring = el("div", "ring"), hint = el("p", "hint"); // W210 pocket2: the ring at the thumb's height, its track above it
  ring.append(el("i", "i i-pocket"));
  track.append(ring);
  screen.style.setProperty("--slide", `${SLIDE_PX}px`); screen.style.setProperty("--slide-min", `${SLIDE_MIN}px`); // W210 pocket2: app/mission.css; W217 ridechrome: on the screen, whose padding reads it too, and the shortest
  screen.append(track, hint);
  document.body.append(burn, ...(touch() ? [pk] : []), screen); // W200 small8 (SPEC §356, her row 6): Pocket on a touch screen only: a computer goes in no pocket

  const m = { pocket: false }; // W210 pocket2: Pocket on (was haul, the long-haul screen, and pocket, its step)
  let unpocket = null, asking = false; // W195 pocket: pocket()'s off; a wake lock asked for
  ownScreen("pocket", () => m.pocket); // W190 screenstate; W210 pocket2: was "haul"
  let backed = false; // W217 ridechrome: a first Back in Pocket, its words in the slide's place a moment
  const words = () => {
    for (const [b, k] of [[burn, "burn"], [pk, "pocket"]]) { b.querySelector(".lbl").textContent = pick(WORDS[k]); b.setAttribute("aria-label", pick(WORDS[k])); }
    hint.textContent = pick(WORDS[backed ? "back" : "slide"]); // W210 pocket2; W217 ridechrome: or the Back's
    screen.setAttribute("aria-label", pick(WORDS.pocket));
  };
  words(); onLingo(words);
  function sync() {
    const flying = flight.flying;
    if (m.pocket && !flying) set(false); // Land, from anywhere, ends it
    const b = !burnShown({ flying, active: nav.active, leg: nav.leg, target: nav.burnTo, pocket: m.pocket });
    if (burn.hidden !== b) burn.hidden = b;
    if (pk.hidden !== (!flying || m.pocket)) pk.hidden = !flying || m.pocket; // W210 pocket2
  }
  // W217 ridechrome (SPEC §419): no fullscreen (W208 pocketbuzz's full() went): Chrome's notice about leaving it can't be hidden
  /** W208 pocketbuzz: into Pocket from a tap, its round button or the gap's bubble's. W210 pocket2: from the ride, in one tap; a
   *  refusal is said beside the round button, and the ride stays as it was. */
  async function pocketIn() {
    if (asking || m.pocket || !flight.flying) return;
    asking = true;
    const no = await awake(true); // the wake lock first: no lock, no Pocket (the screen would sleep, and GPS with it)
    asking = false;
    if (no) explain(pk, no); // W217 ridechrome: no fullscreen to leave
    else if (!flight.flying) awake(false); // landed meanwhile
    else set(true);
  }
  pk.onclick = () => pocketIn(); // W210 pocket2: the round button
  function set(on) {
    if (m.pocket === on) return;
    m.pocket = on;
    screen.hidden = !on;
    syncScreen(); // W190 screenstate
    for (const n of document.body.children) { // the covered app, out of reach of Tab and screen readers (aria-modal)
      if (n === screen) continue;
      if (on && !n.inert) { n.inert = true; n.dataset.pocketInert = ""; }
      else if (!on && "pocketInert" in n.dataset) { n.inert = false; delete n.dataset.pocketInert; }
    }
    onCover(on);
    if (on) { unpocket = pocket({ track, ring, buzz, onLeave: () => { unpocket = null; set(false); }, onBack: (b) => { backed = b; words(); } }); markSeen("pocketed"); } // W208 pocketbuzz: the Buzz-only ride's tip ends, and the gap's bubble is short; W217 ridechrome: onBack
    else { unpocket?.(); unpocket = null; awake(false); } // W217 ridechrome: no fullscreen to leave
    sync();
    (on ? screen : pk).focus?.({ preventScroll: true });
  }
  burn.onclick = () => nav.burnUp();
  let sampled = -Infinity;
  /** main.js's frame loop, under Pocket: true four times a second, to sample the pose for the warp. */
  m.due = (t) => { if (!m.pocket || t - sampled < 250) return false; sampled = t; return true; };
  m.sync = sync;
  m.set = set;
  m.pocketIn = pocketIn; // W208 pocketbuzz: the gap's bubble
  return m; // W77 restfix: no timer of its own; main.js's hud() calls sync() four times a second, while it runs (in flight, under Pocket)
}
