// The chart's tile handler (W21 tiles): past the archive's detailed coverage, the chart shows the best
// lower-resolution tile it has, enlarged, and never the bare background.
//
// The archive has z13 to z15 only inside planetiler's --bounds, but its z8 to z12 tiles spread past them,
// as far as Hudson and Clinton (chart/SCHEMA.md). The stock pmtiles protocol hid them in two ways:
//   - its TileJSON passed the header's bounds on, so MapLibre asked for no tile past them, at any zoom;
//   - a tile the archive lacks came back empty, which MapLibre takes as a tile loaded with nothing in it,
//     so it dropped the parent it was showing.
// Here an archive's TileJSON goes without bounds (W51 edge: the hills' too), and a missing tile is an error (MISSING, from the
// protocol's errorOnMissingTile). For an errored tile MapLibre keeps the nearest loaded parent, and asks
// for the next one up, as far as 10 zooms up (_updateRetainedTiles, maplibre-gl 6.14); a "404" would not
// do, since its vector source turns that into an empty tile too. makeMap (chart.js) quiets these errors.
// A stored tile file (app/main.js) is added to the same protocol, so it goes through here too.
// W205 workers (SPEC §375): once the chart is stored, MapLibre's workers read its tiles themselves (opfs://, storedHandler below):
// only its TileJSON still comes through here.

export const MISSING = "Tile not found."; // what pmtiles throws for a missing tile with errorOnMissingTile

/** W82 packmap: archives read as one, each tile from the first that has it (the base's, then each stored pack's in order). A
 *  tile across a cut is whole in each archive (planetiler writes every tile its box touches whole), so one tile per z/x/y is
 *  seamless: nothing is drawn twice and nothing is missing. `archives` is read at each call, so it may change in place. A
 *  PMTiles-like object: getZxy, getHeader and `source` (the first's: the key the pmtiles protocol files it under).
 *  W205 workers: here from world.js, which can't be loaded into MapLibre's workers (tiles-worker.mjs). */
export function firstOf(archives) {
  return {
    get source() { return archives[0].source; },
    getHeader: () => archives[0].getHeader(),
    async getZxy(z, x, y, signal) {
      let err = null;
      for (const a of [...archives]) {
        try { const r = a && (await a.getZxy(z, x, y, signal)); if (r) return r; }
        catch (e) { if (e?.name === "AbortError") throw e; err ??= e; } // the base's prefix throws past z13: a pack may have it
      }
      if (err) throw err;
      return undefined;
    },
  };
}

// W205 workers (SPEC §375): a tile from stored files, read in MapLibre's worker that parses it, not on the main thread. The
// chart's tile requests go out as pmtiles://<key>/z/x/y, and MapLibre passes each through the map's transformRequest on the
// main thread first (chart.js): there a key whose archives are all stored files becomes opfs://<their OPFS paths>/z/x/y, which
// tiles-worker.mjs's handler, registered in each worker, reads. Each request names its files, so a map pack stored or removed
// counts from the next request on, as the main thread's list does. Until the chart is stored (the network's, the prefix) the
// requests stay pmtiles:// and come to the main thread as before.
export const STORED = "opfs";

/** The request for a chart tile `url`, by `paths` (key -> the OPFS paths of its archives, the base's first), or undefined: as it is. */
export function storedRequest(url, paths) {
  const m = /^pmtiles:\/\/(.+)\/(\d+\/\d+\/\d+)$/.exec(url), list = m && paths.get(m[1]);
  return list ? { url: `${STORED}://${list.map(encodeURIComponent).join(",")}/${m[2]}` } : undefined;
}

/** A stored file by its OPFS path ("tiles/<sha256>.pmtiles", "packs/<id>/<sha256>.pmtiles"). */
async function opfsFile(path) {
  const names = path.split("/");
  let dir = await navigator.storage.getDirectory();
  for (const n of names.slice(0, -1)) dir = await dir.getDirectoryHandle(n);
  return (await dir.getFileHandle(names.at(-1))).getFile();
}

/** MapLibre's handler for opfs:// (storedRequest): each archive opened once, read by Blob.slice, and a tile none of them has is
 *  MISSING, as the pmtiles protocol's errorOnMissingTile has it. `PMTiles` is the pmtiles library's; `open` reads a path. */
export function storedHandler(PMTiles, open = opfsFile) {
  const archives = new Map(); // path -> a promise of its PMTiles
  const archive = (path) => {
    let a = archives.get(path);
    if (!a) {
      a = open(path).then((file) => new PMTiles({ getKey: () => path, getBytes: async (offset, length) => ({ data: await file.slice(offset, offset + length).arrayBuffer() }) }));
      a.catch(() => archives.delete(path)); // a failed open is tried again at the next read
      archives.set(path, a);
    }
    return a;
  };
  // so one that fails to open hands on (firstOf). A file written again since it was opened (a pack removed and stored again: the
  // same path, named by its contents) can't be read from the File it was opened with (NotReadableError): it is opened again, once.
  const lazy = (path) => ({
    async getZxy(...args) {
      const a = archive(path);
      try { return await (await a).getZxy(...args); } catch (e) {
        if (e?.name !== "NotReadableError") throw e;
        if (archives.get(path) === a) archives.delete(path);
        return (await archive(path)).getZxy(...args);
      }
    },
  });
  return async (params, abort) => {
    const [, list, z, x, y] = /^[a-z]+:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url), paths = list.split(",").map(decodeURIComponent);
    for (const p of archives.keys()) if (!paths.includes(p)) archives.delete(p); // a file no longer named (a pack removed, the chart updated) is let go
    const r = await firstOf(paths.map((p) => lazy(p))).getZxy(+z, +x, +y, abort.signal);
    abort.signal.throwIfAborted();
    if (r) return { data: new Uint8Array(r.data), cacheControl: r.cacheControl, expires: r.expires };
    throw new Error(MISSING); // the chart's and the packs' tiles are vector tiles
  };
}

/** MapLibre's handler for `pmtiles://`, from a pmtiles Protocol made with { errorOnMissingTile: true }. */
export function tileHandler(protocol) {
  return async (params, abort) => {
    const r = await protocol.tilev4(params, abort);
    if (params.type === "json") {
      const header = await protocol.get(params.url.slice("pmtiles://".length))?.getHeader();
      // W51 edge: the hills' DEM too, so past its own detail (z11 to -71.54 in the west) the tint and the steep ground draw
      // their parents, enlarged, as far as z8's tiles (-71.72), at every zoom, and end under the chart's fade (build_style.py)
      if (header) delete r.data.bounds;
    }
    return r;
  };
}

/**
 * W205 workers (SPEC §375): how many workers MapLibre parses tiles on. MapLibre 6 runs one outside Safari (its PR #2354, tuned on
 * desktop page loads), so every tile of every source queued on that one thread, and on a slow phone a zoom out of two levels
 * waited for it ~0.8 s. 2, and 3 from 8 cores: there the third was as fast or faster, slowed 4x and 6x, for 20 MB more; on 4
 * cores it gained at 4x and nothing at 6x, for 30 MB more, beside the router on the same cores (measured on tower, SPEC §375).
 */
export function workerCount(cores = navigator.hardwareConcurrency || 4, safari = isSafari(globalThis)) {
  if (safari) return Math.max(Math.min(Math.floor(cores / 2), 3), 1); // 0.1.94's words review: Safari keeps MapLibre's own rule (measured only in Chromium; an iPhone reporting 6 cores had 3)
  return cores >= 8 ? 3 : 2;
}

/** MapLibre's own Safari test (its `isSafari`, chart/vendor/maplibre-gl.mjs): `safari` in the scope, an iPad, iPhone or iPod, or
 *  Safari and not Chrome in the user agent. */
export function isSafari(scope) {
  const ua = scope.navigator?.userAgent || "";
  return !!scope.safari || /\b(iPad|iPhone|iPod)\b/.test(ua) || (ua.includes("Safari") && !ua.includes("Chrome"));
}
