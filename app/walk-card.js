// W73 walk (design/app-ui/SPEC.md §119): on foot and by T in the preview. chart/routing/walktransit.js plans it in the
// routing worker and app/walk.js asks it; this is the pure part the page draws from, so Node tests it: the cards' words,
// minutes and legs bar, the legs on the chart, and the live departure read from the MBTA's predictions.
//
//   walkCard(plan)              -> { name, why, min, arrive, dep, fact, walk, bar, label }   one card and its facts row (W196 cards2: dep)
//   walkLegs(plan)              -> GeoJSON: the walks, as lines (course.js's dotted course-walk layer)
//   predictionsUrl(leg)         -> the one request a card's first boarding asks (its two stops and line, never a position; R1 plans)
//   firstLive(json, ready, leg) -> the first predicted departure at or after `ready` (ms) of a trip that reaches leg.to, or null (R1 plans)
//   withLive(plan, dep)         -> the plan with its first boarding's live time (and, for one vehicle, its arrival moved)
//   nextLeg(plan, i), stopPlace(plan, k)   W79 walkgo: in flight, the leg after leg i, and where walk leg k ends
//
// Every string is [SCUL, Plain] (app/lingo-mode.js pick()); a lone string is both modes'. R2 sandworm (SPEC §453, arclight's
// ruling of 11-12): SCUL's bus is a sandworm, as on the map (W72 walktransit §2.5: "transports" are cars), named as the station's card names it.
import { pick } from "./lingo-mode.js";
import { clockAt, rideSeconds } from "./course-logic.js"; // W200 parkwalk: rideSeconds
import { lineColour, sectionName } from "./comets-logic.js"; // W186 palette; R2 sandworm: sectionName
import { fillNext } from "../chart/routing/transit.js"; // W189 transittimes

/** The From/To row's switch: "on" plans on foot and by T. Off by default: the ship comes first. */
export const KEY = "starchart.walk";

export const WORDS = {
  mode: ["Space walk and comets", "Walk and T"], // the switch's name
  modeTip: ["Space walk, comets and sandworms", "Walk and T: trains and buses"], // W140 words: the name says on foot; R2 sandworm: SCUL's comets are trains, its buses sandworms
  cards: ["Ways on foot and by comet", "Ways on foot and by T"], // the cards' group
  walk: ["Space Walk", "Walk"], // the card for walking the whole way
  why: {
    quickest: "Quickest",
    direct: (p) => (p.vehicles > 1 ? "Fewer changes" : p.legs.find((l) => l.type === "train")?.mode === "bus" ? ["One sandworm", "One bus"] : ["One comet", "One train"]), // W203 tradeoffs2 (SPEC §365): one bus and a subway beside two buses and a subway is no "One bus"; R2 sandworm
    walk: "No waiting",
    least: "Least time outside", // W198 walkcards: walking, and waiting at a kerb or an open-air platform (was "Shortest space walk", "Least walking": the 87 that kept him out longest)
  },
  walkMin: (n) => [`Space walk ${n} min`, `Walk ${n} min`],
  fact: (line, t, station) => `${line} ${t} at ${station}`, // as the comet card's: "Red Line 8:41 at Central"
  live: "live",
  alone: (mi) => [`Space walk ${mi} LY`, `Walk ${mi} mi`],
  finding: ["Plotting course…", "Finding route…"], // W222 preview4 (SPEC §436, her row 8): the preview's row while a route is found, a walk's or a bike's (was "Finding ways…" on a line over it)
  none: ["No way by comet or sandworm found.", "No way by train or bus found."], // R2 sandworm
  noneNow: ["No way by comet or sandworm now. Try Leave at or Arrive by for a later time.", "No way by train or bus now. Try Leave at or Arrive by for a later time."], // W203 walkcards2 (SPEC §366): planning for now, her When row shows to plan for later; R2 sandworm
  far: ["One end has no comet station or sandworm nest nearby, and it's too far for a space walk.", "One end has no train or bus stop nearby, and it's too far to walk."], // W203 walkcards2 (her row 12): was "No stop within a walk of both ends.", which she couldn't read; 0.1.94's words review 3: one end (either has none), and SCUL's comet station; R2 sandworm: its sandworm nest
  held: "The T's timetable downloads on Wi-Fi, or when downloads resume.",
  offline: "The T's timetable downloads once, with a connection.",
  ended: "The T's timetable is out of date.",
  early: "The T's timetable starts later.",
  failed: "No plan by T just now. Try again.",
  leaveBy: (t) => `Leave by ${t}`, // W189 transittimes: when to set off, so as to reach the stop 2 min before it leaves
  price: (usd) => (usd ? `$${usd.toFixed(2)}` : "Free"), // W203 walkcards2 (SPEC §366): a plan by T's fare on a CharlieCard, from the MBTA's GTFS (walktransit.js fareOf); W204 bikeshare: a Bluebike's pay as you go too (bikeshare.js PRICE, never 0); 0.1.94's merge: one key
  saver: "Timetable not downloaded: Data Saver is on.", // W189 transittimes: a bus stop's peek, the walker's file not stored
  noStop: "No timetable for this stop.", // W189 transittimes: a bus stop the file doesn't name
  // W79 walkgo: in flight (SPEC §148). "comet" only on a train that isn't a ferry; R2 sandworm: a bus by its name, "Board sandworm 83 …" in SCUL
  board: (l, change = false) => { const v = change ? "Change to" : "Board", n = `${l.stops} ${l.stops === 1 ? "stop" : "stops"}`; // W79 walkgo
    return l.mode === "bus" ? busName(l).map((b) => `${v} ${midName(b, true)} at ${l.from_name} toward ${l.head}. ${n}.`) // W79 walkgo; R2 sandworm
      : [`${v} the ${l.line}${l.route.startsWith("Boat-") ? "" : " comet"} at ${l.from_name} toward ${l.head}. ${n}.`, `${v} the ${l.line} at ${l.from_name} toward ${l.head}. ${n}.`]; }, // W79 walkgo
  leave: (l) => [`Leave at ${l.to_name}`, `Get off at ${l.to_name}`], // W79 walkgo: the landing card's foot, as the comets'
  leaveNow: (l) => (l.mode === "bus" || l.route.startsWith("Boat-") ? "Get off here" : ["Leave the comet here", "Get off here"]), // W79 walkgo: the banner near the stop
  tapOn: "Tap to walk on", // W79 walkgo: the landing card's foot, a tap sets out on the next walk
  landed: ["Space walk ended", "Walk ended"], // W79 walkgo: Land's word for a walk ("Landed" / "Ride ended")
  // W204 bikeshare (SPEC §372): a Bluebike leg. SCUL calls its docks Klingon docks (chart/lingo/lingo-pack.json klingon_dock)
  bike: "Bluebike", // the card's name, beside its price
  dock: (name) => [`Klingon Dock ${name}`, name],
  pickUp: (dock, n, ebike = false) => (n == null ? `Pick up at ${dock}` : `${n || "No"} ${ebike ? "e" : ""}${n === 1 ? "bike" : "bikes"} at ${dock}`), // the fact to act on, its live count first; only ebikes there, "ebikes" (their price); emptied since, "No bikes"
  dropOff: (dock, n) => (n == null ? `Return at ${dock}` : `${n || "No"} ${n === 1 ? "dock" : "docks"} free at ${dock}`),
  ride: (dock) => `Ride a Bluebike to ${dock}`, // in flight, at the pick-up dock: the banner, silent
  docked: "Dock the Bluebike here", // at the drop-off
  empty: ["No bikes at the Klingon dock", "No bikes at the dock"], // a re-check at the pick-up: the bar's words (its name under them), and its button
  replan: ["Re-plot", "Re-plan"], // 0.1.94's words review: SCUL plots again ("Re-plotting…")
  full: ["Your Klingon dock is full", "Your dock is full"], // a re-check near the drop-off
  fullNone: ["Your Klingon dock is full, and none nearby has room", "Your dock is full, and none nearby has room"], // 0.1.94's words review: no dock with room anywhere, said so
  room: (dock, d) => `Room at ${dock}, ${d} away`, // d: course-logic.js distLabel()'s, a walk's miles and feet in both modes
  goThere: "Go there",
};
/** W204 bikeshare: a dock's name as the card and the bar say it: before " - " (as the search names one) and before " / " (a dock
 *  named for two places), SCUL's a Klingon Dock. */
export const shortDock = (name) => String(name || "").split(" - ")[0].split(" / ")[0].trim(); // W204 bikeshare: "Central Sq Post Office / Cambridge City Hall at Mass Ave / Pleasant St", its first name
export const dockName = (name) => pick(WORDS.dock(shortDock(name))); // W204 bikeshare
/** W204 bikeshare: plan `p` with its Bluebike leg's counts from fresh `docks` (the pick-up's bikes, the drop-off's free docks). */
export function withCounts(p, docks) { // W204 bikeshare
  const i = p.legs.findIndex((l) => l.type === "bike"), by = new Map(docks.map((d) => [d.id, d]));
  if (i < 0) return p;
  const l = p.legs[i], a = by.get(l.from), b = by.get(l.to);
  return { ...p, legs: p.legs.map((x, k) => (k === i ? { ...x, bikes: a ? a.bikes : x.bikes, docks: b ? b.docks : x.docks } : x)) };
} // W204 bikeshare

/** W79 walkgo: the leg to go after leg `i` (a walk or a ride; a wait is part of the ride's landing card), or -1 at the door. */
export const nextLeg = (p, i) => p.legs.findIndex((l, k) => k > i && l.type !== "wait"); // W79 walkgo
/** W79 walkgo: where walk leg `k` ends, as a place: the next ride's stop ("Central Comet Station" / "Central"; a bus stop by
 *  its name), or null for the walk to the door. */
export function stopPlace(p, k) { // W79 walkgo
  const l = p.legs[nextLeg(p, k)];
  if (!l) return null;
  if (l.type === "bike") return { lingo_name: dockName(l.from_name), name: shortDock(l.from_name), place: "", kind: "klingon_dock", lonlat: l.from_ll.slice() }; // W204 bikeshare: the pick-up dock
  const rail = l.mode !== "bus", lonlat = p.legs[k].geometry.at(-1).slice(); // W79 walkgo: its entrance, where the walk ends
  return { lingo_name: rail ? `${l.from_name} Comet Station` : l.from_name, name: l.from_name, place: "", kind: rail ? "comet_station" : "waypoint", lonlat }; // W79 walkgo
}

const trainsOf = (p) => p.legs.filter((l) => l.type === "train");
const walkS = (p) => p.legs.filter((l) => l.type === "walk").reduce((a, l) => a + l.time_s, 0);
/** R2 sandworm (SPEC §453): bus leg `l`'s name, [SCUL, Plain], as the station's card heads its section (comets-logic.js sectionName):
 *  "Sandworm 83" / "Bus 83", "Silver Line SL1", Massport's "Shuttle 22", a replacement's "Worcester Line Shuttle". */
export const busName = (l) => ["Sandworm", "Bus"].map((bus) => sectionName(l.route, { short: l.short || "", line: l.line || "" }, { bus, shuttle: "Shuttle" }));
/** R2 sandworm: a bus's name inside a sentence: a number's word small ("bus 83", "sandworm 83", "shuttle 22"); with `the`, a line's
 *  name after "the", as a train's ("the Silver Line SL1"). */
export const midName = (b, the = false) => (/^(Sandworm|Bus|Shuttle) \S+$/.test(b) ? b[0].toLowerCase() + b.slice(1) : the ? `the ${b}` : b);
/** A ride's name on a card: the line ("Red Line", "Green Line D", "Bus 69", SCUL "Sandworm 69"), or, short, beside others ("Red", "D", "69"). */
export function lineName(l, short = false) {
  if (l.mode === "bus") return short ? l.short || l.line : pick(busName(l)); // R2 sandworm
  if (!short) return l.line;
  return l.route.startsWith("Green-") ? l.route.slice(6) : l.route.startsWith("CR-") ? l.route.slice(3) : l.short || l.line.replace(/ Line$/, "");
}
/** W173 previewsheet: a CSS background layer `w` (0–1) of the bar wide, from `x` (0–1) of it: a percentage position aligns
 *  the layer's own point with the box's (offset = p × (box − layer)), so it is x / (1 − w), never x itself, which spread the
 *  legs with gaps between them (her note 18: "broken and not continuous"). */
export const barAt = (x, w, h = 100) => `${w >= 0.9995 ? 0 : ((100 * x) / (1 - w)).toFixed(2)}% 50% / ${(100 * w).toFixed(2)}% ${h}% no-repeat`; // W173 previewsheet: h, its height in % of the bar's
/** The legs as one bar, from now to the door: walks in the course's orange, as the map's footprints, and half as tall, so the
 *  Orange Line still reads apart; rides in their line's colour; each solid; a wait is the thin track between them (W173
 *  previewsheet, her note 18: was walks dotted in the ink, black by day, and rides dashed). */
export function legsBar(p) {
  const total = p.total_s || 1, start = p.arrive - p.total_s * 1000, out = [];
  let t = 0;
  for (const l of p.legs) {
    const a = l.type === "train" ? (l.dep - start) / 1000 : t, b = l.type === "train" ? (l.arr - start) / 1000 : t + l.time_s;
    t = b;
    if (l.type === "wait" || b <= a) continue;
    const x = Math.max(0, a / total), w = Math.min(1 - x, (b - a) / total), ink = l.type === "train" ? lineColour(l.route, globalThis.document?.documentElement.dataset.theme === "light", l.color) : "var(--course)"; // W173 previewsheet; W186 palette: her line colour; W192 icons7: a bus's by the leg's colour, its hint
    out.push(`linear-gradient(${ink}, ${ink}) ${barAt(x, w, l.type === "walk" ? 50 : 100)}`); // W173 previewsheet: solid; W204 bikeshare: a Bluebike's ride full height, as a ride
  }
  out.push("linear-gradient(var(--bar-track), var(--bar-track)) 0 50% / 100% 2px no-repeat"); // W173 previewsheet: the track under them, through the waits
  return out.join(", ");
}

/** W215 ridesheet (SPEC §411): a ride's name in a row's bar, as her mock-up has them: "Green E", "87", "Red", "Fitchburg". */
export const barName = (l) => (l.mode === "bus" ? l.short || l.line : l.route.startsWith("Green-") ? `Green ${l.route.slice(6)}` : lineName(l, true)); // W215 ridesheet
/** W215 ridesheet (SPEC §411, UX rule 55): plan `p`'s legs on one clock, for the preview's row: [{ kind, t0, t1, ink, name, short,
 *  change, leg }], ms. `kind` "walk", "wait", "train" (a train, a bus or a boat, in its line's colour, `name` and `short` its names),
 *  "bike" (a Bluebike) or "ride" (her own bike, a bike + T's). From `leave` (Leave by, or the plan's start): the legs before the first
 *  vehicle from then, the wait the rest, so time before leaving is never travel; a vehicle from its departure to its arrival; a wait
 *  ends as the next vehicle leaves. `paceK`: her pace on a bike + T's rides, as cometCard() takes it. Legs under half a second go. */
export function legsAt(p, leave = null, { paceK = 1 } = {}) { // W215 ridesheet
  const start = p.arrive - p.total_s * 1000, light = globalThis.document?.documentElement.dataset.theme === "light", out = [];
  const dur = (l) => 1000 * (l.type === "ride" ? l.time_s + rideSeconds(l) * (1 / paceK - 1) : l.time_s);
  let t = Math.max(start, leave ?? start);
  p.legs.forEach((l, i) => {
    if (l.type === "train") { out.push({ kind: "train", t0: l.dep, t1: l.arr, ink: lineColour(l.route, light, l.color), name: barName(l), short: lineName(l, true), leg: l }); t = l.arr; return; }
    const next = p.legs[i + 1], t1 = l.type === "wait" && next?.type === "train" ? Math.max(t, next.dep) : t + dur(l);
    out.push({ kind: l.type === "wait" || l.type === "bike" || l.type === "ride" ? l.type : "walk", t0: t, t1, ink: null, name: l.type === "bike" ? WORDS.bike : "", short: "", ...(l.change ? { change: true } : {}), leg: l });
    t = t1;
  });
  return out.filter((g) => g.t1 - g.t0 >= 500);
} // W215 ridesheet
/** W215 ridesheet (SPEC §411): whether plan `p`'s first departure can no longer be caught at `now`: now is past its departure less
 *  the legs before it (their waits aside; a bike + T's rides at her pace, `paceK`). A plan with no timetable (a walk all the way, a
 *  Bluebike) is never missed. */
export function missed(p, now, { paceK = 1 } = {}) { // W215 ridesheet
  const i = p.legs.findIndex((l) => l.type === "train");
  return i >= 0 && now > p.legs[i].dep - p.legs.slice(0, i).reduce((a, l) => a + (l.type === "wait" ? 0 : 1000 * (l.type === "ride" ? l.time_s + rideSeconds(l) * (1 / paceK - 1) : l.time_s)), 0);
} // W215 ridesheet

/** W189 transittimes (SPEC §329): a ride's departure and the next ones of its line at its stop, as times: "12:05, 12:17, 12:29". */
export const depTimes = (l) => [l.dep, ...(l.next || [])].map((t) => clockAt(new Date(t))).join(", ");
/** W189 transittimes: Leave by's rule. Asked for now (within `now_ms`), a plan that has her at the stop more than `early_s` before
 *  its vehicle says when to set off to be there `before_s` before it. */
export const LEAVE = { early_s: 180, before_s: 120, now_ms: 5 * 60000 };
/** W189 transittimes: when to set off for plan `p`'s first boarding (ms), or null: on time, the vehicle gone, the time past, or a
 *  plan for later. `paceK`: the rider's pace on a bike plan's rides before it, as the card's minutes take it. Information only:
 *  Start sets out at once, and the card's minutes count from now. */
export function leaveBy(p, now = Date.now(), { paceK = 1 } = {}) { // W200 parkwalk: the rides' riding at her pace, their walks unscaled
  const i = p.legs.findIndex((l) => l.type === "train"), wait = p.legs[i - 1], start = p.arrive - p.total_s * 1000;
  if (i < 0 || wait?.type !== "wait" || Math.abs(start - now) > LEAVE.now_ms || p.legs[i].dep <= now) return null;
  const early = wait.time_s - p.legs.slice(0, i).reduce((a, l) => a + (l.type === "ride" ? rideSeconds(l) * (1 / paceK - 1) : 0), 0), t = start + (early - LEAVE.before_s) * 1000;
  return early > LEAVE.early_s && t > now ? t : null;
}

/** A plan's card: its name (the lines, or Walk), its reason in a word, its minutes, arrival, the fact to act on, its walk. W189
 *  transittimes: the fact's next two departures, and `leave`, "Leave by 12:00" when she'd wait at the stop ("" otherwise).
 *  W203 walkcards2: `price`, a plan by T's fare ("$2.40", "Free"), "" for a walk or a fare not known. */
export function walkCard(p, now = Date.now()) { // W189 transittimes: now
  const trains = trainsOf(p), t0 = trains[0], wm = Math.max(1, Math.round(walkS(p) / 60));
  let name = !trains.length ? pick(WORDS.walk) : trains.length === 1 ? lineName(t0) : trains.map((l) => lineName(l, true)).join(" + "); // W204 bikeshare: let
  const why = p.why ? pick(typeof WORDS.why[p.why] === "function" ? WORDS.why[p.why](p) : WORDS.why[p.why]) : "";
  let fact = t0 ? `${WORDS.fact(lineName(t0), depTimes(t0), t0.from_name)}${t0.live ? ` · ${WORDS.live}` : ""}` : pick(WORDS.alone((p.walk_m / 1609.344).toFixed(1))); // W189 transittimes: depTimes // W204 bikeshare: let
  const walk = pick(WORDS.walkMin(wm)), min = Math.max(1, Math.round(p.total_s / 60)), lb = t0 && leaveBy(p, now); let leave = lb ? WORDS.leaveBy(clockAt(new Date(lb))) : ""; // W189 transittimes: leave
  let price = t0 && p.price != null ? WORDS.price(p.price) : ""; // W203 walkcards2: never guessed; W211 walkmore: let
  const bl = p.legs.find((l) => l.type === "bike"); // W204 bikeshare (SPEC §372): a Bluebike's card, its price; the pick-up's bikes, the drop-off's free docks
  if (bl) { name = WORDS.bike; price = WORDS.price(p.fare); fact = WORDS.pickUp(dockName(bl.from_name), bl.bikes, bl.ebike); leave = WORDS.dropOff(dockName(bl.to_name), bl.docks); } // W204 bikeshare; W211 walkmore (SPEC §395, her row 17: "displayed in the same, consistent way"): its price where a fare sits, beside the minutes, and heard where a fare is
  return { name, why, min, arrive: clockAt(new Date(p.arrive)), dep: clockAt(new Date(lb || Math.round(p.arrive / 1000 - p.total_s) * 1000)), fact, leave, walk, price, // W196 cards2 (SPEC §349): dep, when to set off: Leave by when she'd wait, else the plan's start (now); W203 walkcards2: price; to the second, as total_s is
    bar: legsBar(p), label: [name, why, `${min} min`, price, fact, leave, walk].filter(Boolean).join(", ") }; // W189 transittimes: leave; W203 walkcards2: price
}

/** The walks on the chart, as lines for the dotted course-walk layer (the rides go on course.js's comet layers). */
export const walkLegs = (p) => ({ type: "FeatureCollection", features: (p?.legs || []).filter((l) => l.type === "walk" && l.geometry?.length > 1)
  .map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.geometry } })) });

/** The one request for a card's first boarding: its line and direction (BRIEF §8's api-v3.mbta.com). R1 plans (SPEC §441, review P09):
 *  at her two stops, where she boards and where she gets off, with each platform's station, so the trips that don't reach hers are
 *  known. 50 rows, two stops' worth (19 at one stop was the most at 8 am, the Orange Line's): a last stop's predictions have no
 *  departure and sort first: at 7:47 am, Downtown Crossing to Braintree, 17 rows came before any departure, so 16 would hold none. */
export const predictionsUrl = (l) => `https://api-v3.mbta.com/predictions?filter[stop]=${encodeURIComponent(l.from)},${encodeURIComponent(l.to)}&filter[route]=${encodeURIComponent(l.route)}` // R1 plans: her two stops
  + `&filter[direction_id]=${l.dir}&include=stop&fields[stop]=&fields[prediction]=arrival_time,departure_time&sort=departure_time&page[limit]=50`; // R1 plans: each platform's station, and the arrivals
/** W189 transittimes: V3's JSON:API reply's predicted departures (ms) at leg `l`'s boarding stop, soonest first. R1 plans (SPEC §441,
 *  review P09): only the trips predicted at its last stop after it, so not the other branch's trains (the Red Line's to Ashmont for
 *  Quincy Center) nor a trip that turns short; a stop is its platform's station (the reply's `included` stops), else itself. */
export function liveDeps(json, l) { // R1 plans: l
  const station = new Map((json?.included || []).filter((x) => x.type === "stop").map((x) => [x.id, x.relationships?.parent_station?.data?.id || x.id]));
  const at = (p) => station.get(p.relationships?.stop?.data?.id) ?? p.relationships?.stop?.data?.id, trip = (p) => p.relationships?.trip?.data?.id;
  const time = (p) => Date.parse(p.attributes?.departure_time), there = new Map(); // a trip's last time at her stop
  for (const p of json?.data || []) if (at(p) === l.to) { const t = Date.parse(p.attributes?.arrival_time ?? p.attributes?.departure_time); if (t > (there.get(trip(p)) ?? -Infinity)) there.set(trip(p), t); }
  return (json?.data || []).filter((p) => at(p) === l.from && time(p) < there.get(trip(p))).map(time).sort((a, b) => a - b); // R1 plans
}
/** The first predicted departure (ms) at or after `ready`, from V3's JSON:API reply, or null (none, or none in reach). */
export function firstLive(json, ready, l) { // R1 plans: l, the leg
  return liveDeps(json, l).find((x) => x >= ready) ?? null; // W189 transittimes: liveDeps
}
/** The plan with its first boarding at the live time `dep`: the leg says so; with one vehicle the arrival moves with it
 *  (with more, the change's next vehicle may still be caught, so only a delay moves it). W189 transittimes: `later`, the
 *  reply's other departures (ms), its next ones (transit.js fillNext()). */
export function withLive(p, dep, later = []) { // W189 transittimes: later
  const i = p.legs.findIndex((l) => l.type === "train");
  if (i < 0 || dep == null) return p;
  const l = p.legs[i], d = dep - l.dep, one = trainsOf(p).length === 1, move = one || d > 0 ? d : 0;
  const legs = p.legs.map((x, k) => (k === i ? { ...x, dep, arr: x.arr + move, live: true, ...(x.next ? { next: fillNext(later, x.next, dep) } : {}) } // W189 transittimes: next
    : k === i - 1 && x.type === "wait" ? { ...x, time_s: Math.max(0, x.time_s + Math.round(d / 1000)) }
    : k > i && x.type === "train" ? { ...x, dep: x.dep + move, arr: x.arr + move } : x));
  return { ...p, legs, arrive: p.arrive + move, total_s: p.total_s + Math.round(move / 1000) };
}
