// The logbook worker (wave 17, SPEC §15): the Log's tracks in IndexedDB, off the main thread.
// Database "starchart", store "tracks", key [flightId, chunk]. Chunk -1 is the flight's mark
// {final: true}, written with its summary after the Undo window; a flight with chunks and no mark was
// cut short. Messages: {seq, op, ...} → {seq, result} or {seq, error}. app/logbook.js is the client.
// W67 logsafe: a module worker, for the Log's backup (app/logsafe.js).
import { packBackup, unpackBackup } from "./logsafe.js"; // W67 logsafe; W147 backup: the file is read and written on the page
import { decodeChunk, drawnTrack, trackLines } from "./logbook.js"; import { GHOST_V, SET, ghostCollection, ghostLines, openGhosts } from "./ghost-logic.js"; // W73 ghosts
let db = null;
function open() {
  if (db) return db;
  db = new Promise((resolve, reject) => {
    const r = indexedDB.open("starchart", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tracks");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { db = null; reject(r.error); };
  });
  return db;
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const range = (id) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);
/** W40 log: a write is stored once its transaction completes; a full store aborts it at the commit, after the request's success. */
const commit = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error("aborted")); });
const write = async (fn) => { const tx = (await open()).transaction("tracks", "readwrite"); fn(tx.objectStore("tracks")); await commit(tx); };

// W73 ghosts (SPEC §121): each flight's ghost trail, made once from its track and kept in the ghosts' own database
// (app/ghost-logic.js openGhosts), with the set the chart draws.
const glines = new Map(); // id → lines, this session's
async function ghostsOf(ids) {
  const want = ids.filter((id) => !glines.has(id));
  if (!want.length) return;
  const cached = await openGhosts().then((g) => { const s = g.transaction("lines").objectStore("lines"); return Promise.all(want.map((id) => done(s.get(id)))); }).catch(() => []);
  const made = [];
  for (const [i, id] of want.entries()) {
    if (cached[i]?.v === GHOST_V) { glines.set(id, cached[i].lines); continue; }
    const lines = ghostLines(trackLines(drawnTrack((await OPS.chunks({ id })).flatMap(decodeChunk))));
    if (lines.length) { glines.set(id, lines); made.push([id, lines]); } // none yet (no track): asked again next time
  }
  if (made.length) await openGhosts().then((g) => { const tx = g.transaction("lines", "readwrite"); for (const [id, lines] of made) tx.objectStore("lines").put({ v: GHOST_V, lines }, id); return commit(tx); }).catch(() => {});
}
const forget = (id) => { glines.delete(id); return openGhosts().then((g) => { const tx = g.transaction("lines", "readwrite"); tx.objectStore("lines").delete(id); return commit(tx); }).catch(() => {}); };

const OPS = {
  put: ({ id, n, head, d, m }) => write((s) => s.put(m ? { head, d, m } : { head, d }, [id, n])), // m: the matched track (wave 21); W40 log: write
  final: ({ id }) => write((s) => s.put({ final: true }, [id, -1])), // W40 log: write
  async chunks({ id }) {
    const all = await done((await open()).transaction("tracks").objectStore("tracks").getAll(range(id)));
    return all.filter((c) => c.head);
  },
  drop: ({ id }) => Promise.all([write((s) => s.delete(range(id))), forget(id)]).then(() => {}), // W40 log: write; W73 ghosts: and its ghost
  /** W73 ghosts: the ghost trails of the flights `ids` (oldest first), as the `ghosts` source's GeoJSON, kept as the set,
   *  which MapLibre's worker reads from a ghosts:// address (app/ghosts-worker.mjs), so it never crosses the main thread.
   *  {bounds, n}: their box and count; and the `data` itself where it can't be kept, or when asked (`direct`: that address
   *  can't be read). */
  async ghosts({ ids, direct = false }) {
    await ghostsOf(ids);
    const { data, bounds } = ghostCollection(ids.map((id) => glines.get(id)));
    const kept = !direct && await openGhosts().then((g) => { const tx = g.transaction("lines", "readwrite"); tx.objectStore("lines").put({ v: GHOST_V, data }, SET); return commit(tx); }).then(() => true, () => false);
    return { bounds, n: data.features.length, ...(kept ? {} : { data }) };
  },
  async flights() {
    const keys = await done((await open()).transaction("tracks").objectStore("tracks").getAllKeys());
    const by = new Map();
    for (const [id, n] of keys) by.set(id, by.get(id) || n === -1);
    return [...by].map(([id, final]) => ({ id, final }));
  },
  /** W147 backup (SPEC §263): the Log's data from a backup (`log`, packBackup's) in place of every track here: {flights}, the
   *  summaries to keep, or {bad}. */
  async replace({ log }) {
    const r = unpackBackup(log);
    if (r.bad) return { bad: r.bad };
    const stored = (await OPS.flights()).map((f) => f.id);
    try { await write((s) => { for (const id of stored) s.delete(range(id)); for (const [id, n, c] of r.chunks) s.put(c, [id, n]); for (const id of new Set(r.chunks.map(([id]) => id))) s.put({ final: true }, [id, -1]); }); } // one transaction: a full store keeps every track as it was
    catch (e) { if (e?.name === "QuotaExceededError") return { bad: "full" }; throw e; }
    await Promise.all(stored.map(forget)); // and their ghosts
    return { flights: r.flights };
  },
  /** W147 backup: the Log's part of a backup, as data (packBackup's), with every track here. */
  async packed({ flights, totals, made }) {
    const s = (await open()).transaction("tracks").objectStore("tracks"), [keys, vals] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
    const chunks = new Map();
    keys.forEach(([id, n], i) => { if (vals[i]?.head) { if (!chunks.has(id)) chunks.set(id, []); chunks.get(id).push([n, vals[i]]); } });
    return packBackup({ flights, chunks, totals, made });
  },
};

onmessage = async ({ data }) => {
  try { postMessage({ seq: data.seq, result: await OPS[data.op](data) }); } catch (e) { postMessage({ seq: data.seq, error: String(e?.message || e) }); }
};
