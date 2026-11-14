// W199 prefs (design/app-ui/SPEC.md §353, the W198 prefsdesign mock-up's variant B): Settings › Routing › Trade-offs. One row,
// after Street preferences (W204 settings9), its line "Balanced" or what it leans to; it opens a page with one back arrow (as What's new), three beams:
// Quicker ⟷ Bike paths and Quicker ⟷ Fewer hills under By bike, T and bus ⟷ Walking under Walk and T. Each is five tap places
// for your weight, the heavier side down, the middle (the fulcrum) level; one line under it with its price, live.
//   leans()               { protect, hills, walk }, each -2 … 2: what the router, the bike cards and the walker's cards read
//   mountTradeoffs({ row, page })   the row and its page
// W201 weather2 (SPEC §360): a fourth, T and bus ⟷ Rain gear under In bad weather: how much bad weather tips you to the T, riding
// and walking alike (the bike + T rain rule's cap, the walker's bad skies' shifts: chart/routing/tradeoffs.js rainRules(), walktransit.js leaned()).
// W203 tradeoffs2 (SPEC §365, her row 7): the page opens on a switch, By bike | On foot, each tab its own beams: By bike, Quicker ⟷
// Bike paths, Quicker ⟷ Fewer hills and its weather beam, Train ⟷ Rain gear (the bike + T rain rule); On foot, T and bus ⟷ Walking,
// Quicker ⟷ Fewer changes (new: each change's own minutes, walktransit.js RANGES.change) and its weather beam, T and bus ⟷ Rain gear
// (the walker's bad skies). The one weather beam's key became the two (app/settings.js migrate), so nothing changes for anyone who
// had set it. Each line says what the lean does to a choice she'd see ("Rides up to 14 min to walk 10 min less").
// The keys are app/keys.js's (starchart.tradeoffs.*); the prices are chart/routing/tradeoffs.js's, so the words can't drift.
// A change applies to the next plan; an open bike preview plans again at once (app/course.js), as for a street avoided.
import { get, set } from "./settings.js";
import { pick, onLingo } from "./lingo-mode.js";
import { showPage } from "./subpage.js";
import { BEAMS, PRICE, lean } from "../chart/routing/tradeoffs.js"; // W210 settings10: lean, a beam off level
import { WALKER } from "./walker.js"; // W228 icons6

/** W212 walkfirst (SPEC §399, the brief's item 4): Consider the T on bike rides (app/keys.js, comet-card.js KEY). Off, By bike's weather
 *  beam can't act: it moves only the By train card, which nothing asks for then (app/course.js askComet). */
export const TRANSIT = "starchart.transit";
const acts = (b, transit) => b !== "bikeWeather" || transit !== "off"; // W212 walkfirst
/** Each beam's key. */
export const KEY = { protect: "starchart.tradeoffs.protect", hills: "starchart.tradeoffs.hills", bikeWeather: "starchart.tradeoffs.weather.bike", walk: "starchart.tradeoffs.walk", changes: "starchart.tradeoffs.changes", footWeather: "starchart.tradeoffs.weather.foot" }; // W201 weather2: weather; W203 tradeoffs2: a weather beam a tab, and changes
/** The beams as set: each a step from -2 (its left side) to +2 (its right side), 0 level. */
export const leans = () => Object.fromEntries(BEAMS.map((b) => [b, +get(KEY[b])]));

/** The words, [SCUL, Plain] where they differ. */
export const WORDS = {
  title: "Trade-offs",
  balanced: "Balanced",
  leansTo: (side) => `Leans to ${side}`, // one line at 320 px (Settings' rule)
  set: (n, of = BEAMS.length) => `${n} of ${of} set`, // W212 walkfirst: of the beams that can act; W210 settings10 (SPEC §388, her row 26): two beams or more off level, how many (was "Leans five ways", which told her nothing)
  lede: "More of one side costs some of the other.",
  ends: { protect: ["Quicker", ["Wormholes", "Bike paths"]], hills: ["Quicker", ["Fewer negi g-wells", "Fewer hills"]], walk: [["Comets and sandworms", "T and bus"], ["Space walk", "Walking"]], // R2 sandworm (SPEC §453): SCUL's bus a sandworm
    bikeWeather: [["Comets", "Trains"], ["Radiation suit", "Rain gear"]], // W203 tradeoffs2: By bike's: the rain rule boards a train, never a bus on the rain alone (transit.js earn()); 0.1.94's words review: "Trains", as the row's summary says
    changes: ["Quicker", "Fewer changes"], // W203 tradeoffs2 (her row 11d)
    footWeather: [["Comets and sandworms", "T and bus"], ["Radiation suit", "Rain gear"]] }, // R2 sandworm; W201 weather2 (SPEC §360): the T's end where the walker's beam has it; BRIEF §6.4's radiation suit; W203 tradeoffs2: On foot's
  // R2 sandworm (SPEC §453): SCUL's vehicle side "comets, sandworms", one line in Settings at 320 px, where "comets and sandworms" takes two
  side: { paths: ["wormholes", "bike paths"], hills: ["fewer negi g-wells", "fewer hills"], speed: "speed", train: ["comets", "trains"], vehicle: ["comets, sandworms", "T and bus"], onFoot: ["space walk", "walking"], changes: "fewer changes", gear: ["radiation suit", "rain gear"] }, // W201 weather2: gear; rel-0.1.93 (the words review): one form, as its beam's end; W203 tradeoffs2: train, changes
  // W203 tradeoffs2 (SPEC §365, her row 7): what the lean does to a choice she'd see (chart/routing/tradeoffs.js PRICE): a 20 min
  // route's card (Pace's "20 min route"), a 10 ft climb skipped, 10 min less walking, a change skipped; W199's were "Up to 30 %
  // farther for bike paths", "Up to 300 ft farther to climb 1 ft less", "10 min outside counts as 10 min under cover", W201's
  // "Up to 30 % slower to stay dry"
  // W210 settings10 (SPEC §388, her row 22: "The current one liners are a bit cryptic"): two or three lines each, what the step
  // trades in a case she'd meet, saying which card or plan it moves: the Bike paths and Fewest hills cards, the By train card in the
  // rain (comet-card.js WORDS.card), the walker's first card (walktransit.js pickCards: her best, by the leaned weights)
  line: {
    protect: (n) => [`On a 20 min flight, the Ship-friendly course can take up to ${n} min longer than the quickest, to stay in wormholes`, `On a 20 min ride, the Bike-friendly route can take up to ${n} min longer than the quickest, to stay on bike paths`], // W219 preview3 (SPEC §424): the route's name, as its row says it
    hills: (n) => [`The Fewest negi g-wells course can be up to ${n} LY longer to skip a 10 ft climb, about one story`, `The Fewest hills route can be up to ${n} mi longer to skip a 10 ft climb, about one story`],
    bikeWeather: (n) => [`In radiation, a drier way by comet is offered when it adds no more than ${n} min to a 20 min flight`, `In the rain, a drier way by train is offered when it adds no more than ${n} min to a 20 min ride`],
    // R2 sandworm (SPEC §453): SCUL's sandworm, its lines reworded to stay within three lines at 320 px and 150 % text, the measure the
    // same ("must beat walking by", "Even n min slower than walking, … can come first"), and Fewer changes' within three at 100 % text
    walk: (n) => (Array.isArray(n) ? [`A comet or sandworm must beat walking by ${n[0]} min to show, ${n[1]} to come first`, `A train or bus must be ${n[0]} min quicker than walking to show, ${n[1]} to come first`] // W212 walkfirst (SPEC §399, her row 7.4): on the Walking side, chart/routing/tradeoffs.js SOONER's, door to door against walking all the way
      : n ? [`Even ${n} min slower than walking, a 10 min comet or sandworm can come first`, `A 10 min train or bus ride can come first even if it's ${n} min slower than walking`] // the second review's P1: "can", the most the T may lose by (a fare asks for more: beside a 15 min walk a $2.40 ride leads only from 2.5 min slower, and at level from 5 min quicker), as the Walking side says the least it must win by; the T the subject all along, so −1's and +1's "3 min" aren't twins (was "comes first even if walking is about n min quicker"); 0.1.99's words review (its P1): one measure along the beam, door to door against walking all the way (was "… comes first only when it saves 5 / 7 / 10 min of walking" beside the Walking side's "must save 3 min over walking …, 5 to come first": two measures in near-twin words, so level's 10 read as more than +1's 5)
        : ["A comet or sandworm can come first when it's about as quick as walking", "A train or bus can come first when it's about as quick as walking"]), // SCUL's "walking" as the lines before these ("… of walking", "… over walking") and "to show" for "to be offered": three lines at 320 px and 150 % text, which "quicker than a space walk to be offered" isn't; walkcards' measure: a minute outside (walking, or waiting at a kerb) against one riding or under a station's roof; W212 walkfirst: in her terms, three lines at 320 px and 150 % text (was "A plan that walks 10 min less comes first when it's up to n min longer, say a bus to the train instead of walking there", which read as if less walking won, in five)
    changes: (n) => [`A plan with one change fewer comes first when it's up to ${n} min longer, say one comet, not a sandworm and a comet`, `A plan with one change fewer comes first when it's up to ${n} min longer, say one train instead of a bus and a train`], // on top of the change's walk, wait and risk, which every plan counts
    footWeather: (n) => [`In radiation, a plan that walks 10 min less comes first when it's up to ${n} min longer`, `In the rain, a plan that walks 10 min less comes first when it's up to ${n} min longer`], // walk's, in the rain
  },
  off: ["Off while Consider comets on flights is off", "Off while Consider the T on bike rides is off"], // W212 walkfirst (SPEC §399): By bike's weather beam, with its switch off
  turnOn: "Turn it on",
  level: "Level",
  steps: { 1: "a little more", 2: "much more" },
};
const g = (x) => pick(x).replace("g-w", "g\u2011w"); // "g-wells" whole on its line, as the cards' (app/course.js)

/** The row's line: "Balanced", one beam's side leaned to ("Leans to bike paths", "Leans to speed"), or with more, how many: "5 of 6 set".
 *  W212 walkfirst: of the beams that can act, with `transit` the switch Consider the T on bike rides ("5 of 5 set" with it off). */
export function summary(l, transit = "on") {
  if (!acts("bikeWeather", transit)) l = { ...l, bikeWeather: 0 }; // W212 walkfirst: its lean kept, but it counts for nothing
  const off = BEAMS.filter((b) => lean(l[b]) !== 1).length; // W210 settings10 (SPEC §388, her row 26): the beams off level
  if (off > 1) return WORDS.set(off, BEAMS.filter((b) => acts(b, transit)).length); // W210 settings10; W212 walkfirst: of those that can act
  const sides = [], add = (x) => { if (!sides.includes(x)) sides.push(x); };
  if (l.protect > 0) add(g(WORDS.side.paths));
  if (l.hills > 0) add(g(WORDS.side.hills));
  if (l.protect < 0 || l.hills < 0 || l.changes < 0) add(WORDS.side.speed); // W203 tradeoffs2: On foot's Quicker too
  if (l.bikeWeather < 0) add(pick(WORDS.side.train)); // W203 tradeoffs2: By bike's weather beam
  if (l.walk > 0) add(pick(WORDS.side.onFoot));
  if (l.walk < 0 || l.footWeather < 0) add(pick(WORDS.side.vehicle)); // W201 weather2: or in bad weather; W203 tradeoffs2: On foot's
  if (l.changes > 0) add(WORDS.side.changes); // W203 tradeoffs2
  if (l.bikeWeather > 0 || l.footWeather > 0) add(pick(WORDS.side.gear)); // W201 weather2; W203 tradeoffs2: either tab's
  return sides.length ? WORDS.leansTo(sides[0]) : WORDS.balanced; // W210 settings10: one beam, one side
}
/** The line under beam `b` at step `k`; W203 tradeoffs2: On foot's weather line with the walker's beam `walk` too (its rain rate), and
 *  a number kept with its unit where the line wraps ("20 min" whole on its line, at 320 px and 150 % text). */
export const priceLine = (b, k, walk = 0) => g(WORDS.line[b](PRICE[b](k, walk))).replace(/(\d) (?=(min|mi|ft|LY)\b)/g, "$1\u00a0"); // W203 tradeoffs2: the no-break space

// The ends' icons, drawn in code: one colour, 24 units square (the mock-up's)
const ICON = {
  quicker: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.8h4M18.4 6.6l1.4-1.4"/>',
  paths: '<path d="M4 21 9 3M20 21 15 3"/><path d="M12 5v2.5M12 11v2.5M12 17v2.5" stroke-width="2"/>',
  hills: '<path d="M2.5 19.5 9 9l3.6 5.6L15.5 11l6 8.5z"/>',
  vehicle: '<circle cx="12" cy="12" r="9"/><path d="M7.8 8.2h8.4M12 8.2v8.6"/>',
  gear: '<path d="M3 12.5a9 9 0 0 1 18 0z"/><path d="M12 12.5v6a2.2 2.2 0 0 1-4.4 0M12 2.5v1"/>', // W201 weather2: an umbrella
  onFoot: WALKER, // W228 icons6 (SPEC §478): her walker (app/walker.js), the pin's own 24 units and 2.2 stroke
  direct: '<path d="M5 12h14"/><circle cx="4.5" cy="12" r="2.6" fill="currentColor"/><circle cx="19.5" cy="12" r="2.6" fill="currentColor"/>', // W203 tradeoffs2: Fewer changes, one ride from stop to stop
};
const PICS = { protect: ["quicker", "paths"], hills: ["quicker", "hills"], bikeWeather: ["vehicle", "gear"], walk: ["vehicle", "onFoot"], changes: ["quicker", "direct"], footWeather: ["vehicle", "gear"] }; // W201 weather2: weather; W203 tradeoffs2: a weather beam a tab, and changes
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
  const off = el("p", "off"), why = el("span"), on = el("button"); // W212 walkfirst (SPEC §399): a beam that can't act says so, its switch right there
  on.type = "button"; on.onclick = () => { set(TRANSIT, "on"); hits.querySelector('[aria-checked="true"]')?.focus(); }; // the beam back, focus on her weight
  off.append(why, on);
  if (b === "bikeWeather") box.append(off);
  const show = () => {
    const can = acts(b, get(TRANSIT)); // W212 walkfirst: off, the beam gives way to one line, its lean kept
    ends.hidden = pic.hidden = line.hidden = !can; off.hidden = can;
    box.setAttribute("role", can ? "radiogroup" : "group");
    why.textContent = pick(WORDS.off); on.textContent = WORDS.turnOn;
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
    line.textContent = priceLine(b, k, +get(KEY.walk)); // W203 tradeoffs2: On foot's weather line moves with the walker's beam
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
  const line = row.querySelector("small"), beams = Object.fromEntries(BEAMS.map((b) => [b, beam(b)]));
  page.querySelector('[data-beams="bike"]').append(beams.protect.box, beams.hills.box);
  page.querySelector('[data-beams="bikeWeather"]').append(beams.bikeWeather.box); // W203 tradeoffs2: By bike's own weather beam
  page.querySelector('[data-beams="foot"]').append(beams.walk.box, beams.changes.box); // W203 tradeoffs2: and Fewer changes
  page.querySelector('[data-beams="footWeather"]').append(beams.footWeather.box); // W201 weather2; W203 tradeoffs2: On foot's
  // W203 tradeoffs2 (SPEC §365): By bike | On foot, a segmented choice as Settings' others (app/settings.js segs), each its tab's beams;
  // the tab stays as she left it while the app runs, By bike first
  const tabs = page.querySelector("#tradeoffs-tabs");
  let tab = "bike";
  const showTab = (v = tab) => {
    tab = v;
    for (const b of tabs.querySelectorAll("button")) { const on = b.dataset.v === tab; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of page.querySelectorAll("[data-tab]")) p.hidden = p.dataset.tab !== tab;
  };
  tabs.addEventListener("click", (e) => { const v = e.target.closest("button")?.dataset.v; if (v) showTab(v); });
  tabs.addEventListener("keydown", (e) => { // a radio group's keys: the arrows move the choice, Home and End go to its ends (as Settings' others)
    const v = { Home: "bike", End: "foot" }[e.key] ?? (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key) && (tab === "bike" ? "foot" : "bike"));
    if (!v) return;
    e.preventDefault();
    showTab(v); tabs.querySelector(`[data-v="${tab}"]`).focus();
  });
  showTab(); // W203 tradeoffs2
  const show = () => { line.textContent = summary(leans(), get(TRANSIT)); for (const x of Object.values(beams)) x.show(); }; // W212 walkfirst: TRANSIT
  show();
  addEventListener("starchart:settings", (e) => { if (Object.values(KEY).includes(e.detail.key) || e.detail.key === TRANSIT) show(); }); // W212 walkfirst: and the switch
  onLingo(show);
  row.onclick = () => { show(); showPage(page); page.scrollTop = 0; };
  return { show };
}
