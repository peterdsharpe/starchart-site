// W50 layers (design/app-ui/SPEC.md §62): the Layers button and its card, as in Google Maps. arclight, 2026-10-19: "a
// layers button kind of like Google Maps has where you can toggle on and off different layers ... if we have comets be
// toggleable that means that we can actually slightly increase their visibility".
// W55 layers2 (SPEC §71), arclight, 2026-10-19: "join the layers for "comets" and "comet trails" ... use Google maps'
// toggle-boxes where the boxes illustrate what shows". Each layer is a square tile, a picture drawn in code
// (app/index.html, coloured in app/layers.css) with its one-word name, a toggle button outlined in --course when on; a
// long press tells more. Kept in localStorage through app/settings.js (set() dispatches "starchart:settings"):
//   Comets    starchart.comets (W29's key) and starchart.layer.tlines (W50's): the live trains and the comet tracks
//             (the comet-trail layers) together. Either key off from before, it starts off, and writes both.
//             app/comets.js hears its key; off, it asks the MBTA nothing
//   Terrain   starchart.layer.terrain: app/terrain.js hears the event; off, no tint, no steep ground and no 3D
//   Places    starchart.layer.places: the named spots up close, the spot-* layers; W94 bizicons: and the paid stops (the pink
//             icons: shops, food and drink, banks), so it hides every place one pays at; the free stops (blue) and parking stay
//   Lanes     starchart.layer.lanes (W59 routes): the streets' bike lanes, sharrows and protected lanes, in cyan by their
//             comfort (W23); off, the streets are plain starpaths. W88 paths: and the wormholes, plain footpath lines when off
//   Weather   starchart.layer.weather (W52 weather, SPEC §66), off by default: app/weather.js hears the event; off, it asks IEM nothing
//   Anchorages starchart.layer.anchorages (W56 parking, SPEC §73), off by default: every bike rack from z15 (app/anchorages.js) // W56 parking; W91 icons: z15
//   Systems   starchart.layer.systems (W56 parking): the towns' glow, the system-nebula layer // W56 parking
// The card drops from the button at the top right, small, over the chart, under the turn card. W92 panels (SPEC §188): it
// opens whole, over the ship if it must (his note: "the layers panel should always open in full and not be scrollable"). A tap on the button or a tile never moves the camera. Its ×, a tap outside it, Escape and Android's back gesture close it.
import { get, set } from "./settings.js";
import { longPress } from "./press.js"; import { tip } from "./tip.js"; // W55 layers2: a tile's long press tells more
import { pick, onLingo } from "./lingo-mode.js"; // W60 c

/** W88 mapfix (SPEC §178): the cycle tracks beside the streets, drawn as wormholes in layers of their own (chart/style/build_style.py), go with the bike lanes. */
export const TRACKS = ["cycle-track-glow", "cycle-track", "cycle-track-core", "cycle-track-core-dust"];
/** W88 paths (SPEC §181): the paths' bright drawing and their cyan names go too; their flow follows "wormhole" (chart/prototype/gl-layer.js). */
export const WORMS = ["wormhole-glow", "wormhole", "wormhole-core", "wormhole-core-dust", "wormhole-label"]; // W88 paths
/** The tiles: the button's id, its keys (on when all are), and the style layers it hides itself (the comets and the hills do their own); W88 paths: and `plain`, the ones it shows when off. */
export const LAYERS = [
  { id: "layer-comets", keys: ["starchart.comets", "starchart.layer.tlines"], layers: ["comet-trail", "comet-trail-tunnel", "comet-line-label", "deep", "comet-station-label"], plain: ["comet-station-landmark"] }, // W55 layers2: the trains and their tracks, one layer; W70 deep: and their tunnels at depth (app/deep.js); W91 icons: and the stations, off an ordinary landmark from z16; W95 cometlook: and the lines' names
  { id: "layer-terrain", keys: ["starchart.layer.terrain"] },
  { id: "layer-places", keys: ["starchart.layer.places"], layers: ["spot-dot", "spot-label", "spot-hull-label", "spot-biz", "stop-label-pink"] }, // W94 bizicons: spot-biz, stop-label-pink
  { id: "layer-weather", keys: ["starchart.layer.weather"] }, // W52 weather: off by default (its key's default); app/weather.js hears the event
  { id: "layer-anchorages", keys: ["starchart.layer.anchorages"], layers: ["anchorages"] }, // W56 parking: off by default; app/anchorages.js adds its layer
  { id: "layer-systems", keys: ["starchart.layer.systems"], layers: ["system-nebula"] }, // W56 parking: the towns' glow, on by default
  { id: "layer-lanes", keys: ["starchart.layer.lanes"], layers: ["shared-starpath", "laned-starpath", "shielded-starpath-glow", "shielded-starpath-thin", "shielded-starpath", ...TRACKS, ...WORMS], plain: ["wormhole-plain", "wormhole-label-plain"] }, // W59 routes: the streets' cyan (W23 comfort's shading); its tile is the card's first (app/index.html); W88 mapfix: TRACKS; W88 paths: WORMS, and off, the paths plain
];
/** W59 routes: the words this lane added, for W60's plain versions; the Lanes tile's name (for his veto) and its long press. */
export const WORDS = { lanes: ["Lanes", "Bike lanes"], // W86 map: Plain names what they are (her note: "add a layer for it", for the light blue lines)
  lanesMore: ["The bike lanes and sharrows on the starpaths, and the wormholes, brighter where the flying is better. Off, the wormholes stay as plain thin lines.", // W59 routes; W88 paths
  "The bike lanes and sharrows on the streets, and the bike paths, brighter where the riding is better. Off, the bike paths stay as plain thin lines."], // W60 c: [SCUL, Plain]; W88 paths: the paths go plain with the lanes
  placesMore: ["Lunas, Fuel Depots, Steering Dampeners and every pink place you pay at, and the other places' grey dots and names, up close. Space Docks, free stops (blue) and Derby Arenas stay.", // W94 bizicons
  "Shops, cafés, restaurants, bars and every pink place you pay at, and the other places' grey dots and names, up close. Bike shops, free things (blue) and parking stay."] }; // W94 bizicons: [SCUL, Plain], the Places tile's long press
export const isOn = (key) => get(key) !== "off";
/** W55 layers2: a tile is on when all its keys are. */
export const rowOn = (row) => row.keys.every(isOn);

/** Show or hide the style layers of the tile that `key` belongs to, on `map`, as the tile says. */
export function showLayers(map, key) {
  const row = LAYERS.find((l) => l.keys.includes(key));
  const v = row && rowOn(row) ? "visible" : "none";
  const flip = v === "none" ? "visible" : "none"; // W88 paths
  for (const [id, w] of [...(row?.layers ?? []).map((id) => [id, v]), ...(row?.plain ?? []).map((id) => [id, flip])]) if (map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== w) map.setLayoutProperty(id, "visibility", w); // W88 paths: plain
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
  const lanes = $("layer-lanes"); // W59 routes: its words from WORDS
  const lanesWords = () => { if (lanes) { lanes.lastElementChild.textContent = pick(WORDS.lanes); lanes.dataset.more = pick(WORDS.lanesMore); } }; // W59 routes; W60 c: pick
  lanesWords(); onLingo(lanesWords); // W60 c
  const places = $("layer-places"), placesWords = () => { if (places) places.dataset.more = pick(WORDS.placesMore); }; // W94 bizicons
  placesWords(); onLingo(placesWords); // W94 bizicons
  for (const row of LAYERS) showLayers(map, row.keys[0]);
  map.triggerRepaint();
  const show = () => { for (const row of LAYERS) $(row.id)?.setAttribute("aria-pressed", String(rowOn(row))); }; // W55 layers2: tiles
  for (const row of LAYERS) { // W55 layers2: a tap toggles the tile; a long press says what it shows
    const tile = $(row.id);
    if (!tile) continue;
    tile.onclick = () => toggle(row);
    if (tile.dataset.more) longPress(tile, () => tip(tile, tile.dataset.more, { ms: 5000 }));
  }
  show();
  addEventListener("starchart:settings", (e) => {
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
  addEventListener("pointerdown", (e) => { if (!card.hidden && !card.contains(e.target) && !button.contains(e.target)) close(); }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !card.hidden) { close(); button.focus({ preventScroll: true }); } });
  return { open, close, get shown() { return !card.hidden; } };
}
