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
/** W238 feeddocks (SPEC §501): a kept answer's docks but those its last known counts (of any age) say aren't installed, for the map and a plan alike. */
const installed = (kept) => kept.docks.filter((d) => !(kept.status?.[d.id] && !kept.status[d.id][3])); // W238 feeddocks
/** W238 feeddocks: the stations the map draws from a kept answer: every one listed but those not installed (installed), as a plan leaves
 *  them out (asOf); one with no counts kept is drawn; null with no list. */
export const listedOf = (kept) => (kept?.docks ? installed(kept).map(({ id, name, ll }) => ({ id, name, ll })) : null); // W238 feeddocks
/** W238 feeddocks: listedOf this phone's kept answer with Consider Bluebikes on, else null; read before the map is made (app/main.js). */
export const listedNow = (store = globalThis.localStorage) => (setting(KEY) === "on" ? listedOf(read(store)) : null); // W238 feeddocks

export function mountBikeshare({ fetchFn = (...a) => fetch(...a), now = () => Date.now(), store = globalThis.localStorage, onKept = () => {} } = {}) { // W238 feeddocks: onKept, after a new list or new counts are kept
  let kept = read(store), asking = null;
  const get = async (url) => {
    const r = await fetchFn(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const save = () => { try { store?.setItem(CACHE, JSON.stringify(kept)); } catch { /* full, or storage off: this visit only */ } };
  async function ask(counts) { // counts: the live counts too, else the docks alone
    const t = now(), offline = globalThis.navigator?.onLine === false;
    let fresh = false; // W238 feeddocks
    if (!offline && (!kept.docks || !(t - kept.info_at < AGE.info_ms))) {
      const info = await get(GBFS.info).catch(() => null);
      if (info) { kept.docks = docksOf(info); kept.info_at = t; fresh = true; } // W238 feeddocks: fresh
    }
    if (counts && !offline && !(t - kept.status_at < AGE.status_ms)) { // at most once a minute
      const status = await get(GBFS.status).catch(() => null);
      if (status) { kept.status = pack(status); kept.status_at = t; fresh = true; } // W238 feeddocks: fresh
    }
    save();
    if (fresh) onKept(); // W238 feeddocks: the map's stations again (app/feed-docks.js draws nothing anew when they are the same)
  }
  const asOf = () => (kept.docks ? withStatus(installed(kept), kept.status && now() - kept.status_at < AGE.stale_ms ? unpack(kept.status) : null) : null); // W238 feeddocks: installed, so counts past 15 min still leave out a station the map doesn't draw
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
    /** W238 feeddocks: the stations the map draws, [{ id, name, ll }] (listedOf), with the switch on and a list kept; else null. */
    listed: () => (setting(KEY) === "on" ? listedOf(kept) : null),
  };
}
