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

/** The From/To row's switch: "on" plans on foot and by T. Off by default: the ship comes first. */
export const KEY = "starchart.walk";

export const WORDS = {
  mode: ["Space walk and comets", "Walk and T"], // the switch's name
  modeTip: ["Space walk and comets: on foot, with trains and buses", "Walk and T: on foot, with trains and buses"],
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
/** The legs as one bar, from now to the door: walks dotted in the ink, rides dashed in their line's colour, waits empty. */
export function legsBar(p) {
  const total = p.total_s || 1, start = p.arrive - p.total_s * 1000, out = [];
  let t = 0;
  for (const l of p.legs) {
    const a = l.type === "train" ? (l.dep - start) / 1000 : t, b = l.type === "train" ? (l.arr - start) / 1000 : t + l.time_s;
    t = b;
    if (l.type === "wait" || b <= a) continue;
    const x = (100 * Math.max(0, a / total)).toFixed(1), w = (100 * Math.min(1, (b - a) / total)).toFixed(1);
    const g = l.type === "train" ? `repeating-linear-gradient(90deg, #${l.color} 0 6px, transparent 6px 9px)` : "repeating-linear-gradient(90deg, var(--starlight) 0 2px, transparent 2px 5px)";
    out.push(`${g} ${x}% 0 / ${w}% 100% no-repeat`);
  }
  return out.join(", ");
}

/** A plan's card: its name (the lines, or Walk), its reason in a word, its minutes, arrival, the fact to act on, its walk. */
export function walkCard(p) {
  const trains = trainsOf(p), t0 = trains[0], wm = Math.max(1, Math.round(walkS(p) / 60));
  const name = !trains.length ? pick(WORDS.walk) : trains.length === 1 ? lineName(t0) : trains.map((l) => lineName(l, true)).join(" + ");
  const why = p.why ? pick(typeof WORDS.why[p.why] === "function" ? WORDS.why[p.why](p) : WORDS.why[p.why]) : "";
  const fact = t0 ? `${WORDS.fact(lineName(t0), clockAt(new Date(t0.dep)), t0.from_name)}${t0.live ? ` · ${WORDS.live}` : ""}` : pick(WORDS.alone((p.walk_m / 1609.344).toFixed(1)));
  const walk = pick(WORDS.walkMin(wm)), min = Math.max(1, Math.round(p.total_s / 60));
  return { name, why, min, arrive: clockAt(new Date(p.arrive)), fact, walk, bar: legsBar(p), label: [name, why, `${min} min`, fact, walk].filter(Boolean).join(", ") };
}

/** The walks on the chart, as lines for the dotted course-walk layer (the rides go on course.js's comet layers). */
export const walkLegs = (p) => ({ type: "FeatureCollection", features: (p?.legs || []).filter((l) => l.type === "walk" && l.geometry?.length > 1)
  .map((l) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.geometry } })) });

/** The one request for a card's first boarding: its stop and its line and direction (BRIEF §8's api-v3.mbta.com). */
export const predictionsUrl = (l) => `https://api-v3.mbta.com/predictions?filter[stop]=${encodeURIComponent(l.from)}&filter[route]=${encodeURIComponent(l.route)}`
  + `&filter[direction_id]=${l.dir}&fields[prediction]=departure_time&sort=departure_time&page[limit]=8`;
/** The first predicted departure (ms) at or after `ready`, from V3's JSON:API reply, or null (none, or none in reach). */
export function firstLive(json, ready) {
  const t = (json?.data || []).map((x) => Date.parse(x.attributes?.departure_time)).filter((x) => Number.isFinite(x) && x >= ready).sort((a, b) => a - b);
  return t.length ? t[0] : null;
}
/** The plan with its first boarding at the live time `dep`: the leg says so; with one vehicle the arrival moves with it
 *  (with more, the change's next vehicle may still be caught, so only a delay moves it). */
export function withLive(p, dep) {
  const i = p.legs.findIndex((l) => l.type === "train");
  if (i < 0 || dep == null) return p;
  const l = p.legs[i], d = dep - l.dep, one = trainsOf(p).length === 1, move = one || d > 0 ? d : 0;
  const legs = p.legs.map((x, k) => (k === i ? { ...x, dep, arr: x.arr + move, live: true } : k === i - 1 && x.type === "wait" ? { ...x, time_s: Math.max(0, x.time_s + Math.round(d / 1000)) }
    : k > i && x.type === "train" ? { ...x, dep: x.dep + move, arr: x.arr + move } : x));
  return { ...p, legs, arrive: p.arrive + move, total_s: p.total_s + Math.round(move / 1000) };
}
