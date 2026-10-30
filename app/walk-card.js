// W73 walk (design/app-ui/SPEC.md §119): on foot and by T in the preview. chart/routing/walktransit.js plans it in the
// routing worker and app/walk.js asks it; this is the pure part the page draws from, so Node tests it: the cards' words,
// minutes and legs bar, the legs on the chart, and the live departure read from the MBTA's predictions.
//
//   walkCard(plan)              -> { name, why, min, arrive, fact, walk, bar, label }   one card and its facts row
//   walkLegs(plan)              -> GeoJSON: the walks, as lines (course.js's dotted course-walk layer)
//   predictionsUrl(leg)         -> the one request a card's first boarding asks (its stop and line, never a position)
//   firstLive(json, ready)      -> the first predicted departure at or after `ready` (ms), or null
//   withLive(plan, dep)         -> the plan with its first boarding's live time (and, for one vehicle, its arrival moved)
//   nextLeg(plan, i), stopPlace(plan, k)   W79 walkgo: in flight, the leg after leg i, and where walk leg k ends
//
// Every string is [SCUL, Plain] (app/lingo-mode.js pick()); a lone string is both modes'. A bus is "bus" in both modes
// until arclight names one (W72 walktransit §2.5: "transports" are cars).
import { pick } from "./lingo-mode.js";
import { clockAt } from "./course-logic.js";
import { lineColour } from "./comets-logic.js"; // W186 palette
import { fillNext } from "../chart/routing/transit.js"; // W189 transittimes

/** The From/To row's switch: "on" plans on foot and by T. Off by default: the ship comes first. */
export const KEY = "starchart.walk";

export const WORDS = {
  mode: ["Space walk and comets", "Walk and T"], // the switch's name
  modeTip: ["Space walk and comets: trains and buses", "Walk and T: trains and buses"], // W140 words: the name says on foot
  cards: ["Ways on foot and by comet", "Ways on foot and by T"], // the cards' group
  walk: ["Space Walk", "Walk"], // the card for walking the whole way
  why: {
    quickest: "Quickest",
    direct: (p) => (p.legs.find((l) => l.type === "train")?.mode === "bus" ? "One bus" : ["One comet", "One train"]),
    walk: "No waiting",
    least: ["Shortest space walk", "Least walking"],
  },
  walkMin: (n) => [`Space walk ${n} min`, `Walk ${n} min`],
  bus: (short) => `Bus ${short}`,
  fact: (line, t, station) => `${line} ${t} at ${station}`, // as the comet card's: "Red Line 8:41 at Central"
  live: "live",
  alone: (mi) => [`Space walk ${mi} LY`, `Walk ${mi} mi`],
  finding: "Finding ways…",
  none: ["No way by comet or bus found.", "No way by train or bus found."],
  far: "No stop within a walk of both ends.",
  held: "The T's timetable downloads on Wi-Fi, or when downloads resume.",
  offline: "The T's timetable downloads once, with a connection.",
  ended: "The T's timetable is out of date.",
  early: "The T's timetable starts later.",
  failed: "No plan by T just now. Try again.",
  leaveBy: (t) => `Leave by ${t}`, // W189 transittimes: when to set off, so as to reach the stop 2 min before it leaves
  saver: "Timetable not downloaded: Data Saver is on.", // W189 transittimes: a bus stop's peek, the walker's file not stored
  noStop: "No timetable for this stop.", // W189 transittimes: a bus stop the file doesn't name
  // W79 walkgo: in flight (SPEC §148). "comet" only on a train that isn't a ferry; a bus is "bus" in both modes, as above
  board: (l, change = false) => { const v = change ? "Change to" : "Board", n = `${l.stops} ${l.stops === 1 ? "stop" : "stops"}`; // W79 walkgo
    return l.mode === "bus" ? `${v} bus ${l.short || l.line} at ${l.from_name} toward ${l.head}. ${n}.` // W79 walkgo
      : [`${v} the ${l.line}${l.route.startsWith("Boat-") ? "" : " comet"} at ${l.from_name} toward ${l.head}. ${n}.`, `${v} the ${l.line} at ${l.from_name} toward ${l.head}. ${n}.`]; }, // W79 walkgo
  leave: (l) => [`Leave at ${l.to_name}`, `Get off at ${l.to_name}`], // W79 walkgo: the landing card's foot, as the comets'
  leaveNow: (l) => (l.mode === "bus" || l.route.startsWith("Boat-") ? "Get off here" : ["Leave the comet here", "Get off here"]), // W79 walkgo: the banner near the stop
  tapOn: "Tap to walk on", // W79 walkgo: the landing card's foot, a tap sets out on the next walk
  done: ["Space walk complete", "Arrived"], // W79 walkgo: at the door, as "Course complete"
  landed: ["Space walk ended", "Walk ended"], // W79 walkgo: Land's word for a walk ("Landed" / "Ride ended")
};

/** W79 walkgo: the leg to go after leg `i` (a walk or a ride; a wait is part of the ride's landing card), or -1 at the door. */
export const nextLeg = (p, i) => p.legs.findIndex((l, k) => k > i && l.type !== "wait"); // W79 walkgo
/** W79 walkgo: where walk leg `k` ends, as a place: the next ride's stop ("Central Comet Station" / "Central"; a bus stop by
 *  its name), or null for the walk to the door. */
export function stopPlace(p, k) { // W79 walkgo
  const l = p.legs[nextLeg(p, k)];
  if (!l) return null;
  const rail = l.mode !== "bus", lonlat = p.legs[k].geometry.at(-1).slice(); // W79 walkgo: its entrance, where the walk ends
  return { lingo_name: rail ? `${l.from_name} Comet Station` : l.from_name, name: l.from_name, place: "", kind: rail ? "comet_station" : "waypoint", lonlat }; // W79 walkgo
}

const trainsOf = (p) => p.legs.filter((l) => l.type === "train");
const walkS = (p) => p.legs.filter((l) => l.type === "walk").reduce((a, l) => a + l.time_s, 0);
/** A ride's name on a card: the line ("Red Line", "Green Line D", "Bus 69"), or, short, beside others ("Red", "D", "69"). */
export function lineName(l, short = false) {
  if (l.mode === "bus") return short ? l.short || l.line : WORDS.bus(l.short || l.line);
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
    out.push(`linear-gradient(${ink}, ${ink}) ${barAt(x, w, l.type === "train" ? 100 : 50)}`); // W173 previewsheet: solid
  }
  out.push("linear-gradient(var(--bar-track), var(--bar-track)) 0 50% / 100% 2px no-repeat"); // W173 previewsheet: the track under them, through the waits
  return out.join(", ");
}

/** W189 transittimes (SPEC §329): a ride's departure and the next ones of its line at its stop, as times: "12:05, 12:17, 12:29". */
export const depTimes = (l) => [l.dep, ...(l.next || [])].map((t) => clockAt(new Date(t))).join(", ");
/** W189 transittimes: Leave by's rule. Asked for now (within `now_ms`), a plan that has her at the stop more than `early_s` before
 *  its vehicle says when to set off to be there `before_s` before it. */
export const LEAVE = { early_s: 180, before_s: 120, now_ms: 5 * 60000 };
/** W189 transittimes: when to set off for plan `p`'s first boarding (ms), or null: on time, the vehicle gone, the time past, or a
 *  plan for later. `paceK`: the rider's pace on a bike plan's rides before it, as the card's minutes take it. Information only:
 *  Start sets out at once, and the card's minutes count from now. */
export function leaveBy(p, now = Date.now(), { paceK = 1 } = {}) {
  const i = p.legs.findIndex((l) => l.type === "train"), wait = p.legs[i - 1], start = p.arrive - p.total_s * 1000;
  if (i < 0 || wait?.type !== "wait" || Math.abs(start - now) > LEAVE.now_ms || p.legs[i].dep <= now) return null;
  const early = wait.time_s - p.legs.slice(0, i).reduce((a, l) => a + (l.type === "ride" ? l.time_s * (1 / paceK - 1) : 0), 0), t = start + (early - LEAVE.before_s) * 1000;
  return early > LEAVE.early_s && t > now ? t : null;
}

/** A plan's card: its name (the lines, or Walk), its reason in a word, its minutes, arrival, the fact to act on, its walk. W189
 *  transittimes: the fact's next two departures, and `leave`, "Leave by 12:00" when she'd wait at the stop ("" otherwise). */
export function walkCard(p, now = Date.now()) { // W189 transittimes: now
  const trains = trainsOf(p), t0 = trains[0], wm = Math.max(1, Math.round(walkS(p) / 60));
  const name = !trains.length ? pick(WORDS.walk) : trains.length === 1 ? lineName(t0) : trains.map((l) => lineName(l, true)).join(" + ");
  const why = p.why ? pick(typeof WORDS.why[p.why] === "function" ? WORDS.why[p.why](p) : WORDS.why[p.why]) : "";
  const fact = t0 ? `${WORDS.fact(lineName(t0), depTimes(t0), t0.from_name)}${t0.live ? ` · ${WORDS.live}` : ""}` : pick(WORDS.alone((p.walk_m / 1609.344).toFixed(1))); // W189 transittimes: depTimes
  const walk = pick(WORDS.walkMin(wm)), min = Math.max(1, Math.round(p.total_s / 60)), lb = t0 && leaveBy(p, now), leave = lb ? WORDS.leaveBy(clockAt(new Date(lb))) : ""; // W189 transittimes: leave
  return { name, why, min, arrive: clockAt(new Date(p.arrive)), fact, leave, walk, bar: legsBar(p), label: [name, why, `${min} min`, fact, leave, walk].filter(Boolean).join(", ") }; // W189 transittimes: leave
}

/** The walks on the chart, as lines for the dotted course-walk layer (the rides go on course.js's comet layers). */
export const walkLegs = (p) => ({ type: "FeatureCollection", features: (p?.legs || []).filter((l) => l.type === "walk" && l.geometry?.length > 1)
  .map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.geometry } })) });

/** The one request for a card's first boarding: its stop and its line and direction (BRIEF §8's api-v3.mbta.com). */
export const predictionsUrl = (l) => `https://api-v3.mbta.com/predictions?filter[stop]=${encodeURIComponent(l.from)}&filter[route]=${encodeURIComponent(l.route)}`
  + `&filter[direction_id]=${l.dir}&fields[prediction]=departure_time&sort=departure_time&page[limit]=8`;
/** W189 transittimes: V3's JSON:API reply's predicted departures (ms), soonest first. */
export const liveDeps = (json) => (json?.data || []).map((x) => Date.parse(x.attributes?.departure_time)).filter(Number.isFinite).sort((a, b) => a - b);
/** The first predicted departure (ms) at or after `ready`, from V3's JSON:API reply, or null (none, or none in reach). */
export function firstLive(json, ready) {
  return liveDeps(json).find((x) => x >= ready) ?? null; // W189 transittimes: liveDeps
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
