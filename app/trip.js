// W215 journey (design/app-ui/SPEC.md §412), her row 2 of 2026-11-10: "before I get to the subway station or bus stop, the station is
// shown as my destination, which is confusing. It's just a point on the ride that I need to pass by. The whole route should be displayed
// at all times. Even when I am on transit, display the route that I am following, which will be on the color of the transit I am on."
//
// A walk + T, bike + T or Bluebike plan flies leg by leg (course.js nav.leg: W62 cometcard, W79 walkgo, W204 bikeshare, W211 walkride,
// W212 bikeride), each walk or ride a course of its own to its stop; but it is one trip (UX rule 56). This is the pure part the card's
// foot, the readout and the map read on every leg, so Node tests it. No DOM here.
//
//   tripPlace(leg, place)     -> the place the card's foot names and the pin stands on: the trip's, never a stop on the way
//   tripAt(leg)               -> the index in the plan's legs of the part she's on: a walk, a ride, a Bluebike's ride or the train whose card shows
//   tripArrive(legs, k, t)    -> when she reaches the door (ms), ready for leg k at t: each walk and ride its time, each train its timetable
//   tripEta(leg, here)        -> { arrive, min, clock, dist_m }: the whole trip's arrival, its minutes left, and a distance only on the last leg
//   tripLegs(leg)             -> the trip's legs for the map, the one she's on apart: { at, walks, rides, trains }, each { geometry | l, o }
//   tripPoints(leg)           -> every point of the legs still ahead, for the camera's whole-route view (W222 ontrain: legPoints(p), a plan's)
//   rideSpot(w, l, now, here, ms) -> on board, her place on her line: { lonlat, heading } (W222 ontrain: one place, never back)
import { clockAt, routeSeconds } from "./course-logic.js";
import { rideAt, ridePlace } from "./walk-ride.js"; // W222 ontrain: ridePlace (was rideTimes, and geo.js bearing)
import { rideLine } from "./ride-line.js"; // W222 ontrain

/** A train or bus counts as caught when she is at its stop no more than this after it leaves by the timetable: her minutes on foot
 *  are an estimate, and the T is rarely to the second. Later than that, the next one of its line there (the plan's `next`). */
export const CATCH_S = 60;
/** The legs ahead and behind the one she's on, by opacity, never by width (UX rule 21: the selected route is never thinner): those
 *  behind as faint as the part of a course ridden (the style's progress `flown`, 0.32), those ahead between it and the course. */
export const LEG_O = { ahead: 0.6, behind: 0.32 };

/** The trip's own place (course.js keeps it as `nav.leg.place` while each leg's course ends at its stop), else the course's. */
export const tripPlace = (leg, place) => leg?.place ?? place;
const kth = (legs, type, k) => { let n = -1; return legs.findIndex((l) => l.type === type && ++n === k); };
/** The part of plan `leg.plan` she's on. A walker's plan says it (`i`: the walk, the Bluebike's ride, the ride whose card shows); a bike + T
 *  course's (n 1, the ride to the station; n 0, train `k`'s card; n 2, the ride from the last station) by its kind. */
export function tripAt(leg) {
  const legs = leg?.plan?.legs || [];
  if (leg?.walk) return leg.i;
  if (leg?.n === 0) return kth(legs, "train", leg.k || 0);
  return leg?.n === 1 ? legs.findIndex((l) => l.type === "ride") : legs.findLastIndex((l) => l.type === "ride");
}

/** When she is at the door (ms), ready to set out on leg `k` of `legs` at `t`: a walk, a ride (at her pace `paceK`, its walking unscaled),
 *  a Bluebike's ride, a station's walk in or out, a change, each its own time; a wait is the train's; a train or bus arrives by its timetable
 *  when she's at its stop in time (CATCH_S), else its next departure there moves it, or with none known, how late she is. */
export function tripArrive(legs, k, t, { paceK = 1 } = {}) {
  for (const l of legs.slice(Math.max(0, k))) {
    if (l.type === "wait") continue;
    if (l.type !== "train") { t += 1000 * (l.type === "ride" ? routeSeconds(l, paceK) : l.time_s || 0); continue; }
    if (t <= l.dep + CATCH_S * 1000) { t = Math.max(t, l.arr); continue; }
    const next = (l.next || []).find((d) => d + CATCH_S * 1000 >= t);
    t = l.arr + Math.max(0, (next ?? t) - l.dep);
  }
  return t;
}

/**
 * The trip's numbers on the leg she's on, at `now` (ms): on a course, `left_s` and `left_m` its seconds and metres to its end; on a ride's
 * card, the ride's watch (`leg.ride`) says when she gets off (the timetable shifted by a fix on the line or the MBTA's prediction,
 * walk-ride.js rideAt), and before she's on board the departure is the timetable's. `dist_m` only on the last leg, where the course's end
 * is the trip's place: before it, the distance to her stop is the step's (the card's own distance to its last instruction).
 */
export function tripEta(leg, { now = Date.now(), left_s = 0, left_m = null, paceK = 1 } = {}) {
  const legs = leg.plan.legs, at = tripAt(leg), l = legs[at];
  let k = at + 1, t = now + (leg.ride?.going ? 0 : Math.max(0, left_s) * 1000); // W222 ontrain: on her way out on the train (the watch's `going`), she's at its stop now
  if (l?.type === "train") { if (leg.ride?.phase === "ride") t = Math.max(now, rideAt(leg.ride, l, now).arr); else { k = at; t = now; } }
  const arrive = tripArrive(legs, k, t, { paceK }), last = l?.type !== "train" && !legs.slice(k).some((x) => x.type !== "wait");
  return { arrive, min: Math.max(1, Math.round((arrive - now) / 60000)), clock: clockAt(new Date(arrive)), dist_m: last ? left_m : null };
}

/** The trip on the map: every walk (footprints), ride and Bluebike ride (a bike's course) and train or bus (its line's colour), each with
 *  its opacity `o`: behind or ahead of the part she's on (`at`). That part is left out where a course draws it (a walk or a ride); a train
 *  she's on, or waiting for, is drawn full. */
export function tripLegs(leg) {
  const legs = leg?.plan?.legs || [], at = tripAt(leg), out = { at, walks: [], rides: [], trains: [] };
  legs.forEach((l, i) => {
    const o = i < at ? LEG_O.behind : i > at ? LEG_O.ahead : 1;
    if (l.type === "train") out.trains.push({ l, o });
    else if (i !== at && l.geometry?.length > 1) (l.type === "walk" ? out.walks : out.rides).push({ geometry: l.geometry, o });
  });
  return out;
}

/** Every point of the legs after the part she's on (and of the train she's on, which has no course), and the trip's place: with the rest
 *  of her course, the camera's whole-route view. */
export function tripPoints(leg) {
  const legs = leg?.plan?.legs || [], at = tripAt(leg), from = legs[at]?.type === "train" ? at : at + 1;
  return [...legPoints({ legs: legs.slice(Math.max(0, from)) }), ...(leg?.place?.lonlat ? [leg.place.lonlat] : [])]; // W222 ontrain: legPoints
}
/** W222 ontrain (SPEC §433): every point of plan `p`, a train or bus on its line as the map draws it (ride-line.js rideLine: on its tracks),
 *  for the camera's fit (comet-card.js planPoints' with the trains' tracks). */
export const legPoints = (p) => p.legs.flatMap((l) => (l.type === "train" && l.path?.length > 1 ? rideLine(l).pts : l.geometry || l.path || []));

/** W222 ontrain (SPEC §433): on board, her place on her line (walk-ride.js ridePlace): one distance along its tracks that never goes back,
 *  led by a fresh fix (`here`, main.js's pose) and with none by the timetable, shifted by how late it runs (the watch's `shift`, by a fix
 *  on the line or the MBTA's prediction), heading along it; a move on glides (by `ms`, the frame's clock). Her avatar rides it (main.js).
 *  W215 journey's was the timetable's place alone, straight between its stops, and only with no fix: a fix behind it put her back. */
export function rideSpot(w, l, now, here = null, ms = now) {
  if (!w || !l?.path?.length) return null;
  const { lonlat, heading } = ridePlace(w, l, now, here, ms);
  return { lonlat, heading };
}
