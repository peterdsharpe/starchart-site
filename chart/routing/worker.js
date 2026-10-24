// The router in a web worker, so planning never blocks the chart.
//   const w = new Worker(new URL("./routing/worker.js", import.meta.url), { type: "module" });
//   w.postMessage({ type: "load", buffer }, [buffer]);              -> { type: "ready", junctions, edges, ms, bounds }
//   w.postMessage({ type: "route", id, from, via, to, style });     -> { type: "route", id, route } (null: no route)
// W21 routes: a route message with a `lane` (a drag re-plotting the course) waits its turn, and a newer one in the same
// lane takes its place: the older is answered { type: "route", id, route: null, stale: true } without being planned.
// W61 transit: bike plus comet (transit.js), over the comets' timetable, gunzipped:
//   w.postMessage({ type: "timetable", id, buffer }, [buffer]);    -> { type: "timetable", id, feed }
//   w.postMessage({ type: "comet", id, from, to, at, opts });      -> { type: "comet", id, result } (transit.js plan())
// W73 walk: on foot and by T (walktransit.js), over every mode's timetable, gunzipped:
//   w.postMessage({ type: "walktable", id, buffer }, [buffer]);    -> { type: "walktable", id, feed } (W73 walk)
//   w.postMessage({ type: "walk", id, from, to, at, opts });       -> { type: "walk", id, result } (walktransit.js walkPlan()) (W73 walk; W78 walkalerts: opts)
//   w.postMessage({ type: "walkroute", id, from, to });           -> { type: "walkroute", id, route } (walktransit.js walkRoute()) (W79 walkgo)
// W81 packroute: the base's graph and the stored packs' a trip touches (merge.js packsFor), merged into one router (SPEC §153):
//   w.postMessage({ type: "graphs", buffers }, buffers);          -> { type: "ready", ..., graphs } as load's (W81 packroute)
// W83 rustroute: with ?router=wasm on the worker's address, the search runs in WebAssembly (wasm.js, SPEC §162), and ready says
// router: "wasm" (else "js"); the courses are the same. If router.wasm can't be fetched, compiled or instantiated, it plans with router.js
// and ready says router: "js". ?router=js forces router.js (the default until WebAssembly becomes it).
// W85 chpot: WebAssembly is the default now, being the quicker with CH-potentials too (SPEC §165); ?router=js forces router.js.
// W85 chpot (SPEC §165): the graph's CH-potentials file (chpot.js), the bytes as stored: checked against the graph in use (its
// hash and the costs'), then its weights computed a slice at a time between messages; the router plans with it from then on
// (plain A* until then, or when it doesn't fit: the same routes):
//   w.postMessage({ type: "ch", buffer }, [buffer]);              -> { type: "chpot", ms, bytes, cached } once in, or { type: "chpot", refused }
// The result is cached in OPFS (routing/chpot-<key>.bin, chpot.js cacheKeySteps' key; the two last used kept), so a later session
// on the same graph has it in a moment rather than computing it again (0.6–1 s in Node, half a minute on a slow phone).
// W83 algo's ALT tables (built here, cached in OPFS as routing/alt-<key>.bin) gave way to CH-potentials (W85 chpot): the worker
// deletes the old cache's files once, at its start.
import { Router, STYLES, DEFAULT_STYLE } from "./router.js";
import { readTimetable, plan as cometPlan } from "./transit.js"; // W61 transit
import { walkPlan, walkRoute } from "./walktransit.js"; // W73 walk; W79 walkgo: walkRoute
import { mergeGraphs } from "./merge.js"; // W81 packroute
import { chpotSteps } from "./chpot.js"; // W85 chpot

let router = null;
let graph = null; // W85 chpot: the graph file the router was made from, for a CH-potentials file's check
let timetable = null; // W61 transit
let walktable = null; // W73 walk
const lanes = new Map(); // lane -> the newest message waiting in it
const WASM = (globalThis.self?.location ? new URLSearchParams(self.location.search).get("router") : "js") !== "js"; // W83 rustroute; W85 chpot: WebAssembly unless ?router=js (Node's stand-ins for a worker have no address: router.js)
const fellBack = (err) => { console.warn("router.wasm failed, planning with router.js:", err); return null; }; // W83 rustroute
const wasmP = WASM ? import("./wasm.js").then(async (m) => ({ ...m, module: await m.wasmModule() })).catch(fellBack) : null; // W83 rustroute: compiled while the graph unzips
let wasm; // W83 rustroute: undefined until wasmP settles, then the module or null (router.js)
const SLICE_MS = 20, CH_KEEP = 2; // W85 chpot: a plan waits at most a slice for the CH-potentials' customization; the cache's size
const chDir = async () => { const root = await globalThis.navigator?.storage?.getDirectory?.(); return root && root.getDirectoryHandle("routing", { create: true }); }; // W85 chpot
const chWrite = async (fh, bytes, keep = false) => { // W85 chpot: the file is the bytes, or with keep the bytes over its start (the rest kept)
  if (fh.createSyncAccessHandle) { const a = await fh.createSyncAccessHandle(); try { if (!keep) a.truncate(0); a.write(bytes, { at: 0 }); a.flush(); } finally { a.close(); } } // in a worker
  else { const w = await fh.createWritable({ keepExistingData: keep }); await w.write({ type: "write", position: 0, data: bytes }); await w.close(); }
};
const chCache = { // W85 chpot: chpot.js chpotSteps' cache, in OPFS; none in Node
  async load(key) {
    const dir = await chDir().catch(() => null);
    if (!dir) return null;
    try {
      const fh = await dir.getFileHandle(`chpot-${key}.bin`), bytes = await (await fh.getFile()).arrayBuffer();
      await chWrite(fh, new Uint8Array(bytes, 0, 4), true).catch(() => {}); // its first bytes again: written, so the eviction keeps the ones in use
      return bytes;
    } catch { return null; }
  },
  async save(key, bytes) {
    const dir = await chDir();
    if (!dir) return;
    await chWrite(await dir.getFileHandle(`chpot-${key}.bin`, { create: true }), bytes);
    const all = [];
    for await (const [name, h] of dir.entries()) if (/^chpot-.*\.bin$/.test(name)) all.push([name, (await h.getFile()).lastModified]);
    for (const [name] of all.sort((a, b) => b[1] - a[1]).slice(CH_KEEP)) await dir.removeEntry(name);
  },
};
function useCh(buffer) { // W85 chpot: the file's potential for the router in use, unless another graph replaces it first
  const r = router, t0 = performance.now(), me = self; // me: the worker that asked
  let cached = true; // until it computes the weights
  const it = chpotSteps(new Uint8Array(buffer), r, graph, { load: chCache.load, save: (k, b) => { cached = false; return chCache.save(k, b); } });
  const slice = async () => {
    try {
      for (const t = performance.now(); performance.now() - t < SLICE_MS;) {
        if (router !== r) return;
        const { value, done } = it.next();
        if (done) { r.chpot = value; return me.postMessage({ type: "chpot", ms: Math.round(performance.now() - t0), bytes: value.bytes, cached }); }
        if (value instanceof Promise) await value; // the streams, unzipped
      }
      setTimeout(slice);
    } catch (err) { me.postMessage({ type: "chpot", refused: String(err.message || err) }); }
  };
  setTimeout(slice);
}
// W85 chpot: W83 algo's ALT cache, gone with ALT: its files, and its folder once empty, deleted at the worker's start
(async () => {
  const root = await globalThis.navigator?.storage?.getDirectory?.(), dir = root && (await root.getDirectoryHandle("routing").catch(() => null));
  if (!dir) return;
  const names = [];
  for await (const [name] of dir.entries()) names.push(name);
  for (const name of names.filter((n) => /^alt-.*\.bin$/.test(n))) await dir.removeEntry(name);
  if (names.every((n) => /^alt-.*\.bin$/.test(n))) await root.removeEntry("routing");
})().catch(() => { /* none, or no OPFS (Node) */ });
function plan(data) {
  try {
    if (!router) throw new Error("no graph loaded");
    self.postMessage({ type: "route", id: data.id, route: router.route(data) });
  } catch (err) {
    self.postMessage({ type: "error", id: data.id, message: String(err.message || err) });
  }
}
self.onmessage = function onmessage({ data }) { // W83 rustroute: named, for wasm's load
  if (data.type === "route" && data.lane != null) {
    const old = lanes.get(data.lane);
    if (old) self.postMessage({ type: "route", id: old.id, route: null, stale: true });
    else setTimeout(() => { const m = lanes.get(data.lane); lanes.delete(data.lane); if (m) plan(m); }); // after the messages already queued
    lanes.set(data.lane, data);
    return;
  }
  try {
    if (data.type === "load" || data.type === "graphs") { // W81 packroute: graphs
      if (wasmP && wasm === undefined) return void wasmP.then((m) => { wasm = m; onmessage({ data }); }); // W83 rustroute
      const t = performance.now();
      graph = data.type === "graphs" ? mergeGraphs(data.buffers) : data.buffer; // W81 packroute; W83 rustroute: kept for a fall back; W85 chpot: and for a CH-potentials file's check
      router = new Router(graph); // W83 rustroute
      if (wasm) try { wasm.useWasm(router, wasm.module); } catch (err) { wasm = fellBack(err); router = new Router(graph); } // W83 rustroute
      router.style(DEFAULT_STYLE); // the first route shouldn't pay for the cost tables and the snap grid
      router.buildGrid();
      self.postMessage({ type: "ready", junctions: router.N, edges: router.E, styles: Object.keys(STYLES), ms: Math.round(performance.now() - t), bounds: router.header.bounds || null, ...(data.buffers && { graphs: data.buffers.length }), router: wasm ? "wasm" : "js" }); // W67 routefile: bounds, the chart's region, for a route file; W81 packroute: graphs; W83 rustroute: router
    } else if (data.type === "route") plan(data);
    else if (data.type === "ch") { if (!router) throw new Error("no graph loaded"); useCh(data.buffer); } // W85 chpot
    else if (data.type === "timetable") { timetable = readTimetable(data.buffer); self.postMessage({ type: "timetable", id: data.id, feed: timetable.feed }); } // W61 transit
    else if (data.type === "comet") { // W61 transit
      if (!router || !timetable) throw new Error(router ? "no comet timetable loaded" : "no graph loaded"); // W61 transit
      self.postMessage({ type: "comet", id: data.id, result: cometPlan(router, timetable, data.from, data.to, data.at, data.opts) }); // W61 transit
    } // W61 transit
    else if (data.type === "walktable") { walktable = readTimetable(data.buffer); self.postMessage({ type: "walktable", id: data.id, feed: walktable.feed }); } // W73 walk
    else if (data.type === "walk") { // W73 walk
      if (!router || !walktable) throw new Error(router ? "no walk timetable loaded" : "no graph loaded"); // W73 walk
      self.postMessage({ type: "walk", id: data.id, result: walkPlan(router, walktable, data.from, data.to, data.at, data.opts) }); // W73 walk; W78 walkalerts: opts
    } // W73 walk
    else if (data.type === "walkroute") { if (!router) throw new Error("no graph loaded"); self.postMessage({ type: "walkroute", id: data.id, route: walkRoute(router, data.from, data.to) }); } // W79 walkgo: a walk as a course
  } catch (err) {
    self.postMessage({ type: "error", id: data.id, message: String(err.message || err) });
  }
};
