// W67 logsafe (design/app-ui/SPEC.md §96): the Log's backup, one file with every flight: its summary (the name, the stats,
// the taps, the car guard's excluded_m; app/blackbox.js) and its track's chunks (app/logbook.js), with the lifetime totals
// and class. It is JSON with a format version, gzipped. Restore adds the flights the phone hasn't by id, so none counts
// twice. Pure apart from (De)CompressionStream, so Node tests it (app/tests/logsafe.test.mjs); the logbook worker
// (app/logbook-worker.js) writes and reads it, and app/log.js has the buttons.
export const FORMAT = "starchart-log", VERSION = 1;

/** The backup as plain data. `flights` are the summaries, `chunks` a Map of a flight's id to its chunks as [n, {head, d, m}],
 *  `totals` the lifetime numbers ({flights, ly, class}), for a reader; a restore counts them again from the flights. */
export function packBackup({ flights, chunks, totals, made = Date.now() }) {
  const track = (id) => (chunks.get(id) || []).slice().sort((a, b) => a[0] - b[0])
    .map(([n, c]) => ({ n, head: [...c.head].map((v) => (Number.isNaN(v) ? null : v)), d: [...c.d], ...(c.m ? { m: [...c.m] } : {}) }));
  return { format: FORMAT, v: VERSION, made: new Date(made).toISOString(), totals, flights: flights.map((f) => ({ ...f, track: track(f.id) })) };
}

const num = (v) => typeof v === "number" && Number.isFinite(v);
/** A chunk as the store keeps it, or null if it isn't one. */
function chunk(c) {
  if (!c || !Number.isInteger(c.n) || c.n < 0 || !Array.isArray(c.head) || c.head.length !== 4 || !Array.isArray(c.d) || c.d.length % 4) return null;
  if (![0, 1, 2].every((i) => num(c.head[i])) || !c.d.every(Number.isInteger) || (c.m && (!Array.isArray(c.m) || c.m.length !== 2 + c.d.length / 2))) return null;
  const out = { head: new Float64Array(c.head.map((v) => v ?? NaN)), d: new Int32Array(c.d) };
  if (c.m) out.m = new Int16Array(c.m);
  return out;
}

const str = (v) => typeof v === "string"; // W73 logsafe
/** W73 logsafe: the summary's fields the Log reads, each with its type (app/logbook.js FlightStats.summary(), app/blackbox.js); one of
 *  another type is dropped, as a broken chunk is, so a hand-edited or odd file can't break the Log page. Any other field stays. */
const TYPES = { name: str, dest: str, systems: (v) => Array.isArray(v) && v.every(str), thumb: (v) => Array.isArray(v) && v.length <= 256 && v.every(Number.isInteger), // W73 logsafe: packThumb writes at most 128
  ...Object.fromEntries(["top_mps", "climb_m", "pulsars", "holes", "hifives", "cups", "moving_s", "plan_s", "flew_s", "courses", "pace"].map((k) => [k, num])) };
const typed = (f) => Object.fromEntries(Object.entries(f).filter(([k, v]) => !TYPES[k] || TYPES[k](v))); // W73 logsafe

/** What a backup brings to a phone that has the flights `have` (ids): {flights, chunks: [[id, n, chunk]], skipped}, with
 *  each flight once and none the phone has; or {bad: "newer"} for a file from a later format, {bad: "not"} for anything else. */
export function unpackBackup(data, have = new Set()) {
  if (data?.format !== FORMAT || !Array.isArray(data.flights)) return { bad: "not" };
  if (data.v !== VERSION) return { bad: num(data.v) && data.v > VERSION ? "newer" : "not" };
  const seen = new Set(have), flights = [], chunks = [];
  let skipped = 0;
  for (const raw of data.flights) {
    if (!raw || typeof raw !== "object") continue; // W147 backup: a null entry threw, and Restore said nothing
    const { track, ...f } = raw;
    if (typeof f.id !== "string" || !f.id || ![f.start, f.end, f.metres, f.minutes].every(num) || f.metres < 0 || [f.start, f.end].some((t) => isNaN(new Date(t)))) continue; // W73 logsafe: a date out of range threw in the Log
    if (seen.has(f.id)) { skipped++; continue; }
    seen.add(f.id);
    flights.push({ ...typed(f), excluded_m: Math.min(f.metres, Math.max(0, num(f.excluded_m) ? f.excluded_m : 0)) }); // the car guard's, as it was; W73 logsafe: typed
    for (const c of Array.isArray(track) ? track : []) { const k = chunk(c); if (k) chunks.push([f.id, c.n, k]); }
  }
  return { flights, chunks, skipped };
}

/** The backup's text, gzipped. */
export const gzip = (text) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob().then((b) => new Blob([b], { type: "application/gzip" }));

/** A file's data: gzipped JSON or plain JSON; null if it is neither. */
export async function readBackup(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const s = head[0] === 0x1f && head[1] === 0x8b ? blob.stream().pipeThrough(new DecompressionStream("gzip")) : blob.stream();
    return JSON.parse(await new Response(s).text());
  } catch { return null; }
}

// W147 backup (SPEC §263): Settings › App's Back up, everything the rider made in one file: the Log (packBackup's data, as
// `log`), and `store`, the localStorage keys that hold a choice or her own places and streets, as they are kept (app/log.js
// names them). "starchart-backup-2026-10-25.json", gzipped (".json.gz") when large. Restore replaces what the phone has.
export const ALL = "starchart-backup", ALL_V = 1, BIG = 256 * 1024; // W147 backup: gzipped above BIG bytes
/** W147 backup: the file's name, in local time; `gz` when it is gzipped. */
export function allName(now = Date.now(), gz = false) {
  const d = new Date(now), p = (n) => String(n).padStart(2, "0");
  return `starchart-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json${gz ? ".gz" : ""}`;
}
/** W147 backup: the file's data, from the Log's (packBackup's) and the kept keys' values. */
export const packAll = ({ log, store }) => ({ format: ALL, v: ALL_V, made: log.made, log, store });
/** W147 backup: what a file holds, {log, store}, where `store` has only the `keys` asked, as strings; null for an older
 *  Log-only file (W67's), which replaces the Log alone. {bad: "newer"} for a later format, {bad: "not"} for anything else. */
export function unpackAll(data, keys) {
  const log = data?.format === FORMAT ? data : data?.format === ALL ? data.log : null;
  if (data?.format === ALL && data.v !== ALL_V) return { bad: num(data.v) && data.v > ALL_V ? "newer" : "not" };
  if (log?.format !== FORMAT || !Array.isArray(log.flights)) return { bad: "not" };
  if (log.v !== VERSION) return { bad: num(log.v) && log.v > VERSION ? "newer" : "not" };
  if (data.format === FORMAT) return { log, store: null };
  const s = data.store && typeof data.store === "object" ? data.store : {};
  return { log, store: Object.fromEntries(keys.filter((k) => str(s[k])).map((k) => [k, s[k]])) };
}
