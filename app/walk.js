// W73 walk (design/app-ui/SPEC.md §119): on foot and by T on the page. `window.starchart.walk` is the hook for tests:
//
//   starchart.walk.available                           the manifest has the walker's timetable
//   await starchart.walk.plan(from, to, at)            -> { plans, reason }   her best two or three, best first
//   await starchart.walk.live(plan)                    -> the plan with its first boarding's live time, or as it was
//   await starchart.walk.route(from, to)               -> a walk as a course (walktransit.js walkRoute), or null (W79 walkgo)
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
import { canStore, storedTiles, store, prune, paused } from "./offline.js";
import { predictionsUrl, firstLive, withLive } from "./walk-card.js";
import { boston } from "./comet-bikes.js";
import { ALERTS } from "../chart/routing/transit.js"; // W78 walkalerts
/** The longest her cards wait for the alerts reply (W78 walkalerts): later, the plans stand on the file alone, as offline. */
export const ALERT_WAIT_MS = 1500;

export function mountWalk({ data, at, router, fetchFn = (...a) => fetch(...a) }) {
  const entry = (data?.optional || []).find((f) => f.kind === "walk") || null;
  let loaded = null, seq = 0;

  /** The timetable's bytes: the stored copy when it is the manifest's, else stored now (or the network's, where nothing
   *  can be stored), else an older stored one. */
  async function bytes() {
    const st = canStore() ? await storedTiles(entry, "walk") : null;
    let blob = st?.current ? st.file : null;
    if (!blob && !st && paused()) throw new Error("held");
    if (!blob && canStore() && !paused()) {
      try {
        await store(at(entry.path), entry);
        blob = (await storedTiles(entry, "walk"))?.file || null;
        prune([entry.sha256], "walk");
      } catch { /* offline, or the guard held it: an older copy, if any */ }
    }
    if (!blob && !canStore()) { const r = await fetchFn(at(entry.path)); if (r.ok) blob = await r.blob(); }
    blob ||= st?.file || null;
    if (!blob) throw new Error("offline");
    return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  function ask(w, msg, transfer = []) {
    const id = `walk-${++seq}`;
    return new Promise((ok, no) => {
      const on = ({ data: m }) => {
        if (m?.id !== id) return;
        w.removeEventListener("message", on);
        if (m.type === "error") no(new Error(m.message)); else ok(m);
      };
      w.addEventListener("message", on);
      w.postMessage({ ...msg, id }, transfer);
    });
  }
  function ready() {
    return (loaded ??= (async () => {
      const [w, buffer] = await Promise.all([router(), bytes()]);
      await ask(w, { type: "walktable", buffer }, [buffer]);
      return w;
    })().catch((err) => { loaded = null; throw err; }));
  }

  return {
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
      const got = await Promise.race([alerts, late]); clearTimeout(wait); // W78 walkalerts
      const { result } = await ask(w, { type: "walk", from, to, at: when, opts: { alerts: got } }); // W78 walkalerts: alerts
      return { plans: result.plans, reason: result.reason || (result.plans.length ? null : "none"), stats: result.stats };
    },
    /** W79 walkgo: a walk from `from` to `to` as a course, its turns and the walker's time, on the graph alone (no timetable). */
    async route(from, to) { return (await ask(await router(), { type: "walkroute", from, to })).route; }, // W79 walkgo
    /** The plan's first boarding at its live time, from one predictions request; as it was offline or without one. */
    async live(plan) {
      const l = plan.legs.find((x) => x.type === "train");
      if (!l || globalThis.navigator?.onLine === false) return plan;
      const wait = plan.legs[plan.legs.indexOf(l) - 1], ready = l.dep - (wait?.type === "wait" ? wait.time_s * 1000 : 0);
      try {
        const r = await fetchFn(predictionsUrl(l), { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
        return r.ok ? withLive(plan, firstLive(await r.json(), ready)) : plan;
      } catch { return plan; }
    },
  };
}
