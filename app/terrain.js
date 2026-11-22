// Hills on the chart (wave 19, design/app-ui/SPEC.md §19): the elevation tint and the steep ground under the
// roads and labels, and 3D terrain at ×6 while the chart is tilted.
//
// W28 settings (SPEC §38): one look for everyone, with no setting. The tint that colours the ground by its height
// stays; the grey hillshade went (a tester: "a grayish, foggy thing", "I think the shading could be taken out").
// 3D always stands up when the chart is tilted.
//
// The layers are chart/terrain/style.js's, in the theme's token colours; a theme switch repaints them. The
// data are the manifest's "dem" PMTiles (W231 sculclimbs: and Climbs' two; the "slope" went): read from the phone once stored and checked (OPFS,
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
// kept Terrain as it was until W231 (ruling 1, arclight's to change).
// W231 sculclimbs (SPEC §486), arclight 2026-11-14: "the climbs is I think a strict improvement over the older terrain mode, we should do
// that in SCUL mode too". One look in both word modes, coloured by the mode's tokens (design/tokens.json climbs: hers in Plain, SCUL's
// own ramp in SCUL): CLIMBS_IN, the tint by height, the steep ground and the slope file went; Battery saver holds off the raised hills alone.
// W234 layers3d (SPEC §495), pancake's row 6 of 2026-11-14: "3D terrain and climbs should be independent settings". The hills rise with
// Settings › Power › 3D terrain whether Climbs is drawn or not (hillsRise); the switch is on by default in SCUL and off in Plain, and
// splitHills, once, keeps everyone's tilt as it was at the update.
import { terrainSources, terrainSpec, climbsLayers, climbsSource, CLIMB_LAYER_IDS, CLIMB_SOURCE, CLIMBS_OVER, CLIMBS_UNDER } from "../chart/terrain/style.js"; // W229 climbs; W229 chevrons: CLIMBS_UNDER; W231 sculclimbs: no tint, no steep ground
import { keepLayer } from "../chart/prototype/gl-layer.js"; // W229 chevrons: back after a lost WebGL context, in its place
import { canStore, prune, store, storedTiles, StoredSource } from "./offline.js";
import { metres as metresBetween } from "./geo.js"; // W26 relief
import { metresPerPixel } from "../chart/prototype/follow.js"; // W26 relief
import { get } from "./settings.js"; // W191 appleft (SPEC §334)
import { KEY as WORDS, lingo } from "./lingo-mode.js"; // W192 mapfix3: the word mode, whose default Terrain follows; W229 climbs: lingo; W231 sculclimbs: whose ramp Climbs takes

export const EXAGGERATION = 6, ON_PITCH = 3, OFF_PITCH = 1;
/** W50 layers: Layers › Terrain (app/layers.js), "on" or "off": off, no tint, no steep ground and no 3D. W192 mapfix3 (SPEC §337): off
 *  by default in Plain, on in SCUL (app/keys.js), a stored choice kept. W231 sculclimbs: the key of Climbs in both modes (G-wells in SCUL).
 *  W234 layers3d (SPEC §495): the shading alone; the raised hills are 3D terrain's (D3). */
export const LAYER = "starchart.layer.terrain";
/** W160 smallui (SPEC §287, her note 19: "Battery saver should disable terrain, which is likely to crash the app on older phones"):
 *  Battery saver (starchart.smooth "30") holds the hills off, flat and untinted; the rider's own Terrain choice stays stored and
 *  comes back when it goes off. The Layers tile says why (app/layers.js). W229 climbs, W231 sculclimbs: it holds off the raised hills
 *  alone (3D terrain's row says so, SAVER_OFF); Climbs shows whatever it says, in both modes. */
export const SAVER = "starchart.smooth", SAVER_OFF = "Off while Battery saver is on.";
/** W229 climbs (her point 7): Settings › Power › 3D terrain, under Battery saver (app/keys.js): on by default; off, the hills never rise.
 *  W234 layers3d (SPEC §495, her row 6): it alone raises them, whatever the layer says; on by default in SCUL and off in Plain, as the layer. */
export const D3 = "starchart.hills3d";
/** W160 smallui; W229 climbs: is the layer drawn? Not if she turned it off. W231 sculclimbs: Climbs, in both modes, shows whatever
 *  Battery saver says (her point 6: it is flat, and costs no more than another fill). */
export const terrainShown = (choice) => choice !== "off";
/** W229 climbs (ruling 6): the hills rise with 3D terrain on, Battery saver off and a tilt past ON_PITCH (or, risen, OFF_PITCH: want3d);
 *  `on` is whether they are risen now. W234 layers3d (SPEC §495, her row 6: "3D terrain and climbs should be independent settings"): whatever
 *  the layer says (ruling 5, the layer drawn, went). */
export const hillsRise = ({ d3, smooth, pitch, on = false }) => d3 !== "off" && smooth !== "30" && want3d(pitch, on);
/** W229 climbs: the 3D terrain switch's look, { checked, disabled, line }, for its stored choice `d3`, Battery saver `smooth` and the
 *  word mode. Under Battery saver it shows off and can't be set, saying why (her words); her choice is kept and shows again when
 *  Battery saver goes. W234 layers3d: the layer no longer matters to it, so no line says what it needs. */
export const D3_WORDS = { line: ["Makes hills rise when you tilt the chart.", "Makes hills rise when you tilt the map."] }; // [SCUL, Plain]
export function d3Row({ d3, smooth, words }) {
  if (smooth === "30") return { checked: false, disabled: true, line: SAVER_OFF };
  return { checked: d3 !== "off", disabled: false, line: D3_WORDS.line[words !== "scul" ? 1 : 0] };
}
/** W234 layers3d (SPEC §495): set once, when 3D terrain has been given the layer's stored choice (app/keys.js). */
export const SPLIT = "starchart.hills3d.split";
/**
 * W234 layers3d (SPEC §495, UX 98: "a new one starts as things were"): nobody's tilt changes at the update. Until now the hills rose
 * only with the layer on, and 3D terrain was on unless she had turned it off; now 3D terrain alone raises them, on by default in SCUL
 * and off in Plain (the layer's defaults). So, once: a rider who never set 3D terrain and has a choice of the layer stored gets that
 * choice for 3D terrain (on, her hills still rise; off, her tilt stays flat, in either mode); with no layer stored, each mode's default
 * is the layer's, as before; a 3D terrain she set is hers. Battery saver changes nothing here: it still holds the hills flat. SPLIT says
 * it ran, so a layer she sets later is the layer's alone. Run as this module loads (below), before Settings' row or the hills read it.
 */
export function splitHills(s = globalThis.localStorage) {
  try {
    if (!s || s.getItem(SPLIT) != null) return;
    const layer = s.getItem(LAYER), d3 = s.getItem(D3);
    if (d3 !== "on" && d3 !== "off" && (layer === "on" || layer === "off")) s.setItem(D3, layer);
    s.setItem(SPLIT, "1");
  } catch { /* storage off: nothing stored to keep */ }
}
splitHills();
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
/** Should 3D terrain be on at this pitch, given whether it is on now? */
export const want3d = (pitch, on) => (on ? pitch > OFF_PITCH : pitch >= ON_PITCH);

/**
 * Add the hills to the map once `after` resolves (the chart's first frame). `protocol` is the PMTiles
 * protocol the chart reads through (chart/prototype/chart.js). Returns the debug handle.
 */
export function mountTerrain({ map, data, at, tokens, protocol, after = Promise.resolve(), theme = () => globalThis.starchartTheme?.current ?? { theme: "dark" }, pinned = () => false, seen = () => Promise.resolve(), words = lingo }) { // W26: pinned, the camera following the ship; W102 trim: seen, once the chart is uncovered; W229 climbs: words, the word mode
  const kind = (k) => data.files.find((f) => f.kind === k); // W229 climbs
  const dem = kind("dem"), climbs = kind("climbs"), climbdir = kind("climbdir"); // W229 climbs: climbdir, the chevrons' (W229 chevrons), is stored here, read there; W231 sculclimbs: no slope
  const state = { on3d: false, ready: false, switches: 0, shown: true, climbs: false }; // W229 climbs: climbs, whether Climbs is drawn
  const now = { [LAYER]: get(LAYER), [SAVER]: get(SAVER), [D3]: get(D3) }; // W160 smallui: the choice and Battery saver, as the events tell them; W191 appleft (SPEC §334): through the registry, with its defaults (storage off too); W229 climbs: and 3D terrain
  state.shown = terrainShown(now[LAYER]); // W50 layers; W160 smallui: and not under Battery saver; W229 climbs, W231 sculclimbs: Climbs whatever it says
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

  // W229 climbs: each file read once, when its layer is first wanted, its source added
  const has = {}, reading = {}; // kind: true once its source is in
  const sources = (e) => e.kind === "dem" ? terrainSources({ dem: url(e) }) : { [CLIMB_SOURCE]: climbsSource(url(e)) }; // W231 sculclimbs: no slope
  const need = (e) => !e ? Promise.resolve(false) : has[e.kind] ? Promise.resolve(true) : (reading[e.kind] ??= readStored(e).then((ok) => { // W229 climbs
    delete reading[e.kind];
    if (!ok) return false;
    // SRTM and 3DEP are public domain: their credits are in About's credits, so the chart's credit stays as short as before
    for (const [id, { attribution, ...src }] of Object.entries(sources(e))) map.addSource(id, src);
    return (has[e.kind] = true);
  }));
  let shown = "", moved = false; // the ids drawn now, to tell a repaint from a new set of layers; W229 climbs: whether the buildings are under Climbs
  function draw() {
    const t = theme().theme === "light" ? "light" : "dark", ramp = tokens.climbs?.[words()]?.[t] ?? tokens.climbs?.[t]; // W229 climbs: a mode's own ramp (climbs.<mode>.<theme>) if it has one, else hers; W231 sculclimbs: SCUL's
    const want = has.climbs && ramp ? climbsLayers(ramp) : []; // W229 climbs: Climbs, once stored; W231 sculclimbs: in both modes
    const ids = want.map(([l]) => l.id).join();
    if (ids === shown) { // the same layers: only the paint (a theme switch)
      for (const [l] of want) for (const k in l.paint) map.setPaintProperty(l.id, k, l.paint[k]);
    } else {
      for (const id of CLIMB_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id); // W229 climbs; W231 sculclimbs: no tint, no steep ground
      for (const [l, before] of want) map.addLayer(l, map.getLayer(before) ? before : undefined);
      shown = ids;
    }
    for (const id of CLIMB_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.shown ? "visible" : "none"); // W50 layers
    state.climbs = !!map.getLayer("climbs") && state.shown; // W229 climbs
    if (ramp) chev.inks = [ramp["gentle-ink"], ramp["medium-ink"], ramp["steep-ink"]]; // W229 chevrons: the theme's, a new array only here
    // W229 climbs (her point 4): under Climbs the buildings go under the shading, as the parks are; with it gone, back where the style has them
    // (over the water, under the towns' glow): moved back only if they were moved
    if (state.climbs !== moved) {
      const to = state.climbs ? "climbs" : "system-area"; // W231 sculclimbs: no SCUL tint to go under
      for (const id of CLIMBS_OVER) if (map.getLayer(id) && map.getLayer(to)) map.moveLayer(id, to);
      moved = state.climbs;
    }
    chevrons(); // W229 chevrons
    map.triggerRepaint();
  }

  // W229 chevrons (SPEC §483), her points 5 and 8: Climbs' uphill chevrons, app/chevrons.js, its module loaded the first time Climbs is drawn
  // and its layer in the style only while Climbs is, just over it. Hidden (visibility none) once raised hills have faded them out, so
  // MapLibre's draped layers aren't split round a custom layer that draws nothing. Their field: Climbs' stored file (its PMTiles, which
  // the protocol already has) and the stored direction file; until both are stored, the layer draws nothing.
  const chev = state.chevrons = { layer: null, loading: null, mod: null, inks: null, asking: false };
  const openStored = async (e) => { const st = e && canStore() ? await storedTiles(e).catch(() => null) : null; return st ? new pmtiles.PMTiles(new StoredSource(st.file, url(e))) : null; }; // W76 privacy: only stored
  const chevField = async () => { const grade = has.climbs ? protocol.get?.(url(climbs)) : null, dir = grade ? await openStored(climbdir) : null; return grade && dir ? { grade, dir } : null; };
  function chevrons() {
    const L = chev.layer;
    if (!state.climbs) { if (L && map.getLayer(L.id)) map.removeLayer(L.id); return; }
    if (!L) {
      chev.loading ??= Promise.all([import("./chevrons.js"), chevField()]).then(([mod, field]) => {
        chev.mod = mod; chev.layer = new mod.ClimbChevrons({ field, inks: () => chev.inks, hills: state }); chevrons();
      }).catch((err) => { chev.loading = null; console.error("chevrons:", err); });
      return;
    }
    if (!L.field && !chev.asking) { chev.asking = true; chevField().then((f) => { chev.asking = false; if (f) L.setField(f); }); } // stored since
    if (!map.getLayer(L.id)) keepLayer(map, L, CLIMBS_UNDER);
    chevShown();
  }
  /** Shown, unless raised hills have faded them out (app/chevrons-logic.js riseOpacity); read at each frame while the hills are up. */
  function chevShown() {
    const L = chev.layer;
    if (!L || !map.getLayer(L.id)) return;
    const v = state.on3d && chev.mod.riseOpacity(true, map.terrain?.exaggeration ?? 0) <= 0 ? "none" : "visible";
    if (map.getLayoutProperty(L.id, "visibility") !== v) map.setLayoutProperty(L.id, "visibility", v);
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
    const pitch = map.getPitch(), on = hillsRise({ d3: now[D3], smooth: now[SAVER], pitch, on: state.on3d }); // W28 settings: always; W50 layers: unless Layers › Terrain is off; W229 climbs: and 3D terrain on, Battery saver off (rulings 5, 6); W234 layers3d: 3D terrain alone, whatever the layer
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
      chevShown(); // W229 chevrons: back on a flat map
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
    // W76 privacy; W229 climbs: the DEM (3D), and Climbs' (none stored yet: no shading, the hills still rise); W231 sculclimbs: in both modes
    if (!(await need(dem))) { mounting = false; return; }
    await need(climbs);
    draw();
    tilt();
    map.on("pitch", tilt);
    map.on("render", () => { if (state.on3d) { ease(); chevShown(); } }); // W20 terrain3d: the easing, while it runs; W229 chevrons: and the chevrons' fade
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
      prune([], "slope"); // W231 sculclimbs: the steep ground's file, which nothing reads now, goes from the phone as an old chart's does
      for (const e of [dem, climbs, climbdir]) { // W229 climbs: and Climbs' field and direction
        if (!e) continue;
        try {
          const st = await storedTiles(e);
          if (!st || !st.current) { prune([e.sha256, st?.state.sha256].filter(Boolean), e.kind); const file = await store(url(e), e); if (file) checked.set(e, file); } // W230 detailrace: file, the one its worker checked
          else prune([e.sha256], e.kind);
        } catch (err) { console.warn(`storing the ${e.kind}:`, err.message); }
      }
    } finally { storing = false; }
    after.then(seen).then(() => (state.ready ? need(climbs).then(draw) : mount())).catch((err) => console.error("hills:", err)); // W76 privacy: stored now, so they draw; W102 trim: once the chart is seen, never under an opaque Settings (SPEC §202); W229 climbs: a file stored after the mount draws too
  });

  // W50 layers: Layers › Terrain, at once
  addEventListener("starchart:settings", async (e) => {
    if (![LAYER, SAVER, WORDS, D3].includes(e.detail?.key)) return; // W160 smallui: and Battery saver; W192 mapfix3: and Words; W229 climbs: and 3D terrain
    if (e.detail.key === WORDS) { now[LAYER] = get(LAYER); now[D3] = get(D3); } // W192 mapfix3: a rider who never chose has the new mode's default; W234 layers3d: 3D terrain's too
    else now[e.detail.key] = e.detail.value;
    state.shown = terrainShown(now[LAYER]); // W160 smallui; W229 climbs, W231 sculclimbs: whatever Battery saver says
    if (!state.ready) return;
    draw(); tilt(); // W231 sculclimbs: a Words switch repaints Climbs in the mode's ramp
  });

  /** The ground's height at [lon, lat] in metres, exaggeration in, or 0 while the chart is flat. */
  state.height = (lonlat) => (map.getTerrain() ? map.queryTerrainElevation(lonlat) || 0 : 0);
  return state;
}
