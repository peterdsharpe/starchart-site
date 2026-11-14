// W113 settings2 (her note 16, SPEC §227): Settings › Developer › Icon legend: every image in the map's sprite, and every turn
// arrow, with its meaning in the current words, grouped. The pictures are the sprite's own (its JSON and PNG, the theme's), and
// the arrows design/glyphs/maneuver's (TURN_ARROWS, the manifest's list, which the build leaves out; app/tests/legend.test.mjs
// checks they match), so the legend can't drift from the map. Nothing loads until it opens.
import { pick, onLingo } from "./lingo-mode.js";
import { moveWords, thenWords } from "../chart/prototype/course.js"; // W222 legendavatar: thenWords, the two-turn pictures
import { PLAIN_ICON, PLAIN_HIDES, glyphIn } from "../chart/prototype/banners.js"; // W135 plainicons: the one table of Plain's twins; W166 icons4: PLAIN_HIDES; W219 sculgreen: glyphIn, SCUL's turn pictures
import { markImage } from "./starred.js"; // W171 icons5: the favourites' mark
import { KINDS } from "../chart/lingo/kinds.js"; // W191 dataleft: the kinds' groups
import { winterIcon } from "./stops-logic.js"; // W209 water3
import { rowGlyphs } from "./map-pics.js"; // W222 legendavatar: the pictures a search row can wear

/** The groups, in order: [id, SCUL, Plain]. */
export const GROUPS = [["riding", "Flying", "Riding"], ["stops", "Stops", "Stops"], ["pay", "Places you pay at", "Places you pay at"],
  ["free", "Free places", "Free places"], ["transit", "Transit", "Transit"], ["hazards", "Hazards", "Hazards"], ["turns", "Turns", "Turns"]];

const LINES = { red: "Red Line", mattapan: "Mattapan Line", orange: "Orange Line", blue: "Blue Line", green: "Green Line" };

/** W197 stationlines (SPEC §350): the words of a station's picture for each set of lines it can carry (design/glyphs/build.py
 *  station_name: its lines' keys, sorted), its lines in the picture's order, the MBTA's: "Station on the Orange and Green Lines and the
 *  Commuter Rail". Every set, so a picture the glyphs add has its words with no list here (W153 tstations, W171 stations2: six pairs). */
function stationMeanings() {
  const keys = [...Object.keys(LINES), "commuter_rail"], out = {};
  const sets = keys.reduce((all, k) => [...all, ...all.map((s) => [...s, k])], [[]]).filter((s) => s.length).sort((a, b) => a.length - b.length);
  for (const ks of sets) {
    const t = ks.filter((k) => LINES[k]).map((k) => LINES[k]), cr = ks.includes("commuter_rail");
    const ts = t.length < 2 ? t.map((l) => `the ${l}`) : [`the ${t.slice(0, -1).map((l) => l.replace(" Line", "")).join(", ")} and ${t.at(-1)}s`];
    const on = [...ts, ...(cr ? ["the Commuter Rail"] : [])].join(" and ");
    out[`comet_station_${[...ks].sort().join("_")}`] = ["transit", `Comet station on ${on}`, t.length ? `Station on ${on}` : "Commuter Rail station"];
  }
  return out;
}

/** Every sprite image's meaning: name → [group, SCUL, Plain]. app/tests/legend.test.mjs checks each sprite's names are here. W191 dataleft
 *  (SPEC §335): a kind's row has its words only, and its group is chart/kinds.json's (the style's pink is its pay group). */
export const MEANINGS = Object.fromEntries(Object.entries({
  launchpad: ["riding", "Launchpad: where a course starts", "Start of a route"],
  waypoint: ["riding", "Waypoint: a stop on the course; in search, a street, address, park or other place", "Stop on the route"], // W222 legendavatar: what a search row wears with no picture of its own; W225 kindwords: bare
  // W196 logsettings2 (SPEC §348): "with SCUL mode off" and "(in SCUL mode)", Settings' switch (was "with Words on Plain" and "on SCUL")
  route_start: ["riding", "Route start: a launchpad, with SCUL mode off", "Start of a route"], // W135 plainicons: from here, Plain's twins (PAIRS)
  pin: ["riding", "Pin: a waypoint, with SCUL mode off", "Stop on the route; in search, a street, address, park or other place"], // W222 legendavatar; W225 kindwords: bare
  home: ["riding", "Home: a space station, with SCUL mode off", "Your home"], // W219 favs3 (SPEC §425): as before W216 (no row: nothing on the map wears it)
  shop: ["pay", "Shop: a Luna, with SCUL mode off", "Shop"],
  police: ["free", "Police station: an ST outpost, with SCUL mode off", "Police station"],
  hospital: ["free", "Hospital: a meat repair facility, with SCUL mode off", "Hospital"],
  bus_stop: ["transit", "Bus stop: a sandworm nest, with SCUL mode off", "Bus stop"],
  bluebikes_dock: ["transit", "Bluebikes station: a Klingon dock, with SCUL mode off", "Bluebikes station"], // W215 icons5: her Bluebikes sign
  obstacle: ["hazards", "Obstacle: space junk, with SCUL mode off", "Obstacle"],
  rain: ["hazards", "Rain: radiation, with SCUL mode off", "Rain"], // W135 plainicons
  landing_pad: ["riding", "Landing pad: the course's end", "End of a route"],
  shield_wormhole: ["riding", "Wormhole: a bike path or footbridge", "Bike path or footbridge"], // W222 legendavatar: a search row's (the map draws no shield since W166 icons4; was "a bike path's name"); W225 kindwords: bare
  shield_byway: ["riding", "Hyperspace byway: a bridge", "Bridge"], // W222 legendavatar: a search row's (was "a bridge's name"); W225 kindwords: bare
  shield_system: ["riding", "System: a town's name", "Town name"], // W225 kindwords (SPEC §472): Plain's rows a label each, no article (was "A town's name")
  system_nebula: ["riding", "System nebula: a town's glow", "Town glow"], // W225 kindwords: was "A town's glow"
  system: ["System: a town or neighborhood", "Town or neighborhood"], // W171 icons5: in search and the town's pill (was shield_system); W225 kindwords: bare
  constellation: ["Constellation: a square", "Square, as in Davis Square"], // W225 kindwords (SPEC §472): a kind named bare (was "A …"); the words read: "Square" alone beside a round icon read as a shape
  nebula: ["riding", "Nebula: a river, lake or pond", "River, lake or pond"], // W222 legendavatar: beside the chart's other places; what a river's or a lake's search row wears (chart/kinds.json); nothing in the app draws it for fog (was ["hazards", "Nebula: fog", "Fog"]); W225 kindwords: bare
  two_way: ["riding", "Two-way: ships fly both ways on this one-way street", "Bikes may ride both ways on this one-way street"], // W118 peekfix: tiles16's mark (SPEC §221), met by settings2's legend
  oneway: ["riding", "One-way starpath: the way the traffic flies", "One-way street: the way traffic goes"], // W120 data16: the arrows along one-way streets (SPEC §229)
  g_well_posi: ["riding", "Posi g-well: downhill", "Downhill"],
  g_well_negi: ["riding", "Negi g-well: uphill", "Uphill"],
  posi_g_well: ["riding", "Posi g-well: downhill (the first drawing)", "Downhill (the first drawing)"],
  negi_g_well: ["riding", "Negi g-well: uphill (the first drawing)", "Uphill (the first drawing)"],
  daystar: ["riding", "Daystar: the sun, at sunrise and sunset", "The sun, at sunrise and sunset"],
  space_station: ["Space station: your home", "Your home"], // W219 favs3: as before W216 (no row: app/starred.js draws no house for a favourite named Home)
  "starred-mark": ["riding", "Starred place: a favorite place", "Favorite place"], // W171 icons5 (FAV): app/starred.js's mark, not the sprite's
  fort: ["Fort: the club's base", "The club's base"], // W222 legendavatar: a search row's in Plain too (was "… (in SCUL mode)")
  lore: ["Lore: a SCUL landmark", "SCUL landmark"], // W222 legendavatar: as the Fort; W225 kindwords: bare
  starfield: ["riding", "Starfield: the stars behind the chart", "Stars behind the map (in SCUL mode)"],
  pulsar: ["Pulsar: a traffic light", "Traffic light"],
  stop: ["Stop sign", "Stop sign"],
  stop_all: ["stops", "All-way stop", "All-way stop"], // W177 mapmarks2
  black_hole: ["Black hole: a rotary", "Rotary (in SCUL mode)"],
  rotary: ["stops", "Rotary: a black hole, with SCUL mode off", "Rotary"],
  traffic_light: ["stops", "Traffic light: a pulsar, with SCUL mode off", "Traffic light"], // W124 mapbits
  luna: ["Luna: a shop", "Shop"],
  refueling_station: ["Refueling station: a convenience store", "Convenience store"],
  fuel_depot: ["Fuel depot: a café", "Café"],
  grenade_depot: ["Grenade depot: a donut shop", "Donut shop"],
  steering_dampener: ["Steering dampener: a bar or pub", "Bar or pub"],
  restaurant: ["pay", "Luna: a place to eat", "Place to eat"], // W157 icons3: every place to eat, and Plain's donut shop
  grocery: ["pay", "Luna: a grocery or convenience store", "Grocery or convenience store"], // W157 icons3: and Plain's convenience store
  pharmacy: ["pay", "Luna: a pharmacy", "Pharmacy"],
  bank: ["pay", "Luna: a bank", "Bank"],
  space_dock: ["Space dock: a bike shop", "Bike shop"],
  coolant: ["Coolant: drinking water", "Drinking water"],
  coolant_winter: ["free", "Coolant: drinking water outdoors, usually off for the winter", "Drinking water outdoors, usually off for the winter"], // W209 water3: the snowflake, from November to April
  plasma: ["Plasma: an air pump", "Air pump"],
  gantry: ["Gantry: a bike repair stand", "Bike repair stand"],
  rack: ["free", "Anchorage: a bike rack", "Bike rack"],
  rack_alt: ["free", "Anchorage: a bike rack (the other drawing)", "Bike rack (the other drawing)"],
  anchorage: ["Anchorage: bike parking", "Bike parking"],
  anchorage_covered: ["free", "Covered anchorage: covered bike parking", "Covered bike parking"],
  derby_arena: ["Derby arena: a big parking lot", "Big parking lot"],
  tardis: ["Tardis: a public toilet", "Public toilet"],
  temple_of_knowledge: ["Temple of knowledge: a library", "Library"],
  shore_leave: ["Shore leave: a playground", "Playground"],
  st_outpost: ["ST outpost: a police station", "Police station"],
  meat_repair: ["Meat repair facility: a hospital", "Hospital"],
  urgent_care: ["Meat repair clinic: urgent care", "Urgent care"], // W196 mapstyle4 (her row 11)
  hamburger_helper: ["Hamburger helper: a first-aid kit", "First-aid kit"],
  aed: ["AED: a defibrillator", "AED: a defibrillator"],
  comet_station: ["Comet station: a train or subway station", "Train or subway station"],
  ...stationMeanings(), // W197 stationlines (SPEC §350): every station picture's (was the six pairs of design/glyphs/build.py STATION_LINES, copied)
  sandworm_nest: ["Sandworm nest: a bus stop", "Bus stop"],
  klingon_dock: ["Klingon dock: a Bluebikes station", "Bluebikes station"], // W157 icons3: beside the bus stop, in its format (was a place you pay at)
  buoy_field: ["Buoy field: cones or construction", "Cones or construction"],
  crossing: ["hazards", "High-crash crossing: a record of bike crashes", "High-crash crossing"], // W128 crashes, met by the sprite at the W139 merge
  space_junk: ["hazards", "Space junk: an obstacle", "Obstacle"],
  asteroids: ["Asteroids: potholes, grates or manhole covers", "Potholes, grates or manhole covers"],
  meteorites: ["hazards", "Meteorites: broken glass", "Broken glass"],
  space_dust: ["Space dust: gravel or sand", "Gravel or sand"],
  radiation: ["hazards", "Radiation: rain", "Rain"],
  heavy_radiation: ["hazards", "Heavy radiation: snow or hail", "Snow or hail"],
}).map(([name, m]) => [name, m.length === 2 ? [KINDS[name].group, ...m] : m])); // W191 dataleft

/** W124 mapbits (SPEC §231), her note: "if an icon differs between the SCUL view and the non-SCUL view you should show both": SCUL's
 *  picture → Plain's, one row with both, each under its mode's name, the current mode's first, in that mode's words. */
export const PAIRS = PLAIN_ICON; // W135 plainicons (SPEC §248): every SCUL picture with a Plain twin (was the pulsar's and the black hole's)
/** W166 icons4 (SPEC §292), her note: "If any icons are no longer used by the map, please remove them from the legend." The legend
 *  lists what the map draws in the mode, read from the style (every layer's icon-image and pattern, a kind's own picture by the
 *  layer's filter, Plain's twins and hidden layers as app/main.js swaps them), so it can't drift from it; and the sprite's images
 *  the app draws itself (APP_ICONS). It replaces W157's SCUL_TOO: a twin SCUL's map draws on its own has its own row there. */
/** W171 icons5 (SPEC §296), her note: "Why is there no favorites icon in the legend?": the favourites' star, which app/starred.js
 *  draws (markImage, by theme), has a row in every mode, though the sprite hasn't it. */
export const FAV = "starred-mark";
/** W173 quality3 (SPEC §306): the Bike-friendly roads layer's scale, a row of its own under Flying/Riding: the blue, then green to red. */
export const QRAMP = "bike-quality", QRAMP_WORDS = ["Ship-friendly starpaths: blue lanes, then green to red, calm to rough", "Bike-friendly roads: blue bike lanes, then green to red, quiet to bad"]; // W173 quality3: [SCUL, Plain]
/** W196 mapstyle4 (SPEC §345), her row 10 of 10-31: "If any icons displays different in dark vs light mode, please note that in the legend." The
 *  sprite's images whose colours differ by theme (Dark's sheet against Daystar's, 20 ΔE or more at the middle of their drawn pixels, halos
 *  aside; chart/style/test_build_style.py measures it): the racks, the chart's and sky's badges, the route's pins. The places' fills are one
 *  hue's two shades (11 to 16 ΔE), so they have no note. Their row says it, the other theme by its name in Settings › Theme. */
export const BY_THEME = ["anchorage", "anchorage_covered", "black_hole", "constellation", "crossing", "derby_arena", "fort", "g_well_negi", "g_well_posi", "heavy_radiation", "home", // W228 icons6: derby_arena, the parking sign, by night the racks' look (design/glyphs/build.py RACK_SIGNS)
  "landing_pad", "launchpad", "lore", "nebula", "pin", "rack", "rack_alt", "radiation", "rain", "route_start", "shield_byway", "shield_system", "shield_wormhole",
  "space_station", "system", "two_way", "waypoint"];
const OTHER_THEME = { dark: ["Daystar", "Light"], light: ["Dark", "Dark"] }; // W196 mapstyle4: the other theme's name in Settings › Theme, [SCUL, Plain]
export const APP_ICONS = ["rack", "waypoint"]; // W166 icons4: app/anchorages.js's racks; app/course.js's dropped pin, the waypoint's (Plain's pin)
const PAINTS = ["icon-image", "fill-pattern", "line-pattern", "background-pattern", "fill-extrusion-pattern"]; // W166 icons4
const odd = (a, from = 1) => a.filter((_, i) => i >= from && i % 2 === 1); // W166 icons4
/** W166 icons4: the images an expression `e` can give, a ["get", "kind"] each of `kinds`. */
function outputs(e, kinds) {
  if (typeof e === "string") return [e];
  if (!Array.isArray(e)) return [];
  const [op, ...a] = e;
  if (op === "get") return a[0] === "kind" ? kinds : [];
  if (op === "literal") return typeof a[0] === "string" ? [a[0]] : [];
  const m = a.slice(1), byKind = op === "match" && kinds.length && a[0]?.[0] === "get" && a[0][1] === "kind"; // a kind's branch only if the filter lets that kind through
  const outs = op === "match" ? [...odd(m).filter((_, i) => !byKind || [m[2 * i]].flat().some((k) => kinds.includes(k))), a.at(-1)] : op === "case" ? [...odd(a.slice(0, -1)), a.at(-1)] : op === "step" ? odd(a) : a; // match: input, label, output … fallback; case: test, output … fallback; step: input, output, stop, output …
  return outs.flatMap((x) => outputs(x, kinds));
}
/** W166 icons4: the kinds a layer's filter lets through (its ["match", ["get", "kind"], …] → true and ["==", ["get", "kind"], …]);
 *  in an "all", those every part lets through, less those a ["!", …] part names; [] when it names none. */
function kindsIn(f) {
  if (!Array.isArray(f)) return [];
  const [op, ...a] = f, isKind = (x) => Array.isArray(x) && x[0] === "get" && x[1] === "kind";
  if (op === "match" && isKind(a[0])) return a.slice(1, -1).flatMap((x, i, b) => (i % 2 === 0 && b[i + 1] === true ? [x].flat() : [])).filter((x) => typeof x === "string");
  if (op === "==" && isKind(a[0])) return typeof a[1] === "string" ? [a[1]] : [];
  if (op === "!") return []; // an exclusion names no kind it lets through
  if (op !== "all") return a.flatMap(kindsIn);
  const drop = a.filter((x) => Array.isArray(x) && x[0] === "!").flatMap((x) => kindsIn(x[1]));
  const keep = a.map(kindsIn).filter((k) => k.length).reduce((s, k) => (s ? s.filter((n) => k.includes(n)) : k), null);
  return (keep ?? []).filter((n) => !drop.includes(n));
}
/** W166 icons4: the images the map draws in `mode`, by `style` (the theme's style JSON, as loaded) and the app's own. */
export function drawnIcons(style, mode, d = new Date()) { // W209 water3: d, the month
  const plain = mode === "meatspace", out = new Set(APP_ICONS);
  for (const L of style?.layers ?? []) {
    if (plain && PLAIN_HIDES.includes(L.id)) continue;
    for (const k of PAINTS) { const e = L.layout?.[k] ?? L.paint?.[k]; if (e != null) for (const n of outputs(e, kindsIn(L.filter))) out.add(n); }
    if (L.metadata?.["starchart:winter-icon"]) for (const n of outputs(winterIcon(L, d), kindsIn(L.filter))) out.add(n); // W209 water3 (SPEC §384): the icon the map's copy wears in `d`'s month (main.js), the snowflake from November to April
  }
  return plain ? new Set([...out].map((n) => PLAIN_ICON[n] ?? n)) : out;
}
const MODE_NAMES = { scul: "SCUL", meatspace: "Plain" }; // the Words setting's own names (app/index.html)

/** A turn arrow's words, as the banner and the voice say its move (chart/prototype/course.js), by its file name. */
const TURNS = { straight: "straight", slight_right: "slight_right", right: "right", sharp_right: "sharp_right", slight_left: "slight_left",
  left: "left", sharp_left: "sharp_left", come_about: "u_turn", cross: "cross" }; // W212 walkcross: cross
/** design/glyphs/manifest.json's `maneuvers`, in its order (the site has no manifest). */
export const TURN_ARROWS = ["straight", "slight_right", "right", "sharp_right", "slight_left", "left", "sharp_left", "come_about",
  ...[1, 2, 3, 4, 5].map((n) => `black_hole_exit_${n}`), "merge_wormhole", "arrive", "cross", "off_course"]; // W212 walkcross: cross
/** W222 legendavatar (SPEC §438; the backlog's 0.1.104 leftover): design/glyphs/manifest.json's `pairs`, the 16 two-turn pictures (W217 turnicons),
 *  in its order: each of four turns, then each of the four. */
const PAIR_TURNS = ["slight_left", "left", "slight_right", "right"];
export const TURN_PAIRS = PAIR_TURNS.flatMap((a) => PAIR_TURNS.map((b) => `${a}_then_${b}`));
const OTHER_TURNS = { merge_wormhole: ["Onto a wormhole", "Onto a bike path"], arrive: ["Landing pad", "Arriving"], off_course: ["Off course", "Off route"] }; // 0.1.104's words read: Plain's as the card, the pill and the voice say it
/** W217 glyphs6 (SPEC §415): the turn pictures whose colours differ by theme (their file's <style>: the ink, the arrival's pin), whose rows say so as BY_THEME's do. */
export const TURNS_BY_THEME = ["arrive", "cross", "off_course"];
/** The words for a turn arrow `name` (a design/glyphs/maneuver file), in `mode` ("scul" or "meatspace"). */
export function turnMeaning(name, mode) {
  const exit = /^black_hole_exit_(\d)$/.exec(name);
  if (exit) return moveWords({ turn: "black_hole", exit: +exit[1] }, mode);
  if (TURNS[name]) return moveWords({ turn: TURNS[name] }, mode);
  const two = /^(.+)_then_(.+)$/.exec(name); // W222 legendavatar: a two-turn picture, as the card and the voice say it ("Keep left, then right")
  if (two && TURNS[two[1]] && TURNS[two[2]]) return `${moveWords({ turn: TURNS[two[1]] }, mode)}, then ${thenWords(TURNS[two[2]], mode)}`;
  return OTHER_TURNS[name]?.[mode === "meatspace" ? 1 : 0] ?? name.replace(/_/g, " ");
}
/** A sprite image's [group, words] in `mode`; one the table lacks goes under Flying with its name. */
export function meaning(name, mode) {
  const m = MEANINGS[name];
  return m ? [m[0], m[mode === "meatspace" ? 2 : 1]] : ["riding", name.replace(/_/g, " ")];
}

/** The legend's rows from the sprite's JSON (`sprite`, name → { x, y, width, height, pixelRatio }) and the turn arrows' names, in
 *  `mode`: [{ group, title, rows: [{ name, words, turn?, pair? }] }], the groups in GROUPS' order, the rows in MEANINGS' (a new image
 *  last). W124 mapbits: a PAIRS row is SCUL's name with `pair`, Plain's, and Plain's picture has no row of its own. W166 icons4: only
 *  the images `style`'s map draws in the mode (drawnIcons): a pair's row by its mode's picture; a twin SCUL draws on its own, its own row. */
export function legendRows(sprite, turns, mode, style, theme) { // W196 mapstyle4: theme ("dark" or "light"), for the rows that differ by it
  const by = new Map(GROUPS.map(([id]) => [id, []]));
  const paired = new Set(Object.entries(PAIRS).filter(([s, p]) => s in sprite && p in sprite).map(([, p]) => p)); // W124 mapbits
  const drawn = drawnIcons(style, mode), plain = mode === "meatspace"; // W166 icons4
  const seen = new Set([...drawn, ...[...rowGlyphs()].map((g) => glyphIn(g, plain))]); // W222 legendavatar (SPEC §438): and every picture a search row wears, Plain's twins in Plain (app/course.js glyphImg)
  const shown = (n) => (paired.has(n) ? !plain && seen.has(n) : seen.has(plain && paired.has(PAIRS[n]) ? PAIRS[n] : n)); // W166 icons4: was every image, less Plain's twins but SCUL_TOO; W222 legendavatar: seen
  const names = [...Object.keys(MEANINGS).filter((n) => n in sprite || n === FAV), ...Object.keys(sprite).filter((n) => !(n in MEANINGS))].filter((n) => n === FAV || shown(n)); // W171 icons5: FAV; W219 favs3: no HOME_PIC, nothing on the map wears the house // the table's order; W124 mapbits: less Plain's twins; W166 icons4: what the map draws
  const other = OTHER_THEME[theme]?.[plain ? 1 : 0], note = (n, list = BY_THEME) => (other && list.includes(n) ? ` · other colors in ${other}` : ""); // W196 mapstyle4; W217 glyphs6: list
  for (const name of names) { // W124 mapbits: pair, in its mode's words; W196 mapstyle4: note
    const pair = paired.has(PAIRS[name]) ? PAIRS[name] : undefined, pic = mode === "meatspace" && pair ? pair : name, [g, w] = meaning(pic, mode);
    const svg = !pair && name !== FAV && !drawn.has(pic), words = w + (svg ? "" : note(pic)); // W222 legendavatar: svg, a picture only a search row wears (its file, one in both themes: no note)
    by.get(g).push({ name, words, ...(pair && { pair }), ...(svg && { svg }) });
  }
  by.get("riding").unshift({ name: QRAMP, words: QRAMP_WORDS[plain ? 1 : 0], ramp: true }); // W173 quality3: first, the map's lines before its pictures
  const once = turns.length > 1 && turns.every((n) => note(n, plain ? TURNS_BY_THEME : turns)); // W222 legendavatar (the backlog's 0.1.107 leftover): SCUL's every turn twin differs by theme, so the title says it once
  for (const name of turns) by.get("turns").push({ name, words: turnMeaning(name, mode) + (once ? "" : note(name, plain ? TURNS_BY_THEME : turns)), turn: true }); // W217 glyphs6: note; W219 sculgreen: SCUL's twins are each the theme's green (design/glyphs/scul/maneuver); W222: once
  return GROUPS.map(([id, scul, plain]) => ({ group: id, title: (mode === "meatspace" ? plain : scul) + (id === "turns" && once ? note(turns[0], turns) : ""), rows: by.get(id) })).filter((g) => g.rows.length); // W222 legendavatar: once
}

const PX = 32; // each picture's box, CSS px
/**
 * Fill `fold` (a <details>) when it first opens: `sprite()` is the map's sprite URL now (without @2x or .json), `glyphs` the
 * base URL of design/glyphs/. Its words follow a change of Words; its pictures follow the theme's sprite at the next open.
 */
export function mountLegend({ fold, sprite, glyphs, style, mode = () => pick("scul", "meatspace") }) { // W166 icons4: style(), the style file's URL
  const list = fold.querySelector(".legend");
  let shown = null, data = null; // shown: the sprite URL drawn; data: { json, img, turns, map }
  async function load(url) {
    const [json, img, map] = await Promise.all([fetch(`${url}@2x.json`).then((r) => r.json()),
      new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = `${url}@2x.png`; }),
      fetch(style()).then((r) => r.json())]); // W166 icons4: the style, for what the map draws
    return { json, img, turns: [...TURN_ARROWS, ...TURN_PAIRS], map }; // W222 legendavatar: and the two-turn pictures
  }
  function picture(name, svg = false) { // W222 legendavatar (SPEC §438): svg, a picture only a search row wears, its file as the row draws it (app/course.js glyphImg)
    if (svg) return Object.assign(new Image(PX, PX), { src: new URL(`${glyphIn(name, mode() === "meatspace")}.svg`, glyphs).href, alt: "" });
    const s = data.json[name], pr = s.pixelRatio || 1, dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const w = Math.min(s.width, 160 * pr), h = Math.min(s.height, 160 * pr), k = PX / ((name.startsWith("comet_station") ? h : Math.max(w, h)) / pr); // a big pattern: a corner of it; W171 stations2: a T station's roundels side by side, each as big as one alone
    const c = Object.assign(document.createElement("canvas"), { width: Math.round((w / pr) * k * dpr), height: Math.round((h / pr) * k * dpr) });
    c.style.width = `${(w / pr) * k}px`; c.style.height = `${(h / pr) * k}px`;
    c.getContext("2d").drawImage(data.img, s.x, s.y, w, h, 0, 0, c.width, c.height);
    return c;
  }
  function favPicture() { // W171 icons5: the favourites' mark, as the map draws it now, in a sprite cell's box
    const im = markImage(), c = Object.assign(document.createElement("canvas"), { width: im.width, height: im.height });
    c.style.width = c.style.height = `${PX}px`; c.getContext("2d").putImageData(im, 0, 0);
    return c;
  }
  function render() {
    const m = mode(), out = [];
    for (const g of legendRows(data.json, data.turns, m, data.map, /-daystar$/.test(shown ?? "") ? "light" : "dark")) { // W166 icons4: data.map; W196 mapstyle4: the theme, by the sprite's sheet
      out.push(Object.assign(document.createElement("h4"), { textContent: g.title }));
      const ul = document.createElement("ul");
      for (const r of g.rows) {
        const li = document.createElement("li"), pic = r.turn ? Object.assign(new Image(PX, PX), { src: new URL(`${glyphIn(`maneuver/${r.name}`, m === "meatspace")}.svg`, glyphs).href /* W219 sculgreen: SCUL's twin */, alt: "" }) : r.ramp ? document.createElement("i") : r.name === FAV ? favPicture() : picture(r.name, r.svg); // W171 icons5: FAV; W173 quality3: the scale, by CSS; W222: r.svg
        li.dataset.name = r.name; pic.setAttribute("aria-hidden", "true"); pic.className = r.ramp ? "lg-i lg-ramp" : "lg-i"; // W173 quality3
        if (r.pair) { // W124 mapbits: both pictures, each under its mode's name, the current mode's first
          const two = [["scul", pic], ["meatspace", picture(r.pair)]].map(([k, p]) => { p.setAttribute("aria-hidden", "true"); p.className = "lg-i"; const f = document.createElement("figure"); f.className = "lg-f"; f.dataset.mode = k; f.append(p, Object.assign(document.createElement("small"), { textContent: MODE_NAMES[k] })); return f; });
          li.dataset.pair = r.pair; li.append(...(m === "meatspace" ? two.reverse() : two), Object.assign(document.createElement("span"), { textContent: r.words }));
        } else li.append(pic, Object.assign(document.createElement("span"), { textContent: r.words }));
        ul.append(li);
      }
      out.push(ul);
    }
    list.replaceChildren(...out);
  }
  fold.addEventListener("toggle", async () => {
    if (!fold.open) return;
    const url = sprite();
    if (!url || url === shown) return;
    try { data = await load(url); shown = url; render(); } catch (err) { console.warn("legend:", err.message); }
  });
  onLingo(() => { if (data) render(); });
}
