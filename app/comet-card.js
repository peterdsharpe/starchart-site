// W62 cometcard (design/app-ui/SPEC.md §90): bike plus comet in the preview and in flight. W61 transit plans it and
// earns it its card (chart/routing/transit.js earn(), app/transit.js); this is the pure part the page draws from, so Node
// tests it: the card's words and minutes, the bike cards the planner weighs, the fold to three cards, the train leg's
// dashed line and its stations' rings, and the two legs a comet course flies as.
//
//   cometCard(plan, { paceK })   -> { name, why, min, arrive, fact, warn: [..], share }  the card and its facts row
//   bikeCards(routes)            -> the preview's routes by style, as the planner's `opts.bike`
//   foldTo(folds, routes, n)     -> foldStyles()'s cards, at most n: the card nearest another folds into it
//   trainLines(plan)             -> GeoJSON: each train leg through its stations, in its line's colour; both ends ringed
//   cometLegs(plan)              -> { ride0, ride1, trains, board, leave }: leg 1 lands at board, leg 2 sets out from leave
//   boardText(plan)              -> leg 1's landing card: "Board the Red Line at Alewife toward Braintree. 15 stops."
//
// Every string is [SCUL, Plain] (app/lingo-mode.js pick()); a lone string is both modes'.
import { pick } from "./lingo-mode.js";
import { clockAt, carFree } from "./course-logic.js";
import { metres } from "./geo.js";
import { samples } from "../chart/routing/transit.js";

/** The Settings key: off by default (W59 multimodal: bike first, comets stay subtle). */
export const KEY = "starchart.transit";
/** Leg 2 sets out when the fix comes back this near the leaving station's entrance (or on a tap on the card). */
export const LEAVE_M = 150;

export const WORDS = {
  card: ["By comet", "By train"],
  why: { time: "Quicker", rain: "Drier", bare: "Calmer", climb: "Flatter" }, // the earn rule's reason, in a word
  fact: (line, t, station) => `${line} ${t} at ${station}`, // the one fact to act on: "Red Line 12:13 at Alewife"
  stairs: (station) => `Stairs at ${station}`,
  line: (l) => (l.route.startsWith("Boat-") ? [l.line, l.line] : [`${l.line} comet`, l.line]), // a ferry is no comet
  stops: (n) => `${n} ${n === 1 ? "stop" : "stops"}`,
  board: (line, station, head, n) => `Board the ${line} at ${station} toward ${head}. ${n}.`,
  change: (line, station) => `Change to the ${line} at ${station}.`,
  station: (name) => [`${name} Comet Station`, name],
  leave: (station) => [`Leave at ${station}`, `Get off at ${station}`],
  tapOn: ["Tap to fly on", "Tap to ride on"],
  noShare: ["Only a ship's course can be shared.", "Only a bike route can be shared."],
};

const why = (e) => WORDS.why[e.reason === "comfort" ? e.kind : e.reason] || "";
const trainsOf = (p) => p.legs.filter((l) => l.type === "train");
const ridesOf = (p) => p.legs.filter((l) => l.type === "ride");

/**
 * The card for an earned plan (earn()'s, with its `earned`): its name, its reason in a word, its door-to-door minutes from
 * now with the wait (the rides at the pilot's pace `paceK`, the stations and trains as timed: W59 pace's planned minutes
 * keep the rides apart from the train), the arrival clock, the fact to act on and its warnings (stairs at a station).
 * `share`: the trains' part of the trip, [from, to] in 0..1, for the card's bar.
 */
export function cometCard(p, { paceK = 1 } = {}) {
  const t0 = trainsOf(p)[0], r1 = ridesOf(p).at(-1), late = r1 ? r1.time_s * (1 / paceK - 1) : 0;
  const total = p.total_s + late, trains = trainsOf(p), start = (t0.dep - (p.arrive - p.total_s * 1000)) / 1000;
  const warn = p.legs.filter((l) => l.stairs).map((l) => WORDS.stairs(l.name));
  return {
    name: pick(WORDS.card), why: why(p.earned), min: Math.max(1, Math.round(total / 60)), arrive: clockAt(new Date(p.arrive + late * 1000)),
    fact: WORDS.fact(t0.line, clockAt(new Date(t0.dep)), t0.from_name), warn: [...new Set(warn)],
    share: [Math.max(0, start / total), Math.min(1, (trains.at(-1).arr - (p.arrive - p.total_s * 1000)) / 1000 / total)],
  };
}

/** The preview's routes by style (the router's), as W61's planner weighs them (transit.js bikeCards()'s shape). */
export const bikeCards = (routes) => Object.entries(routes).filter(([, r]) => r).map(([style, r]) => ({ style, time_s: r.time_s, distance_m: r.distance_m,
  climb_m: r.climb_m || 0, bare_m: (r.bare || []).reduce((a, [x, y]) => a + y - x, 0), samples: samples(r) }));

/** How far apart two routes are as choices: their minutes, climb and car-free share, each against its own scale. */
const apartOf = (a, b) => Math.abs(a.time_s - b.time_s) / Math.max(60, Math.min(a.time_s, b.time_s))
  + Math.abs((a.climb_m || 0) - (b.climb_m || 0)) / Math.max(30, a.climb_m || 0, b.climb_m || 0) + Math.abs(carFree(a) - carFree(b)) / 100;
/**
 * The bike cards, at most `n` (W59 multimodal §5: the comet card is the third, never a fourth). While there are more, the
 * card nearest another folds into it, as W27's near-equal folds do: its styles join that card, which keeps its own route
 * and name. The first card (Wormholes', bike first) is never the one folded away. `folds`: foldStyles()'s; `routes`: by style.
 */
export function foldTo(folds, routes, n) {
  const out = folds.map((f) => ({ ...f, ids: f.ids.slice() }));
  while (out.length > Math.max(1, n)) {
    let best = null;
    for (let i = 1; i < out.length; i++) for (let j = 0; j < out.length; j++) {
      const d = i === j ? Infinity : apartOf(routes[out[i].keep], routes[out[j].keep]);
      if (!best || d < best.d) best = { i, j, d };
    }
    const into = out[best.j];
    into.ids.push(...out[best.i].ids);
    into.folded = [...(into.folded || []), ...out[best.i].ids];
    out.splice(best.i, 1);
  }
  return out;
}

/** The train legs on the chart: each a line through its stations in its line's colour (dashed, by the layer), and its two
 *  stations as points to ring. */
export function trainLines(p) {
  const features = [];
  for (const l of p ? trainsOf(p) : []) {
    const color = `#${l.color || "8a8f98"}`, path = l.path || [];
    if (path.length > 1) features.push({ type: "Feature", properties: { color }, geometry: { type: "LineString", coordinates: path } });
    for (const ll of [path[0], path.at(-1)]) if (ll) features.push({ type: "Feature", properties: { color }, geometry: { type: "Point", coordinates: ll } });
  }
  return { type: "FeatureCollection", features };
}
/** Every point of the plan, rides and trains, for the preview's framing. */
export const planPoints = (p) => p.legs.flatMap((l) => l.geometry || l.path || []);

/** A plan's two legs: the rides, the trains, and the entrances leg 1 lands at and leg 2 sets out from. */
export function cometLegs(p) {
  const [ride0, ride1] = ridesOf(p), wi = p.legs.find((l) => l.type === "walk_in"), wo = p.legs.find((l) => l.type === "walk_out");
  return { ride0, ride1, trains: trainsOf(p), board: { lonlat: wi.lonlat || ride0.geometry.at(-1), name: wi.name, id: wi.station },
    leave: { lonlat: wo.lonlat || ride1.geometry[0], name: wo.name, id: wo.station } };
}
/** Leg 1's landing pad: the boarding station's entrance, as a place. */
export const stationPlace = (s) => ({ lingo_name: WORDS.station(s.name)[0], name: s.name, place: "", kind: "comet_station", lonlat: s.lonlat.slice() });
/** The fix is near enough the leaving station for leg 2. */
export const nearLeave = (legs, lonlat) => !!lonlat && metres(lonlat, legs.leave.lonlat) <= LEAVE_M;

/** Leg 1's landing card, in the mode's words: "Board the Red Line comet at Alewife toward Braintree. 15 stops." (Plain:
 *  "Board the Red Line at …"), and with a change, the second train after it. */
export function boardText(p) {
  const [a, b] = trainsOf(p);
  const first = WORDS.board(pick(WORDS.line(a)), a.from_name, a.head, WORDS.stops(a.stops));
  return b ? `${first} ${WORDS.change(pick(WORDS.line(b)), b.from_name)}` : first;
}
