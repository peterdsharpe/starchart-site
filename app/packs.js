// W81 packstore (design/app-ui/SPEC.md §154): the regional map packs, each downloaded only when the rider asks.
//
// data/manifest.json's `packs` (app/build.mjs) gives each pack's id, name, places, bounds, bytes and files (tiles, graph,
// search), named by their hash. mountPacks() reads what is stored and nothing more: no pack is fetched before download(id), and
// none is precached (app/sw.js). download(id) fetches each of the pack's files whole from its own URL, one GET each, into OPFS
// packs/<id>/, keyed by kind as the chart's are (app/offline.js storeIn: <sha256>.graph.gz, graph-state.json). pause(id) keeps
// the part, and the next download(id) resumes it by Range from the stored length. file(id, kind) gives a file only once it is
// stored and checked. A stored pack from an older release is `update`: its next download replaces its files and prunes the old.
//
// The guard (app/downloads.js): download(id) is the rider's tap, so it goes; list()'s `asks` says when the words around that
// tap must say mobile data or Data Saver (phase 2's offer). A pack started on Wi-Fi pauses if the connection turns careful,
// and goes on by itself on Wi-Fi again.
// A failed download stops after one try and says why once (the "starchart:packs" event's `why`, in the Words mode; list()
// keeps it while failed), and what's stored stays: a part resumes by Range at the next download(id).
//
// W243 packsauto (SPEC §506), her row of 2026-11-15: "any downloaded maps should automatically get updated when using the app on
// WiFi". freshen() starts each stored pack's update by itself, one at a time, where app/downloads.js byItself says so (Wi-Fi or a
// cable, or a computer that can't say), when `when()` (app/main.js) lets it: parked, after the chart's own downloads. An update, hers
// or one that came by itself, records its files in their own state files (offline.js NEXT): the pack is read from the same release's
// files all visit (`kept`: stored while its update runs, is paused or failed), and from the new ones from the next start, whose
// `ready` makes them the files' own and prunes the old. One that came by itself says nothing when it fails (it tries again at the
// next start or Wi-Fi) and stops on mobile data or Data Saver whatever its size; her Pause holds it till her tap, across starts (HELD).
import { canStore, markSet, NEXT, promoteSet, prune, removeFolder, storedBytes, storedTiles, storeIn } from "./offline.js"; // W243 packsauto: markSet, NEXT, promoteSet
import { asks, byItself, careful, freeAgain, touchFirst } from "./downloads.js"; // W243 packsauto: byItself, touchFirst
import { pick } from "./lingo-mode.js";

const HELD = "starchart:packs-held"; // W243 packsauto: the packs whose update she paused, by id: none comes by itself till her tap (app/keys.js)
const heldIds = () => { try { return JSON.parse(localStorage.getItem(HELD) || "[]"); } catch { return []; } };
const hold = (id, on) => { try { const ids = heldIds().filter((x) => x !== id); if (on) ids.push(id); if (ids.length) localStorage.setItem(HELD, JSON.stringify(ids)); else localStorage.removeItem(HELD); } catch { /* storage off */ } };

export const WORDS = {
  full: ["Not stored: the droid's storage is full.", "Not stored: the device's storage is full."], // W200 small8 (SPEC §356): device
  check: "The download was damaged. Try again.", // R2 words6 (SPEC §451): what happened to it (was "didn't match")
  stopped: "The download stopped. Try again with a signal.",
  gone: ["The chart pack couldn't be fetched. Reload and try again.", "The map pack couldn't be fetched. Reload and try again."], // an HTTP error: a redeploy renamed it, under the manifest loaded before; R2 words6: SCUL's "chart pack", as its other lines
  unsupported: ["This browser can't store chart packs.", "This browser can't store map packs."], // R2 words6
};
/** Why a download failed: a WORDS key. */
export const whyOf = (err) => (err?.full ? "full" : /does not match/.test(err?.message || "") ? "check" : /^HTTP /.test(err?.message || "") ? "gone" : "stopped");

const STOP = Object.assign(new Error("paused"), { paused: true });

/** The packs of `manifest` (data/manifest.json), their files under `at` (a function of a path, or the site's URL). */
export function mountPacks({ manifest, at, conn = globalThis.navigator?.connection, touch = touchFirst, when = async () => true }) { // W243 packsauto: touch, when
  const url = typeof at === "function" ? at : (p) => new URL(p, at).href;
  const packs = manifest?.packs || [];
  const st = new Map(packs.map((p) => [p.id, { state: "none", got: 0, why: "", update: false, held: false, run: null, task: null, stop: false, careful: false, kept: false, need: 0, auto: false }])); // W243 packsauto: kept, a whole set read this visit; need, the bytes its download or update fetches; auto, it came by itself
  const fns = new Set();
  const folders = (id) => ["packs", id];
  const big = () => globalThis.__downloadBig; // the e2e tests' fixture pack is under 2 MB (app/downloads.js)
  const byId = (id) => { const p = packs.find((x) => x.id === id); if (!p) throw new Error(`no map pack "${id}"`); return p; };
  const item = (p) => {
    const s = st.get(p.id);
    return { id: p.id, name: p.name, places: p.places, bytes: p.bytes, state: s.state, got: s.got, why: s.why ? pick(WORDS[s.why]) : "",
      update: s.update, asks: (s.state !== "stored" || s.update) && asks(conn, p.bytes - s.got, big()), // an update: its changed files' bytes
      kept: s.kept, need: s.need, auto: byItself(conn, touch()), held: heldIds().includes(p.id) }; // W243 packsauto: held, her Pause of its update (not the guard's)
  };
  const tell = (p) => {
    const d = item(p);
    for (const f of fns) f(d);
    dispatchEvent(new CustomEvent("starchart:packs", { detail: d }));
  };

  // What is stored: every file checked is "stored" (`update` if any is an older release's); else a part makes it "paused".
  // W243 packsauto: an update that finished in an earlier visit (offline.js markSet) is made the pack's own first, even with a newer
  // release out since, and every older file pruned: those read this visit and the manifest's (an update's, or its part) stay.
  const ready = Promise.all(packs.map(async (p) => {
    if (!canStore()) return;
    const s = st.get(p.id);
    const waits = (await promoteSet(folders(p.id)).catch((err) => { console.warn("packs:", err.message); return err.set; })) || {}; // W243 packsauto: waits, a set whose promotion failed, whole at the next start
    let got = 0, all = true, current = true, need = 0; const read = {}; // W243 packsauto: need; read, each kind's file read this visit
    for (const f of p.files) {
      const have = await storedTiles(f, f.kind, folders(p.id));
      if (have?.current) { got += f.bytes; continue; }
      if (have) read[f.kind] = have.state.sha256; // W243 packsauto
      const fresh = (await storedTiles(f, f.kind, folders(p.id), NEXT))?.current; // W243 packsauto: in, by an update
      all &&= !!have || (f.kind === "ch" && (fresh || !(await storedBytes(f, folders(p.id))))); // W85 chpot: a stored pack a release adds its CH-potentials file to is stored, with an update
      current = false; need += f.bytes; // W243 packsauto: need
      got += fresh ? f.bytes : await storedBytes(f, folders(p.id)); // W243 packsauto: fresh
    }
    if (all) for (const f of p.files) await prune([f.sha256, read[f.kind], waits[f.kind]].filter(Boolean), f.kind, folders(p.id)); // W243 packsauto: an older release's files, and their parts, once nothing reads them (as the chart's, app/main.js storeChart) or waits
    Object.assign(s, { got, need, state: all ? "stored" : got > 0 ? "paused" : "none", update: all && !current, kept: all }); // W243 packsauto: need, kept
  }));

  async function run(p, s) {
    const slot = s.kept ? NEXT : ""; // W243 packsauto: an update's files go in beside the set read this visit, which stays one release's
    try {
      let done = 0;
      for (const f of p.files) {
        if ((await storedTiles(f, f.kind, folders(p.id)))?.current || (slot && (await storedTiles(f, f.kind, folders(p.id), slot))?.current)) { done += f.bytes; continue; } // W243 packsauto: or in, by an update
        if (s.stop) throw STOP; // a pause between two files, after the last check
        s.run = storeIn(url(f.path), f, (d) => {
          if (d.type === "progress" || d.type === "verifying") { s.got = done + d.loaded; tell(p); }
        }, folders(p.id), slot); // W243 packsauto: slot
        await s.run.done;
        done += f.bytes;
      }
      if (slot) await markSet(p.files, folders(p.id)); // W243 packsauto: an update's, read from the next start (ready), and the older files pruned then
      else for (const f of p.files) await prune([f.sha256], f.kind, folders(p.id)); // an older release's files, and their parts
      Object.assign(s, { state: "stored", got: p.bytes, update: false, kept: true }); // W243 packsauto: kept
    } catch (err) {
      if (err?.paused) s.state = "paused";
      else if (s.auto) s.state = "stored"; // W243 packsauto: one that came by itself fails quietly, the map as it was; it tries again at the next start or Wi-Fi
      else Object.assign(s, { state: "failed", why: whyOf(err) }); // once: no retry, and the part stays
    } finally {
      Object.assign(s, { run: null, task: null, stop: false });
    }
    tell(p);
  }
  /** W243 packsauto: start the download (`auto`: by itself, not her tap). */
  function begin(p, s, auto) {
    Object.assign(s, { state: "downloading", why: "", held: false, stop: false, careful: careful(conn), auto });
    if (!s.kept) s.need = p.bytes; // W243 packsauto: a first download fetches it all; an update, what ready() found older
    tell(p);
    return (s.task = run(p, s));
  }
  /** W243 packsauto: stop a download, keeping its part (her Pause records it: pause()). */
  async function stop(id) {
    const s = st.get(byId(id).id);
    if (!s.task) return;
    s.stop = true;
    s.run?.stop();
    await s.task;
  }
  /** W243 packsauto: room for `bytes` more, as far as the browser says. */
  const room = async (bytes) => { const e = await globalThis.navigator?.storage?.estimate?.().catch(() => null); return !e?.quota || e.quota - (e.usage || 0) > bytes; };

  const api = {
    ready,
    list: () => packs.map(item),
    /** Download the pack (resuming its parts), unless it is stored and current or downloading. Resolves when it stops. */
    async download(id) {
      const p = byId(id), s = st.get(id);
      await ready;
      hold(id, false); // W243 packsauto: her tap lets its update go on by itself again
      if (s.task) { s.auto = false; return s.task; } // W243 packsauto: hers now
      if (s.state === "stored" && !s.update) return;
      if (!canStore()) { Object.assign(s, { state: "failed", why: "unsupported" }); tell(p); return; }
      return begin(p, s, false); // W243 packsauto: begin
    },
    /** Stop a download, keeping its part: her Pause. W243 packsauto: a stored pack's update stays paused till her tap, across starts. */
    async pause(id) {
      if (st.get(byId(id).id).kept) hold(id, true); // W243 packsauto
      await stop(id); // W243 packsauto: stop
    },
    /** Delete the pack's files, stored or partial. */
    async remove(id) {
      const p = byId(id), s = st.get(id);
      await ready;
      await stop(id); // W243 packsauto: stop, not her Pause
      hold(id, false); // W243 packsauto
      await removeFolder(folders(id));
      Object.assign(s, { state: "none", got: 0, why: "", update: false, held: false, kept: false, need: 0 }); // W243 packsauto: kept, need
      tell(p);
    },
    /** W243 packsauto: each stored pack's update, by itself and one at a time, where the connection lets it (byItself) and when
     *  `when()` does (parked, the chart's own downloads done); not one she paused. Resolves when they have stopped. */
    freshen() {
      return (freshening ??= (async () => {
        await ready;
        for (const p of packs) {
          const s = st.get(p.id);
          if (!due(s, p.id) || !byItself(conn, touch()) || !(await room(p.bytes - s.got))) continue; // no room: nothing said, the map as it is
          if (!(await when())) return; // asked before each pack, so none starts in a ride
          if (due(s, p.id) && byItself(conn, touch())) await begin(p, s, true); // as they are after the wait
        }
      })().finally(() => { freshening = null; }));
    },
    /** A stored, checked file of the pack ("tiles", "graph" or "search"), or null. */
    async file(id, kind) {
      const f = byId(id).files.find((x) => x.kind === kind);
      return (f && (await storedTiles(f, kind, folders(id)))?.file) || null;
    },
    /** fn(item) on every change; returns the function that stops it. */
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
  };

  let freshening = null; // W243 packsauto: freshen()'s run
  const due = (s, id) => s.kept && s.update && !s.task && !heldIds().includes(id); // W243 packsauto: an update waits, and she hasn't paused it
  let free = freeAgain(conn); // W243 packsauto: Wi-Fi or a cable at the last change, so only a change to it brings the updates that wait
  conn?.addEventListener?.("change", () => { // the guard: a pack started on Wi-Fi waits on mobile data, and goes on back on Wi-Fi
    for (const p of packs) {
      const s = st.get(p.id);
      if (s.task && !s.careful && (s.auto ? !byItself(conn, touch()) : asks(conn, p.bytes - s.got, big()))) { s.held = true; stop(p.id); } // W243 packsauto: stop; one that came by itself, whatever its size
      else if (s.held && s.state === "paused" && freeAgain(conn) && !s.auto) { s.held = false; api.download(p.id); } // W243 packsauto: one that came by itself goes on through freshen()
    }
    const was = free; free = freeAgain(conn); // W243 packsauto
    if (free && !was) api.freshen(); // W243 packsauto: Wi-Fi again: the updates that wait (not a change of its speed alone)
  });
  return api;
}
