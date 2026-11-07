// W73 walk (design/app-ui/SPEC.md §119): on foot and by T on the page. `window.starchart.walk` is the hook for tests:
//
//   starchart.walk.available                           the manifest has the walker's timetable
//   await starchart.walk.plan(from, to, at)            -> { plans, reason }   her best two or three, best first
//   await starchart.walk.live(plan)                    -> the plan with its first boarding's live time, or as it was
//   await starchart.walk.route(from, to)               -> a walk as a course (walktransit.js walkRoute), or null (W79 walkgo)
//   await starchart.walk.load()                        -> true once the file is in the routing worker, for the bike planner's buses (W128 buslegs)
//   await starchart.walk.stops(lonlat, name, at, { ref }) -> a bus stop's next departures by route (walktransit.js stopTimes), or { reason } (W189 transittimes; W192 sltimes: ref)
//   await starchart.walk.sky(from, to, at)             -> the sky on her way for her cards, skyOf()'s; a test may stand in for it (W198 walkcards)
//
// - **The file** is data/manifest.json's `optional` entry of kind "walk" (app/build.mjs), about 0.4 MB with every bus:
//   asked for only when the From/To row's switch is first turned on, under the data guard's rules (while offline.js holds
//   the downloads, no plan: reason "held"), checked by its SHA-256 and kept in this phone's storage, as app/transit.js's.
// - **The planner** runs in the routing worker (chart/routing/worker.js's `walk` message, chart/routing/walktransit.js),
//   on the graph the courses use, walked.
// - **The live departure:** for each card's first boarding, one request for its stop and line (app/walk-card.js
//   predictionsUrl, the same for everyone at that stop; never a position). Offline, failing, or with no prediction in
//   reach, the card keeps the schedule.
// - **The storm-day check** (W78 walkalerts): one request a plan, the comets' (chart/routing/transit.js ALERTS, the same for
//   everyone), asked beside the timetable. A plan with an active SUSPENSION, SHUTTLE or STATION_CLOSURE on one of its rides,
//   bus or train, is dropped in the worker and the next one weighed (walktransit.js walkPlan's `alerts`); a bike alert
//   doesn't count, as she takes none. Offline, failing or slower than ALERT_WAIT_MS, the plans stand from the file alone.
// - **The sky** (W198 walkcards, SPEC §351): what the Weather layer already knows of her way (skyOf()), with no request of its
//   own, tips her cards (walktransit.js RANGES.sky): rain or snow makes a minute outside weigh more, a dry radar a little less.
import { canStore, storedTiles } from "./offline.js";
import { timetableBytes, askWorker } from "./timetable.js"; // W152 app-rest J1
import { predictionsUrl, firstLive, withLive, liveDeps } from "./walk-card.js"; // W189 transittimes: liveDeps
import { boston } from "./comet-bikes.js";
import { ALERTS, MASSPORT } from "../chart/routing/transit.js"; // W78 walkalerts; W192 sltimes: MASSPORT
import { AHEAD_MIN } from "./weather-logic.js"; // W198 walkcards: the nowcast's reach
import { leans } from "./tradeoffs.js"; // W199 prefs: Settings' Trade-offs, the walker's beam
/** The longest her cards wait for the alerts reply (W78 walkalerts): later, the plans stand on the file alone, as offline. */
export const ALERT_WAIT_MS = 1500;
/**
 * W198 walkcards (SPEC §351): the sky on her way from `from` to `to` leaving at `when` (ms), from app/weather.js's `weather` as it
 * stands (no request of its own): "wet" with rain on the nowcast along the straight line as she walks it (1.2 times as long, at
 * walking pace, at most an hour) or a snow or ice warning or advisory by then; "cold" or "hot" with the NWS's cold or heat alert
 * by then; "fine" with a fresh radar dry all the way; null with the layer off, no fresh radar, or the trip past its reach.
 */
export async function skyOf(weather, from, to, when, now = Date.now()) { // W198 walkcards
  if (!weather?.on) return null;
  const kx = 111320 * Math.cos((from[1] * Math.PI) / 180), m = Math.hypot((to[0] - from[0]) * kx, (to[1] - from[1]) * 111320);
  const off = (when - now) / 60000, T = Math.min(60, (1.2 * m) / 1.4 / 60), end = when + T * 60000, by = (a) => a && !(a.onset > end) && !(a.ends < when); // in effect while she's on her way
  if (by(weather.winter) && weather.winter.level !== "watch") return "wet"; // snow or ice by then
  const radar = weather.fresh && off >= -5 && off + T <= AHEAD_MIN, n = Math.max(2, Math.ceil(T / 5));
  const pts = Array.from({ length: n + 1 }, (_, i) => ({ lonlat: [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n], m: Math.max(0, off) + (T * i) / n }));
  if (radar && (await weather.along(pts)) >= 0) return "wet";
  if (by(weather.harsh)) return weather.harsh.kind;
  return radar ? "fine" : null;
} // W198 walkcards

export function mountWalk({ data, at, router, fetchFn = (...a) => fetch(...a), weather = null }) { // W198 walkcards: weather, app/weather.js's
  const entry = (data?.optional || []).find((f) => f.kind === "walk") || null;
  let loaded = null;

  /** The timetable's bytes (app/timetable.js): stored, else the network's, else an older stored copy. */
  const bytes = () => timetableBytes(entry, "walk", { at, fetchFn }); // W152 app-rest J1: transit.js's loader, the network where storage throws too
  const ask = askWorker("walk"); // W152 app-rest J1
  function ready() {
    return (loaded ??= (async () => {
      const [w, buffer] = await Promise.all([router(), bytes()]);
      await ask(w, { type: "walktable", buffer }, [buffer]);
      return w;
    })().catch((err) => { loaded = null; throw err; }));
  }

  const api = { // W198 walkcards: named, so plan() asks api.sky(), which a test may replace
    get available() { return !!entry; }, get feed() { return entry?.feed || null; },
    /** On foot and by T from `from` to `to` ([lon, lat]) leaving at `when` (ms). */
    async plan(from, to, when = Date.now()) {
      if (!entry) return { plans: [], reason: "none" };
      if (entry.feed?.end && boston(when).date.replaceAll("-", "") > entry.feed.end) return { plans: [], reason: "ended" };
      const alerts = globalThis.navigator?.onLine === false ? null // W78 walkalerts: asked beside the timetable
        : fetchFn(ALERTS, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => (r.ok ? r.json() : null)).catch(() => null); // W78 walkalerts
      let w;
      try { w = await ready(); } catch (e) { return { plans: [], reason: e.message === "held" ? "held" : "offline" }; }
      let wait; const late = new Promise((done) => { wait = setTimeout(() => done(null), ALERT_WAIT_MS); }); // W78 walkalerts: a weak signal never holds her cards
      const [got, sky] = await Promise.all([alerts, api.sky(from, to, when).catch(() => null)].map((x) => Promise.race([x, late]))); clearTimeout(wait); // W78 walkalerts; W198 walkcards: the sky, as late
      const { result } = await ask(w, { type: "walk", from, to, at: when, opts: { alerts: got, sky, leans: leans() } }); // W78 walkalerts: alerts; W198 walkcards: sky; W199 prefs: leans (walktransit.js leaned())
      return { plans: result.plans, reason: result.reason || (result.plans.length ? null : "none"), stats: result.stats };
    },
    /** W128 buslegs (SPEC §239): the timetable in the routing worker for the bike planner's buses (app/transit.js): true once in.
     *  The stored copy, else fetched and stored as plan()'s, but never on Data Saver unless it is stored already (the walker's
     *  switch fetched it: she asked). */
    async load() { // W128 buslegs
      if (!entry || (entry.feed?.end && boston(Date.now()).date.replaceAll("-", "") > entry.feed.end)) return false; // W128 buslegs
      if (navigator.connection?.saveData === true && !(canStore() && (await storedTiles(entry, "walk"))?.file)) return false; // W128 buslegs
      return ready().then(() => true, () => false); // W128 buslegs
    }, // W128 buslegs
    /** W189 transittimes (SPEC §329): a bus stop's next departures by route from the stored file, with no request (walktransit.js
     *  stopTimes()): { stops, rows }, or { reason }: "none" (no walker's file), "ended", "saver" (Data Saver, and it isn't
     *  stored: never fetched then), "held" or "offline" (as plan()'s). Else it is fetched and stored once, as plan()'s.
     *  W192 sltimes: and the stops its OSM `ref` names (the GTFS stop codes). */
    async stops(lonlat, name, when = Date.now(), { ref = "" } = {}) { // W189 transittimes; W192 sltimes: ref
      if (!entry) return { reason: "none" }; // W189 transittimes
      if (entry.feed?.end && boston(when).date.replaceAll("-", "") > entry.feed.end) return { reason: "ended" }; // W189 transittimes
      if (navigator.connection?.saveData === true && !(canStore() && (await storedTiles(entry, "walk"))?.file)) return { reason: "saver" }; // W189 transittimes
      let w; try { w = await ready(); } catch (e) { return { reason: e.message === "held" ? "held" : "offline" }; } // W189 transittimes
      return (await ask(w, { type: "stoptimes", lonlat, name, at: when, ref })).result; // W189 transittimes; W192 sltimes: ref
    }, // W189 transittimes
    /** W198 walkcards: the sky on her way (skyOf(), from app/weather.js's `weather`), for her cards. */
    sky: (from, to, when) => skyOf(weather, from, to, when), // W198 walkcards
    /** W79 walkgo: a walk from `from` to `to` as a course, its turns and the walker's time, on the graph alone (no timetable). */
    async route(from, to) { return (await ask(await router(), { type: "walkroute", from, to })).route; }, // W79 walkgo
    /** The plan's first boarding at its live time, from one predictions request; as it was offline or without one. */
    async live(plan) {
      const l = plan.legs.find((x) => x.type === "train");
      if (!l || l.route.startsWith(MASSPORT) || globalThis.navigator?.onLine === false) return plan; // W192 sltimes: the MBTA has no word on Massport's shuttles
      const wait = plan.legs[plan.legs.indexOf(l) - 1], ready = l.dep - (wait?.type === "wait" ? wait.time_s * 1000 : 0);
      try {
        const r = await fetchFn(predictionsUrl(l), { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
        const json = r.ok ? await r.json() : null; // W189 transittimes
        return json ? withLive(plan, firstLive(json, ready), liveDeps(json)) : plan; // W189 transittimes: and its next ones
      } catch { return plan; }
    },
  };
  return api; // W198 walkcards
}
