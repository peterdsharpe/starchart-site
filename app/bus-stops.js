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

/**
 * Mount it. `plan()` is the trip on the chart (course.js nav.chartPlan), `every()` whether the tile shows every stop (on, and not stepped
 * aside by a preview), `flying()` whether a ride is on. tick() from the frame loop; again() after another module set a base filter
 * (main.js drawPacks). Returns { tick, again, drop, stats }.
 */
export function mountBusStops({ map, plan, every, flying }) {
  const stats = { sets: 0, stops: [], all: true }; // for tests
  let seen, seenAll, bases = {}, set = {};
  function apply(p, all) {
    const stops = routeStops(p);
    for (const id of STOP_LAYERS) {
      if (!map.getLayer(id)) continue;
      const now = map.getFilter(id);
      if (!(id in bases) || JSON.stringify(now) !== JSON.stringify(set[id])) bases[id] = now; // one set since by another is the base now (as gl-layer.js focus)
      const f = stopsFilter(bases[id], stops, all);
      if (JSON.stringify(f) !== JSON.stringify(now)) map.setFilter(id, f);
      set[id] = f;
    }
    stats.sets++; stats.stops = stops.ids; stats.all = all;
  }
  function tick() {
    const p = plan(), all = !flying() && every();
    if (p === seen && all === seenAll) return;
    seen = p; seenAll = all;
    apply(p, all);
  }
  const drop = () => { for (const id of STOP_LAYERS) if (map.getLayer(id) && id in bases) map.setFilter(id, bases[id]); set = {}; }; // the style's own, while another sets its base
  const again = () => { bases = {}; set = {}; if (seen !== undefined) apply(seen, seenAll); };
  map.on?.("webglcontextrestored", () => map.once("idle", again)); // a restored context's style has the layers' own filters
  return { tick, again, drop, stats };
}
