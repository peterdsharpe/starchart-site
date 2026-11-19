// W204 streetnames (design/app-ui/SPEC.md §371), her row 14 of 2026-11-08: "It would be really nice if the detail directions,
// besides telling me to turn left or right, also told me the name of the street that I am turning onto … if I have the phone in
// the front basket of my bike and I just want to hear the directions." Detailed says "In 400 feet, turn left onto Elm Street."
//
// - **The clips** are Kokoro's, rendered ahead as every line is (design/sound/scripts/streetnames.py): one per street name of
//   the region, in each voice and word mode, each name said alone, with the moves a name follows ("Turn left onto"), cut where
//   they ran into a name, so the call joins at "onto". One file per region, voice and mode (data/manifest.json `optional`, kind
//   "names"), the same file for every rider: never a request that says where she rides (W76 privacy).
// - **The download:** the file of the voice in use and the word mode, while Detailed is on, stored as the chart is (OPFS,
//   app/offline.js store(): checked by its SHA-256, held while the chart's downloads are held), once the chart is stored, as the
//   graph and the search index follow it (app/course.js, "starchart:offline-ready"). It is always big (24 to 31 MiB), so on
//   mobile data or Data Saver it waits for her Download, as the chart's big ones wait (app/downloads.js careful), and the tap
//   fetches it even while the chart waits; Wi-Fi starts it by itself, and one that came by itself waits again when the phone goes to
//   mobile data, its part kept. Only the voice in use is kept: another voice's file replaces it.
// - **W207 streetnames2 (SPEC §382), the row:** Settings › Offline maps, beside the map's row, as a pack's (namesRow): its size for
//   the voice and mode in use, Download, its progress with Pause, Stored with Remove; on mobile data "Waits for Wi-Fi", and her
//   Download asks first there (downloads.js askFirst, the map's and the packs' one question). After her Pause or Remove nothing comes
//   by itself till her Download.
// - **A course** (app/course.js) asks prepare() for its turns' streets: their clips go to design/sound/sfx.js setNamed, and a
//   turn's call names its street only when the clip decoded (sfx.hasNamed). No file, no name or no clip: the call is as before.
import { canStore, storedTiles, storedBytes, store, storeIn, prune } from "./offline.js"; // W207 streetnames2: storedBytes
import { careful, freeAgain, mb, ASK, PACK_WORDS, askFirst, cellular } from "./downloads.js"; // W207 streetnames2: ASK, PACK_WORDS, askFirst, cellular
import { pick, onLingo, lingo } from "./lingo-mode.js";
import { WORDS as VOICE_WORDS } from "./voices.js"; // W207 streetnames2: the voice's name in the row

export const KIND = "names";
export const REGION = "greater-boston"; // the chart's; a map pack's names are for later
const MAGIC = "SCNM";

/** The manifest's names file for voice `v` and word mode `m` (app/voices.js keys, "meatspace" or "scul"), or null. */
export const namesEntry = (data, v, m, region = REGION) => (data?.optional || []).find((f) => f.kind === KIND && f.voice === v && f.lingo === (m === "meatspace" ? "meatspace" : "scul") && f.region === region) || null;

/** A names file's index, from its first bytes (`blob` a Blob or File): { voice, lingo, head: [off, len], moves, names, base },
 *  where `base` is where the data section starts and each move's and name's [off, len] is in it. Throws for another file. */
export async function readIndex(blob) {
  const dv = new DataView(await blob.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== MAGIC) throw new Error("not a Starchart names file");
  const hlen = dv.getUint32(8, true), h = JSON.parse(await blob.slice(12, 12 + hlen).text());
  return { ...h, base: 12 + hlen };
}

/** One clip as an Ogg Opus file: the shared header pages, then its own. */
export async function clip(blob, ix, [off, len]) {
  const [h0, hn] = ix.head, at = ix.base;
  return new Blob([blob.slice(at + h0, at + h0 + hn), blob.slice(at + off, at + off + len)]).arrayBuffer();
}

/** W207 streetnames2 (SPEC §382): the row's words, [SCUL, Plain], in Settings › Offline maps beside the map's row (her ask: "an
 *  option for me to download all of the street names"), its states and actions a map pack's (app/downloads.js PACK_WORDS). */
export const WORDS = {
  title: ["Starpath names", "Street names"],
  voice: ([scul, plain]) => [`Greater Boston only, for Detailed directions in ${scul}'s voice`, `Greater Boston only, for Detailed directions in ${plain}'s voice`], // app/voices.js WORDS' name pair // W210 settings10 (SPEC §388, her row 32): what it covers first, so no one takes a map pack to bring names; a pack's turns are called without them (app/course.js nameAt)
  failed: (b) => [`The download stopped. ${mb(b)} to go.`, `The download stopped. ${mb(b)} to go.`],
};
/** The row: its state line and its buttons ([words, action][]) as a pack's row, or null to hide it. `shown`: Detailed is on and the
 *  map stored, or the file is; `got` its bytes so far; `ask` its askFirst state; `waits` it comes by itself on Wi-Fi (mobile data now). */
export function namesRow({ entry, shown, stored, got = 0, running = false, failed = false, ask = "", waits = false }) {
  if (!entry || !shown) return null;
  const left = entry.bytes - got, pct = Math.floor((100 * got) / entry.bytes);
  if (stored) return { text: pick(...PACK_WORDS.stored(entry.bytes)), buttons: [[PACK_WORDS.remove, "remove"]] };
  if (running) return { text: pick(...PACK_WORDS.getting(pct)), buttons: [[PACK_WORDS.pause, "pause"]] };
  if (ask === "ask") return { text: pick(...ASK.q(left)), buttons: [[ASK.go, "download"], [ASK.later, "wait"]] };
  if (failed) return { text: pick(...WORDS.failed(left)), buttons: [[PACK_WORDS.download, "download"]] };
  if (ask === "wait" || waits) return { text: pick(...ASK.waits(left)), buttons: [[PACK_WORDS.download, "download"]] };
  if (got > 0) return { text: pick(...PACK_WORDS.paused(pct)), buttons: [[PACK_WORDS.download, "download"]] };
  return { text: pick(...PACK_WORDS.size(entry.bytes)), buttons: [[PACK_WORDS.download, "download"]] };
}
const HELD = "starchart:names-held"; // W207 streetnames2: her Pause or Remove: nothing comes by itself till her Download (app/keys.js)
const held = () => { try { return localStorage.getItem(HELD) === "1"; } catch { return false; } };
const hold = (on) => { try { if (on) localStorage.setItem(HELD, "1"); else localStorage.removeItem(HELD); } catch { /* storage off */ } };

/**
 * Wire the names: `data` the manifest, `at(path)` a file's address, `voice()` the voice in use (app/voices.js voiceNow),
 * `on()` is Detailed on (app/calls.js detailed), `sfx` design/sound/sfx.js, `row` Settings › Offline maps' row (#names-row, a pack
 * row's parts). Returns { prepare(names) }.
 */
export function mountStreetNames({ data, at, voice, on, sfx, row = null, conn = () => globalThis.navigator?.connection }) {
  let ix = null, ixFor = null, running = null, loaded = 0, failed = false, seq = 0, own = null, stop = null; // own: the stop of a download that came by itself; stop: the running one's, for Pause
  const mode = () => (lingo() === "meatspace" ? "meatspace" : "scul");
  const entry = () => namesEntry(data, voice(), mode());
  /** The stored file of the voice and mode in use, and its index, or null. */
  async function stored() {
    const e = entry();
    if (!e || !canStore()) return null;
    if (ixFor === e.sha256 && ix) return ix;
    const st = await storedTiles(e, KIND).catch(() => null);
    if (!st?.current) return null;
    try { ix = { ...(await readIndex(st.file)), file: st.file }; ixFor = e.sha256; return ix; } catch { return null; }
  }
  /** Download the file in use, unless it is stored or coming; `asked`: her Download (through the question, askFirst), on any
   *  connection. One look at a time, so two events at once start one download. */
  let looking = Promise.resolve();
  const get = (asked = false) => (looking = looking.then(() => getOnce(asked), () => getOnce(asked)));
  async function getOnce(asked) {
    const e = entry();
    if (!e || !on() || !canStore() || running || (await stored())) return paint();
    if (!asked && (!chartIn || held() || careful(conn()))) return paint(); // after the chart, as the graph and the index (course.js); on mobile data or Data Saver, at a tap: a names file is always big; W207 streetnames2: not after her Pause or Remove
    failed = false; loaded = await storedBytes(e);
    const progress = ({ type, loaded: l }) => { if (type === "progress" || type === "verifying") { loaded = l; paint(); } };
    let why = ""; // W207 streetnames2: "pause" hers, "data" mobile data's: either way the part waits, not failed
    const auto = (own = asked ? null : new AbortController()), run = asked ? storeIn(at(e.path), e, progress) : null;
    stop = (w) => { why = w; if (run) run.stop(); else auto.abort(); };
    running = (run ? run.done : store(at(e.path), e, progress, auto.signal)) // a tap goes ahead while the chart's downloads are held
      .then(() => prune([e.sha256], KIND), () => { failed = !why; }) // another voice's or mode's file goes once this one is stored
      .finally(async () => {
        running = null; own = null; stop = null; loaded = await storedBytes(e);
        if (entry()?.sha256 !== e.sha256 || (why === "data" && freeAgain(conn()))) get(); else paint(); // the voice or mode changed meanwhile: its own file; Wi-Fi again already (W204 review 2)
      });
    paint();
  }
  const ask = askFirst({ start: () => { hold(false); get(true); }, paint: () => paint(), conn: conn() }); // W207 streetnames2: her Download asks first on mobile data
  const ACT = {
    download: () => ask.tap((entry()?.bytes ?? 0) - loaded),
    wait: () => { hold(false); ask.wait(); },
    pause: () => { hold(true); stop?.("pause"); },
    remove: async () => { hold(true); stop?.("pause"); await running; await prune([], KIND); ix = null; ixFor = null; loaded = 0; paint(); },
  };
  async function paint() {
    if (!row) return;
    const n = ++seq, e = entry(), have = !!(await stored()), c = conn();
    if (!running && e && !have) loaded = await storedBytes(e); // a part, a Pause's or another visit's
    if (n !== seq) return;
    if (running || have) ask.clear();
    const s = namesRow({ entry: canStore() ? e : null, shown: have || (on() && chartIn), stored: have, got: loaded, running: !!running, failed, ask: ask.state === "wait" && c?.saveData ? "" : ask.state, // Data Saver's hold, which Wi-Fi alone doesn't end, says its size (as the map's)
      waits: !held() && cellular(c) && !c.saveData });
    row.hidden = !s;
    if (!s) return;
    row.querySelector(".t").textContent = pick(...WORDS.title);
    row.querySelector(".pl").textContent = pick(...WORDS.voice(VOICE_WORDS[voice()] ?? ["", ""]));
    row.querySelector(".st").textContent = s.text;
    row.toggleAttribute("data-ask", s.buttons.some(([, act]) => act === "wait")); // the question (app/downloads.css)
    row.querySelectorAll("button").forEach((b, i) => {
      const [t, act] = s.buttons[i] || [];
      b.hidden = !t;
      b.textContent = t || "";
      b.onclick = act ? ACT[act] : null;
    });
  }
  let chartIn = false; // the chart is stored: its own downloads are done, or never held this one
  addEventListener("starchart:offline-ready", () => { chartIn = true; get(); });
  conn()?.addEventListener?.("change", () => { if (freeAgain(conn())) get(); else if (careful(conn())) { if (own) stop?.("data"); else paint(); } }); // mobile data mid-download: one that came by itself waits again, as the chart's (downloads.js)
  onLingo(() => get());
  addEventListener("starchart:settings", () => get()); // the voice, or Directions
  get();
  return {
    /** A course's streets (their spoken names, chart/routing/instructions.js spokenRoad) and the moves before them, to sfx;
     *  resolves to the names sfx can say. */
    async prepare(names) {
      const x = await stored();
      if (!x || !on()) { await sfx.setNamed([]); return new Set(); }
      const want = [...new Set(names.filter(Boolean))].filter((n) => x.names[n]);
      const clips = await Promise.all([...Object.entries(x.moves), ...want.map((n) => [n, x.names[n]])].map(async ([t, r]) => [t, await clip(x.file, x, r)]));
      await sfx.setNamed(clips, { voice: x.voice });
      if (!Object.keys(x.moves).every((t) => sfx.hasNamed(t))) return new Set(); // a move that didn't decode: no name joins, the calls as before
      return new Set(want.filter((n) => sfx.hasNamed(n)));
    },
  };
}
