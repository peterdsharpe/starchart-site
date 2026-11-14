// W73 walk (design/app-ui/SPEC.md §119): on foot and by T on the page. `window.starchart.walk` is the hook for tests:
//
//   starchart.walk.available                           the manifest has the walker's timetable
//   await starchart.walk.plan(from, to, at)            -> { plans, reason, left }   her best two or three, best first; W211 stationcard2: left, the lines an alert left out
//   await starchart.walk.live(plan)                    -> the plan with its first boarding's live time, or as it was
//   await starchart.walk.route(from, to)               -> a walk as a course (walktransit.js walkRoute), or null (W79 walkgo)
//   await starchart.walk.load()                        -> true once the file is in the routing worker, for the bike planner's buses (W128 buslegs)
//   await starchart.walk.stops(lonlat, name, at, { ref }) -> a bus stop's next departures by route (walktransit.js stopTimes), or { reason } (W189 transittimes; W192 sltimes: ref)
//   await starchart.walk.sky(from, to, at)             -> the sky on her way for her cards, skyOf()'s; a test may stand in for it (W198 walkcards)
//
// - **The file** is data/manifest.json's `optional` entry of kind "walk" (app/build.mjs), about 0.4 MB with every bus:
//   asked for only when the From/To row's switch is first turned on, under the data guard's rules (while offline.js holds
//   the downloads, no plan: reason "held"), checked by its SHA-256 and kept in this phone's storage, as app/transit.js's.
// - **A card's times** (W226 cardfirst, SPEC §474): stops() reads the file into a worker of its own (app/stops-worker.js), with no graph;
//   main.js reads it ahead once a visit (ahead()), when the map is first still, from the stored copy alone, so the first card is as quick.
// - **The planner** runs in the routing worker (chart/routing/worker.js's `walk` message, chart/routing/walktransit.js),
//   on the graph the courses use, walked.
// - **The live departure:** for each card's first boarding, one request for its stop and line and the stop she gets off at
//   (app/walk-card.js predictionsUrl, the same for everyone riding between them; never a position; R1 plans: only a trip
//   predicted at both counts). Offline, failing, or with no prediction in reach, the card keeps the schedule.
// - **The storm-day check** (W78 walkalerts): one request a plan, the comets' (chart/routing/transit.js ALERTS, the same for
//   everyone), asked beside the timetable. A plan with an active SUSPENSION, SHUTTLE or STATION_CLOSURE on one of its rides,
//   bus or train, is dropped in the worker and the next one weighed (walktransit.js walkPlan's `alerts`); a bike alert
//   doesn't count, as she takes none. Offline, failing or slower than ALERT_WAIT_MS, the plans stand from the file alone.
// - **Bluebikes** (W204 bikeshare, SPEC §372): with Consider Bluebikes on, the docks within a walk of either end and their live
//   counts (app/bikeshare.js, as late as the alerts) go with the plan, and the worker weighs a Bluebike leg beside the T.
// - **Her walking pace** (W211 walkmore, SPEC §395): Settings' Walking pace (app/settings.js walkPace()) times every walk the worker
//   plans and walks as a course; Pace times riding only.
// - **The sky** (W198 walkcards, SPEC §351): what the Weather layer already knows of her way (skyOf()), with no request of its
//   own, tips her cards (walktransit.js RANGES.sky): rain or snow makes a minute outside weigh more, a dry radar a little less.
import { canStore, storedTiles, paused } from "./offline.js"; // W226 cardfirst: paused
import { timetableBytes, askWorker } from "./timetable.js"; // W152 app-rest J1
import { predictionsUrl, firstLive, withLive, liveDeps } from "./walk-card.js"; // W189 transittimes: liveDeps
import { boston } from "./comet-bikes.js";
import { ALERTS, MASSPORT } from "../chart/routing/transit.js"; // W78 walkalerts; W192 sltimes: MASSPORT
import { AHEAD_MIN } from "./weather-logic.js"; // W198 walkcards: the nowcast's reach
import { leans } from "./tradeoffs.js"; // W199 prefs: Settings' Trade-offs, the walker's beam
import { walkPace } from "./settings.js"; // W211 walkmore: Settings' Walking pace
import { BIKE } from "../chart/routing/bikeshare.js"; // W204 bikeshare
/** W204 bikeshare: the docks within BIKE.reach_m (a straight line, at most the walk) of `from` or `to`, for the worker. */
export const docksNear = (docks, from, to) => (docks || []).filter((d) => [from, to].some((p) => { const kx = 111320 * Math.cos((p[1] * Math.PI) / 180); return Math.hypot((d.ll[0] - p[0]) * kx, (d.ll[1] - p[1]) * 111320) <= BIKE.reach_m; })); // W204 bikeshare
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

export function mountWalk({ data, at, router, fetchFn = (...a) => fetch(...a), weather = null, bikes = null }) { // W198 walkcards: weather, app/weather.js's; W204 bikeshare: bikes, app/bikeshare.js's
  const entry = (data?.optional || []).find((f) => f.kind === "walk") || null;
  let loaded = null, own = null, tabled = false, aheadDone = false, last = Promise.resolve(); // W226 cardfirst: the cards' own worker with the timetable (app/stops-worker.js); the timetable in memory; the read-ahead answered; the last read of the file

  /** The timetable's bytes (app/timetable.js): stored, else the network's, else an older stored copy. W226 cardfirst: a card's and a plan's
   *  reads one after the other, so the second reads the copy the first stored and the file is downloaded once. */
  const bytes = () => { const p = last.then(() => timetableBytes(entry, "walk", { at, fetchFn })); last = p.then(() => {}, () => {}); return p; }; // W152 app-rest J1: transit.js's loader, the network where storage throws too
  const ask = askWorker("walk"); // W152 app-rest J1
  function ready() {
    return (loaded ??= (async () => {
      const [w, buffer] = await Promise.all([router(), bytes()]);
      await ask(w, { type: "walktable", buffer }, [buffer]);
      tabled = true; // W226 cardfirst
      return w;
    })().catch((err) => { loaded = null; throw err; }));
  }
  /** W226 cardfirst (SPEC §474): the timetable in the cards' own worker, with no graph: `blob`, the stored file (the read-ahead's, unzipped
   *  there), else bytes()'s by its rules. */
  function cards(blob = null) {
    return (own ??= (async () => {
      const w = new Worker(at("app/stops-worker.js"), { type: "module" }), broke = new Promise((ok, no) => w.addEventListener("error", () => no(new Error("offline")), { once: true })); // its script not loaded: as offline
      broke.catch(() => {});
      try { const buffer = blob ? null : await bytes(); await Promise.race([ask(w, blob ? { type: "walktable", blob } : { type: "walktable", buffer }, buffer ? [buffer] : []), broke]); } catch (err) { w.terminate(); throw err; }
      tabled = true;
      return w;
    })().catch((err) => { own = null; throw err; }));
  }

  const api = { // W198 walkcards: named, so plan() asks api.sky(), which a test may replace
    get available() { return !!entry; }, get feed() { return entry?.feed || null; },
    /** On foot and by T from `from` to `to` ([lon, lat]) leaving at `when` (ms). W203 walkcards2: `by`, arriving by `when` instead
     *  (walktransit.js walkPlan's: each plan her latest run that makes it); its sky from when she'd set off on foot. */
    async plan(from, to, when = Date.now(), { by = false, cards } = {}) { // W203 walkcards2: by; W211 walkmore: cards, as many as the sheet fits (app/course.js)
      if (!entry) return { plans: [], reason: "none" };
      if (entry.feed?.end && boston(when).date.replaceAll("-", "") > entry.feed.end) return { plans: [], reason: "ended" };
      const alerts = globalThis.navigator?.onLine === false ? null // W78 walkalerts: asked beside the timetable
        : fetchFn(ALERTS, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => (r.ok ? r.json() : null)).catch(() => null); // W78 walkalerts
      let w;
      try { w = await ready(); } catch (e) { return { plans: [], reason: e.message === "held" ? "held" : "offline" }; }
      let wait; const late = new Promise((done) => { wait = setTimeout(() => done(null), ALERT_WAIT_MS); }); // W78 walkalerts: a weak signal never holds her cards
      const off = by ? when - (1.2 * Math.hypot((to[0] - from[0]) * 111320 * Math.cos((from[1] * Math.PI) / 180), (to[1] - from[1]) * 111320) / 1.4) * 1000 : when; // W203 walkcards2: arriving by, she sets off about a walk's time before (skyOf()'s walk)
      const docked = bikes?.on && !by ? bikes.docks().catch(() => null) : null; // W204 bikeshare: Bluebikes' docks and counts, as late as the alerts; 0.1.94's merge: none for Arrive by (walktransit.js)
      const [got, sky, all] = await Promise.all([alerts, api.sky(from, to, off).catch(() => null), docked].map((x) => Promise.race([x, late]))); clearTimeout(wait); // W78 walkalerts; W198 walkcards: the sky, as late; W203 walkcards2: off; W204 bikeshare: all, the docks
      const docks = bikes?.on && !by ? docksNear(all ?? bikes.kept(), from, to) : []; // W204 bikeshare: the feed too slow, the kept docks (their counts unknown once 15 min old)
      const { result } = await ask(w, { type: "walk", from, to, at: when, opts: { alerts: got, sky, leans: leans(), by, pace: walkPace(), ...(cards ? { cards } : {}), ...(docks.length ? { docks } : {}) } }); // W78 walkalerts: alerts; W198 walkcards: sky; W199 prefs: leans (walktransit.js leaned()); W203 walkcards2: by; W204 bikeshare: docks; W211 walkmore: pace, her walking pace; cards
      return { plans: result.plans, reason: result.reason || (result.plans.length ? null : "none"), stats: result.stats, left: result.left || [] }; // W211 stationcard2: left, the lines an alert left her cards without
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
    async stops(lonlat, name, when = Date.now(), { ref = "", station = "" } = {}) { // W189 transittimes; W192 sltimes: ref; W219 stationcard3: station, a station's GTFS id (walktransit.js stopTimes)
      if (!entry) return { reason: "none" }; // W189 transittimes
      if (entry.feed?.end && boston(when).date.replaceAll("-", "") > entry.feed.end) return { reason: "ended" }; // W189 transittimes
      if (navigator.connection?.saveData === true && !(canStore() && (await storedTiles(entry, "walk"))?.file)) return { reason: "saver" }; // W189 transittimes
      let w; try { const p = own || (tabled ? loaded : null); /* rel-0.1.118 (the re-review's P2): a plan still loading the graph isn't waited for: the cards' own worker reads the stored copy */ w = await (p ? p.catch(() => cards()) : cards()); } catch (e) { return { reason: e.message === "held" ? "held" : "offline" }; } // W189 transittimes; W226 cardfirst: the cards' worker (was the routing worker's, after its graph), or the routing worker's where it has the timetable; where theirs fails (the read-ahead's), its own read
      return (await ask(w, { type: "stoptimes", lonlat, name, at: when, ref, station })).result; // W189 transittimes; W192 sltimes: ref; W219 stationcard3: station
    }, // W189 transittimes
    /** W226 cardfirst (SPEC §474): the timetable read ahead into the cards' worker (main.js, once a visit, when the map is first still), from
     *  the stored current copy alone: never fetched, never on Data Saver or while the downloads are held; true once in memory, false
     *  otherwise, saying nothing (a card then reads it at its tap, as before). */
    async ahead() {
      try {
        if (!entry || own || loaded || (entry.feed?.end && boston(Date.now()).date.replaceAll("-", "") > entry.feed.end) || navigator.connection?.saveData === true || paused() || !canStore()) return false;
        const st = await storedTiles(entry, "walk").catch(() => null);
        if (!st?.current || own || loaded) return false;
        return await cards(st.file).then(() => true, () => false);
      } finally { aheadDone = true; }
    },
    /** W226 cardfirst: the timetable is in memory (read ahead, or by a card or a plan), so a card's times come in a frame or two. */
    get tabled() { return tabled; },
    /** W226 cardfirst: the read-ahead has answered, read or not (a test's hook). */
    get aheadDone() { return aheadDone; },
    /** W198 walkcards: the sky on her way (skyOf(), from app/weather.js's `weather`), for her cards. */
    sky: (from, to, when) => skyOf(weather, from, to, when), // W198 walkcards
    /** W79 walkgo: a walk from `from` to `to` as a course, its turns and the walker's time, on the graph alone (no timetable). */
    async route(from, to) { return (await ask(await router(), { type: "walkroute", from, to, pace: walkPace() })).route; }, // W79 walkgo; W211 walkmore: at her walking pace
    /** The plan's first boarding at its live time, from one predictions request; as it was offline or without one. */
    async live(plan) {
      const l = plan.legs.find((x) => x.type === "train");
      if (!l || l.route.startsWith(MASSPORT) || globalThis.navigator?.onLine === false) return plan; // W192 sltimes: the MBTA has no word on Massport's shuttles
      const wait = plan.legs[plan.legs.indexOf(l) - 1], ready = l.dep - (wait?.type === "wait" ? wait.time_s * 1000 : 0);
      try {
        const r = await fetchFn(predictionsUrl(l), { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
        const json = r.ok ? await r.json() : null; // W189 transittimes
        return json ? withLive(plan, firstLive(json, ready, l), liveDeps(json, l)) : plan; // W189 transittimes: and its next ones; R1 plans (SPEC §441): of the trips that reach her stop
      } catch { return plan; }
    },
  };
  return api; // W198 walkcards
}
