// W204 bikeshare (design/app-ui/SPEC.md §372): Bluebikes for a walker, pure JS with no DOM, for the routing worker
// (walktransit.js plans the leg), the page (app/bikeshare.js asks the feed) and Node's tests.
//
//   docksOf(info)                 -> [{ id, name, ll, cap }]   the feed's station_information, compact (cached for offline)
//   withStatus(docks, status)     -> each dock with its live { bikes, ebikes, docks, renting, returning } from station_status
//   fareOf(ride_s, ebike)         -> the pay-as-you-go price in dollars (PRICE)
//   stressM(route)                -> the metres of a bike course on streets that aren't calm (the router's comfort, BIKE.calm)
//   recheckDue(phase, here, leg, last, now) -> true when the walk should ask the feed again (NEAR)
//   recheck(phase, leg, docks)    -> null, { kind: "empty", dock } or { kind: "full", dock, alt }
//   nearestWithRoom(docks, ll, not) -> the nearest dock with a free dock to `ll`, with its metres, or null
//
// The feed is Bluebikes' GBFS (Lyft's host): the same two files for everyone, never a position.

/** W204 bikeshare: Bluebikes' GBFS 2.3 files (gbfs.lyft.com/gbfs/2.3/bos/gbfs.json lists them). */
export const GBFS = {
  host: "gbfs.lyft.com",
  info: "https://gbfs.lyft.com/gbfs/2.3/bos/en/station_information.json",
  status: "https://gbfs.lyft.com/gbfs/2.3/bos/en/station_status.json",
};
/** W204 bikeshare: the Single Trip, pay as you go (bluebikes.com/pricing, read 8 Nov 2026): $3.00 for one ride of up to 30 min on a
 *  classic bike, $0.33 a minute past them; an ebike $0.33 a minute from the start, on top of the $3.00. */
export const PRICE = { unlock: 3, free_s: 1800, per_min: 0.33, ebike_min: 0.33, url: "https://bluebikes.com/pricing", read: "2026-11-08" };
/** W204 bikeshare: a Bluebike leg's numbers (walktransit.js bikePlans()). */
export const BIKE = {
  reach_m: 800, // the longest walk to or from a dock looked at (10 min)
  near: 3, // docks looked at each end: the nearest by walking with a bike to rent (or a free dock to return it to)
  pairs: 3, // rides planned on the bike graph: the best pairs by a straight-line guess (each a route(): 0.8 s in Node on the full graph without CH potentials)
  unlock_s: 60, // find the bike, unlock it with the app or at the kiosk, set the saddle
  dock_s: 30, // push it into a dock and see the light turn green
  slow: 1.15, // a Bluebike (about 20 kg, three gears) against the router's pace
  calm: 4, // a comfort level (0-7, chart/SCHEMA.md) from which a street is calm on a stranger's bike: green on the scale
};
/** W204 bikeshare: when a walk asks the feed again: walking within pick_m of the pick-up dock, riding within drop_m of the drop-off,
 *  at most every every_ms. */
export const NEAR = { pick_m: 250, drop_m: 500, every_ms: 60000 };

const round = (x, k = 1e6) => Math.round(x * k) / k;
/** W204 bikeshare: the feed's stations, compact: its id, name, [lon, lat] and capacity. */
export const docksOf = (info) => (info?.data?.stations || []).filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat))
  .map((s) => ({ id: String(s.station_id), name: String(s.name || "").trim(), ll: [round(s.lon), round(s.lat)], cap: s.capacity ?? null }));
/** W204 bikeshare: the docks with their live counts; one the status doesn't list, or an uninstalled one, is dropped, and none at
 *  all (no status) keeps every dock with its counts unknown (null). */
export function withStatus(docks, status) {
  const list = status?.data?.stations;
  if (!list) return docks.map((d) => ({ ...d, bikes: null, ebikes: null, docks: null, renting: null, returning: null }));
  const by = new Map(list.map((s) => [String(s.station_id), s]));
  return docks.flatMap((d) => {
    const s = by.get(d.id);
    if (!s || !s.is_installed) return [];
    return [{ ...d, bikes: s.num_bikes_available ?? 0, ebikes: s.num_ebikes_available ?? 0, docks: s.num_docks_available ?? 0, renting: !!s.is_renting, returning: !!s.is_returning }];
  });
}
/** W204 bikeshare: a ride's price in dollars (PRICE): a classic bike's $3.00 for 30 min, then by the minute; an ebike by the minute. */
export function fareOf(ride_s, ebike = false) {
  const min = Math.ceil(ride_s / 60), extra = ebike ? min * PRICE.ebike_min : Math.max(0, Math.ceil((ride_s - PRICE.free_s) / 60)) * PRICE.per_min;
  return Math.round((PRICE.unlock + extra) * 100) / 100;
}
/** W204 bikeshare: a bike course's metres on streets below BIKE.calm, from its comfort runs ([at_m, level], null unknown). */
export function stressM(r, calm = BIKE.calm) {
  const c = r?.comfort || [];
  let m = 0;
  for (let i = 0; i < c.length; i++) if (c[i][1] != null && c[i][1] < calm) m += (i + 1 < c.length ? c[i + 1][0] : r.distance_m) - c[i][0];
  return Math.max(0, Math.round(m));
}
const metres = (a, b) => { const kx = 111320 * Math.cos((a[1] * Math.PI) / 180); return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 111320); };
/** W204 bikeshare: the nearest dock to `ll` with a dock free and returns allowed, but `not` (an id), as { dock, m }, or null. */
export function nearestWithRoom(docks, ll, not = null) {
  let best = null;
  for (const d of docks) if (d.id !== not && d.docks > 0 && d.returning !== false) { const m = metres(d.ll, ll); if (!best || m < best.m) best = { dock: d, m: Math.round(m) }; }
  return best;
}
/** W204 bikeshare: whether to ask the feed again now: walking to the pick-up dock ("pick", `leg.from_ll`) within NEAR.pick_m, or
 *  riding to the drop-off ("drop", `leg.to_ll`) within NEAR.drop_m, and `last` (ms) at least NEAR.every_ms ago. */
export function recheckDue(phase, here, leg, last, now) {
  const at = phase === "pick" ? leg.from_ll : phase === "drop" ? leg.to_ll : null;
  if (!at || !here) return false;
  return metres(here, at) <= (phase === "pick" ? NEAR.pick_m : NEAR.drop_m) && !(now - last < NEAR.every_ms);
}
/** W204 bikeshare: what the fresh counts say for the leg's dock: walking to it ("pick") and no bike to rent, { kind: "empty" }, for
 *  a re-plan; riding to it ("drop") and no dock free, { kind: "full", alt }, the nearest dock with room; else null (or unknown). */
export function recheck(phase, leg, docks) {
  const id = phase === "pick" ? leg.from : leg.to, dock = docks.find((d) => d.id === id);
  if (!dock || dock.bikes == null) return null;
  if (phase === "pick") return dock.bikes > 0 && dock.renting ? null : { kind: "empty", dock };
  if (dock.docks > 0 && dock.returning) return null;
  return { kind: "full", dock, alt: nearestWithRoom(docks, dock.ll, dock.id) };
}
