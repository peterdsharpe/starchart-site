// W67 places (design/app-ui/SPEC.md §97): the starred places on the chart, and the list in this phone's storage.
//   - The marks: a small chalk five-pointed star (the chart's hue for your own marks, BRIEF §7.2) from z14, its name from z16,
//     under the street labels, which win a collision; the marks themselves never hide anything, nor give way.
//   - starred() and save(list): the list (app/starred-logic.js); a save tells the chart and the open picks
//     ("starchart:starred").
//   - W88 favorites (SPEC §176): mountStarredRow({ label, glyph }), Settings' list under Avoided streets, in #fav-fold.
import { KEY, readStarred, marks, unstar, samePlace, WORDS, STAR_D } from "./starred-logic.js"; // W88 favorites: unstar, samePlace, WORDS; W133 fivestar: STAR_D
import { placeName } from "./course-logic.js";
import { onLingo, pick } from "./lingo-mode.js"; // W88 favorites: pick
import { el } from "./dom.js"; // W152 app-rest J2
import { KINDS } from "../chart/lingo/kinds.js"; // W188 kindsone: the stations' zoom

export const SOURCE = "starred", EVENT = "starchart:starred";
export const starred = () => { try { return readStarred(localStorage.getItem(KEY)); } catch { return []; } };
export function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full: the change lasts this visit's view only */ }
  dispatchEvent(new CustomEvent(EVENT, { detail: { list } }));
}

/** The mark: Settings' five-pointed star (STAR_D, log.css's .i-star) in chalk, with the void's halo, drawn at 2×
 *  (30 px, shown 15 px at z16). W133 fivestar (SPEC §247): was a four-point sparkle, which read as the "AI" star.
 *  W157 icons3 (SPEC §276), her note: "Favorites should have yellow star as an icon, the same size as other icons": yellow (`ink`),
 *  in a place icon's cell (CELL, the sprite's 48 px a symbol, at 2×), as tall as a place disc with its rim (the star's tips at r 32
 *  of 64, its height 0.9 of the cell; the disc's 56 of 64: tips on the disc's rim read smaller, as a star fills less of its circle), on the
 *  places' 5-unit rim (`edge`: the void by night; the ink by day, a thin dark edge, as yellow fades on the pale ground). */
export const CELL = 48, STAR_R = 32 / 64, PLACE_SIZE = ["interpolate", ["exponential", 1.6], ["zoom"], 15, 0.462, 18, 0.726]; // W157 icons3: chart/style/build_style.py's place icons' icon-size (PLACE_ICON_SIZE); W171 icons5: 10 % larger, as the place icons
function star(ink, edge) {
  const n = CELL * 2, c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true }); // W74 start: read back on the CPU, not behind the GPU's queue
  c.width = c.height = n;
  const d = new Path2D(STAR_D), k = (STAR_R * n - 5 / 64 * n / 2) / 9.62; // W157 icons3: STAR_D's tips 9.62 from its middle (12, 12.42), the rim's outer half outside them
  g.translate(n / 2, n / 2); g.scale(k, k); g.translate(-12, -12.42); // W157 icons3: its middle on the cell's, as a place disc's (was the box's, at 1.25)
  g.lineJoin = "round"; g.lineWidth = (5 / 64) * n / k; g.strokeStyle = edge; g.stroke(d); // W157 icons3: the places' rim (was 4 px)
  g.fillStyle = ink; g.fill(d);
  return g.getImageData(0, 0, n, n);
}
/** W171 icons5 (SPEC §296): the map's mark in the theme now (2×, CELL × 2 px square), for the map and the Icon legend's row. */
export function markImage() {
  const css = getComputedStyle(document.documentElement), tok = (k) => css.getPropertyValue(k).trim();
  return star(tok("--fav"), tok(document.documentElement.dataset.theme === "light" ? "--starlight" : "--void")); // W157 icons3: yellow, a dark edge by day
}

/** The marks on `map`, kept up with the list, the theme and the Words. `before`: the layer they go under. */
export function mountStarred({ map, before = "starpath-label" }) {
  const css = () => getComputedStyle(document.documentElement), tok = (k) => css().getPropertyValue(k).trim();
  const data = () => marks(starred(), (p) => placeName(p));
  const ink = () => {
    if (!map.getLayer(SOURCE)) return;
    if (map.hasImage("starred-mark")) map.removeImage("starred-mark");
    map.addImage("starred-mark", markImage(), { pixelRatio: 2 }); // W157 icons3: yellow, a dark edge by day; W171 icons5: markImage
    map.setPaintProperty(SOURCE, "text-color", tok("--chalk"));
    map.setPaintProperty(SOURCE, "text-halo-color", tok("--void"));
  };
  const add = () => {
    if (map.getLayer(SOURCE)) return;
    map.addSource(SOURCE, { type: "geojson", data: data() });
    map.addLayer({ id: SOURCE, type: "symbol", source: SOURCE, minzoom: KINDS.comet_station.chart_zoom, // arclight, 2026-10-21: from a little farther out (was z14); W188 kindsone: with the stations (her note 8), kinds.json's
      layout: { "icon-image": "starred-mark", "icon-size": PLACE_SIZE, // W157 icons3: a place icon's size at every zoom (was its own ramp, 15 px at z16)
        "icon-allow-overlap": true, "icon-ignore-placement": true,
        "text-field": ["step", ["zoom"], "", 16, ["get", "name"]], "text-font": ["Atkinson Hyperlegible Next Regular", "Noto Sans Regular"],
        "text-size": 12.5, "text-anchor": "left", "text-offset": ["literal", [1.1, 0]], "text-optional": true, "text-max-width": 9, "text-padding": 2 }, // W157 icons3: text-offset clear of the bigger star (was 0.85)
      paint: { "text-halo-width": 1.4 } }, map.getLayer(before) ? before : undefined); // W157 icons3: the star opaque, as the place icons (was 0.95)
    ink();
  };
  const draw = () => map.getSource(SOURCE)?.setData(data());
  if (map.isStyleLoaded()) add(); else map.once("load", add);
  map.on("style.load", () => { add(); draw(); }); // a restored context's style
  addEventListener(EVENT, draw);
  addEventListener("starchart:theme", ink);
  onLingo(draw);
  return { draw };
}

// ---- W88 favorites (SPEC §176): Settings' list, as Avoided streets' (app/avoid.js) ----------------------------------
const CLOSE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`; // W88 favorites
const UNDO_MS = 5000; // W88 favorites
/** W88 favorites: "Favorites" (SCUL "Starred places") in Settings, the fold #starred-fold in #fav-fold: each place with its ×, and for a
 *  moment after, Undo in its place; the list's foot says how to star one. `label(p)`, its name in the mode's words;
 *  `glyph(place)`, its icon (course.js has both; W176 searchux: the place, so a business has the map's). */
export function mountStarredRow({ label = placeName, glyph = () => document.createElement("i") } = {}) { // W88 favorites
  const fold = document.getElementById("starred-fold"), box = document.getElementById("starred-list"); // W88 favorites: index.html's, in #fav-fold, so Settings' folds and long press have it
  if (!fold || !box) return null; // W88 favorites
  const sum = fold.querySelector("summary"), title = sum.querySelector(".t"), names = sum.querySelector("small"); // W88 favorites
  let undo = null; // W88 favorites: { place, at, back(list), timer }: the place just removed, kept in its row for a moment
  function row(p, gone = false) { // W88 favorites
    const r = el("div", `row fav${gone ? " gone" : ""}`), t = el("span", "txt", label(p)), b = el("button", gone ? "undo" : "rm"); // W88 favorites
    if (p.place && !gone) t.append(el("small", "", p.place)); // W88 favorites: its town
    if (gone) { b.textContent = "Undo"; b.onclick = () => { const u = undo; clearTimeout(u.timer); undo = null; save(u.back(starred())); }; } // W88 favorites
    else { b.innerHTML = CLOSE_SVG; b.setAttribute("aria-label", WORDS.remove(label(p))); b.title = b.getAttribute("aria-label"); b.onclick = () => remove(p); } // W88 favorites
    r.append(glyph(p), t, b); // W88 favorites; W176 searchux: glyph(p)
    return r; // W88 favorites
  } // W88 favorites
  function remove(p) { // W88 favorites
    const at = starred().findIndex((x) => samePlace(x, p)), { list, undo: back } = unstar(starred(), p); // W88 favorites
    if (undo) clearTimeout(undo.timer); // W88 favorites
    undo = { place: p, at, back, timer: setTimeout(() => { undo = null; draw(); }, UNDO_MS) }; // W88 favorites
    save(list); // W88 favorites
    box.querySelector(".undo")?.focus(); // W88 favorites
  } // W88 favorites
  function howRow() { // W88 favorites: "Tap ☆ by a place in the search or on the map."
    const [a, b] = pick(WORDS.how), r = el("div", "row fav-how"), t = el("span", "txt", a), i = el("i", "i i-star"); // W88 favorites
    i.setAttribute("role", "img"); i.setAttribute("aria-label", pick(WORDS.starIcon)); // W88 favorites
    t.append(i, b); r.append(t); // W88 favorites
    return r; // W88 favorites
  } // W88 favorites
  function draw() { // W88 favorites
    const list = starred(); // W88 favorites
    title.textContent = pick(WORDS.list); // W88 favorites; W88 settings3's convention: a fold has no data-more (no (i) in its summary, where a tap opens the fold); its how-to row inside says it
    names.textContent = list.length ? list.map((p) => label(p)).join(", ") : pick(WORDS.none); // W88 favorites: one argument, as placeName takes a mode second
    const rows = list.map((p) => row(p)); // W88 favorites
    if (undo) rows.splice(Math.max(0, Math.min(rows.length, undo.at)), 0, row(undo.place, true)); // W88 favorites
    rows.push(howRow()); // W88 favorites
    box.replaceChildren(...rows); // W88 favorites
  } // W88 favorites
  addEventListener(EVENT, draw); // W88 favorites
  addEventListener("storage", (e) => { if (e.key === KEY) draw(); }); // W88 favorites: another tab's change
  onLingo(draw); // W88 favorites
  draw(); // W88 favorites
  return { draw }; // W88 favorites
} // W88 favorites
