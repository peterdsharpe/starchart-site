// W73 mission (design/app-ui/SPEC.md §122): mission nights, for a prototype. Two things in flight:
// - **Burn up:** in free flight (no course), one tap plots home, or the Fort when no home is set (SCUL only), as the
//   in-flight preview with Fly it. Its comet card is asked in flight too, planned from now, so after midnight a comet
//   that has stopped running for the night earns no card.
// - **The long-haul screen:** a near-black screen over the chart for a 3 to 5 hour mission. The chart stops drawing
//   (main.js's frame loop treats it as covered, as the Log), while GPS, the track, the calls and Wake Lock run on. It
//   shows the readout and the next turn, dim; Chart goes back.
import { pick, onLingo } from "./lingo-mode.js";

export const WORDS = {
  burn: ["Burn up", "Head home"],
  haul: ["Long haul", "Dim screen"],
  back: ["Chart", "Map"],
  ly: ["LY", "mi"], warp: ["Warp", "mph"], min: "Min",
};

/** Where Burn up goes: home, else the Fort (not in Plain, which has no Fort pick), else nowhere. */
export const burnTarget = ({ home, fort, plain }) => home || (plain ? null : fort) || null;

/** Burn up shows in free flight only, with somewhere to go, and not while the long-haul screen covers the chart. A comet
 *  course is a course on the train too, between its legs, where `active` (a bike leg's) is false and `leg` stays. */
export const burnShown = ({ flying, active, leg, target, haul }) => flying && !active && !leg && !!target && !haul;

export function mountMission({ flight, nav, onCover = () => {}, $ = (id) => document.getElementById(id) }) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (id, icon) => { const b = el("button", "btn mission"); b.id = id; b.hidden = true; b.append(el("i", `i i-${icon}`), el("span", "lbl")); return b; };
  const burn = button("burnup", "hangar"), haulBtn = button("longhaul", "amoled");
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
  screen.append(turn, big, pair, back);
  document.body.append(burn, haulBtn, screen);

  const m = { haul: false };
  const words = () => {
    for (const [b, k] of [[burn, "burn"], [haulBtn, "haul"]]) { b.querySelector(".lbl").textContent = pick(WORDS[k]); b.setAttribute("aria-label", pick(WORDS[k])); }
    back.textContent = pick(WORDS.back);
    screen.setAttribute("aria-label", pick(WORDS.haul));
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
  function set(on) {
    if (m.haul === on) return;
    m.haul = on;
    screen.hidden = !on;
    document.body.classList.toggle("haul", on);
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
  back.onclick = () => set(false);
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
