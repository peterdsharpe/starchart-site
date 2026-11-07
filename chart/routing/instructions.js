// Router maneuvers -> course mode's instructions. router.js names roads by their OSM name; this names them
// through the lingo pack ("Turn right onto Starpath Beech.") and returns the instruction objects that
// chart/prototype/course.js (nextManeuver, arrowFile, turnWords, TurnPrompter) reads from the demo courses:
// { at, along_m, turn, arrow, exit, angle, text, plain, then, road, lanes? }. W31 navvoice: course.js says the turns in port and
// starboard from `turn` and `then`; `text` keeps left and right, and gives it the road's SCUL name. Pure functions: no DOM.

import { labelFor, baseFor, wormholeName } from "../lingo/lingo.js"; // W60 b: wormholeName

const VERBS = { // as chart/routing/demo_routes.py words BRouter's hints
  straight: ["↑", "Continue"], left: ["←", "Turn left"], slight_left: ["↖", "Bear left"], sharp_left: ["↙", "Sharp left"],
  right: ["→", "Turn right"], slight_right: ["↗", "Bear right"], sharp_right: ["↘", "Sharp right"],
  keep_left: ["↖", "Keep left"], keep_right: ["↗", "Keep right"], u_turn: ["↶", "Hard about"],
};
// W32 routing: a course that stops this far or more from the place, across the street, says to walk across
export const WALK_SAY_M = 15;
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const ordinal = (n) => ORDINAL[n] || `${n}th`;

/** The SCUL and plain names of the road a maneuver takes: ["Starpath Beech", "Beech Street"], or [null, null]. W60 b: a
 *  sidepath named after its street ("Western Avenue", a cycleway beside it) is named as the street, "Starpath Western", the
 *  way the chart labels it: the chart gives such a path no name of its own (lingo.js wormholeName, Starchart.java). */
export function roadLabels(pack, m) {
  if (!m.name) return m.kind === "wormhole" ? ["the wormhole", "the bike path"] : [null, null];
  let kind = m.kind && pack.kinds[m.kind] ? m.kind : "starpath";
  if (kind === "wormhole" && !wormholeName(m.name)) kind = "starpath"; // W60 b
  const scul = labelFor(pack, kind, { name: m.name, ref: kind === "transport_lane" ? m.name : undefined });
  return [kind === "wormhole" ? `the ${scul}` : scul, m.name];
}

/** W60 d: the name of the road a maneuver takes in a lingo mode: "Starpath Beech", or in Plain ("meatspace") "Beech Street". */
export const roadName = (pack, m, mode = "scul") => roadLabels(pack, m)[mode === "meatspace" ? 1 : 0];

/** One maneuver's instruction, in course.js's shape. */
export function instruction(pack, m) {
  const [scul, plain] = roadLabels(pack, m);
  const onto = (w) => (w ? ` onto ${w}.` : ".");
  let text, plainText, arrow;
  if (m.type === "arrive") {
    [text, plainText, arrow] = ["Landing pad ahead.", "Arriving.", "⚑"];
    if (m.walk_m >= WALK_SAY_M) [text, plainText] = [`${text} Walk across.`, `${plainText} Walk across.`]; // W32 routing
  } else if (m.type === "black_hole") {
    const n = ordinal(m.exit || 1);
    arrow = m.angle < 0 ? "⟲" : "⟳";
    text = `Orbit the black hole. Take the ${n} exit` + (scul ? `, onto ${scul}.` : ".");
    plainText = `At the rotary, take the ${n} exit` + onto(plain); // W60 d: the comma, as it is said
  } else {
    const [a, verb] = VERBS[m.type] || VERBS.straight;
    const then = m.then && VERBS[m.then] ? `, then ${VERBS[m.then][1].charAt(0).toLowerCase()}${VERBS[m.then][1].slice(1)}` : "";
    arrow = a;
    text = verb + then + onto(scul);
    plainText = (m.type === "u_turn" ? "Make a U-turn" : verb) + then + onto(plain); // W60 d: "Hard about" is SCUL
  }
  return {
    at: m.lonlat, along_m: m.at_m, turn: m.type, arrow, exit: m.exit ?? null, angle: m.angle, text, plain: plainText, ...(m.walk_m ? { walk_m: m.walk_m } : {}),
    then: (m.type !== "black_hole" && VERBS[m.then] && m.then) || null, // W31 navvoice: a folded jog's second turn, for course.js's port and starboard
    road: m.name ? { kind: m.kind, name: m.name, base: baseFor(pack, m.kind || "starpath", m.name) } : null,
    ...(m.lanes ? { lanes: m.lanes } : {}), // W53 lanes: the motor lanes to cross (router.js lanesAt), for the card's row and the prepare call
  };
}

/** W93 busstop: the stretches of a route on a painted or shared bike lane on a street, [from_m, to_m], from its `ways` runs. */
const laneRuns = (r) => (r.ways || []).map(([m, kind], i, w) => [m, w[i + 1]?.[0] ?? r.distance_m, kind])
  .filter(([, , kind]) => kind === "laned_starpath" || kind === "shared_starpath").map(([a, b]) => [a, b]);

/** A whole route as a course: the GeoJSON Feature the prototype flies (`properties.instructions`, `length_m`). */
export function toCourse(pack, r, { id = "planned", title = "Planned course" } = {}) {
  return {
    type: "Feature",
    properties: {
      id, title, profile: r.style, length_m: r.distance_m, light_years: +(r.distance_m / 1609.344).toFixed(2),
      ascend_m: r.climb_m, time_s: r.time_s, bike_m: r.bike_m, instructions: r.maneuvers.map((m) => instruction(pack, m)),
      stops: (r.stops || []).map(([, lon, lat]) => [lon, lat]), // W86 stops: the stop signs met, for the events engine
      lanes: laneRuns(r), // W93 busstop: the painted or shared bike lanes ridden, for a bus stop beside one
      source: "Starchart router, data © OpenStreetMap contributors (ODbL)",
    },
    geometry: { type: "LineString", coordinates: r.geometry },
  };
}
