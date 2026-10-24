// The search module in a web worker, so loading the index never blocks the chart:
//   const w = new Worker(new URL("search-worker.js", import.meta.url), { type: "module" });
//   w.postMessage({ id: 1, type: "load", url: "data/tiles/greater-boston-search-v8.json.gz", packUrl: "chart/lingo/lingo-pack.json" });
//   w.postMessage({ id: 2, type: "search", q: "12 elm st", near: [lon, lat], opts: { limit: 8 } });
//   w.postMessage({ id: 3, type: "inbox", kinds: ["tardis"], bbox: [w, s, e, n] });   // W54 course: the stops along a course
//   w.onmessage = ({ data }) => ...   // { id, type: "loaded", size } | { id, type: "results", results } | { id, type: "error", message }
// "load" also takes `file` (a Blob or File, such as the one in OPFS) instead of `url`, and `pack`
// instead of `packUrl`. A search sent before the load finishes waits for it.
// W82 packui (SPEC §156): "load" also takes `gazetteer`, the URL of the statewide gazetteer (chart/search/gazetteer.json), and
//   w.postMessage({ id: 4, type: "packs", packs: [{ id: "central", key: sha256, file }] });   // -> { id, type: "loaded", packs: n }
// gives the stored map packs' indexes (each replaces the last list). A search then asks the base's index, every pack's and the
// gazetteer's, merged by score with one entry per name within 100 m (one per town's name), a town or village named in full
// just after the best match (search.js searchAll).
import { loadBlob, loadUrl, use, search, inBox, mergeResults, searchAll } from "./search.js"; // W54 course: inBox; W82 packui: mergeResults, searchAll

let ready = Promise.reject(new Error("search: no index loaded"));
ready.catch(() => {});
let lingo = null, gaz = null, packs = new Map(), packsSent = 0; // W82 packui: the lingo pack, the gazetteer's index, pack id -> its index, and the last "packs" message's number

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "load") {
      ready = (async () => {
        const pack = lingo = m.pack || await (await fetch(m.packUrl)).json(); // W82 packui: lingo
        if (m.gazetteer) gaz = await loadUrl(m.gazetteer, pack).catch(() => null); // W82 packui: a build without it still searches
        return use(m.file ? await loadBlob(m.file, pack) : await loadUrl(m.url, pack));
      })();
      const idx = await ready;
      self.postMessage({ id: m.id, type: "loaded", size: idx.size, houses: idx.houses, built: idx.built });
    } else if (m.type === "search") {
      await ready;
      self.postMessage({ id: m.id, type: "results", results: packs.size || gaz ? searchAll([await ready, ...packs.values()], gaz, m.q, m.near ?? null, m.opts ?? {}) : search(m.q, m.near ?? null, m.opts ?? {}) }); // W82 packui: searchAll
    } else if (m.type === "inbox") { // W54 course: the places of some kinds in a box, for the stops along a course
      await ready;
      self.postMessage({ id: m.id, type: "results", results: packs.size ? mergeResults([inBox(m.kinds, m.bbox), ...[...packs.values()].map((p) => p.inBox(m.kinds, m.bbox))], Infinity) : inBox(m.kinds, m.bbox) }); // W82 packui: and the packs'
    } else if (m.type === "packs") { // W82 packui
      const n = ++packsSent; // W82 packui: a slower, older list (a pack's, then Remove's) doesn't replace a newer one
      await ready.catch(() => {}); // W82 packui: lingo
      const next = new Map(); // W82 packui
      for (const p of m.packs) next.set(p.id, packs.get(p.id)?.key === p.key ? packs.get(p.id) : Object.assign(await loadBlob(p.file, lingo), { key: p.key })); // W82 packui: one at a time; key, its file's hash
      if (n === packsSent) packs = next; // W82 packui
      self.postMessage({ id: m.id, type: "loaded", packs: packs.size }); // W82 packui
    }
  } catch (e) {
    self.postMessage({ id: m.id, type: "error", message: e.message });
  }
};
