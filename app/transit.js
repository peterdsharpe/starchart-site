// W61 transit (design/app-ui/SPEC.md §87): bike plus comet on the page, with no UI yet (W62 builds the card and the Settings
// toggle). `window.starchart.transit` is the hook for tests and for W62:
//
//   await starchart.transit.enable()                       the timetable: downloaded once asked, stored beside the graph
//   await starchart.transit.plan(from, to, at, opts)       -> { earned, plans, bike, checked, alerts, reason, say }
//
// - **The file** is data/manifest.json's `optional` entry of kind "transit" (app/build.mjs), about 30 KB: it is asked for
//   only after enable(), under the data guard's rules (while offline.js holds the downloads, no plan: reason "held"), checked by its SHA-256
//   and kept in this phone's storage; a stored copy that isn't the manifest's still plans until the new one is in. A file
//   past its feed's end plans nothing: the first plan says so once (`say`), later ones only give the reason.
// - **The planner** runs in the routing worker (chart/routing/worker.js's `comet` message, chart/routing/transit.js), on the
//   graph the courses use. Its answers carry ids of their own ("comet-1"), which course.js's handler passes over.
// - **The buses** (W128 buslegs, SPEC §239): `buses()` (main.js: app/walk.js load()) puts the walker's file, every mode's, in the
//   routing worker at the first plan (never at enable(), never on Data Saver unless stored), and the planner joins its buses on
//   their front racks; a plan with a bus earns its card only when clearly quicker (transit.js EARN.bus, EARN.rack).
// - **The rain:** with the Weather layer on and fresh, each course's minute samples are asked of weather.along(), whose
//   first wet point ends each ask, so a dry course costs one; the earn rule (transit.js earn()) reads them.
// - **The live check:** one request a plan, and only for a plan that earned its card: the MBTA's bike alerts
//   (transit.js ALERTS, the same for everyone). An active alert on a leg's line drops the plan and the next one is weighed.
//   W76 comets: so does a storm day's suspension, shuttle or station closure on a train's stretch (transit.js STORM).
//   Offline or failing, the plan stands from the file alone, `checked: false`.
// - **The live departure** (W73 transit): for a plan asked for now that earned its card, its first train's predicted time
//   at the boarding station, one request a stop and line (transit.js departuresUrl()). The train late or early moves the
//   plan (`live: true`), which is weighed again; a train gone drops it, and the next one is weighed. No prediction, or
//   offline: the schedule stands.
import { canStore, storedTiles } from "./offline.js";
import { timetableBytes, askWorker } from "./timetable.js"; // W152 app-rest J1
import { earn, alerted, ALERTS, word, departuresUrl, departure } from "../chart/routing/transit.js"; // W73 transit: departuresUrl, departure
import { boston } from "./comet-bikes.js";
import { timetableStations } from "./comets-logic.js"; // W111 stationlines

/** Boston's date at `now` as "20261020". */
const ymd = (now) => boston(now).date.replaceAll("-", "");
/** W73 transit: a plan asked for this near the clock is "now", and its train's prediction is asked for. */
const LIVE_MS = 5 * 60000;

export function mountTransit({ data, at, router, weather = null, fetchFn = (...a) => fetch(...a), buses = async () => false }) { // W128 buslegs: buses(), app/walk.js load()
  const entry = (data?.optional || []).find((f) => f.kind === "transit") || null;
  let enabled = false, loaded = null, said = false, table = null; // W111 stationlines: table
  const ended = (now = Date.now()) => !!entry?.feed?.end && ymd(now) > entry.feed.end;

  /** The timetable's bytes (app/timetable.js): stored, else the network's (where nothing can be stored, or storing throws:
   *  W73 transit), else an older stored copy. */
  const bytes = () => timetableBytes(entry, "transit", { at, fetchFn, missing: "no comet timetable on this droid yet" }); // W152 app-rest J1
  const ask = askWorker("comet"); // W152 app-rest J1
  /** The routing worker, with the timetable loaded into it. */
  function ready() {
    return (loaded ??= (async () => {
      const [w, buffer] = await Promise.all([router(), bytes()]);
      await ask(w, { type: "timetable", buffer }, [buffer]);
      return w;
    })().catch((err) => { loaded = null; throw err; }));
  }

  /** Each course's wet minutes from the nowcast, as a lookup for earn(): asked along each course from its first point on. */
  async function wetness(courses, offset) {
    if (!weather?.on) return null;
    const wet = new Set(), key = (p) => `${p.lonlat[0]},${p.lonlat[1]},${p.m}`;
    for (const pts of courses) {
      for (let i = 0; i < pts.length;) {
        const k = await weather.along(pts.slice(i).map((p) => ({ lonlat: p.lonlat, m: p.m + offset })));
        if (k < 0) break;
        wet.add(key(pts[i + k])); i += k + 1;
      }
    }
    return (lonlat, m) => wet.has(key({ lonlat, m }));
  }
  async function alerts() {
    if (globalThis.navigator?.onLine === false) return null;
    try {
      const r = await fetchFn(ALERTS, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }
  /** W73 transit: the coming departures at a train leg's station, asked once a stop and line in a plan (`asked`). */
  function departures(l, asked) {
    const url = departuresUrl(l);
    if (!asked.has(url)) asked.set(url, fetchFn(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return asked.get(url);
  }

  const api = {
    get available() { return !!entry; }, get enabled() { return enabled; }, get feed() { return entry?.feed || null; },
    /** W62's Settings toggle: from now on comet plans may be asked for, and the timetable comes (once, then from storage). */
    enable() { enabled = true; return entry && !ended() ? ready().then(() => true, () => false) : Promise.resolve(false); },
    disable() { enabled = false; },
    /** W111 stationlines (SPEC §215): the timetable's stations with their lines (comets-logic.js timetableStations), for a
     *  station's peek with Comets off: the stored copy, else fetched and stored as plan()'s (not on Data Saver). */
    async stations() {
      if (!entry) return [];
      if (navigator.connection?.saveData === true && !(canStore() && (await storedTiles(entry, "transit"))?.file)) return [];
      return (table ??= bytes().then((b) => timetableStations(JSON.parse(new TextDecoder().decode(new Uint8Array(b, 12, new DataView(b).getUint32(8, true))))))
        .catch((err) => { table = null; throw err; }));
    },
    /** Bike plus comet from `from` to `to` ([lon, lat]) leaving at `at` (ms, now by default). `opts`: transit.js plan()'s
     *  (`bike`, the preview's cards, saves planning them again; `all`); W76 comets: `paceK`, the pilot's Pace, for earn(). The plan that earned its card is `earned`. */
    async plan(from, to, when = Date.now(), opts = {}) {
      const none = (reason) => ({ earned: null, plans: [], bike: [], checked: false, alerts: [], reason });
      if (!entry) return none("none");
      if (!enabled) return none("off");
      if (ended(when)) { const r = none("ended"); if (!said) { said = true; r.say = { scul: word("ended"), plain: word("ended", {}, "plain") }; } return r; }
      let w;
      try { w = await ready(); } catch (e) { return none(e.message === "held" ? "held" : "no-timetable"); }
      const { result } = await ask(w, { type: "comet", from, to, at: when, opts: { ...opts, buses: await buses().catch(() => false) } }); // W128 buslegs: and the buses, once their file is in
      if (result.reason) return { ...none(result.reason), bike: result.bike };
      const offset = (when - Date.now()) / 60000; // the samples' minutes are from `when`; the nowcast's from the clock
      const wet = await wetness([...result.bike.map((b) => b.samples), ...result.plans.flatMap((p) => p.legs.filter((l) => l.type === "ride").map((l) => l.samples))], offset);
      let earned = earn(result, { wet, paceK: opts.paceK }), checked = false, hits; // W76 comets: paceK, the pilot's (#40)
      const dropped = [];
      if (earned) {
        const live = globalThis.navigator?.onLine !== false && Math.abs(when - Date.now()) < LIVE_MS, asked = new Map(); // W73 transit
        const train = (p) => p.legs.find((l) => l.type === "train"); // W73 transit
        if (live) departures(train(earned), asked); // W73 transit: asked beside the alerts
        const json = await alerts();
        checked = !!json;
        let plans = result.plans;
        while (earned) { // W73 transit: and each plan's live departure
          if (json && (hits = alerted(json, earned)).length) { // drop the alerted plan, weigh the next
            const drop = earned;
            dropped.push(...hits.filter((h) => !dropped.includes(h)));
            plans = plans.filter((p) => p.start !== drop.start || p.end !== drop.end || p.total_s !== drop.total_s);
            earned = earn({ ...result, plans }, { wet, paceK: opts.paceK }); // W76 comets: paceK
            continue; // W73 transit
          }
          if (!live || "live" in earned) break; // W73 transit: the schedule stands, or this plan's train is live already
          const i = plans.findIndex((p) => p.legs === earned.legs), p = departure(await departures(train(earned), asked), plans[i]); // W73 transit
          plans = (p ? plans.with(i, p) : plans.toSpliced(i, 1)).sort((a, b) => a.total_s + (a.risk_s || 0) - b.total_s - (b.risk_s || 0)); // W73 transit: moved, or gone
          earned = earn({ ...result, plans }, { wet, paceK: opts.paceK }); // W73 transit; W76 comets: paceK
        }
      }
      return { earned, plans: result.plans, bike: result.bike, checked, alerts: dropped, reason: earned ? earned.earned.reason : "bike", stats: result.stats };
    },
  };
  return api;
}
