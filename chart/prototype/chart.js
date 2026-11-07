// Load the Saturnight style into MapLibre GL JS, with PMTiles and runtime lingo modes.
import * as maplibregl from "../vendor/maplibre-gl.mjs";
import { tileHandler, MISSING } from "./tiles.js";

maplibregl.setWorkerUrl(new URL("../vendor/maplibre-gl-worker.mjs", import.meta.url).href);
export const protocol = new pmtiles.Protocol({ errorOnMissingTile: true }); // exported so the app can add a stored tile file (app/main.js)
maplibregl.addProtocol("pmtiles", tileHandler(protocol)); // W21 tiles: past the archive's detail, its parents (tiles.js)

const STALE_TILE = "Should not be trying to reload a tile that was never loaded or has been removed"; // W107 fixes: MapLibre's worker's words

export const STYLE_URL = new URL("../style/saturnight.json", import.meta.url).href;

/** Fetch the style and make its root-relative URLs absolute for this page. */
export async function loadStyle(url = STYLE_URL) {
  const style = await (await fetch(url)).json();
  const abs = (u) => new URL(u, location.origin).href;
  style.sprite = spriteUrl(abs(style.sprite)); // W111 sprite3x
  style.glyphs = location.origin + style.glyphs;
  const src = style.sources.chart;
  src.url = "pmtiles://" + abs(src.url.replace("pmtiles://", ""));
  const ne = style.sources["new-england"]; // W51 edge
  if (ne) ne.data = abs(ne.data); // W51 edge
  if (style.sources.tlines) style.sources.tlines.data = abs(style.sources.tlines.data); // W144 tlines
  return style;
}

/** Switch every label layer between "scul", "cadet" and "meatspace". */
export function setLingoMode(map, mode) {
  for (const layer of map.getStyle().layers) {
    const lingo = layer.metadata && layer.metadata["starchart:lingo"];
    if (lingo && lingo[mode]) map.setLayoutProperty(layer.id, "text-field", lingo[mode]);
    const spacing = layer.metadata && layer.metadata["starchart:letter-spacing"];
    if (spacing && spacing[mode] !== undefined) map.setLayoutProperty(layer.id, "text-letter-spacing", spacing[mode]);
  }
}

/**
 * The map's pixel ratio (W50 crisp): the device's own, so the map's text is as sharp as the page's. A ratio of 2 on a
 * 2.625x or 3x screen left the browser to stretch the map's image 1.3-1.5x, and the labels' edges went soft. With
 * `saver` (the app's Battery saver), 2 at most, as before (motion-3: 3 costs more frame time than 2).
 */
export function mapPixelRatio(saver = false) {
  const device = devicePixelRatio || 1;
  return saver ? Math.min(2, device) : device;
}

/**
 * W111 sprite3x (SPEC §228): the style's sprite for a screen of `ratio`. MapLibre asks for `<sprite>@2x` at any ratio above
 * 1, so above 2.5 (2.625x and 3x phones) the sprite points at sprites/3x/, whose @2x sheet is drawn at 3x and says
 * pixelRatio 3: the icons draw 1:1 instead of stretched 1.31-1.5x (chart/style/build_sprite.py). With Data Saver on, it keeps
 * the precached 2x sheet, so the 3x one (441-448 KB) is never fetched.
 */
export function spriteUrl(url, ratio = devicePixelRatio || 1, saveData = navigator.connection?.saveData === true) {
  return ratio > 2.5 && !saveData ? url.replace("/sprites/", "/sprites/3x/") : url;
}

/**
 * Make the chart's map. opts: center, zoom, bearing, pitch, mode, pixelRatio (mapPixelRatio()'s by default), and
 * either styleUrl or style (a style object that is ready to use, as the app loads it). W47 firstload: opts.until "style"
 * resolves once the style is in, not at MapLibre's load, which waits for every first tile too (a tile request that hung
 * held the app's start).
 * W76 start (SPEC §137): MapLibre checks the style against the spec only where a bad edit would show, in a browser driven
 * by a test (navigator.webdriver), on the dev channel and with ?validate=1: the start's longest task is 30-50 ms shorter without it at CPU x4 (bench box), and the
 * shipped styles pass it (tools/ci/validate.mjs, and every e2e test).
 */
export async function makeMap(container, opts = {}) {
  const style = opts.style || (await loadStyle(opts.styleUrl));
  const validateStyle = navigator.webdriver || new URLSearchParams(location.search).get("validate") === "1" || document.querySelector('meta[name="starchart-channel"]')?.content === "dev"; // W76 start
  const map = new maplibregl.Map({
    container,
    style,
    center: opts.center || style.center,
    zoom: opts.zoom ?? style.zoom,
    bearing: opts.bearing || 0,
    pitch: opts.pitch || 0,
    attributionControl: false,
    maxZoom: 19.5,
    minZoom: 6, // W51 edge: Massachusetts, from Natural Earth (chart/style/build_new_england.py), past the data
    // No symbol fades: each one is a burst of frames that MapLibre draws on its own, outside the
    // frame governor, all ride long. Labels place at once instead (motion-1).
    fadeDuration: 0,
    pixelRatio: opts.pixelRatio ?? mapPixelRatio(), // W50 crisp: the device's (motion-3 capped it at 2)
    validateStyle, // W76 start
  });
  map.on("error", (e) => {
    // W21 tiles: a tile the archive lacks is expected past its detail. MapLibre draws the nearest parent
    // and asks for the next one up when it next updates its tiles, so ask for that update now (tiles.js).
    // _update is MapLibre's own (private): nothing public updates the tiles without moving the camera.
    if (e.tile && e.error?.message === MISSING) { map._update(); return; }
    // W107 fixes: now and then, as the camera reframes twice in quick succession (a preview closed, the next one planned),
    // MapLibre asks its worker to parse again a tile the worker has already dropped, and the tile stays blank, "errored".
    // Load it afresh, as a new tile loads (no actor: "LT", not "RT"). _reloadTile and tileManagers are MapLibre's own (private).
    if (e.tile && e.error?.message === STALE_TILE) { e.tile.actor = null; map.style?.tileManagers?.[e.sourceId]?._reloadTile(e.tile.tileID.key, "loading"); return; }
    console.error("map error:", e.error && (e.error.message || e.error));
  });
  window.__map = map;
  // Not compact: the compact control hides the OpenStreetMap credit after the first drag (prototype-6).
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
  if (opts.until !== "style") await new Promise((r) => map.once("load", r));
  else if (!map.style?._loaded) await new Promise((r) => map.once("style.load", r)); // W47 firstload; _loaded is MapLibre's own (private): it may be in already
  if (opts.mode && opts.mode !== "scul") setLingoMode(map, opts.mode);
  warmCircles(map);
  return map;
}

/**
 * W43 z17: MapLibre compiles a shader program the first time it draws with it, and the main thread waits for the link.
 * The style's one circle layer past z16, spot-dot, is hidden until z17 by its opacity, and MapLibre skips a layer drawn at
 * opacity 0, so the jump to z17 compiled the circle program: 200-370 ms of the main thread on SwiftShader at 8 vCPUs,
 * against 60 ms for the whole jump in 0.1.12. A point drawn at radius 0 (nothing to see) in the first frames compiles that
 * program at load, among the others. Its paint is all constant, as spot-dot's, so it is the same program. It goes two
 * frames after its tile is in, not at the first idle, which a moving ship may hold off for long.
 */
function warmCircles(map) {
  const c = map.getCenter();
  map.addSource("warm-circle", { type: "geojson", data: { type: "Point", coordinates: [c.lng, c.lat] } });
  map.addLayer({ id: "warm-circle", type: "circle", source: "warm-circle", paint: { "circle-radius": 0 } });
  let drawn = 0;
  const done = () => {
    if (!map.isSourceLoaded("warm-circle") || ++drawn < 2) return;
    map.off("render", done);
    map.removeLayer("warm-circle");
    map.removeSource("warm-circle");
  };
  map.on("render", done);
}

export { maplibregl };
