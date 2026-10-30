// W73 ghosts (design/app-ui/SPEC.md §121): loaded into MapLibre's workers (maplibregl.importScriptInWorkers, app/ghosts.js).
// A "ghosts://" address reads the set of ghost trails the logbook worker keeps (app/ghost-logic.js openGhosts), so the set
// goes from one worker to the other through IndexedDB and never crosses the main thread, however many flights there are.
// The page's CSP stays as it is: no fetch, no blob: address.
import { SET, openGhosts } from "./ghost-logic.js";

const EMPTY = { type: "FeatureCollection", features: [] };
self.addProtocol("ghosts", async () => {
  const g = await openGhosts();
  const rec = await new Promise((resolve, reject) => { const r = g.transaction("lines").objectStore("lines").get(SET); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  return { data: rec?.data ?? EMPTY };
});
