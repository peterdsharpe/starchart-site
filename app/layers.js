// W50 layers (design/app-ui/SPEC.md §62): the Layers button and its card, as in Google Maps. arclight, 2026-10-19: "a
// layers button kind of like Google Maps has where you can toggle on and off different layers ... if we have comets be
// toggleable that means that we can actually slightly increase their visibility".
// W55 layers2 (SPEC §71), arclight, 2026-10-19: "join the layers for "comets" and "comet trails" ... use Google maps'
// toggle-boxes where the boxes illustrate what shows". Each layer is a square tile, a picture drawn in code
// (app/index.html, coloured in app/layers.css) with its one-word name, a toggle button outlined in --course when on; a
// long press tells more. Kept in localStorage through app/settings.js (set() dispatches "starchart:settings"):
//   Comets    starchart.comets (W29's key) and starchart.layer.tlines (W50's): the live trains and the comet tracks
//             (the comet-trail layers) together. Either key off from before, it starts off, and writes both.
//             app/comets.js hears its key; off, it asks the MBTA nothing (W173 uismall: but a tapped station's next trains, once, SPEC §302)
//   Terrain   starchart.layer.terrain: app/terrain.js hears the event; off, no tint, no steep ground and no 3D
//   Places    starchart.layer.places: the named spots up close, the spot-* layers; W94 bizicons: and the paid stops (the pink
//             icons: shops, food and drink, banks), so it hides every place one pays at; the free stops (blue) and parking stay
//   Lanes     starchart.layer.lanes (W59 routes): the streets' bike lanes, sharrows and protected lanes, in cyan by their
//             comfort (W23); off, the streets are plain starpaths. W88 paths: and the wormholes, plain footpath lines when off
//   Weather   starchart.layer.weather (W52 weather, SPEC §66), off by default: app/weather.js hears the event; off, it asks IEM nothing
// W122 homerow (SPEC §230): no Anchorages tile (the racks show by themselves from z16, app/anchorages.js) and no Systems tile
// (the towns' glow is SCUL's decoration, never Plain's, app/main.js PLAIN_HIDES); their stored keys are ignored. // W122 homerow
//   Flying    starchart.layer.quality (W90 comfort, SPEC §184), off by default: every road in its comfort's colour of the comfort // W90 comfort
//             scale, a thin line over the roads and bike lanes, under the course (app/comfort-along.js bikeQualityLayer) // W90 comfort
// The card drops from the button at the top right, small, over the chart, under the turn card. W92 panels (SPEC §188): it
// opens whole, over the ship if it must (his note: "the layers panel should always open in full and not be scrollable"). A tap on the button or a tile never moves the camera. Its ×, a tap outside it, Escape and Android's back gesture close it.
import { get, set } from "./settings.js";
import { longPress } from "./press.js"; import { tip } from "./tip.js"; // W55 layers2: a tile's long press tells more
import { pick, onLingo } from "./lingo-mode.js"; // W60 c
import { bikeQualityLayer, bikeQualityEdge, EDGE_INK } from "./comfort-along.js"; // W90 comfort; W156 qualitysteps: Daystar's edge
import { SAVER, SAVER_OFF } from "./terrain.js"; // W160 smallui: Battery saver holds Terrain off

/** W88 mapfix (SPEC §178): the cycle tracks beside the streets, drawn as wormholes in layers of their own (chart/style/build_style.py), go with the bike lanes. */
export const TRACKS = ["cycle-track-edge", "cycle-track"]; // W160 mapclean: no glow and no core; Daystar's ink edge
/** W88 paths (SPEC §181): the paths' bright drawing and their cyan names go too; their flow follows "wormhole" (chart/prototype/gl-layer.js). */
export const WORMS = ["wormhole-edge", "wormhole", "wormhole-label"]; // W88 paths; W160 mapclean: no glow and no core; Daystar's ink edge
/** The tiles: the button's id, its keys (on when all are), and the style layers it hides itself (the comets and the hills do their own); W88 paths: and `plain`, the ones it shows when off. */
export const LAYERS = [
  { id: "layer-comets", keys: ["starchart.comets", "starchart.layer.tlines"], layers: ["comet-trail-ties", "comet-trail", "comet-trail-tunnel-ties", "comet-trail-tunnel", "comet-line-label", "deep", "comet-station-label"], plain: ["comet-station-landmark"] }, // W173 mapstyle2: the ties; W124 mapbits: comet-casing (W144 tlines: none now); W55 layers2: the trains and their tracks, one layer; W70 deep: and their tunnels at depth (app/deep.js); W91 icons: and the stations, off an ordinary landmark from z16; W95 cometlook: and the lines' names
  { id: "layer-terrain", keys: ["starchart.layer.terrain"], saver: true }, // W160 smallui (SPEC §287): off under Battery saver, the choice kept (app/terrain.js)
  { id: "layer-places", keys: ["starchart.layer.places"], layers: ["spot-dot", "spot-label", "spot-hull-label", "spot-biz", "stop-label-pink"] }, // W94 bizicons: spot-biz, stop-label-pink
  { id: "layer-weather", keys: ["starchart.layer.weather"] }, // W52 weather: off by default (its key's default); app/weather.js hears the event
  { id: "layer-lanes", keys: ["starchart.layer.lanes"], layers: ["shared-starpath", "laned-starpath", "shielded-starpath-thin-edge", "shielded-starpath-thin", "shielded-starpath", ...TRACKS, ...WORMS, "two-way-bikes"], plain: ["wormhole-plain", "wormhole-label-plain"] }, // W160 mapclean: no glow, the thin lines' edge; W111 tiles16: two-way-bikes, the two-way mark; W59 routes: the streets' cyan (W23 comfort's shading); its tile is the card's first (app/index.html); W88 mapfix: TRACKS; W88 paths: WORMS, and off, the paths plain
  { id: "layer-quality", keys: ["starchart.layer.quality"], layers: ["bike-quality", "bike-quality-edge"] }, // W90 comfort; W156 qualitysteps: and Daystar's edge: off by default (its key's default); after Lanes in the card (app/index.html)
];
/** W59 routes: the words this lane added, for W60's plain versions; the Lanes tile's name (for his veto) and its long press. */
export const WORDS = { lanes: ["Lanes", "Bike lanes"], // W86 map: Plain names what they are (her note: "add a layer for it", for the light blue lines)
  lanesMore: ["Bike lanes, sharrows and wormholes, brighter where the flying is better. Off, wormholes stay as thin lines.", // W59 routes; W88 paths; W140 words
  "Bike lanes, sharrows and bike paths, brighter where the riding is better. Off, bike paths stay as thin lines."], // W60 c: [SCUL, Plain]; W88 paths: the paths go plain with the lanes
  placesMore: ["The pink places you pay at (Lunas, Fuel Depots, Steering Dampeners) and the grey dots up close. Space Docks, free stops and Derby Arenas always show.", // W94 bizicons; W140 words
  "The pink places you pay at (shops, cafés, bars) and the grey dots up close. Bike shops, free places and parking always show."], // W94 bizicons: [SCUL, Plain], the Places tile's long press
  // W160 quality2 (SPEC §283): her note, "Find a name for the bikeability layer that indicates that it shows less bikeable roads": Plain's
  // names what it draws (the Level of Traffic Stress the room factor follows); SCUL's is the peek's word for those levels, "Rough flying"
  // W173 quality3 (SPEC §306): her note, 2026-10-27: 'show these five colors in the "stressful roads" layer, but call it something more positive,
  // like "bike friendly roads"'. SCUL's twin is his own word for the score, "ship-friendliness" (2026-10-17)
  quality: ["Ship-friendly starpaths", "Bike-friendly roads"], // W90 comfort: the Bike quality layer's name, [SCUL, Plain]; W160 quality2: was "Flying", "Ride quality"; W173 quality3: was "Rough flying", "Stressful streets"
  qualityMore: ["Lanes and wormholes in blue; other starpaths from green, the calmest, through yellow and orange to red, the roughest, as on your course.", // W90 comfort; W140 words: the app's spelling; W156 qualitysteps: the steps; W173 quality3: the continuum
    "Bike lanes and paths in blue; other streets from green, the quietest, through yellow and orange to red, the worst, as on your route."], // W90 comfort; W156 qualitysteps (was "from rough to smooth"); W173 quality3: the continuum (W160 quality2: two steps, no blue)
  // W140 dircomfort (SPEC §254; arclight: an info button on the tile, "technical is fine"): what the score reads (chart/SCHEMA.md
  // Comfort; a course by its direction, chart/routing/README.md), and what it doesn't
  qualityWhy: ["What makes a starpath ship-friendly:\n· a wormhole, protected lane or lane, each way; sharrows count as none\n· transport speed, lanes, width and parking\n· calm starpaths\n· grade: uphill is worse; on your course, downhill is easier on smaller starpaths\n· surface, potholes (Boston 311) and lighting\nSpace walks stay plain. High-crash crossings aren't in it: they're called ahead.", // W140 dircomfort; W160 quality2: its name, and the footpaths
    "What makes a road bike friendly:\n· a bike path, protected lane or lane, each way; sharrows count as none\n· traffic speed, lanes, width and parking\n· quiet roads\n· grade: uphill is worse; on your route, downhill is easier on smaller streets\n· surface, potholes (Boston 311) and lighting\nFootpaths stay plain. High-crash crossings aren't in it: they're called ahead."] }; // W140 dircomfort: [SCUL, Plain]; W160 quality2: its name, and the footpaths; W173 quality3: its new name, the factors that make it
export const isOn = (key) => get(key) !== "off";
/** W55 layers2: a tile is on when all its keys are. */
export const rowOn = (row) => row.keys.every(isOn);
/** W160 smallui: a tile Battery saver holds off (Terrain), whatever its stored choice. */
export const held = (row) => !!row.saver && get(SAVER) === "30";

/** W173 mapstyle2 (SPEC §303), her note: "in route preview please hide other layers (such as bike lanes) because they make the preview route
 *  itself harder to see". The tiles a preview hushes (app/course.js previewLook): their layers step aside and their tiles show off, the
 *  stored choice kept; a tap on one there shows it (her choice wins), and the preview's end gives every tile back its own. */
let quiet = new Set(), redraw = () => {}; // W173 mapstyle2
export const hushed = (row) => quiet.has(row.id); // W173 mapstyle2
export function hush(map, ids) { // W173 mapstyle2: ids, the tiles' ids to hush, [] for none
  const was = quiet;
  quiet = new Set(ids);
  for (const row of LAYERS) if (was.has(row.id) !== quiet.has(row.id)) showLayers(map, row.keys[0]);
  redraw();
}

/** Show or hide the style layers of the tile that `key` belongs to, on `map`, as the tile says. */
export function showLayers(map, key) {
  const row = LAYERS.find((l) => l.keys.includes(key));
  const v = row && rowOn(row) && !hushed(row) ? "visible" : "none"; // W173 mapstyle2: hushed
  const flip = v === "none" ? "visible" : "none"; // W88 paths
  for (const [id, w] of [...(row?.layers ?? []).map((id) => [id, v]), ...(row?.plain ?? []).map((id) => [id, flip])]) if (map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== w) map.setLayoutProperty(id, "visibility", w); // W88 paths: plain
  const trains = row?.id === "layer-comets" && hushed(row) ? "none" : "visible"; // W173 mapstyle2: the live trains (app/comets.js, its own switch) step aside with their tracks
  if (row?.id === "layer-comets" && map.getLayer("comets") && map.getLayoutProperty("comets", "visibility") !== trains) map.setLayoutProperty("comets", "visibility", trains); // W173 mapstyle2
}

/** W55 layers2: a tile with one of its keys off from before (W50's two switches) is off: write the rest off too, so the
 *  comets stop asking the MBTA when only the tracks were off. */
export function joinKeys() {
  for (const row of LAYERS) if (!rowOn(row)) for (const k of row.keys) if (isOn(k)) set(k, "off");
}

/** W55 layers2: a tap on a tile: all its keys on, or all off. */
export function toggle(row) {
  const v = rowOn(row) ? "off" : "on";
  for (const k of row.keys) set(k, v);
  return v === "on";
}

export function mountLayers({ map, $ = (id) => document.getElementById(id) }) { // W92 panels: no ship: the card no longer shrinks above it
  const button = $("layers"), card = $("layerspick");
  joinKeys(); // W55 layers2
  const lanes = $("layer-lanes"), quality = $("layer-quality"); // W59 routes: its words from WORDS; W90 comfort: and the Flying tile's
  const lanesWords = () => { if (lanes) { lanes.lastElementChild.textContent = pick(WORDS.lanes); lanes.dataset.more = pick(WORDS.lanesMore); } // W59 routes; W60 c: pick
    if (quality) { quality.lastElementChild.textContent = pick(WORDS.quality); quality.dataset.more = pick(WORDS.qualityMore); } }; // W90 comfort
  const roads = map.getStyle().layers; // W149 qualitywidth: the roads' widths, the same in both themes
  if (!map.getLayer("bike-quality")) map.addLayer(bikeQualityLayer(roads), ["comet-trail-ties", "comet-trail", "edge-void"].find((id) => map.getLayer(id))); // W173 mapstyle2: under the ties too; // W90 comfort: over the roads and the bike lanes, under the edge, the labels and the course; W124 mapbits: and under the T's tracks, which draw over the streets (W144 tlines: no casing)
  if (!map.getLayer("bike-quality-edge")) map.addLayer(bikeQualityEdge(roads), "bike-quality"); // W156 qualitysteps: under the bike blue
  addEventListener("starchart:theme", () => { if (map.getLayer("bike-quality")) map.setPaintProperty("bike-quality", "line-color", bikeQualityLayer(roads).paint["line-color"]); }); // W121 viridis: the scale's colours are the theme's; W149 qualitywidth: roads
  addEventListener("starchart:theme", (ev) => { if (map.getLayer("bike-quality-edge")) map.setPaintProperty("bike-quality-edge", "line-color", EDGE_INK[ev.detail.theme === "light" ? "light" : "dark"]); }); // W156 qualitysteps; review: the colour, so a preview's fade of the opacity (app/course.js) holds
  lanesWords(); onLingo(lanesWords); // W60 c
  const places = $("layer-places"), placesWords = () => { if (places) places.dataset.more = pick(WORDS.placesMore); }; // W94 bizicons
  placesWords(); onLingo(placesWords); // W94 bizicons
  for (const row of LAYERS) showLayers(map, row.keys[0]);
  map.triggerRepaint();
  map.on("webglcontextrestored", () => map.once("idle", () => { for (const row of LAYERS) showLayers(map, row.keys[0]); map.triggerRepaint(); })); // W173 integration: keepLayer (chart/prototype/gl-layer.js) adds the live trains back visible at style.load, so a preview's hush holds
  const show = () => { for (const row of LAYERS) $(row.id)?.setAttribute("aria-pressed", String(rowOn(row) && !held(row) && !hushed(row))); }; // W55 layers2: tiles; W160 smallui: held off; W173 mapstyle2: hushed off
  redraw = show; // W173 mapstyle2
  const unhush = (row) => { quiet.delete(row.id); if (!rowOn(row)) toggle(row); else { showLayers(map, row.keys[0]); map.triggerRepaint(); show(); dispatchEvent(new CustomEvent("starchart:settings", { detail: { key: row.keys[0], value: get(row.keys[0]) } })); } }; // W173 mapstyle2: her choice wins; and its listeners hear it (main.js: the bike paths' flow), as a toggle's
  for (const row of LAYERS) { // W55 layers2: a tap toggles the tile; a long press says what it shows
    const tile = $(row.id);
    if (!tile) continue;
    tile.onclick = () => (held(row) ? tip(tile, SAVER_OFF) : hushed(row) ? unhush(row) : toggle(row)); // W160 smallui: no silent tap; the choice stays; W173 mapstyle2: a hushed tile shows its layer
    if (tile.dataset.more) longPress(tile, () => tip(tile, held(row) ? `${tile.dataset.more} ${SAVER_OFF}` : tile.dataset.more, { stay: true })); // W112 taps: an explanation, until a tap; W160 smallui: and why it's off
  }
  const why = $("layer-quality-info"); // W140 dircomfort
  if (why) why.onclick = () => tip(why, pick(WORDS.qualityWhy), { stay: true, look: "qramp" }); // W140 dircomfort: the factors, an explanation until a tap; W173 quality3: over the scale (app.css)
  show();
  addEventListener("starchart:settings", (e) => {
    if (e.detail?.key === SAVER) return show(); // W160 smallui: Battery saver holds Terrain off, or lets it be
    if (!LAYERS.some((l) => l.keys.includes(e.detail?.key))) return; // W55 layers2
    showLayers(map, e.detail.key); map.triggerRepaint(); show();
  });

  let watch = null;
  const close = () => {
    if (card.hidden) return;
    card.hidden = true;
    button.setAttribute("aria-expanded", "false");
    watch?.destroy(); watch = null;
  };
  const open = () => {
    show(); // comets.set() writes the key without the event
    card.hidden = false;
    button.setAttribute("aria-expanded", "true");
    card.querySelector(".x").focus({ preventScroll: true });
    if (window.CloseWatcher && !watch) { try { watch = new CloseWatcher(); watch.onclose = () => { watch = null; close(); }; } catch { /* one per user gesture */ } }
  };
  button.onclick = () => (card.hidden ? open() : close()); // the camera stays where it is
  card.querySelector(".x").onclick = () => { close(); button.focus({ preventScroll: true }); };
  addEventListener("pointerdown", (e) => { if (!card.hidden && !card.contains(e.target) && !button.contains(e.target) && !e.target.closest?.("#loctip")) close(); }, true); // W140 dircomfort: a tap on its explanation closes only that
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !card.hidden) { close(); button.focus({ preventScroll: true }); } });
  return { open, close, get shown() { return !card.hidden; } };
}
