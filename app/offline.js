// The offline chart: the tiles stored in the Origin Private File System (brief §8, rule 6).
//
// At launch the app asks storedTiles() for a checked file. Until there is one, PMTiles reads only the
// chart's prefix (openPrefix below; W76 privacy), and store() downloads the file in a worker (app/offline-worker.js)
// and checks its SHA-256 against data/manifest.json. A download cut off halfway resumes later; the
// old file, or the prefix, keeps working meanwhile.
import { MISSING } from "../chart/prototype/tiles.js"; // W76 privacy

const opfs = () => (navigator.storage && navigator.storage.getDirectory ? navigator.storage.getDirectory() : null);

/** Can this browser store the tiles? (OPFS with sync access handles, in a worker.) */
export const canStore = () => !!(globalThis.isSecureContext && navigator.storage?.getDirectory && globalThis.Worker);

async function tilesDir(folders) { // W81 packstore: folders, ["packs", id] for a map pack (app/packs.js), read but never made here
  let dir = await opfs();
  for (const n of folders ?? ["tiles"]) dir = dir && await dir.getDirectoryHandle(n, { create: !folders }); // W81 packstore
  return dir;
}

// W17 course: the routing graph and the search index are stored beside the tiles, each with its own state file.
// W19 terrain: and the hills' elevation and steepness tiles.
// W61 transit: and the comets' timetable, when the pilot asks for comet plans (app/transit.js).
const EXT = { tiles: ".pmtiles", graph: ".graph.gz", search: ".search.json.gz", dem: ".dem.pmtiles", slope: ".slope.pmtiles", transit: ".comets.bin.gz", walk: ".transit.bin.gz", ch: ".ch" }; // W61 transit: transit; W73 walk: walk, every mode's timetable; W85 chpot: ch, the graph's CH-potentials
const STATE = { tiles: "state.json", graph: "graph-state.json", search: "search-state.json", dem: "dem-state.json", slope: "slope-state.json", transit: "transit-state.json", walk: "walk-state.json", ch: "ch-state.json" }; // W61 transit: transit; W73 walk; W85 chpot: ch
/** Is this stored file one of this kind's? (A hills file ends in .pmtiles too, but is not the chart's.) */
export const ofKind = (name, kind) => name.endsWith(EXT[kind]) && !Object.keys(EXT).some((k) => k !== kind && EXT[k].endsWith(EXT[kind]) && name.endsWith(EXT[k]));
const kindOf = (entry) => (entry && EXT[entry.kind] ? entry.kind : "tiles");

/** What tiles/state.json (or a kind's own state file) says was stored and checked, or null. */
export async function storedState(kind = "tiles", folders) { // W81 packstore: folders
  try {
    const dir = await tilesDir(folders); // W81 packstore
    const f = await (await dir.getFileHandle(STATE[kind])).getFile();
    return JSON.parse(await f.text());
  } catch { return null; }
}

/**
 * The checked tile file to read from, or null. Prefers the manifest's file; otherwise any older
 * checked file, so a new chart on the server never leaves an offline phone without one.
 */
export async function storedTiles(entry, kind = kindOf(entry), folders) { // W81 packstore: folders
  if (!canStore()) return null;
  const st = await storedState(kind, folders); // W81 packstore
  if (!st) return null;
  try {
    const dir = await tilesDir(folders); // W81 packstore
    const file = await (await dir.getFileHandle(`${st.sha256}${EXT[kind]}`)).getFile();
    if (file.size !== st.bytes) return null;
    return { file, state: st, current: !entry || entry.sha256 === st.sha256 };
  } catch { return null; }
}

/** Delete tile files other than these hashes (old charts, and partial downloads of old ones). */
export async function prune(keep, kind = "tiles", folders) { // W81 packstore: folders
  try {
    const dir = await tilesDir(folders); // W81 packstore
    for await (const [name] of dir.entries()) {
      if (ofKind(name, kind) && !keep.some((k) => name === `${k}${EXT[kind]}`)) await dir.removeEntry(name); // W19 terrain: ofKind
    }
  } catch { /* nothing to prune */ }
}

// W26 downloads: pause() holds every download (app/downloads.js): a running one stops, keeping its part, which resumes by
// Range after resume(); a new one waits for resume(). Each worker message also goes out as window "starchart:store".
let held = null;
const running = new Set();
const PAUSED = Object.assign(new Error("paused"), { paused: true }); // W81 packstore: paused, for storeIn's callers
export const paused = () => !!held;
export function pause() {
  if (!held) { let go; held = new Promise((r) => { go = r; }); held.go = go; }
  for (const stop of running) stop();
}
export function resume() { held?.go(); held = null; }

/** Download and check the manifest's tile file (or its graph or search index, by `entry.kind`). onProgress({type, loaded, total}). Resolves when checked. */
export async function store(url, entry, onProgress = () => {}) {
  for (;;) {
    while (held) await held;
    try { return await storeOnce(url, entry, onProgress); } catch (e) { if (e !== PAUSED) throw e; }
  }
}
function storeOnce(url, entry, onProgress) {
  const run = storeIn(url, entry, onProgress); // W81 packstore: storeIn's, with the hold's stop
  running.add(run.stop); // W81 packstore
  return run.done.finally(() => running.delete(run.stop)); // W81 packstore
}
/** W81 packstore: one file's download and check, apart from pause()'s hold: { done, stop }. stop() keeps the part, for a resume by
 *  Range, and rejects `done` with an error whose `paused` is true. `folders`: the OPFS folder, ["packs", id] for a map pack
 *  (app/packs.js), whose downloads say nothing on "starchart:store", which is the chart's (app/downloads.js). */
export function storeIn(url, entry, onProgress = () => {}, folders) { // W81 packstore
  let stop; // W81 packstore
  const done = new Promise((resolve, reject) => { // W81 packstore
    const w = new Worker(new URL("./offline-worker.js", import.meta.url));
    const kind = kindOf(entry);
    let over = false; // W81 packstore
    const end = (fn) => { if (over) return; over = true; w.terminate(); fn(); }; // W81 packstore: once; running is storeOnce's
    stop = () => end(() => { tell({ type: "paused" }); reject(PAUSED); }); // W81 packstore
    const tell = (data) => { if (!folders) dispatchEvent(new CustomEvent("starchart:store", { detail: { ...data, kind } })); }; // W81 packstore: a pack's, not the chart's
    w.onmessage = ({ data }) => {
      onProgress(data);
      tell(data);
      if (data.type === "done") end(resolve);
      if (data.type === "error") end(() => reject(Object.assign(new Error(data.message), { full: !!data.full }))); // W74 integrity: full
    };
    w.onerror = (e) => { tell({ type: "error", message: e.message }); end(() => reject(new Error(e.message || "worker failed"))); };
    w.postMessage({ url, sha256: entry.sha256, bytes: entry.bytes, path: entry.path, name: `${entry.sha256}${EXT[kind]}`, state: STATE[kind], dir: folders }); // W81 packstore: dir
  }); // W81 packstore
  return { done, stop }; // W81 packstore
}
/** W81 packstore: how many bytes of a file are in its folder, checked or not (a part a pause or a quota left), or 0. */
export async function storedBytes(entry, folders) {
  try { return (await (await (await tilesDir(folders)).getFileHandle(`${entry.sha256}${EXT[kindOf(entry)]}`)).getFile()).size; } catch { return 0; }
}
/** W81 packstore: delete a folder and all in it (a map pack's, ["packs", id]). */
export async function removeFolder(folders) {
  try { await (await tilesDir(folders.slice(0, -1))).removeEntry(folders.at(-1), { recursive: true }); } catch { /* not there */ }
}

// W76 privacy (SPEC §132): until the chart is stored, it reads only its prefix (app/build.mjs prefix_bytes): the header, the
// directories and every tile to z13, one Range request that is the same for every rider, so the tile host learns nothing of where
// the rider is. It streams in zoom order, so a tile is served as soon as its bytes are in; it says it ends at z13, and the
// chart draws z13 enlarged. The prefix is kept as the start of the chart's own file, so the download
// resumes after it and a phone on mobile data pays for it once.

/** W76 privacy: a PMTiles source over the prefix: `read(end)` resolves with the prefix once its first `end` bytes are in. Past the
 *  prefix it throws MISSING and never fetches. The first read (the header's 16 KB) is cut at the prefix's end, and its header
 *  says the archive ends at `maxZoom`, as the prefix does: MapLibre then lays z13 out at the view's zoom, labels and icons too,
 *  where z15's MISSING left it a parent kept as a stand-in, drawn without them. */
export class PrefixSource {
  constructor(key, bytes, read, maxZoom = 13) { this.key = key; this.bytes = bytes; this.read = read; this.maxZoom = maxZoom; }
  getKey() { return this.key; }
  async getBytes(offset, length) {
    if (offset >= this.bytes || (offset > 0 && offset + length > this.bytes)) throw new Error(MISSING);
    const end = Math.min(offset + length, this.bytes), data = (await this.read(end)).slice(offset, end);
    if (offset === 0 && data.length > 101) data[101] = Math.min(data[101], this.maxZoom); // the PMTiles v3 header's max zoom
    return { data: data.buffer };
  }
}

const hex = async (buf) => (crypto.subtle ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("") : null);

/** W76 privacy: the chart's prefix, from this chart's stored part when it holds it, else from the network, kept in OPFS once
 *  checked. Returns { source, file, saved, drop }: the PrefixSource; a promise of the whole prefix as a File (for the world's worker);
 *  a promise that settles once it is kept (or failed), after which store() resumes past it; and drop(), which lets its bytes go
 *  once the chart is stored (a read after it is MISSING). A failed read is tried again at the next. */
export function openPrefix(url, entry) {
  const P = entry.prefix_bytes, name = `${entry.sha256}.pmtiles`;
  let buf = null, have = 0, wake = [], whole = null, saved;
  const savedP = new Promise((r) => { saved = r; });
  const tick = (err) => { const w = wake; wake = []; for (const f of w) f(err); };
  async function fromStore() {
    if (!canStore()) return null;
    try {
      const f = await (await (await tilesDir()).getFileHandle(name)).getFile();
      if (f.size < P) return null;
      const b = new Uint8Array(await f.slice(0, P).arrayBuffer());
      return (await hex(b)) === entry.prefix_sha256 ? b : null;
    } catch { return null; }
  }
  async function load() {
    const kept = await fromStore();
    if (kept) { buf = kept; have = P; tick(); saved(); return; }
    buf = new Uint8Array(P); have = 0;
    const res = await fetch(url, { cache: "no-store", headers: { Range: `bytes=0-${P - 1}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    while (have < P) {
      const { done, value } = await reader.read();
      if (done) break;
      const n = Math.min(value.byteLength, P - have);
      buf.set(value.subarray(0, n), have);
      have += n;
      tick();
    }
    if (have < P) throw new Error(`cut off at ${have} of ${P} bytes`);
    reader.cancel().catch(() => {}); // a server that ignored the Range sends the rest: not read
    const sum = await hex(buf);
    if (sum !== null && sum !== entry.prefix_sha256) throw new Error("the chart's first bytes do not match data/manifest.json");
    if (canStore()) savePrefix(entry, buf).then(saved, saved); else saved();
  }
  let loading = null;
  const start = () => (loading ??= load().catch((err) => { loading = null; have = 0; tick(err); saved(); throw err; })); // failed: store() may fetch it whole
  const read = (end) => {
    if (have >= end) return Promise.resolve(buf);
    const p = new Promise((resolve, reject) => {
      const check = (err) => { if (err) reject(err); else if (have >= end) resolve(buf); else wake.push(check); };
      wake.push(check);
    });
    start().catch(() => {});
    return p;
  };
  const file = () => (whole ??= start().then(() => new File([buf], `prefix-${entry.sha256}.pmtiles`)).catch((err) => { whole = null; throw err; }));
  start().catch(() => {});
  const source = new PrefixSource(url, P, read);
  return { source, file, saved: savedP, drop: () => { source.bytes = 0; buf = null; whole = null; } };
}

/** W76 privacy: write a checked prefix at the start of the chart's file, outside the download guard (it is under BIG). */
function savePrefix(entry, head) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./offline-worker.js", import.meta.url));
    w.onmessage = ({ data }) => { if (data.type === "prefix" || data.type === "error") { w.terminate(); (data.type === "prefix" ? resolve : reject)(data); } };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage({ sha256: entry.sha256, bytes: entry.bytes, name: `${entry.sha256}.pmtiles`, head, upto: true });
  });
}

/** A PMTiles source over a stored File, under the network URL's key, so the style need not change. */
export class StoredSource {
  constructor(file, key) { this.file = file; this.key = key; }
  getKey() { return this.key; }
  async getBytes(offset, length) { return { data: await this.file.slice(offset, offset + length).arrayBuffer() }; }
}

/** W40 settings: ask the browser to keep this site's storage (the Log and the stored chart) whenever it doesn't yet: at each start,
 *  once installed, and after a flight or the chart is stored. Chrome grants it on its own signals (installed, engagement), so a
 *  first "no" isn't the last word; it asked only once before. */
export const keep = () => navigator.storage?.persisted?.().then((p) => p || navigator.storage.persist?.()).catch(() => {});

/** Storage use, and whether the browser promised to keep it. */
export async function quota() {
  try {
    const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted()]);
    return { usage: est.usage, quota: est.quota, persisted };
  } catch { return null; }
}
