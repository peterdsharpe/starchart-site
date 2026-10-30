// W152 app-rest J1 (design/app-ui/SPEC.md §280): the timetables' loader, one for app/transit.js (the comets', kind "transit")
// and app/walk.js (every mode's, kind "walk"), which each carried a copy that had drifted: walk's left out the network where
// this phone's storage throws (Safari Private Browsing), so the walker got "offline" where the comets got their file.
// Tested in app/tests/timetable.test.mjs.
import { canStore, storedTiles, store, prune, paused } from "./offline.js";

/** A timetable's bytes, gunzipped: the stored copy when it is the manifest's `entry`, else stored now, else the network's
 *  where nothing is stored (nothing can be, or storing throws: Safari Private Browsing's OPFS, as course.js's dataFile()),
 *  else an older stored one. Throws "held" while the data guard holds the downloads (a Pause, or mobile data) and nothing is
 *  stored, so no plan waits; else `missing` when there is no copy at all. */
export async function timetableBytes(entry, kind, { at, fetchFn = (...a) => fetch(...a), missing = "offline" }) {
  const st = canStore() ? await storedTiles(entry, kind) : null;
  let blob = st?.current ? st.file : null;
  if (!blob && !st && paused()) throw new Error("held");
  if (!blob && canStore() && !paused()) {
    try {
      await store(at(entry.path), entry);
      blob = (await storedTiles(entry, kind))?.file || null;
      prune([entry.sha256], kind);
    } catch { /* offline, or the guard held it: an older copy, if any */ }
  }
  if (!blob && !st) { try { const r = await fetchFn(at(entry.path)); if (r.ok) blob = await r.blob(); } catch { /* offline */ } }
  blob ||= st?.file || null;
  if (!blob) throw new Error(missing);
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

/** A request to the routing worker and its answer, under ids of its own (`prefix`-1, -2 …), which course.js's handler passes
 *  over: ask(w, msg, transfer) resolves with the answer, or rejects with an error answer's message. */
export function askWorker(prefix) {
  let seq = 0;
  return (w, msg, transfer = []) => {
    const id = `${prefix}-${++seq}`;
    return new Promise((ok, no) => {
      const on = ({ data: m }) => {
        if (m?.id !== id) return;
        w.removeEventListener("message", on);
        if (m.type === "error") no(new Error(m.message)); else ok(m);
      };
      w.addEventListener("message", on);
      w.postMessage({ ...msg, id }, transfer);
    });
  };
}
