// The event engine's world: the chart near the ship, read from the PMTiles archive itself at one
// fixed zoom, never from what MapLibre happens to have rendered. The answers are the same at any
// camera zoom, pan or tile state (events-1, prototype-2).
//
//   const world = openWorld("https://…/greater-boston-v9.pmtiles"); // decodes in a module worker
//   world.ready(lonlat)            -> true once the tiles within 700 m are decoded; else asks for them
//   world.systemsAt(lonlat)        -> properties of the `systems` polygons that contain the point
//   world.features(layer, kinds, lonlat, m) -> point features of those kinds within m metres
//   world.roadsNear(lonlat, m)     -> `roads` features within m metres, nearest first
//
// Tiles are z15, where every field exists (chart/SCHEMA.md). A small LRU keeps the last 32. In Node
// (the tests), `new World(archiveLoader(new PMTiles(source)))` decodes on the calling thread.
// W76 privacy (SPEC §132): `world.zoom` is 13 while the app has only the chart's prefix (app/offline.js), and 15 once it is
// stored (setZoom).
// W82 packmap (SPEC §155): the chart is a list of archives, the base's first and then each stored map pack's, read as one
// (firstOf): `load.packs` holds the packs' stored files, and refresh() reads the cached tiles again once that list changes.
import { PMTiles, FileSource } from "../vendor/pmtiles.mjs";
import { VectorTile } from "../vendor/vector-tile.mjs";
import { PbfReader } from "../vendor/pbf.mjs";
import { metres, pointSegment, pointInPolygonGeom } from "./events.js";

export const ZOOM = 15;
const LAYERS = ["systems", "places", "pois", "roads"];

/** The z15 tile [x, y] that holds a point. */
export function tileOf([lon, lat], z = ZOOM) {
  const n = 2 ** z;
  const y = (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(y * n)];
}

/** The tiles that cover a box of ±m metres around a point. */
function tilesAround(p, m, z = ZOOM) { // W76 privacy: z
  const dLat = m / 111320, dLon = m / (111320 * Math.cos((p[1] * Math.PI) / 180));
  const [x0, y0] = tileOf([p[0] - dLon, p[1] + dLat], z), [x1, y1] = tileOf([p[0] + dLon, p[1] - dLat], z); // W76 privacy: z
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

/** One z15 tile (W76 privacy: or z13), decoded to GeoJSON features in lon/lat: {systems, places, pois, roads}. */
export async function readTile(archive, x, y, z = ZOOM) { // W76 privacy: z
  const r = await archive.getZxy(z, x, y);
  const out = Object.fromEntries(LAYERS.map((l) => [l, []]));
  if (!r) return out;
  const vt = new VectorTile(new PbfReader(new Uint8Array(r.data)));
  for (const l of LAYERS) {
    const layer = vt.layers[l];
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i).toGeoJSON(x, y, z); // W76 privacy: z
      out[l].push({ type: "Feature", geometry: f.geometry, properties: { ...f.properties } });
    }
  }
  return out;
}

/** W82 packmap: archives read as one, each tile from the first that has it (the base's, then each stored pack's in order). A
 *  tile across a cut is whole in each archive (planetiler writes every tile its box touches whole), so one tile per z/x/y is
 *  seamless: nothing is drawn twice and nothing is missing. `archives` is read at each call, so it may change in place. A
 *  PMTiles-like object: getZxy, getHeader and `source` (the first's: the key the pmtiles protocol files it under). */
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

/** A tile loader that decodes on this thread. */
export const archiveLoader = (archive) => (x, y, z) => readTile(archive, x, y, z); // W76 privacy: z

/**
 * A tile loader that decodes in a module worker running this file. Set `load.file` to a stored copy
 * of the archive (a File, such as the app's OPFS chart) and the worker reads that instead of the URL.
 * W76 privacy: or to a function that returns a promise of one (the chart's prefix), which each read waits for.
 */
export function workerLoader(url) {
  const worker = new Worker(import.meta.url, { type: "module" });
  const waiting = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) w.reject(new Error(data.error)); else w.resolve(data.tile);
  };
  const load = async (x, y, z) => { // W76 privacy: z, and a file that may be a promise
    const file = await (typeof load.file === "function" ? load.file() : load.file);
    return new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, url, file, packs: load.packs, x, y, z }); // W82 packmap: packs
    });
  };
  load.file = null;
  load.packs = []; // W82 packmap: the stored map packs' tile files, after the base's
  return load;
}

export const openWorld = (url) => new World(workerLoader(url));

function lineDistance(p, g) {
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  let best = Infinity;
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) best = Math.min(best, pointSegment(p, l[i], l[i + 1]));
  return best;
}

export class World {
  /** @param {(x, y) => Promise<object>} load  a decoded tile, as readTile returns it */
  constructor(load, { size = 32, reach = 700, zoom = ZOOM } = {}) { // W76 privacy: zoom
    this.load = load;
    this.zoom = zoom; // W76 privacy
    this.size = size;
    this.reach = reach; // the farthest any query looks: quadrants, 700 m
    this.tiles = new Map(); // "x/y" -> decoded tile, oldest first
    this.pending = new Map(); // "x/y" -> Promise
    this.gen = 0; // W82 packmap: refresh() calls so far
  }

  /** W76 privacy: read at zoom z from now on. The old zoom's tiles answer until the new zoom's round the places last asked
   *  about, one per reach, are decoded, so no query finds nothing meanwhile; then they age out of the LRU. One per reach keeps
   *  the ship's (app/match.js's reach) when a route's ends or a searched place are asked about since. */
  async setZoom(z) {
    this.next = z;
    if (this.asked) { for (const [m, p] of this.asked) for (const [x, y] of tilesAround(p, m, z)) this.request(x, y, z); await this.idle(); }
    if (this.next === z) this.zoom = z;
  }

  tile(x, y) {
    const key = this.zoom + "/" + x + "/" + y, t = this.tiles.get(key); // W76 privacy: the zoom
    if (t) { this.tiles.delete(key); this.tiles.set(key, t); } // most recently used last
    return t;
  }

  request(x, y, z = this.zoom) { // W76 privacy: z
    const key = z + "/" + x + "/" + y; // W76 privacy: the zoom
    if (this.tiles.has(key) || this.pending.has(key)) return;
    const gen = this.gen; // W82 packmap: a refresh's answer, already in, wins over this older read
    this.pending.set(key, this.load(x, y, z).then((t) => {
      if (gen !== this.gen && this.tiles.has(key)) return; // W82 packmap
      this.tiles.set(key, t);
      while (this.tiles.size > this.size) this.tiles.delete(this.tiles.keys().next().value);
    }, (err) => console.warn("world: tile", key, err && err.message)).finally(() => this.pending.delete(key)));
  }

  /** Are the tiles within `m` metres of p decoded? Asks for the ones that are not. */
  ready(p, m = this.reach) {
    (this.asked ??= new Map()).set(m, p); // W76 privacy: for setZoom, the last place at each reach
    let ok = true;
    for (const [x, y] of tilesAround(p, m, this.zoom)) if (!this.tile(x, y)) { ok = false; this.request(x, y); } // W76 privacy: zoom
    return ok;
  }

  /** W82 packmap: read every cached tile again, and every one still loading (a map pack stored or removed); each answers as it
   *  was until its new one is in. Only the latest refresh's answers count. */
  refresh() {
    const gen = ++this.gen, loading = [...this.pending.keys()].filter((k) => k.split("/").length === 3);
    for (const key of new Set([...this.tiles.keys(), ...loading])) {
      const [z, x, y] = key.split("/").map(Number), again = key + "/again/" + gen;
      const p = this.load(x, y, z).then((t) => {
        if (gen === this.gen && (this.tiles.has(key) || this.pending.has(key))) this.tiles.set(key, t);
      }, (err) => console.warn("world: tile", key, err && err.message));
      this.pending.set(again, p.finally(() => this.pending.delete(again)));
    }
  }

  /** Resolves when every tile asked for so far has arrived. */
  async idle() {
    while (this.pending.size) await Promise.all(this.pending.values());
  }

  /** Features of one layer from the tiles within m metres of p (duplicate points at tile edges removed). */
  near(layer, p, m) {
    const out = [], seen = new Set();
    for (const [x, y] of tilesAround(p, m, this.zoom)) { // W76 privacy: zoom
      for (const f of this.tile(x, y)?.[layer] || []) {
        if (f.geometry.type === "Point") {
          const key = f.properties.kind + ":" + f.geometry.coordinates.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
        }
        out.push(f);
      }
    }
    return out;
  }

  systemsAt(p) {
    const [x, y] = tileOf(p, this.zoom); // W76 privacy: zoom
    return (this.tile(x, y)?.systems || []).filter((f) => pointInPolygonGeom(p, f.geometry)).map((f) => f.properties)
      .sort((a, b) => (a.admin_level || 0) - (b.admin_level || 0));
  }

  features(layer, kinds, p, m) {
    return this.near(layer, p, m).filter((f) => kinds.includes(f.properties.kind) && metres(p, f.geometry.coordinates) <= m);
  }

  roadsNear(p, m) {
    return this.near("roads", p, m).map((f) => ({ f, d: lineDistance(p, f.geometry) })).filter((x) => x.d <= m)
      .sort((a, b) => a.d - b.d).map((x) => x.f);
  }
}

// Run as a module worker: decode the tiles the page asks for.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const archives = new Map();
  const open = (file, url) => { // W82 packmap: one archive per file, kept
    const key = file ? `file:${file.name}:${file.size}` : url;
    if (!archives.has(key)) archives.set(key, new PMTiles(file ? new FileSource(file) : url));
    return archives.get(key);
  };
  self.onmessage = async ({ data: { id, url, file, packs = [], x, y, z } }) => { // W76 privacy: z; W82 packmap: packs
    try { self.postMessage({ id, tile: await readTile(firstOf([open(file, url), ...packs.map((f) => open(f))]), x, y, z) }); } // W76 privacy: z; W82 packmap: the base, then the packs
    catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
  };
}
