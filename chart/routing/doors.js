// W248 stationdoor (design/app-ui/SPEC.md §514, UX rule 107): a route to a station ends at a real door of it, the one she reaches
// first along her route (no train known), on foot and by bike. Pure JS with no DOM: the walker's timetable's `doors` message (app/stops-worker.js,
// chart/routing/worker.js), the routing worker's `door` message (chart/routing/worker.js), and Node's tests (chart/routing/tests/doors.test.mjs).
// The bike's pick, bikeDoor(), is router.js's (at its end), so the cards' worker, which reads this file, never loads the router.
//
//   stationDoors(tt, ll, name)           -> the doors [[lon, lat]] of the walker's file's station a map's station `name` at `ll` is, or null
//   footDoor(router, from, doors, pace)  -> the door a walk from `from` reaches first: one walking tree (walkTree), read at each door (past its reach, the nearest)
//   bikeDoor(router, o, doors)           -> the door route(o) reaches first: one search to every door at once, exact (below; router.js)
//
// - **The station** is matched as the tiles' stations took their lines (app/comets-logic.js gtfsStation, Starchart.java): of the walker's
//   file's stations (their GTFS parents, "place-…"), the one of its name within NAMED_M, else the nearest within NEAR_M ("Back Bay
//   Station" is the feed's "Back Bay"). A station whose networks board apart (its `parts`: North Station's Commuter Rail at the Garden,
//   its subway under it) gives the doors of its rail place nearest the map's station (South Station's train station or its Red Line).
// - **Its doors** are its `ent`, read by position: never one marked a way out only (its sixth field 1, as a place's doors are marked and
//   W248 doorsides marks every station's) unless the station has no other door; a file that marks none (0.1.134's, but for its `parts`) has
//   every door count. A station the feed gives no doors (its `ent` is its own point) gives none: the route ends at the map's station as before.
// - **By bike, exact in one search:** router.search's estimate aims at its first end, so with several ends it may stop at a door up to
//   the doors' spread farther than the nearest (W248's scout: about 130 m). Each end's walk here costs R more, R the farthest any end
//   lies from the one it aims at: the straight line to the aim is then a lower bound to every end, the search's order is unchanged, and the
//   end it settles on is the cheapest. The route itself isn't kept: the page plans each style to the door as to any place. The graph draws a
//   street as one line, so by bike a door across it costs the same few metres' walk from the line's end as one beside her, as for any place;
//   on foot the walking tree takes the sidewalks and the crossings where the map has them.
import { walkTree, WALK } from "./walktransit.js";

export const NAMED_M = 400, NEAR_M = 150; // app/comets-logic.js GTFS_NAMED_M, GTFS_NEAR_M: Starchart.java's STATION_STOP_M and STATION_NEAR_M
const key = (s) => String(s || "").toLowerCase().replace(/\s+station$/, "").replace(/[^a-z0-9]+/g, "");
const apart = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 111320);

/** The doors of the walker's file's station that the map's station `name` at `ll` is: [[lon, lat]], or null (none matched, or no doors). */
export function stationDoors(tt, ll, name) {
  let best = null, bm = Infinity, named = false;
  const want = key(name);
  for (const st of new Set(tt.stations.map((s) => s.whole || s))) { // a station's places read as one (transit.js places())
    if (!st.id?.startsWith("place-")) continue;
    const d = apart(ll, st.ll), same = !!want && key(st.name) === want;
    if (d < (same ? NAMED_M : NEAR_M) && ((same && !named) || (same === named && d < bm))) { best = st; bm = d; named = same; }
  }
  if (!best) return null;
  const rail = (p) => p.r.some((i) => tt.routes[i]?.type !== 3 && !tt.routes[i]?.id.startsWith("Shuttle-"));
  const at = best.parts?.filter(rail).sort((a, b) => apart(ll, a.ll) - apart(ll, b.ll))[0] ?? best;
  const none = at.ent.length === 1 && apart(at.ent[0], at.ll) <= 1; // the builder's stand-in where the feed gives no doors (build_timetable.py: its doors, or [its point]); a real door on its point counts (Tufts Medical Center's Washington St)
  const all = none ? [] : at.ent, ins = all.filter((e) => !e[5]); // by position, as transit.js entrances(): [lon, lat, junction, metres, seconds, 1 for a way out only]
  const doors = (ins.length ? ins : all).map((e) => [e[0], e[1]]); // its ways out only where it has no other door
  return doors.length ? doors : null;
}

/** The door of `doors` that a walk from `from` reaches first, at her pace, as walktransit.js walkRoute() times a walk; past its walk's reach (she takes
 *  the T, then walks in from her side) or off the graph, the door nearest her start in a straight line. */
export function footDoor(router, from, doors, pace = 1) {
  const v = WALK.speed * pace, F = walkTree(router, from, (2 * WALK.alone_m) / v, 0, pace), s = router.s;
  let best = null, bs = Infinity;
  for (const d of F ? doors : []) {
    const b = router.snap(d);
    if (!b) continue;
    const L = s.len[b.e];
    let t = Math.min(F.dist[s.from[b.e]] + (L * b.t) / v, F.dist[s.to[b.e]] + (L * (1 - b.t)) / v);
    if (F.snap.e === b.e) t = Math.min(t, (F.snap.d + Math.abs(F.snap.t - b.t) * L) / v); // along the one way, as walkRoute()
    if (t + b.d / v < bs) { bs = t + b.d / v; best = d; }
  }
  return best ?? doors.reduce((a, d) => (apart(from, d) < apart(from, a) ? d : a)); // a station with doors never ends at its point
}
