// W73 ghosts (design/app-ui/SPEC.md §121): ghost trails, the past flights faint in chalk on the chart (his first sketch;
// BRIEF §7.1: "past flights are ghost trails"). The style has the layers, ghost-trail-glow and ghost-trail, over the
// `ghosts` source (chart/style/build_style.py); this fills it.
//
//   Which:  the Log's flights, but archived and tiny ones (haunting()). No switch: the Log decides. Archive a flight and its
//           ghost goes; delete it and so does its ghost; Undo brings it back. The newest is the clearest, the oldest the faintest.
//   Where:  SCUL draws them on the chart, parked and in flight. Plain draws them only on the season chart ("All rides",
//           app/log.js; W150 logtidy: in blue there), since Plain's chart carries no decoration (his 2026-10-20 ruling) and a rider asked for that view.
//   Cost:   each flight is simplified once, to GHOST_M, in the logbook worker, and kept beside the Log (app/ghost-logic.js);
//           the worker keeps the set in IndexedDB, and MapLibre's worker reads it there from a ghosts:// address
//           (app/ghosts-worker.mjs), so the main thread copies nothing however many flights there are, and the CSP stays.
//           The set is made again only when the Log's set of flights changes.
import { KEY, tiny } from "./blackbox.js";
import { plain, onLingo } from "./lingo-mode.js";
import { NEWEST, OLDEST } from "./ghost-logic.js";

/** The flights that haunt the chart, oldest first: the Log's, but archived and tiny ones. W127 walklog: and walks (a ghost is a
 *  ride to race: a walk's trail at 1.4 m/s would trail far behind any bike, and shows the paths a bike can't take). */
export const haunting = (flights) => flights.filter((f) => !f.archived && !f.foot && !tiny(f)); // W127 walklog: !f.foot
/** How much chalk is in a ghost's ink on the chart, for the oldest flight and the newest. The rest is the void, so a ghost is
 *  faint by its colour, not by its alpha: a street ridden fifty times draws as faint as one ridden once, and only its dashes join up. */
const INK = [0.34, 0.6], GLOW = 0.1;
/** W150 logtidy (SPEC §268, her note 10): the season chart ("All rides" in the Log) draws every trail in blue (--you), as a ride's
 *  page draws its own (app/log.js routeInk), solid and at its widths, on a casing of the ground (the glow layer, solid), in both
 *  themes. The chart's own ghosts stay faint chalk, at chart/style/build_style.py's widths. */
const zw = (a, b) => ["interpolate", ["linear"], ["zoom"], 11, a, 16, b]; // app/log.js routeLayers' zw: a ride's widths
const SEASON = { width: zw(2.6, 5), casing: zw(6, 11), opacity: 0.85, blur: 0 };
const rgb = (hex) => (/^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null);
/** `k` of colour `a` over colour `b` (both #rrggbb), as #rrggbb. */
export function mix(a, b, k) {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v * k + y[i] * (1 - k)).toString(16).padStart(2, "0")).join("")}`;
}

export function mountGhosts({ map, maplibregl, box, logbook }) {
  let data = null, key = null, seq = 0, n = 0, bounds = null, season = false, timer = 0, pending = Promise.resolve(), direct = false, base = null;
  const put = () => { if (data) map.getSource("ghosts")?.setData(data); };
  const worker = maplibregl.importScriptInWorkers(new URL("./ghosts-worker.mjs", import.meta.url).href).then(() => true, () => false);
  /** The Log's set of flights changed: send the source its new data, if the set it draws is another. Resolves once it is sent. */
  function refresh() {
    const ids = haunting(box.flights).map((f) => f.id), k = ids.join(); // W150 logtidy: every one (W144 logmiles' period went)
    if (k === key) return pending;
    key = k;
    const my = ++seq;
    return (pending = worker.then((ok) => logbook.ghosts(ids, direct || !ok)).catch(() => null).then((r) => {
      if (my !== seq) return;
      if (!r) { key = null; return; } // asked again at the next change
      ({ n, bounds } = r);
      data = r.data ?? `ghosts://set?${my}`; // the data itself only where MapLibre's worker can't read the set
      put();
    }));
  }
  // Where MapLibre's worker can't read the set (no IndexedDB there), the data goes by postMessage instead, from then on.
  map.on("error", (e) => { if (e.sourceId === "ghosts" && !direct) { direct = true; key = null; refresh(); } });
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function show() {
    if (!map.getLayer("ghost-trail")) return;
    const on = season || !plain(), [old, now] = INK, chalk = css("--chalk"), ground = css("--void");
    base ??= { width: map.getPaintProperty("ghost-trail", "line-width"), glow: map.getPaintProperty("ghost-trail-glow", "line-width"), blur: map.getPaintProperty("ghost-trail-glow", "line-blur"), dash: map.getPaintProperty("ghost-trail", "line-dasharray") }; // the style's, before any change; W150 logtidy: dash
    for (const [id, v] of [["ghost-trail", on], ["ghost-trail-glow", on && season]]) {
      const vis = v ? "visible" : "none";
      if (map.getLayoutProperty(id, "visibility") !== vis) map.setLayoutProperty(id, "visibility", vis);
    }
    map.setPaintProperty("ghost-trail", "line-opacity", 1);
    const [lo, hi] = season ? [css("--you"), css("--you")] : [mix(chalk, ground, old), mix(chalk, ground, now)]; // W150 logtidy: the season chart's blue, both themes
    map.setPaintProperty("ghost-trail", "line-color", ["interpolate", ["linear"], ["coalesce", ["get", "opacity"], NEWEST], OLDEST, lo, NEWEST, hi]);
    map.setPaintProperty("ghost-trail", "line-width", season ? SEASON.width : base.width);
    map.setPaintProperty("ghost-trail", "line-dasharray", season ? undefined : base.dash); // W150 logtidy: solid, as a ride's
    map.setPaintProperty("ghost-trail-glow", "line-color", season ? ground : chalk);
    map.setPaintProperty("ghost-trail-glow", "line-opacity", season ? SEASON.opacity : GLOW);
    map.setPaintProperty("ghost-trail-glow", "line-width", season ? SEASON.casing : base.glow);
    map.setPaintProperty("ghost-trail-glow", "line-blur", season ? SEASON.blur : base.blur);
    map.triggerRepaint();
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 300); }; // a bulk change is one write; Undo another
  box.onwrite = soon;
  addEventListener("storage", (e) => { if (e.key === KEY) soon(); }); // another tab's Log
  onLingo(show); addEventListener("starchart:theme", show); // Daystar's chalk is pencil
  map.on("style.load", () => { put(); show(); }); // a restored WebGL context's style starts empty
  show();
  setTimeout(refresh, 1500); // after the first frames: the chart comes first
  return {
    refresh,
    /** The season chart: every trail in blue, in Plain too (app/log.js opens it from "All rides"). */
    set season(on) { season = !!on; show(); },
    get season() { return season; },
    /** How many flights are drawn, and the box round them ([[w, s], [e, n]] or null). */
    get n() { return n; }, get bounds() { return bounds; },
  };
}
