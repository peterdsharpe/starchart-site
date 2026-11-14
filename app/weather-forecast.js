// W201 weather2 (design/app-ui/SPEC.md §360): how long the rain lasts past the radar's two hours, from the National Weather
// Service's hourly forecast, pure, so Node tests it and app/weather.js asks with it. His row of 11-07: "Rain in 5, lasting 10
// mins is different than rain in 5, lasting all day."
//
// - The request: api.weather.gov's hourly forecast for one fixed point a region (POINTS: the chart's middle, and each map pack's
//   middle, each looked up once on NWS's /points and kept here), the region the rider is in (regionOf()). The same request for
//   everyone there, never a position, as the bus stop's (§346). At most once an hour a region, only while the app is in sight
//   and the Weather layer is on (app/weather.js, by the radar's rules), and kept.
// - The rule (rainUntil()): the radar sees rain to its end; from that hour on, the rain is likely while each hour's chance of
//   precipitation is LIKELY or more, NWS's own word for it ("Likely" is its 60 and 70 %, so 55 % or more rounds to it, and
//   from 80 % it drops the word: rain, no qualifier). The first hour under it ends it: "likely until about 9:00". Likely every
//   hour to midnight: "likely the rest of the day". The radar's end in an hour under it, or no forecast: none (app/weather-
//   logic.js lastsOf() says what the radar saw).
import { HOST } from "./weather-winter.js";

/** Each region's fixed point, NWS's grid [office, x, y] (from /points at the chart's middle, -71.125 42.37, and at each pack's
 *  bounds' middle, tools/data/packs.json; 2026-11-08). A pack not here asks for nothing. */
export const POINTS = {
  base: ["BOX", 69, 101], // Greater Boston, the chart's middle (between Cambridge and Watertown)
  central: ["BOX", 51, 91], north: ["GYX", 45, 8], "south-shore": ["BOX", 77, 89], "south-coast": ["BOX", 78, 71],
  "cape-islands": ["BOX", 104, 74], west: ["BOX", 12, 94], hull: ["BOX", 81, 103],
};
/** At most one request a region in this time. */
export const FORECAST_MS = 60 * 60000;
/** An hour's chance of precipitation (%) from which NWS says rain is likely. */
export const LIKELY = 55;
/** A forecast older than this says nothing. */
export const STALE_MS = 3 * 60 * 60000;

/** The forecast's URL for region `id`, or null. Its only variable is the region's fixed point. */
export const forecastUrl = (id) => { const p = POINTS[id]; return p ? `${HOST}/gridpoints/${p[0]}/${p[1]},${p[2]}/forecast/hourly` : null; };
const inside = ([lon, lat], [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;
/** The region the rider is in: the first map pack whose bounds hold `lonlat` (data/manifest.json's packs: { id, bounds }), else
 *  the chart's own, "base". A pack with no point here: null. */
export function regionOf(lonlat, packs = []) {
  const p = lonlat && packs.find((x) => x?.bounds && inside(lonlat, x.bounds));
  return p ? (POINTS[p.id] ? p.id : null) : "base";
}
/** The reply's hours: [{ start, end, pop }] (ms, ms, %), in order; [] for anything else. */
export function hoursOf(json) {
  const out = [];
  for (const p of json?.properties?.periods ?? []) {
    const start = Date.parse(p?.startTime ?? ""), end = Date.parse(p?.endTime ?? ""), pop = p?.probabilityOfPrecipitation?.value;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end, pop: Number.isFinite(pop) ? pop : 0 });
  }
  return out.sort((a, b) => a.start - b.start);
}
/** Local midnight after `ms`, the rider's day's end. */
const midnight = (ms) => { const d = new Date(ms); d.setHours(24, 0, 0, 0); return d.getTime(); };
/**
 * How long rain the radar sees to its end, at `from` (ms), goes on by the forecast's `hours` (hoursOf()): { until: ms } (the start
 * of the first hour under LIKELY), { day: true } (likely every hour to midnight), or null: no hour holds `from`, that hour isn't
 * likely, or the hours stop before the day ends.
 */
export function rainUntil(hours, from, { likely = LIKELY } = {}) {
  const i = hours?.findIndex((h) => h.start <= from && from < h.end) ?? -1;
  if (i < 0 || hours[i].pop < likely) return null;
  const end = midnight(from);
  for (let k = i + 1; k < hours.length && hours[k].start < end; k++) {
    if (hours[k].start !== hours[k - 1].end) return null; // a gap in the hours: not known
    if (hours[k].pop < likely) return { until: hours[k].start };
  }
  const last = hours.findLast((h) => h.start < end);
  return last && last.end >= end ? { day: true } : null;
}
