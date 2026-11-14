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
//
// W229 climbs (SPEC §482), pancake's row 5 of 2026-11-13: in Plain the layer is Climbs, her design: how steep the ground is, in three
// levels in her colours, opaque over the parks and buildings, under the water and everything a rider reads (chart/terrain/style.js
// climbsLayers, from the manifest's "climbs" field); no tint and no steep ground, and the slope file isn't read. Battery saver no
// longer holds it off (her point 6); it holds off the raised hills alone, as does Settings › Power › 3D terrain (her point 7). SCUL
// keeps Terrain as it was (ruling 1, arclight's to change: CLIMBS_IN).
import { terrainLayers, terrainSources, terrainSpec, TERRAIN_LAYER_IDS, climbsLayers, climbsSource, CLIMB_LAYER_IDS, CLIMB_SOURCE, CLIMBS_OVER } from "../chart/terrain/style.js"; // W229 climbs
import { canStore, prune, store, storedTiles, StoredSource } from "./offline.js";
import { metres as metresBetween } from "./geo.js"; // W26 relief
import { metresPerPixel } from "../chart/prototype/follow.js"; // W26 relief
import { get } from "./settings.js"; // W191 appleft (SPEC §334)
import { KEY as WORDS, lingo } from "./lingo-mode.js"; // W192 mapfix3: the word mode, whose default Terrain follows; W229 climbs: lingo, which draws Climbs

export const EXAGGERATION = 6, ON_PITCH = 3, OFF_PITCH = 1;
/** W50 layers: Layers › Terrain (app/layers.js), "on" or "off": off, no tint, no steep ground and no 3D. W192 mapfix3 (SPEC §337): off
 *  by default in Plain, on in SCUL (app/keys.js), a stored choice kept. */
export const LAYER = "starchart.layer.terrain";
/** W160 smallui (SPEC §287, her note 19: "Battery saver should disable terrain, which is likely to crash the app on older phones"):
 *  Battery saver (starchart.smooth "30") holds the hills off, flat and untinted; the rider's own Terrain choice stays stored and
 *  comes back when it goes off. The Layers tile says why (app/layers.js). */
export const SAVER = "starchart.smooth", SAVER_OFF = "Off while Battery saver is on.";
/** W229 climbs: the word modes whose layer is Climbs (her design) in place of Terrain's tint and steep ground. SCUL keeps Terrain until
 *  arclight rules (W229, ruling 1); adding "scul" here takes Climbs there too: the layer, Battery saver's rule (terrainShown, the Layers
 *  tile's app/layers.js held) and the tile's picture (<html data-climbs>, app/layers.css); its colours are hers unless tokens.json's
 *  climbs gets a ramp of the mode's own (climbs.scul.dark and .light: the proposal's sheet has two), and the tile keeps SCUL's name and its
 *  long press (app/index.html's data-more, which says Terrain's tint and steep ground: that switch wants SCUL words for Climbs too). */
export const CLIMBS_IN = ["meatspace"];
export const climbsIn = (words) => CLIMBS_IN.includes(words); // W229 climbs
/** W229 climbs: <html data-climbs> while the mode's layer is Climbs, so the Layers tile shows her picture (app/layers.css), from the first frame and live. */
const markClimbs = () => globalThis.document?.documentElement?.toggleAttribute?.("data-climbs", climbsIn(lingo())); // W229 climbs
markClimbs(); globalThis.addEventListener?.("starchart:settings", (e) => { if (e.detail?.key === WORDS) markClimbs(); }); // W229 climbs
/** W229 climbs (her point 7): Settings › Power › 3D terrain, under Battery saver (app/keys.js): on by default; off, the hills never rise. */
export const D3 = "starchart.hills3d";
/** W160 smallui; W229 climbs: is the layer drawn? Not if she turned it off; and with Terrain (SCUL) not under Battery saver, while Climbs
 *  shows whatever Battery saver says (her point 6: it is flat, and costs no more than another fill). */
export const terrainShown = (choice, smooth, words = "scul") => choice !== "off" && (climbsIn(words) || smooth !== "30");
/** W229 climbs (rulings 5 and 6): the hills rise only with the layer drawn, 3D terrain on, Battery saver off and a tilt past ON_PITCH
 *  (or, risen, OFF_PITCH: want3d). `shown` is terrainShown's answer, `on` whether they are risen now. */
export const hillsRise = ({ shown, d3, smooth, pitch, on = false }) => !!shown && d3 !== "off" && smooth !== "30" && want3d(pitch, on);
/** W229 climbs: the 3D terrain switch's look, { checked, disabled, line }, for its stored choice `d3`, Battery saver `smooth`, the
 *  layer's choice and the word mode. Under Battery saver it shows off and can't be set, saying why (her words); her choice is kept and
 *  shows again when Battery saver goes. With the layer off it is hers to set, but can't act: its line says what it needs. */
export const D3_WORDS = { line: ["Makes hills rise when you tilt the chart.", "Makes hills rise when you tilt the map."], // [SCUL, Plain]
  needs: ["Needs Terrain in Layers.", "Needs Climbs in Layers."] }; // W229 climbs: the layer's name, as its tile says it; one line at 320 px ("Needs Climbs on in Layers." was two)
export function d3Row({ d3, smooth, choice, words }) {
  const plain = words !== "scul" ? 1 : 0;
  if (smooth === "30") return { checked: false, disabled: true, line: SAVER_OFF };
  return { checked: d3 !== "off", disabled: false, line: choice === "off" ? D3_WORDS.needs[plain] : D3_WORDS.line[plain] };
}
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
export function mountTerrain({ map, data, at, tokens, protocol, after = Promise.resolve(), theme = () => globalThis.starchartTheme?.current ?? { theme: "dark" }, pinned = () => false, seen = () => Promise.resolve(), words = lingo }) { // W26: pinned, the camera following the ship; W102 trim: seen, once the chart is uncovered; W229 climbs: words, the word mode
  const kind = (k) => data.files.find((f) => f.kind === k); // W229 climbs
  const dem = kind("dem"), slope = kind("slope"), climbs = kind("climbs"), climbdir = kind("climbdir"); // W229 climbs: climbdir, the chevrons' (W229 chevrons), is stored here, read there
  const state = { on3d: false, ready: false, switches: 0, shown: true, climbs: false }; // W229 climbs: climbs, whether Climbs is drawn
  const now = { [LAYER]: get(LAYER), [SAVER]: get(SAVER), [D3]: get(D3) }; // W160 smallui: the choice and Battery saver, as the events tell them; W191 appleft (SPEC §334): through the registry, with its defaults (storage off too); W229 climbs: and 3D terrain
  state.shown = terrainShown(now[LAYER], now[SAVER], words()); // W50 layers; W160 smallui: and not under Battery saver; W229 climbs: but Climbs
  if (!dem) return state;
  const url = (e) => at(e.path);

  /** Read a hills file from the phone. W76 privacy (SPEC §132): only from the phone, never by Range from the network, which
   *  would tell the host where the rider is: true once a checked copy is stored (the manifest's, else an older one, as the chart's). */
  const checked = new Map(); // W230 detailrace (SPEC §484): an entry -> the File its store checked this visit
  async function readStored(e) {
    const file = checked.get(e) ?? (canStore() ? (await storedTiles(e).catch(() => null))?.file : null); // W230 detailrace: the store's own file, with no second lookup that can miss
    if (file) protocol.add(new pmtiles.PMTiles(new StoredSource(file, url(e)))); // W76 privacy: an older stored copy too
    return !!file; // W76 privacy
  }

  // W229 climbs: each file read once, when its layer is first wanted (Plain never reads the slope, SCUL never the climbs), its source added
  const has = {}, reading = {}; // kind: true once its source is in
  const sources = (e) => e.kind === "dem" ? terrainSources({ dem: url(e) }) : e.kind === "slope" ? { "terrain-slope": terrainSources({ dem: url(dem), slope: url(e) })["terrain-slope"] } : { [CLIMB_SOURCE]: climbsSource(url(e)) };
  const need = (e) => !e ? Promise.resolve(false) : has[e.kind] ? Promise.resolve(true) : (reading[e.kind] ??= readStored(e).then((ok) => { // W229 climbs
    delete reading[e.kind];
    if (!ok) return false;
    // SRTM and 3DEP are public domain: their credits are in About's credits, so the chart's credit stays as short as before
    for (const [id, { attribution, ...src }] of Object.entries(sources(e))) map.addSource(id, src);
    return (has[e.kind] = true);
  }));
  const plainLook = () => climbsIn(words()); // W229 climbs
  let shown = "", moved = false; // the ids drawn now, to tell a repaint from a new set of layers; W229 climbs: whether the buildings are under Climbs
  function draw() {
    const t = theme().theme === "light" ? "light" : "dark", ramp = tokens.climbs?.[words()]?.[t] ?? tokens.climbs?.[t]; // W229 climbs: a mode's own ramp (climbs.<mode>.<theme>) if it has one, else hers
    const want = plainLook() ? (has.climbs && ramp ? climbsLayers(ramp) : []) : has.slope || !slope ? hillLayers(tokens, theme(), { slope: !!slope }) : []; // W229 climbs: Climbs, once stored; SCUL's as before
    const ids = want.map(([l]) => l.id).join();
    if (ids === shown) { // the same layers: only the paint (a theme switch)
      for (const [l] of want) for (const k in l.paint) map.setPaintProperty(l.id, k, l.paint[k]);
    } else {
      for (const id of [...TERRAIN_LAYER_IDS, ...CLIMB_LAYER_IDS]) if (map.getLayer(id)) map.removeLayer(id); // W229 climbs: and Climbs
      for (const [l, before] of want) map.addLayer(l, map.getLayer(before) ? before : undefined);
      shown = ids;
    }
    for (const id of [...TERRAIN_LAYER_IDS, ...CLIMB_LAYER_IDS]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.shown ? "visible" : "none"); // W50 layers
    state.climbs = !!map.getLayer("climbs") && state.shown; // W229 climbs
    // W229 climbs (her point 4): under Climbs the buildings go under the shading, as the parks are; with it gone, back where the style has them
    // (over the water, under the towns' glow and SCUL's tint, which goes in just before the glow): moved back only if they were moved
    if (state.climbs !== moved) {
      const to = state.climbs ? "climbs" : [...TERRAIN_LAYER_IDS, "system-area"].find((id) => map.getLayer(id));
      for (const id of CLIMBS_OVER) if (map.getLayer(id) && to) map.moveLayer(id, to);
      moved = state.climbs;
    }
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
    const pitch = map.getPitch(), on = hillsRise({ shown: state.shown, d3: now[D3], smooth: now[SAVER], pitch, on: state.on3d }); // W28 settings: always; W50 layers: unless Layers › Terrain is off; W229 climbs: and 3D terrain on, Battery saver off (rulings 5, 6)
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
    if (mounting || state.ready) return; // W229 climbs: once
    mounting = true;
    // W76 privacy; W229 climbs: the DEM (3D), and the mode's own file: Climbs' (none stored yet: no shading, the hills still rise), or SCUL's slope as before
    if (!(await need(dem)) || (!plainLook() && !(await need(slope)) && slope)) { mounting = false; return; }
    if (plainLook()) await need(climbs);
    draw();
    tilt();
    map.on("pitch", tilt);
    map.on("render", () => { if (state.on3d) ease(); }); // W20 terrain3d: the easing, while it runs
    map.on("moveend", () => { if (state.on3d) local(); }); // W26 relief: the view has moved: the ground there
    map.on("sourcedata", loaded);
    addEventListener("starchart:theme", draw);
    state.ready = true;
    mounting = false; // W229 climbs
  };
  after.then(mount).catch((err) => console.error("hills:", err)); // W76 privacy: mount

  // Stored with the tiles: once the chart is on the phone, the hills follow. W26: at every offline-ready, so Settings'
  // Download now retries one that failed; what is stored and current is skipped, and never two runs at once.
  let storing = false;
  addEventListener("starchart:offline-ready", async () => {
    if (storing) return;
    storing = true;
    try {
      for (const e of [dem, slope, climbs, climbdir]) { // W229 climbs: and Climbs' field and direction
        if (!e) continue;
        try {
          const st = await storedTiles(e);
          if (!st || !st.current) { prune([e.sha256, st?.state.sha256].filter(Boolean), e.kind); const file = await store(url(e), e); if (file) checked.set(e, file); } // W230 detailrace: file, the one its worker checked
          else prune([e.sha256], e.kind);
        } catch (err) { console.warn(`storing the ${e.kind}:`, err.message); }
      }
    } finally { storing = false; }
    after.then(seen).then(() => (state.ready ? need(plainLook() ? climbs : slope).then(draw) : mount())).catch((err) => console.error("hills:", err)); // W76 privacy: stored now, so they draw; W102 trim: once the chart is seen, never under an opaque Settings (SPEC §202); W229 climbs: a file stored after the mount draws too
  });

  // W50 layers: Layers › Terrain, at once
  addEventListener("starchart:settings", async (e) => {
    if (![LAYER, SAVER, WORDS, D3].includes(e.detail?.key)) return; // W160 smallui: and Battery saver; W192 mapfix3: and Words; W229 climbs: and 3D terrain
    if (e.detail.key === WORDS) now[LAYER] = get(LAYER); // W192 mapfix3: a rider who never chose has the new mode's default
    else now[e.detail.key] = e.detail.value;
    state.shown = terrainShown(now[LAYER], now[SAVER], words()); // W160 smallui; W229 climbs: by the mode
    if (!state.ready) return;
    if (e.detail.key === WORDS) await need(plainLook() ? climbs : slope); // W229 climbs: the new mode's own file, read once
    draw(); tilt();
  });

  /** The ground's height at [lon, lat] in metres, exaggeration in, or 0 while the chart is flat. */
  state.height = (lonlat) => (map.getTerrain() ? map.queryTerrainElevation(lonlat) || 0 : 0);
  return state;
}
