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
import { canStore, prune, removeFolder, storedBytes, storedTiles, storeIn } from "./offline.js";
import { asks, careful, freeAgain } from "./downloads.js";
import { pick } from "./lingo-mode.js";

export const WORDS = {
  full: ["Not stored: the droid's storage is full.", "Not stored: the phone's storage is full."],
  check: "The download didn't match. Try again.",
  stopped: "The download stopped. Try again with a signal.",
  gone: "The map pack couldn't be fetched. Reload and try again.", // an HTTP error: a redeploy renamed it, under the manifest loaded before
  unsupported: "This browser can't store map packs.",
};
/** Why a download failed: a WORDS key. */
export const whyOf = (err) => (err?.full ? "full" : /does not match/.test(err?.message || "") ? "check" : /^HTTP /.test(err?.message || "") ? "gone" : "stopped");

const STOP = Object.assign(new Error("paused"), { paused: true });

/** The packs of `manifest` (data/manifest.json), their files under `at` (a function of a path, or the site's URL). */
export function mountPacks({ manifest, at, conn = globalThis.navigator?.connection }) {
  const url = typeof at === "function" ? at : (p) => new URL(p, at).href;
  const packs = manifest?.packs || [];
  const st = new Map(packs.map((p) => [p.id, { state: "none", got: 0, why: "", update: false, held: false, run: null, task: null, stop: false, careful: false }]));
  const fns = new Set();
  const folders = (id) => ["packs", id];
  const big = () => globalThis.__downloadBig; // the e2e tests' fixture pack is under 2 MB (app/downloads.js)
  const byId = (id) => { const p = packs.find((x) => x.id === id); if (!p) throw new Error(`no map pack "${id}"`); return p; };
  const item = (p) => {
    const s = st.get(p.id);
    return { id: p.id, name: p.name, places: p.places, bytes: p.bytes, state: s.state, got: s.got, why: s.why ? pick(WORDS[s.why]) : "",
      update: s.update, asks: (s.state !== "stored" || s.update) && asks(conn, p.bytes - s.got, big()) }; // an update: its changed files' bytes
  };
  const tell = (p) => {
    const d = item(p);
    for (const f of fns) f(d);
    dispatchEvent(new CustomEvent("starchart:packs", { detail: d }));
  };

  // What is stored: every file checked is "stored" (`update` if any is an older release's); else a part makes it "paused".
  const ready = Promise.all(packs.map(async (p) => {
    if (!canStore()) return;
    const s = st.get(p.id);
    let got = 0, all = true, current = true;
    for (const f of p.files) {
      const have = await storedTiles(f, f.kind, folders(p.id));
      if (have?.current) { got += f.bytes; continue; }
      all &&= !!have || (f.kind === "ch" && !(await storedBytes(f, folders(p.id)))); // W85 chpot: a stored pack a release adds its CH-potentials file to is stored, with an update
      current = false;
      got += await storedBytes(f, folders(p.id));
    }
    Object.assign(s, { got, state: all ? "stored" : got > 0 ? "paused" : "none", update: all && !current });
  }));

  async function run(p, s) {
    try {
      let done = 0;
      for (const f of p.files) {
        if ((await storedTiles(f, f.kind, folders(p.id)))?.current) { done += f.bytes; continue; }
        if (s.stop) throw STOP; // a pause between two files, after the last check
        s.run = storeIn(url(f.path), f, (d) => {
          if (d.type === "progress" || d.type === "verifying") { s.got = done + d.loaded; tell(p); }
        }, folders(p.id));
        await s.run.done;
        done += f.bytes;
      }
      for (const f of p.files) await prune([f.sha256], f.kind, folders(p.id)); // an older release's files, and their parts
      Object.assign(s, { state: "stored", got: p.bytes, update: false });
    } catch (err) {
      if (err?.paused) s.state = "paused";
      else Object.assign(s, { state: "failed", why: whyOf(err) }); // once: no retry, and the part stays
    } finally {
      Object.assign(s, { run: null, task: null, stop: false });
    }
    tell(p);
  }

  const api = {
    ready,
    list: () => packs.map(item),
    /** Download the pack (resuming its parts), unless it is stored and current or downloading. Resolves when it stops. */
    async download(id) {
      const p = byId(id), s = st.get(id);
      await ready;
      if (s.task) return s.task;
      if (s.state === "stored" && !s.update) return;
      if (!canStore()) { Object.assign(s, { state: "failed", why: "unsupported" }); tell(p); return; }
      Object.assign(s, { state: "downloading", why: "", held: false, stop: false, careful: careful(conn) });
      tell(p);
      return (s.task = run(p, s));
    },
    /** Stop a download, keeping its part. */
    async pause(id) {
      const s = st.get(byId(id).id);
      if (!s.task) return;
      s.stop = true;
      s.run?.stop();
      await s.task;
    },
    /** Delete the pack's files, stored or partial. */
    async remove(id) {
      const p = byId(id), s = st.get(id);
      await ready;
      await api.pause(id);
      await removeFolder(folders(id));
      Object.assign(s, { state: "none", got: 0, why: "", update: false, held: false });
      tell(p);
    },
    /** A stored, checked file of the pack ("tiles", "graph" or "search"), or null. */
    async file(id, kind) {
      const f = byId(id).files.find((x) => x.kind === kind);
      return (f && (await storedTiles(f, kind, folders(id)))?.file) || null;
    },
    /** fn(item) on every change; returns the function that stops it. */
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
  };

  conn?.addEventListener?.("change", () => { // the guard: a pack started on Wi-Fi waits on mobile data, and goes on back on Wi-Fi
    for (const p of packs) {
      const s = st.get(p.id);
      if (s.task && !s.careful && asks(conn, p.bytes - s.got, big())) { s.held = true; api.pause(p.id); }
      else if (s.held && s.state === "paused" && freeAgain(conn)) { s.held = false; api.download(p.id); }
    }
  });
  return api;
}
