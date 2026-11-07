// W111 tiles16 (design/app-ui/SPEC.md §221; OSS review #14): a bike route lit whole. Tiles v16 keep every
// named route of a way (`route`, and `routes` when there are more), so a road of the route lights wherever the chart has
// it, not only the pieces whose one `route` was this one; v15's tiles light by `route` alone. The peek gives the route's
// length and climb, from the tiles' `bike_routes` table (z0, chart/SCHEMA.md), once it is read.
// W140 routelit (SPEC §253, his 0.1.61 note on Hawthorn St) gave the peek a row per route and lit the route as a halo from it.
// W196 cards2 (SPEC §349, her 10-31 row 33: "This visualization option should be removed"): the rows and the halo went; the app
// reads no route here now. The tiles' route fields and these helpers stay, for their tests (tiles16-fixture), and so a veto is a revert.
import { LY, FT } from "./course-logic.js";

/** The named bike routes of a road's tile properties: `routes` split, else `route`, else none. */
export function routeNames(p = {}) {
  if (p.routes) return [...new Set(String(p.routes).split(";").map((s) => s.trim()).filter(Boolean))];
  return p.route ? [String(p.route)] : [];
}

/** The filter of the roads of any of `names`: `route` is one, or `routes` holds one between its `;`s. None lights nothing. */
export function routeFilter(names) {
  if (!names.length) return ["==", ["get", "route"], "\u0000"];
  const routes = ["concat", ";", ["coalesce", ["get", "routes"], ""], ";"];
  return ["any", ["in", ["get", "route"], ["literal", names]], ...names.map((n) => ["in", `;${n};`, routes])];
}

/** The peek's line for a route of the table (`{ length_m, climb_m }`): "Minuteman Bikeway · 10.2 mi · ▲ 60 ft"; without
 *  its name when the peek already says it ("Whole route · 10.2 mi"). The climb only from 10 ft, and only with `climb`
 *  (W140 routelit). Null without the row. */
export function routeLine(name, row, { named = false, mode = "meatspace", climb = true } = {}) {
  const m = +row?.length_m;
  if (!(m > 0)) return null;
  const ft = climb ? Math.round((+row.climb_m || 0) / FT / 10) * 10 : 0;
  return `${named ? "Whole route" : name} · ${(m / LY).toFixed(1)}\u00a0${mode === "meatspace" ? "mi" : "LY"}${ft >= 10 ? ` · ▲\u00a0${ft}\u00a0ft` : ""}`; // a number keeps its unit when the line wraps
}
