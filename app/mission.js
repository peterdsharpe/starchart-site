// W73 mission (design/app-ui/SPEC.md §122): mission nights, for a prototype. Two things in flight:
// - **Burn up:** in free flight (no course), one tap plots home, or the Fort when no home is set (SCUL only), as the
//   in-flight preview with Fly it. Its comet card is asked in flight too, planned from now, so after midnight a comet
//   that has stopped running for the night earns no card.
// - **The long-haul screen:** a near-black screen over the chart for a 3 to 5 hour mission. The chart stops drawing
//   (main.js's frame loop treats it as covered, as the Log), while GPS, the track, the calls and Wake Lock run on. It
//   shows the readout and the next turn, dim; Chart goes back. W177 buttons2 (SPEC §312), her note 5: "any tap/click on that screen
//   should take us back to map view. The tiny map button should be gone. Instead at the bottom center of the screen put a message
//   that says "tap to return to map"": a tap anywhere on it goes back, and the button is that line, in words, at the foot.
// - W195 pocket (SPEC §343): **Pocket**, a button on the long-haul screen (over its foot's line; in a short screen's top corner;
//   on its side, a column of its own): the screen goes all black but a faint ring and "Hold to show the map", and ignores every
//   touch (app/pocket.js) until a 1.5 s hold on the ring, Back or Escape, which go back to the chart. The wake lock is held,
//   whatever Keep the screen on says; without one it says why and stays. Land, or the ride ending by itself at its
//   destination, ends both.
import { pick, onLingo } from "./lingo-mode.js";
import { el } from "./dom.js"; // W152 app-rest J2
import { own as ownScreen, sync as syncScreen } from "./screen.js"; // W190 screenstate (SPEC §330)
import { pocket } from "./pocket.js"; // W195 pocket
import { buzz } from "./press.js"; // W195 pocket: the hold's buzz as it takes

export const WORDS = {
  burn: ["Burn up", "Head home"],
  haul: ["Long haul", "Dim screen"],
  back: ["Tap to return to the chart", "Tap to return to the map"], // W177 buttons2: was "Chart" / "Map", a small pill
  pocket: ["Pocket droid", "Pocket"], hold: ["Hold to show the chart", "Hold to show the map"], // W195 pocket: SCUL's "pocket droid", the phone (CULTURE.md)
  ly: ["LY", "mi"], warp: ["Warp", "mph"], min: "Min",
};

/** Where Burn up goes: home, else the Fort (not in Plain, which has no Fort pick), else nowhere. */
export const burnTarget = ({ home, fort, plain }) => home || (plain ? null : fort) || null;

/** Burn up shows in free flight only, with somewhere to go, and not while the long-haul screen covers the chart. A comet
 *  course is a course on the train too, between its legs, where `active` (a bike leg's) is false and `leg` stays. */
export const burnShown = ({ flying, active, leg, target, haul }) => flying && !active && !leg && !!target && !haul;

export function mountMission({ flight, nav, onCover = () => {}, awake = async () => null, explain = () => {}, $ = (id) => document.getElementById(id) }) { // W195 pocket: awake(on), the wake lock held for Pocket (null, or why not); explain(node, text), a bubble
  const button = (id, icon) => { const b = el("button", "btn mission"); b.id = id; b.hidden = true; b.append(el("i", `i i-${icon}`), el("span", "lbl")); return b; };
  const burn = button("burnup", "hangar"), haulBtn = button("longhaul", "amoled");
  haulBtn.dataset.round = ""; // W190 testinvariants: a round button (app/index.html's data-round)
  const screen = el("section", "");
  screen.id = "haul"; screen.hidden = true; screen.tabIndex = -1; // a tap on the black keeps the focus here, so Escape still ends it
  screen.setAttribute("role", "dialog"); screen.setAttribute("aria-modal", "true");
  const turn = el("div", "turn"), arrow = Object.assign(el("img", "arrow"), { alt: "" }), dist = el("b", "dist"), road = el("span", "road");
  turn.append(arrow, dist, road);
  const big = el("div", "ly"), ly = el("b", ""), lyL = el("span", "lbl");
  big.append(ly, lyL);
  const pair = el("div", "pair"), mins = el("b", ""), minL = el("span", "lbl"), warp = el("b", ""), warpL = el("span", "lbl");
  const cell = (b, l) => { const d = el("div", ""); d.append(b, l); return d; };
  pair.append(cell(mins, minL), cell(warp, warpL));
  const back = el("button", "back");
  const pk = el("button", "pocket"), pkL = el("span", ""); // W195 pocket: the way in
  pk.append(el("i", "i i-pocket"), pkL);
  const ring = el("div", "ring"), hint = el("p", "hint"), pocketed = el("div", "pk"); // W195 pocket: what pocket mode shows, faint
  ring.append(el("i", "i i-pocket"));
  pocketed.append(ring, hint);
  screen.append(turn, big, pair, pk, back, pocketed);
  document.body.append(burn, haulBtn, screen);

  const m = { haul: false, pocket: false }; // W195 pocket
  let unpocket = null, asking = false; // W195 pocket: pocket()'s off; a wake lock asked for
  ownScreen("haul", () => m.haul); // W190 screenstate: was body.haul
  const words = () => {
    for (const [b, k] of [[burn, "burn"], [haulBtn, "haul"]]) { b.querySelector(".lbl").textContent = pick(WORDS[k]); b.setAttribute("aria-label", pick(WORDS[k])); }
    back.textContent = pick(WORDS.back);
    pkL.textContent = pick(WORDS.pocket); hint.textContent = pick(WORDS.hold); // W195 pocket
    screen.setAttribute("aria-label", m.pocket ? pick(WORDS.pocket) : pick(WORDS.haul));
    lyL.textContent = pick(WORDS.ly); warpL.textContent = pick(WORDS.warp); minL.textContent = WORDS.min;
  };
  words(); onLingo(words);
  const text = (sel) => document.querySelector(sel)?.textContent ?? "";
  function sync() {
    const flying = flight.flying;
    if (m.haul && !flying) set(false); // Land, from anywhere, ends it
    const b = !burnShown({ flying, active: nav.active, leg: nav.leg, target: nav.burnTo, haul: m.haul });
    if (burn.hidden !== b) burn.hidden = b;
    if (haulBtn.hidden !== (!flying || m.haul)) haulBtn.hidden = !flying || m.haul;
    if (!m.haul) return;
    ly.textContent = text("#ly"); mins.textContent = text("#mins"); warp.textContent = text("#warp"); minL.textContent = document.querySelector("#readout .eta") ? `${text("#left")} ${text("#left + .lbl")}` : WORDS.min; // W86 ride: "12 min left" on a course; W88 ridemodes: the readout's minutes left
    const card = document.querySelector(".cturn"), on = !!card && !card.hidden;
    turn.hidden = !on;
    if (on) {
      const src = card.querySelector(".arrow")?.src || "";
      if (arrow.src !== src) arrow.src = src;
      dist.textContent = text(".cturn .dist"); road.textContent = text(".cturn .road");
    }
  }
  /** W195 pocket: pocket mode on the long-haul screen, or off (back to the long-haul screen, or with it, to the chart). */
  function setPocket(on) {
    if (m.pocket === on) return;
    m.pocket = on;
    screen.classList.toggle("pocketed", on);
    if (on) unpocket = pocket({ ring, buzz, onLeave: () => { unpocket = null; set(false); } }); else { unpocket?.(); unpocket = null; }
    words();
    if (!on) awake(false);
  }
  pk.onclick = async (e) => {
    e.stopPropagation(); // the screen's own tap goes back to the chart
    if (asking) return;
    asking = true;
    const no = await awake(true); // the wake lock first: no lock, no Pocket (the screen would sleep, and GPS with it)
    asking = false;
    if (no) explain(pk, no);
    else if (!m.haul || !flight.flying) awake(false); // gone meanwhile
    else setPocket(true);
  };
  function set(on) {
    if (m.haul === on) return;
    if (!on) setPocket(false); // W195 pocket: off with it
    m.haul = on;
    screen.hidden = !on;
    syncScreen(); // W190 screenstate
    for (const n of document.body.children) { // the covered app, out of reach of Tab and screen readers (aria-modal)
      if (n === screen) continue;
      if (on && !n.inert) { n.inert = true; n.dataset.haulInert = ""; }
      else if (!on && "haulInert" in n.dataset) { n.inert = false; delete n.dataset.haulInert; }
    }
    onCover(on);
    sync();
    (on ? back : haulBtn).focus?.({ preventScroll: true });
  }
  burn.onclick = () => nav.burnUp();
  haulBtn.onclick = () => set(true);
  screen.onclick = () => set(false); // W177 buttons2: a tap anywhere, the line (back) too
  screen.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); set(false); } // this screen only, not a card under it
  });
  let sampled = -Infinity;
  /** main.js's frame loop, under the long-haul screen: true four times a second, to sample the pose for the warp. */
  m.due = (t) => { if (!m.haul || t - sampled < 250) return false; sampled = t; return true; };
  m.sync = sync;
  m.set = set;
  return m; // W77 restfix: no timer of its own; main.js's hud() calls sync() four times a second, while it runs (in flight, under this screen)
}
