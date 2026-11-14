// W204 bikeshare (design/app-ui/SPEC.md §372): Bluebikes' feed on the page, for the walker's Bluebike leg
// (chart/routing/walktransit.js bikePlans()). `window.starchart.bikes` is the hook for tests:
//
//   starchart.bikes.on                   Settings › Routing › Consider Bluebikes (KEY), off by default
//   await starchart.bikes.docks()        -> every dock with its live counts, or null (no feed and none kept)
//
// - **The feed** is Bluebikes' GBFS (chart/routing/bikeshare.js GBFS, Lyft's host): station_information (the docks, kept a
//   day) and station_status (the live bikes and free docks), the same two files for everyone, never a position.
// - **When:** only with the switch on, as a walker's preview plans (app/walk.js), every minute at most while a walking preview
//   with a Bluebike card is open (not with Data Saver on), and in a walk with a Bluebike leg as she nears each dock (app/course.js). The status is about
//   270 KB a time (the host sends it uncompressed), so never more often than once a minute.
// - **Offline:** the last answer is kept in this phone's storage (CACHE): the docks for planning, the counts while they are
//   under STALE_MS old; older, the counts are unknown and the plan doesn't count on them.
import { GBFS, docksOf, withStatus } from "../chart/routing/bikeshare.js";
import { get as setting } from "./settings.js";

/** Settings › Routing › Consider Bluebikes: "on" plans a Bluebike leg for a walker. Off by default: most riders ride their own. */
export const KEY = "starchart.bluebikes";
/** The last answer, kept: { info_at, docks, status_at, status }. */
export const CACHE = "starchart:bluebikes";
/** The docks again after a day; the counts again after a minute, at most; kept counts trusted for 15 min. */
export const AGE = { info_ms: 24 * 3600e3, status_ms: 60e3, stale_ms: 15 * 60e3 };

const read = (store) => { try { return JSON.parse(store?.getItem(CACHE) || "null") || {}; } catch { return {}; } };
/** The counts compact, for the cache: { id: [bikes, ebikes, docks, installed, renting, returning] }. */
const pack = (status) => Object.fromEntries((status?.data?.stations || []).map((s) => [s.station_id, [s.num_bikes_available, s.num_ebikes_available, s.num_docks_available, s.is_installed, s.is_renting, s.is_returning]]));
const unpack = (c) => ({ data: { stations: Object.entries(c || {}).map(([id, [b, e, d, i, r, t]]) => ({ station_id: id, num_bikes_available: b, num_ebikes_available: e, num_docks_available: d, is_installed: i, is_renting: r, is_returning: t })) } });

export function mountBikeshare({ fetchFn = (...a) => fetch(...a), now = () => Date.now(), store = globalThis.localStorage } = {}) {
  let kept = read(store), asking = null;
  const get = async (url) => {
    const r = await fetchFn(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const save = () => { try { store?.setItem(CACHE, JSON.stringify(kept)); } catch { /* full, or storage off: this visit only */ } };
  async function ask(counts) { // counts: the live counts too, else the docks alone
    const t = now(), offline = globalThis.navigator?.onLine === false;
    if (!offline && (!kept.docks || !(t - kept.info_at < AGE.info_ms))) {
      const info = await get(GBFS.info).catch(() => null);
      if (info) { kept.docks = docksOf(info); kept.info_at = t; }
    }
    if (counts && !offline && !(t - kept.status_at < AGE.status_ms)) { // at most once a minute
      const status = await get(GBFS.status).catch(() => null);
      if (status) { kept.status = pack(status); kept.status_at = t; }
    }
    save();
  }
  const asOf = () => (kept.docks ? withStatus(kept.docks, kept.status && now() - kept.status_at < AGE.stale_ms ? unpack(kept.status) : null) : null);
  return {
    get on() { return setting(KEY) === "on"; },
    /** Every dock with its live counts (chart/routing/bikeshare.js withStatus()), asked of the feed when the last answer is over a
     *  minute old (a day for the docks), else the kept one; counts over STALE_MS old are unknown (null); null with no docks at all. */
    async docks() {
      await (asking ??= ask(true).finally(() => { asking = null; }));
      return asOf();
    },
    /** The kept answer now, asking nothing: for a plan that can't wait for the feed. */
    kept: asOf,
    /** The docks alone (station_information), kept for the first plan: the switch turned on. No live counts outside a walk. */
    stations: () => ask(false).then(() => !!kept.docks),
    /** When the counts were asked (ms), or 0. */
    get at() { return kept.status_at || 0; },
  };
}
