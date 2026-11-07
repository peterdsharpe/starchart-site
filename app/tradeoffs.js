// W199 prefs (design/app-ui/SPEC.md §353, the W198 prefsdesign mock-up's variant B): Settings › Routing › Trade-offs. One row,
// after Streets, its line "Balanced" or what it leans to; it opens a page with one back arrow (as What's new), three beams:
// Quicker ⟷ Bike paths and Quicker ⟷ Fewer hills under By bike, T and bus ⟷ Walking under Walk and T. Each is five tap places
// for your weight, the heavier side down, the middle (the fulcrum) level; one line under it with its price, live.
//   leans()               { protect, hills, walk }, each -2 … 2: what the router, the bike cards and the walker's cards read
//   mountTradeoffs({ row, page })   the row and its page
// The keys are app/keys.js's (starchart.tradeoffs.*); the prices are chart/routing/tradeoffs.js's, so the words can't drift.
// A change applies to the next plan; an open bike preview plans again at once (app/course.js), as for a street avoided.
import { get, set } from "./settings.js";
import { pick, onLingo } from "./lingo-mode.js";
import { showPage } from "./subpage.js";
import { BEAMS, PRICE } from "../chart/routing/tradeoffs.js";

/** Each beam's key. */
export const KEY = { protect: "starchart.tradeoffs.protect", hills: "starchart.tradeoffs.hills", walk: "starchart.tradeoffs.walk" };
/** The beams as set: each a step from -2 (its left side) to +2 (its right side), 0 level. */
export const leans = () => Object.fromEntries(BEAMS.map((b) => [b, +get(KEY[b])]));

/** The words, [SCUL, Plain] where they differ. */
export const WORDS = {
  title: "Trade-offs",
  balanced: "Balanced",
  leansTo: (sides) => (sides.length > 1 ? `Leans ${["two", "three"][sides.length - 2]} ways` : `Leans to ${sides[0]}`), // one line at 320 px (Settings' rule): two sides in SCUL wrap
  lede: "More of one side costs some of the other.",
  ends: { protect: ["Quicker", ["Wormholes", "Bike paths"]], hills: ["Quicker", ["Fewer negi g-wells", "Fewer hills"]], walk: [["Comets and buses", "T and bus"], ["Space walk", "Walking"]] },
  side: { paths: ["wormholes", "bike paths"], hills: ["fewer negi g-wells", "fewer hills"], speed: "speed", vehicle: ["comets and buses", "T and bus"], onFoot: ["space walk", "walking"] },
  line: {
    protect: (n) => [`Up to ${n} % farther for wormholes`, `Up to ${n} % farther for bike paths`],
    hills: (n) => `Up to ${n} ft farther to climb 1 ft less`,
    walk: (n) => `10 min outside counts as ${n} min under cover`, // walkcards' measure: walking, or waiting at a kerb, against riding or a station's roof
  },
  level: "Level",
  steps: { 1: "a little more", 2: "much more" },
};
const g = (x) => pick(x).replace("g-w", "g\u2011w"); // "g-wells" whole on its line, as the cards' (app/course.js)

/** The row's line: "Balanced", the side leaned to ("Leans to bike paths", "Leans to speed"), or how many: "Leans two ways". */
export function summary(l) {
  const sides = [], add = (x) => { if (!sides.includes(x)) sides.push(x); };
  if (l.protect > 0) add(g(WORDS.side.paths));
  if (l.hills > 0) add(g(WORDS.side.hills));
  if (l.protect < 0 || l.hills < 0) add(WORDS.side.speed);
  if (l.walk > 0) add(pick(WORDS.side.onFoot));
  if (l.walk < 0) add(pick(WORDS.side.vehicle));
  return sides.length ? WORDS.leansTo(sides) : WORDS.balanced;
}
/** The line under beam `b` at step `k`. */
export const priceLine = (b, k) => g(WORDS.line[b](PRICE[b](k)));

// The ends' icons, drawn in code: one colour, 24 units square (the mock-up's)
const ICON = {
  quicker: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.8h4M18.4 6.6l1.4-1.4"/>',
  paths: '<path d="M4 21 9 3M20 21 15 3"/><path d="M12 5v2.5M12 11v2.5M12 17v2.5" stroke-width="2"/>',
  hills: '<path d="M2.5 19.5 9 9l3.6 5.6L15.5 11l6 8.5z"/>',
  vehicle: '<circle cx="12" cy="12" r="9"/><path d="M7.8 8.2h8.4M12 8.2v8.6"/>',
  onFoot: '<circle cx="13" cy="4.2" r="1.9" fill="currentColor" stroke="none"/><path d="M10.2 21l2-6.2-2.6-2.4.9-4.6 3.4 3.2 2.9.9M12.2 14.8l2.6 2.4.8 3.8M9.6 12.4l-2.6.6-1.2 3"/>',
};
const PICS = { protect: ["quicker", "paths"], hills: ["quicker", "hills"], walk: ["vehicle", "onFoot"] };
const POS = [-2, -1, 0, 1, 2], X = (p) => 150 + p * 60, TILT = 3.2; // the places along the beam (viewBox units), degrees a step
const pin = (k, x, side) => `<svg class="pin ${side}" x="${x}" y="5" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const el = (tag, cls = "", text = "") => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

/** One beam: its ends' words, the picture (the bar tips with your weight), five tap places over it, and its price. */
function beam(b) {
  const box = el("div", "beam"), ends = el("div", "ends"), L = el("span", "end l"), R = el("span", "end r");
  box.dataset.beam = b; box.setAttribute("role", "radiogroup");
  ends.append(L, R);
  const pic = el("div", "scale");
  pic.innerHTML = `<svg class="pic" viewBox="0 -14 300 90" aria-hidden="true"><path class="fulcrum" d="M150 48 L136 75 H164 Z"/>
    <g class="tilt"><rect class="plank" x="10" y="40" width="280" height="8" rx="4"/>${POS.map((p) => (p ? `<circle class="tick" cx="${X(p)}" cy="44" r="4.5"/>` : `<circle class="level" cx="150" cy="44" r="6"/>`)).join("")}
    ${pin(PICS[b][0], 8, "l")}${pin(PICS[b][1], 268, "r")}<circle class="weight" cx="150" cy="44" r="12"/></g><circle class="pivot" cx="150" cy="44" r="3"/></svg>`;
  const hits = el("div", "hits");
  for (const p of POS) {
    const t = el("button"); t.type = "button"; t.dataset.v = String(p); t.setAttribute("role", "radio"); t.style.setProperty("--x", String(X(p)));
    hits.append(t);
  }
  pic.append(hits);
  const line = el("small", "line");
  box.append(ends, pic, line);
  const show = () => {
    const k = +get(KEY[b]), [l, r] = WORDS.ends[b];
    L.textContent = g(l); R.textContent = g(r);
    L.classList.toggle("heavy", k < 0); R.classList.toggle("heavy", k > 0);
    box.setAttribute("aria-label", `${g(l)} or ${g(r)}`);
    box.querySelector(".tilt").style.transform = `rotate(${k * TILT}deg)`;
    box.querySelector(".weight").style.transform = `translateX(${X(k) - 150}px)`; // along the plank, in its units
    for (const s of ["l", "r"]) box.querySelector(`.pin.${s}`).classList.toggle("heavy", s === "l" ? k < 0 : k > 0);
    for (const t of hits.children) {
      const p = +t.dataset.v;
      t.setAttribute("aria-checked", String(p === k)); t.tabIndex = p === k ? 0 : -1;
      t.setAttribute("aria-label", p ? `${g(p < 0 ? l : r)}, ${WORDS.steps[Math.abs(p)]}` : WORDS.level);
    }
    line.textContent = priceLine(b, k);
  };
  hits.addEventListener("click", (e) => { const v = e.target.closest("button")?.dataset.v; if (v != null) set(KEY[b], v); });
  hits.addEventListener("keydown", (e) => { // a radio group's keys: the arrows move your weight a place
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const to = Math.max(-2, Math.min(2, +get(KEY[b]) + d));
    set(KEY[b], String(to)); hits.querySelector(`[data-v="${to}"]`)?.focus();
  });
  return { box, show };
}

/** Settings' row (`row`: its button, with .txt small for its line) and the page (`page`: #tradeoffs, its beams' boxes .beams). */
export function mountTradeoffs({ row, page }) {
  if (!row || !page) return null;
  const line = row.querySelector("small"), beams = BEAMS.map(beam);
  page.querySelector('[data-beams="bike"]').append(beams[0].box, beams[1].box);
  page.querySelector('[data-beams="walk"]').append(beams[2].box);
  const show = () => { line.textContent = summary(leans()); for (const x of beams) x.show(); };
  show();
  addEventListener("starchart:settings", (e) => { if (Object.values(KEY).includes(e.detail.key)) show(); });
  onLingo(show);
  row.onclick = () => { show(); showPage(page); page.scrollTop = 0; };
  return { show };
}
