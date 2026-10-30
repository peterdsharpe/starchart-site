// Hills on the chart (wave 19, design/app-ui/SPEC.md §19): the elevation tint and the steep ground under the
// roads and labels, and 3D terrain at ×6 while the chart is tilted.
//
// W28 settings (SPEC §38): one look for everyone, with no setting. The tint that colours the ground by its height
// stays; the grey hillshade went (a tester: "a grayish, foggy thing", "I think the shading could be taken out").
// 3D always stands up when the chart is tilted.
//
// The layers are chart/terrain/style.js's, in the theme's token colours; a theme switch repaints them. The
// data are the manifest's "dem" and "slope" PMTiles: read from the phone once stored and checked (OPFS,
// app/offline.js); W76 privacy: never by Range from the network, so until then there are no hills. They are stored after the chart, as the
// routing graph and the search index are. 3D turns on past 3° of pitch and off below 1° (W20 terrain3d; 12°
// and 8° in W19), so a chart held near 2° never flickers between the two; a flat chart pays nothing for it.
// The exaggeration grows with the pitch, from all but nothing below 8° to ×6 at 25°, and eases there frame by
// frame only once the 3D tiles have come, so nothing on the screen jumps as the hills rise. The ship (app/ship3d.js)
// and the motion layer (chart/prototype/gl-layer.js) read the ground's height from MapLibre while it is on.
import { terrainLayers, terrainSources, terrainSpec, TERRAIN_LAYER_IDS } from "../chart/terrain/style.js";
import { canStore, prune, store, storedTiles, StoredSource } from "./offline.js";
import { metres as metresBetween } from "./geo.js"; // W26 relief
import { metresPerPixel } from "../chart/prototype/follow.js"; // W26 relief
import { get } from "./settings.js"; // W191 appleft (SPEC §334)
import { KEY as WORDS } from "./lingo-mode.js"; // W192 mapfix3: the word mode, whose default Terrain follows

export const EXAGGERATION = 6, ON_PITCH = 3, OFF_PITCH = 1;
/** W50 layers: Layers › Terrain (app/layers.js), "on" or "off": off, no tint, no steep ground and no 3D. W192 mapfix3 (SPEC §337): off
 *  by default in Plain, on in SCUL (app/keys.js), a stored choice kept. */
export const LAYER = "starchart.layer.terrain";
/** W160 smallui (SPEC §287, her note 19: "Battery saver should disable terrain, which is likely to crash the app on older phones"):
 *  Battery saver (starchart.smooth "30") holds the hills off, flat and untinted; the rider's own Terrain choice stays stored and
 *  comes back when it goes off. The Layers tile says why (app/layers.js). */
export const SAVER = "starchart.smooth", SAVER_OFF = "Off while Battery saver is on.";
export const terrainShown = (choice, smooth) => choice !== "off" && smooth !== "30";
/**
 * W20 terrain3d: the exaggeration at a pitch, so that going into 3D doesn't jump. It is all but nothing from
 * where 3D turns on (3°) to RISE_PITCH, which gives the 3D tiles a moment to come, and grows to the full ×6
 * by FULL_PITCH. Not quite 0: the motion layer divides the ground's height by it (chart/prototype/gl-layer.js).
 */
export const RISE_PITCH = 8, FULL_PITCH = 25, MIN_EXAGGERATION = 0.01, EASE = 0.12, MAX_STEP = 0.15;
export const exaggerationAt = (pitch) => Math.max(MIN_EXAGGERATION, EXAGGERATION * Math.min(1, Math.max(0, (pitch - RISE_PITCH) / (FULL_PITCH - RISE_PITCH))));
/**
 * One frame's step of the exaggeration toward its target: an eighth of the way, and never more than MAX_STEP,
 * so a hill 50 m above the centre moves under 8 m a frame. By the frame, not the clock: a slow frame is
 * one step too, never a jump.
 */
export function easeExaggeration(x, target) {
  const y = x + Math.max(-MAX_STEP, Math.min(MAX_STEP, (target - x) * EASE));
  return Math.abs(target - y) < 0.005 ? target : y;
}
/**
 * W26 relief: in 3D the camera's centre stands at the local ground's median height × the exaggeration, so going
 * into 3D keeps the view where it was: ground above the median comes up, ground below it goes down. MapLibre's
 * own clamp puts the centre on the ground under it, and holds it at the gesture's start height while a two-finger
 * tilt raises the hills: the centre was then hundreds of metres under them. The median is of the ground within
 * LOCAL_M of the centre, or within the flat view's half-diagonal where that is smaller (NEAR_M at least). It is read
 * again at a moveend that has moved the view (never per frame), and eased to over MEDIAN_MS.
 */
export const LOCAL_M = 1500, NEAR_M = 250, MEDIAN_MS = 500, GRID = 11;
/** The median of the finite numbers in xs, or null for none. */
export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b), n = v.length;
  return n ? (n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2) : null;
}
/** A GRID × GRID grid's points within r metres of [lon, lat]. */
export function discPoints([lon, lat], r, n = GRID) {
  const dLat = r / 111320, dLon = dLat / Math.cos((lat * Math.PI) / 180), out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = (2 * i) / (n - 1) - 1, v = (2 * j) / (n - 1) - 1;
    if (u * u + v * v <= 1) out.push([lon + u * dLon, lat + v * dLat]);
  }
  return out;
}
/** The median's height `ms` after an ease from `from` to `to` began: cubic out over MEDIAN_MS. */
export const easeMedian = (from, to, ms) => from + (to - from) * (1 - (1 - Math.min(1, Math.max(0, ms / MEDIAN_MS))) ** 3);
/** W28 settings: the hills' one look, b. the tint and c. the steep ground; a. the hillshade went. */
export const HILLS = { tint: true, grade: true };
/** Should 3D terrain be on at this pitch, given whether it is on now? */
export const want3d = (pitch, on) => (on ? pitch > OFF_PITCH : pitch >= ON_PITCH);

/**
 * The hills' layers in a theme ({ theme: "dark" | "light", amoled }), each with the id it goes under. Without a
 * slope file there is no steep ground.
 */
export function hillLayers(tokens, { theme } = {}, { slope = true } = {}) {
  const opts = { ...HILLS };
  if (!slope) delete opts.grade;
  const light = theme === "light";
  return terrainLayers(opts, tokens[light ? "color-light" : "color"], light);
}

/**
 * Add the hills to the map once `after` resolves (the chart's first frame). `protocol` is the PMTiles
 * protocol the chart reads through (chart/prototype/chart.js). Returns the debug handle.
 */
export function mountTerrain({ map, data, at, tokens, protocol, after = Promise.resolve(), theme = () => globalThis.starchartTheme?.current ?? { theme: "dark" }, pinned = () => false, seen = () => Promise.resolve() }) { // W26: pinned, the camera following the ship; W102 trim: seen, once the chart is uncovered
  const dem = data.files.find((f) => f.kind === "dem"), slope = data.files.find((f) => f.kind === "slope");
  const state = { on3d: false, ready: false, switches: 0, shown: true };
  const now = { [LAYER]: get(LAYER), [SAVER]: get(SAVER) }; // W160 smallui: the choice and Battery saver, as the events tell them; W191 appleft (SPEC §334): through the registry, with its defaults (storage off too)
  state.shown = terrainShown(now[LAYER], now[SAVER]); // W50 layers; W160 smallui: and not under Battery saver
  if (!dem) return state;
  const url = (e) => at(e.path);

  /** Read a hills file from the phone. W76 privacy (SPEC §132): only from the phone, never by Range from the network, which
   *  would tell the host where the rider is: true once a checked copy is stored (the manifest's, else an older one, as the chart's). */
  async function readStored(e) {
    const st = canStore() ? await storedTiles(e).catch(() => null) : null;
    if (st) protocol.add(new pmtiles.PMTiles(new StoredSource(st.file, url(e)))); // W76 privacy: an older stored copy too
    return !!st; // W76 privacy
  }

  let shown = ""; // the ids drawn now, to tell a repaint from a new set of layers
  function draw() {
    const want = hillLayers(tokens, theme(), { slope: !!slope });
    const ids = want.map(([l]) => l.id).join();
    if (ids === shown) { // the same layers: only the paint (a theme switch)
      for (const [l] of want) for (const k in l.paint) map.setPaintProperty(l.id, k, l.paint[k]);
    } else {
      for (const id of TERRAIN_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
      for (const [l, before] of want) map.addLayer(l, map.getLayer(before) ? before : undefined);
      shown = ids;
    }
    for (const id of TERRAIN_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.shown ? "visible" : "none"); // W50 layers
    map.triggerRepaint();
  }

  // W20 terrain3d: the exaggeration follows the pitch frame by frame, eased, and stays all but nothing until
  // the 3D tiles under the view have come (a tile popping in at ×6 would jump)
  let late = 0, frames = 0;
  const loaded = (e) => {
    if (!state.on3d || e.sourceId !== map.terrain?.options.source || !e.tile) return;
    if (e.isSourceLoaded) state.tiles3d = true;
    if (ground.at && (!ground.full || ground.pin)) local(true); // W26 relief: ground that was missing from the last read has come; W76: following, a finer tile under the ship too (one point), so a coarse tile's height doesn't stick (the app-terrain:237 flake)
  };
  // W26 relief: the centre's height is ours while 3D is on (MapLibre 6.14's camera; another MapLibre keeps its clamp)
  const own = !!map._camera?.applyTransformChange && !!map.setCenterClampedToGround;
  const ground = state.ground = { from: 0, to: 0, t0: 0, at: null, zoom: 0, reads: 0, full: false };
  /**
   * Read the local median again, unless the view is about where it was last read. While the camera follows the ship
   * (`pinned`), the ground at the centre instead, the ship's, read at every move: the ship keeps its spot on the screen
   * (62 % heading up, the middle north up) on a hill too, rather than riding up the screen by its height above the median.
   */
  function local(force = false) {
    const t = map.terrain;
    if (!own || !t || !state.tiles3d || !(t.exaggeration > 0)) return;
    const pin = pinned();
    if (pin !== ground.pin) { ground.pin = pin; force = true; } // a change of mode eases to the other reading
    if (pin) force = true; // one point is cheap: every move
    const c = map.getCenter(), zoom = map.getZoom(), box = map.getContainer();
    // the view's half-diagonal on the flat chart, at any pitch: a tilt alone never changes the read
    const view = (Math.hypot(box.clientWidth, box.clientHeight) / 2) * metresPerPixel(c.lat, zoom);
    const r = Math.max(NEAR_M, Math.min(LOCAL_M, view));
    if (!force && ground.full && metresBetween(ground.at, [c.lng, c.lat]) < r / 8 && Math.abs(zoom - ground.zoom) < 0.5) return;
    // only the ground whose height has come: where it hasn't, MapLibre answers 0
    const LngLat = c.constructor, has = t.hasElevationForLngLat ? (p) => t.hasElevationForLngLat(new LngLat(p[0], p[1]), map._camera.transform) : () => true;
    const pts = pin ? [[c.lng, c.lat]] : discPoints([c.lng, c.lat], r), hs = pts.map((p) => (has(p) ? map.queryTerrainElevation(p) / t.exaggeration : NaN));
    const m = median(hs);
    ground.full = hs.every(Number.isFinite);
    if (m === null) return;
    const now = performance.now();
    ground.from = ground.at ? easeMedian(ground.from, ground.to, now - ground.t0) : m; // the first read, at ×0.01: there at once
    ground.to = m; ground.t0 = now; ground.at = [c.lng, c.lat]; ground.zoom = zoom; ground.reads++;
    map.triggerRepaint();
  }
  /** Put the centre at the median × the exaggeration; true while the median eases. */
  function lift() {
    const t = map.terrain;
    if (!own || !t) return false;
    const ms = performance.now() - ground.t0, m = easeMedian(ground.from, ground.to, ms);
    state.median = m;
    const e = m * t.exaggeration;
    if (Math.abs(map.getCenterElevation() - e) > 0.01) { map._camera.applyTransformChange((tr) => tr.setElevation(e)); map.triggerRepaint(); }
    return ms < MEDIAN_MS;
  }
  function tilt() {
    const pitch = map.getPitch(), on = state.shown && want3d(pitch, state.on3d); // W28 settings: always; W50 layers: unless Layers › Terrain is off
    if (on !== state.on3d) {
      state.on3d = on;
      state.switches++;
      state.tiles3d = false;
      frames = 0;
      clearTimeout(late);
      if (on) late = setTimeout(() => { state.tiles3d = true; map.triggerRepaint(); }, 1500); // no tiles here: rise anyway
      if (own) { map.setCenterClampedToGround(!on); ground.from = ground.to = 0; ground.at = null; } // W26 relief: flat, MapLibre's height (0) again
      map.setTerrain(on ? terrainSpec(MIN_EXAGGERATION) : null);
      if (!on) map.repaint = false;
    }
    if (on) ease();
  }
  function ease() {
    const t = map.terrain;
    if (!t) return;
    // the tiles are asked for at the first frames: after those, a loaded source has them (or has none here)
    if (!state.tiles3d && ++frames > 2 && map.isSourceLoaded(t.options.source)) state.tiles3d = true;
    if (state.tiles3d && !ground.at) local(true); // W26 relief: the first read, before the hills rise
    const target = state.tiles3d ? exaggerationAt(map.getPitch()) : MIN_EXAGGERATION;
    exaggerate(easeExaggeration(t.exaggeration, target));
    const easing = lift(); // W26 relief: the same frame as the exaggeration
    // drawing on while the hills move, and not "idle" until they have stopped, as a camera animation does
    const moving = t.exaggeration !== target || easing;
    if (map.repaint !== moving) map.repaint = moving;
  }

  /**
   * Change the exaggeration in place. map.setTerrain() would build the terrain anew, its meshes and its
   * draped textures, on every frame of a tilt; MapLibre 6.14 reads these fields when it draws.
   */
  function exaggerate(x) {
    const t = map.terrain;
    if (!t || t.exaggeration === x) return;
    if (!t.coverage || !t.options) { map.setTerrain(terrainSpec(x)); return; } // another MapLibre: the slow way
    t.exaggeration = t.coverage.exaggeration = t.options.exaggeration = x;
    t.resetElevationCache();
    map.painter?.markTerrainDepthDirty?.();
    map.triggerRepaint();
  }

  let mounting = false; // W76 privacy
  const mount = async () => { // W76 privacy: once the hills are stored, after the chart (below); until then there are none
    if (mounting) return;
    mounting = true;
    if (!(await Promise.all([dem, slope].filter(Boolean).map(readStored))).every(Boolean)) { mounting = false; return; } // W76 privacy
    // SRTM is public domain: its credit is in About's credits, so the chart's credit stays as short as before
    for (const [id, { attribution, ...src }] of Object.entries(terrainSources({ dem: url(dem), slope: slope && url(slope) }))) map.addSource(id, src);
    draw();
    tilt();
    map.on("pitch", tilt);
    map.on("render", () => { if (state.on3d) ease(); }); // W20 terrain3d: the easing, while it runs
    map.on("moveend", () => { if (state.on3d) local(); }); // W26 relief: the view has moved: the ground there
    map.on("sourcedata", loaded);
    addEventListener("starchart:theme", draw);
    state.ready = true;
  };
  after.then(mount).catch((err) => console.error("hills:", err)); // W76 privacy: mount

  // Stored with the tiles: once the chart is on the phone, the hills follow. W26: at every offline-ready, so Settings'
  // Download now retries one that failed; what is stored and current is skipped, and never two runs at once.
  let storing = false;
  addEventListener("starchart:offline-ready", async () => {
    if (storing) return;
    storing = true;
    try {
      for (const e of [dem, slope]) {
        if (!e) continue;
        try {
          const st = await storedTiles(e);
          if (!st || !st.current) { prune([e.sha256, st?.state.sha256].filter(Boolean), e.kind); await store(url(e), e); }
          else prune([e.sha256], e.kind);
        } catch (err) { console.warn(`storing the ${e.kind}:`, err.message); }
      }
    } finally { storing = false; }
    after.then(seen).then(mount).catch((err) => console.error("hills:", err)); // W76 privacy: stored now, so they draw; W102 trim: once the chart is seen, never under an opaque Settings (SPEC §202)
  });

  // W50 layers: Layers › Terrain, at once
  addEventListener("starchart:settings", (e) => {
    if (e.detail?.key !== LAYER && e.detail?.key !== SAVER && e.detail?.key !== WORDS) return; // W160 smallui: and Battery saver; W192 mapfix3: and Words
    if (e.detail.key === WORDS) now[LAYER] = get(LAYER); // W192 mapfix3: a rider who never chose has the new mode's default
    else now[e.detail.key] = e.detail.value;
    state.shown = terrainShown(now[LAYER], now[SAVER]); // W160 smallui
    if (state.ready) { draw(); tilt(); }
  });

  /** The ground's height at [lon, lat] in metres, exaggeration in, or 0 while the chart is flat. */
  state.height = (lonlat) => (map.getTerrain() ? map.queryTerrainElevation(lonlat) || 0 : 0);
  return state;
}
