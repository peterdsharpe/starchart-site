// W228 transit2 (design/app-ui/SPEC.md §481), her row 10.4 of 2026-11-13: "With the Transit layer off: show only the bus stops on my route
// (where I get on and off), the same way traffic lights appear only along a route. With the Transit layer on: show every bus stop from its
// zoom level." UX rule 93: a kind of thing shows with its layer; with the layer off, only where her route uses it.
//
// - The stops' layers (chart/style/build_style.py `sandworm-nest`, its icons, and `sandworm-nest-name`, its names, shown in a preview) draw
//   every stop of the tiles from NEST_Z when the Transit tile (Plain "Transit", SCUL "Comets", app/layers.js) is on and not stepped aside;
//   otherwise only the stops the trip on the chart boards and leaves a bus at (routeStops: each bus leg's first and last stop): a stop of the
//   tiles whose OSM `ref` (the MBTA's stop code, chart/SCHEMA.md) is that stop's id, or one with no ref within NO_REF_M of the plan's point
//   for it; none with no trip on the chart.
// - In a ride the stops are always her trip's alone (the map as ground hid every stop in flight: app/fx.js GROUND, before).
// - W234 places2 (SPEC §493), her row 5 of 11-14: "Bluebikes stations ... should all appear at the same zoom level, and only if the transit layer
//   is enabled, because they are transit. Of course they should appear when they are included in a planned or active route." The Bluebikes docks
//   (`stop-label-dock`, its icons, and `stop-label-dock-name`, its names in a preview) follow the same rule by a filter of their own: every dock
//   with the tile on and not stepped aside, else her trip's own (routeDocks: each Bluebike leg's pick-up and drop-off), and in a ride hers alone.
//   Arclight's "hidden in flight" (W21, 10-16) holds for every dock her trip doesn't use.
// - One filter set a change (the trip, the tile, the flight): MapLibre evaluates it in its workers as it lays out each tile, as the route's
//   lights' (chart/prototype/gl-layer.js nearFilter). Nothing a frame but every() (main.js: the tile's two settings, read) and a comparison
//   of what it was told last.

export const STOP_LAYERS = ["sandworm-nest", "sandworm-nest-name"]; // build_style.py's names_apart(nest)
/** Metres from the plan's point (the MBTA's) within which a stop of the tiles with no ref (OSM's, 79 of 1,691 in Cambridge, Somerville and
 *  Boston's middle) is that stop. By ref, not by distance alone: of 1,506 stops whose ref the MBTA's feed has, OSM's point is within 7 m of
 *  the MBTA's for half, 14 m for three in four, 28 m for nine in ten; and for 192 of them another stop (the kerb across) is within 15 m. */
export const NO_REF_M = 25;

/** The stops a plan `p` (a walker's or a bike and T course's) boards and leaves a bus at: each bus leg's first and last stop, as
 *  { ids, pts }: their ids (the MBTA's) and [lon, lat]s, once each. */
export function routeStops(p) {
  const ids = [], pts = [];
  for (const l of p?.legs || []) {
    if (l.type !== "train" || l.mode !== "bus" || !(l.path?.length > 0)) continue;
    for (const id of [l.from, l.to, l.ids?.[0], l.ids?.at(-1)]) if (id != null && !ids.includes(String(id))) ids.push(String(id));
    for (const ll of [l.path[0], l.path.at(-1)]) if (ll && !pts.some((q) => q[0] === ll[0] && q[1] === ll[1])) pts.push(ll);
  }
  return { ids, pts };
}
/** A stops layer's filter: its own `base` with every stop (`all`), else only the stops `s` (routeStops') by ref or, with none, by place; else none. */
export const stopsFilter = (base, s, all) => (all ? base : s.pts.length ? ["all", base ?? true, ["any", ["in", ["to-string", ["coalesce", ["get", "ref"], ""]], ["literal", s.ids]],
  ["all", ["!", ["has", "ref"]], ["<=", ["distance", { type: "MultiPoint", coordinates: s.pts }], NO_REF_M]]]] : ["all", base ?? true, false]);

export const DOCK_LAYERS = ["stop-label-dock", "stop-label-dock-name"]; // W234 places2: build_style.py's names_apart(dock)
/** W234 places2: metres from the plan's dock (Bluebikes' own place, chart/routing/bikeshare.js) within which a dock of the tiles (OSM's) is that
 *  dock: one of its name within DOCK_NAME_M, any within DOCK_M. Live, 2026-11-15: of Bluebikes' 597 stations inside the map, 382 have a sign
 *  by this rule and 215 none (196 with no dock of the map's within 60 m, 146 of them in Boston proper, none in Cambridge); SPEC §493. */
export const DOCK_NAME_M = 60, DOCK_M = 25;
/** The docks a plan `p` (a walker's) takes and leaves a Bluebike at: each bike leg's two, as { names, pts }: their names and [lon, lat]s. */
export function routeDocks(p) {
  const names = [], pts = [];
  for (const l of p?.legs || []) {
    if (l.type !== "bike") continue;
    for (const n of [l.from_name, l.to_name]) if (n && !names.includes(n)) names.push(n);
    for (const ll of [l.from_ll, l.to_ll]) if (ll && !pts.some((q) => q[0] === ll[0] && q[1] === ll[1])) pts.push(ll);
  }
  return { names, pts };
}
/** A docks layer's filter: its own `base` with every dock (`all`), else only the docks `d` (routeDocks') by name and place; else none. */
export const docksFilter = (base, d, all) => { if (all) return base; if (!d.pts.length) return ["all", base ?? true, false];
  const near = (m) => ["<=", ["distance", { type: "MultiPoint", coordinates: d.pts }], m];
  return ["all", base ?? true, ["any", ["all", ["in", ["to-string", ["coalesce", ["get", "name"], ""]], ["literal", d.names]], near(DOCK_NAME_M)], near(DOCK_M)]]; };
/** W238 feeddocks (SPEC §501): the source of the docks drawn from Bluebikes' own station list (app/feed-docks.js), which the dock layers read in
 *  place of the tiles' while the list is on the phone; its stations carry Bluebikes' `station_id`. */
export const FEED_SOURCE = "feed-docks"; // W238 feeddocks
/** W238 feeddocks: Bluebikes' ids of the docks a plan `p` takes and leaves a Bluebike at (each bike leg's `from` and `to`, as its card's), once each. */
export const routeDockIds = (p) => [...new Set((p?.legs || []).flatMap((l) => (l.type === "bike" ? [l.from, l.to] : [])).filter((id) => id != null).map(String))]; // W238 feeddocks
/** W238 feeddocks: a docks layer's filter on Bluebikes' list: its own `base` with every station (`all`), else only the stations of `ids`, by id. */
export const idsFilter = (base, ids, all) => (all ? base : ["all", base ?? true, ["in", ["to-string", ["get", "station_id"]], ["literal", ids]]]); // W238 feeddocks

/**
 * Mount it. `plan()` is the trip on the chart (course.js nav.chartPlan), `every()` whether the tile shows every stop (on, and not stepped
 * aside by a preview), `flying()` whether a ride is on. tick() from the frame loop; again() after another module set a base filter
 * (main.js drawPacks). Returns { tick, again, drop, stats, soon }. W242 leftovers9 (SPEC §505, UX 82): soon() where the trip on the chart
 * changes (course.js charted): its filters in that task, with its line and rings, not at the frame loop's next frame (a quarter second at
 * its idle rate); changes in one task, one tick.
 */
export function mountBusStops({ map, plan, every, flying }) {
  const stats = { sets: 0, stops: [], docks: [], dockIds: [], all: true }; // for tests; W234 places2: docks, the trip's docks' names; W238 feeddocks: dockIds, their ids
  let seen, seenAll, bases = {}, set = {};
  function apply(p, all) {
    const stops = routeStops(p), docks = routeDocks(p), dockIds = routeDockIds(p); // W234 places2: docks; W238 feeddocks: dockIds
    const feed = (id) => map.getLayer(id)?.source === FEED_SOURCE; // W238 feeddocks: the layer reads Bluebikes' list: her docks by their ids
    for (const [ids, filter] of [[STOP_LAYERS, (b) => stopsFilter(b, stops, all)], [DOCK_LAYERS, (b, id) => (feed(id) ? idsFilter(b, dockIds, all) : docksFilter(b, docks, all))]]) for (const id of ids) { // W234 places2: and the docks'; W238 feeddocks: by id on the list
      if (!map.getLayer(id)) continue;
      const now = map.getFilter(id);
      if (!(id in bases) || JSON.stringify(now) !== JSON.stringify(set[id])) bases[id] = now; // one set since by another is the base now (as gl-layer.js focus)
      const f = filter(bases[id], id); // W234 places2: filter; W238 feeddocks: id
      if (JSON.stringify(f) !== JSON.stringify(now)) map.setFilter(id, f);
      set[id] = f;
    }
    stats.sets++; stats.stops = stops.ids; stats.docks = docks.names; stats.dockIds = dockIds; stats.all = all; // W234 places2: docks; W238 feeddocks: dockIds
  }
  function tick() {
    const p = plan(), all = !flying() && every();
    if (p === seen && all === seenAll) return;
    seen = p; seenAll = all;
    apply(p, all);
  }
  const drop = () => { for (const id of [...STOP_LAYERS, ...DOCK_LAYERS]) if (map.getLayer(id) && id in bases) map.setFilter(id, bases[id]); set = {}; }; // the style's own, while another sets its base; W234 places2: the docks' too
  const again = () => { bases = {}; set = {}; if (seen !== undefined) apply(seen, seenAll); };
  let due = false; // W242 leftovers9
  const soon = () => { if (due) return; due = true; queueMicrotask(() => { due = false; tick(); }); }; // W242 leftovers9
  map.on?.("webglcontextrestored", () => map.once("idle", again)); // a restored context's style has the layers' own filters
  return { tick, again, drop, stats, soon }; // W242 leftovers9: soon
}
