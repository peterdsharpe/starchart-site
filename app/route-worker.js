// The router's worker (chart/routing/worker.js), taking the graph file as it is stored: a Blob, gzipped or
// not. Unzipping 10 MB on the page held the main thread for half a second (CPU slowed 4x), so it happens here.
//   w.postMessage({ type: "load", blob })   -> { type: "ready", ... }, then worker.js's own messages
// W82 packmap (SPEC §155): the stored map packs' graph files a trip touches, merged with the base's (merge.js), unzipped one by
// one; none plans on the base's alone again. The base's stays unzipped for the next merge.
//   w.postMessage({ type: "graphs", id, blobs })   -> { type: "ready", ..., graphs } as load's, or { type: "error", id }
// W85 chpot (SPEC §165): a graph's CH-potentials file, read and passed on to worker.js's "ch" (a graphs message's `ch`: base ⊕
// its one pack's, after the merge):
//   w.postMessage({ type: "ch", blob })            -> worker.js's { type: "chpot", ... } once it is in, or refused
import "../chart/routing/worker.js";

const route = self.onmessage;
let base = null; // W82 packmap: the base's graph, unzipped
const unzip = async (blob) => { // W82 packmap: as load's
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const s = head[0] === 0x1f && head[1] === 0x8b ? blob.stream().pipeThrough(new DecompressionStream("gzip")) : blob.stream();
  return new Response(s).arrayBuffer();
};
self.onmessage = async (e) => {
  if (e.data.type === "graphs" && e.data.blobs) { // W82 packmap
    try {
      if (!base) throw new Error("no graph loaded");
      const buffers = [base];
      for (const b of e.data.blobs) buffers.push(await unzip(b)); // one by one
      const ch = e.data.ch ? await e.data.ch.arrayBuffer().catch(() => null) : null; // W85 chpot
      route({ data: { type: "graphs", id: e.data.id, buffers } });
      return ch && route({ data: { type: "ch", buffer: ch } }); // W85 chpot
    } catch (err) { return self.postMessage({ type: "error", id: e.data.id, message: String(err.message || err) }); }
  }
  if (e.data.type === "ch" && e.data.blob) return route({ data: { type: "ch", buffer: await e.data.blob.arrayBuffer() } }); // W85 chpot
  if (e.data.type !== "load" || !e.data.blob) return route(e);
  try {
    base = await unzip(e.data.blob); // W82 packmap: kept
    route({ data: { type: "load", buffer: base } });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err.message || err) });
  }
};
