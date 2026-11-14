// W67 places (design/app-ui/SPEC.md §97): the starred places on the chart, and the list in this phone's storage.
//   - The marks: a small chalk five-pointed star (the chart's hue for your own marks, BRIEF §7.2) from z14, its name from z16,
//     under the street labels, which win a collision; the marks themselves never hide anything, nor give way.
//   - starred() and save(list): the list (app/starred-logic.js); a save tells the chart and the open picks
//     ("starchart:starred").
//   - W88 favorites (SPEC §176): mountStarredRow({ label, glyph }), Settings' list under Avoided streets, in #fav-fold.
import { KEY, readStarred, marks, unstar, samePlace, WORDS, STAR_D, nickname, NICK_MAX, use, byName, moveHome, OLD_HOME } from "./starred-logic.js"; // W88 favorites: unstar, samePlace, WORDS; W133 fivestar: STAR_D; W206 favnames: nickname, NICK_MAX; W210 favs2: use, byName; W216 homefav: moveHome, OLD_HOME; W219 favs3: nickname again (no isHome, no nameIt)
import { placeName } from "./course-logic.js";
import { onLingo, pick, lingo } from "./lingo-mode.js"; // W88 favorites: pick; W216 homefav: lingo (W219 favs3: no plain, no house to draw)
import { el } from "./dom.js"; // W152 app-rest J2
import { KINDS } from "../chart/lingo/kinds.js"; // W188 kindsone: the stations' zoom

export const SOURCE = "starred", EVENT = "starchart:starred";
export const starred = () => { try { return readStarred(localStorage.getItem(KEY)); } catch { return []; } };
export function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full: the change lasts this visit's view only */ }
  dispatchEvent(new CustomEvent(EVENT, { detail: { list } }));
}
/** W216 homefav (SPEC §414): home's old key moved into the list, once, at the start (a restored older backup brings it back, and the
 *  restart moves it the same way), in the Words of the moment; then the key goes. As app/calls.js migrateSound. */
export function migrateHome(s = globalThis.localStorage) { // W216 homefav
  try { // W216 homefav
    const text = s.getItem(OLD_HOME); if (text === null) return; // W216 homefav
    const list = readStarred(s.getItem(KEY)), now = moveHome(list, text, lingo()); // W216 homefav
    if (now !== list) s.setItem(KEY, JSON.stringify(now)); // W216 homefav
    s.removeItem(OLD_HOME); // W216 homefav
  } catch { /* storage off or full: the key stays for the next start */ } // W216 homefav
} // W216 homefav
migrateHome(); // W216 homefav: before anything reads the list (main.js, course.js and legend.js import this module; log.js reads it only when asked)
/** W210 favs2 (SPEC §389): `place` used now, if it is starred (picked in Where to?, or a route planned to it): Where to? lists them by it. */
export function used(place) { const list = starred(), now = use(list, place); if (now !== list) save(now); } // W210 favs2

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
  return star(tok("--fav"), tok(document.documentElement.dataset.theme === "light" ? "--fav-edge" : "--void")); // W157 icons3: yellow, a dark edge by day; W213 palette3 (SPEC §406): her grey edge by day (starred.css --fav-edge, was the ink), the ground's black by night
}

/** The marks on `map`, kept up with the list, the theme and the Words. `before`: the layer they go under. */
export function mountStarred({ map, before = "starpath-label" }) {
  const css = () => getComputedStyle(document.documentElement), tok = (k) => css().getPropertyValue(k).trim();
  const data = () => marks(starred(), (p) => p.nick || placeName(p)); // W206 favnames: her nickname for it, where she gave one; W219 favs3 (SPEC §425): every favourite the star, a name never a house (W216's home wore one)
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
      layout: { "icon-image": "starred-mark", "icon-size": PLACE_SIZE, // W219 favs3: the star alone again (W216's pic() drew home's house) // W157 icons3: a place icon's size at every zoom (was its own ramp, 15 px at z16)
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
  onLingo(draw); // W219 favs3: no house in the mode's picture to change
  return { draw };
}

// ---- W88 favorites (SPEC §176): Settings' list, as Avoided streets' (app/avoid.js) ----------------------------------
const CLOSE_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`; // W88 favorites
const UNDO_MS = 5000; // W88 favorites
/** W88 favorites: "Favorites" (SCUL "Starred places") in Settings, the fold #starred-fold in #fav-fold: each place with its ×, and for a
 *  moment after, Undo in its place; the list's foot says how to star one. W210 favs2 (SPEC §389): the line says how many, the rows go by name. `label(p)`, its name in the mode's words;
 *  `glyph(place)`, its icon (course.js has both; W176 searchux: the place, so a business has the map's). */
export function mountStarredRow({ label = placeName, glyph = () => document.createElement("i") } = {}) { // W88 favorites; W219 favs3: no moved (no "Home moved")
  const fold = document.getElementById("starred-fold"), box = document.getElementById("starred-list"); // W88 favorites: index.html's, in #fav-fold, so Settings' folds and long press have it
  if (!fold || !box) return null; // W88 favorites
  const sum = fold.querySelector("summary"), title = sum.querySelector(".t"), names = sum.querySelector("small"); // W88 favorites
  let undo = null; // W88 favorites: { place, back(list), timer }: the place just removed, kept in its row for a moment (W210 favs2: no `at`, as the rows go by name)
  function row(p, gone = false) { // W88 favorites
    const r = el("div", `row fav${gone ? " gone" : ""}`), t = el("span", "txt", p.nick || label(p)), b = el("button", gone ? "undo" : "rm"); // W88 favorites; W206 favnames: her nickname for it first
    const sub = [p.nick ? label(p) : "", p.place].filter(Boolean).join(" · "); // W206 favnames: and its own name small beneath, with its town
    if (sub && !gone) t.append(el("small", "", sub)); // W88 favorites: its town; W206 favnames: sub
    if (gone) { b.textContent = "Undo"; b.onclick = () => { const u = undo; clearTimeout(u.timer); undo = null; save(u.back(starred())); }; } // W88 favorites
    else { b.innerHTML = CLOSE_SVG; b.setAttribute("aria-label", WORDS.remove(label(p))); b.title = b.getAttribute("aria-label"); b.onclick = () => remove(p); } // W88 favorites
    const n = el("button", "nick"); n.append(el("i", "i i-pen")); n.setAttribute("aria-label", pick(WORDS.nickFor)(label(p))); n.title = n.getAttribute("aria-label"); n.onclick = () => askNick(p, label); // W219 favs3: no moved; W206 favnames: its nickname, set or changed; W210 favs2: the pen, the Log's Rename picture (was the tag)
    r.append(glyph(p), t, ...(gone ? [] : [n]), b); // W88 favorites; W176 searchux: glyph(p); W206 favnames: n
    return r; // W88 favorites
  } // W88 favorites
  function remove(p) { // W88 favorites
    const { list, undo: back } = unstar(starred(), p); // W88 favorites
    if (undo) clearTimeout(undo.timer); // W88 favorites
    undo = { place: p, back, timer: setTimeout(() => { undo = null; draw(); }, UNDO_MS) }; // W88 favorites; W210 favs2: no `at`
    save(list); // W88 favorites
    box.querySelector(".undo")?.focus(); // W88 favorites
  } // W88 favorites
  function howRow() { // W88 favorites: "To add a favorite, search for the place in Where to? or tap it on the map, then tap its ☆." (W210 favs2)
    const [a, b] = pick(WORDS.how), r = el("div", "row fav-how"), t = el("span", "txt", a), i = el("i", "i i-star"); // W88 favorites
    i.setAttribute("role", "img"); i.setAttribute("aria-label", pick(WORDS.starIcon)); // W88 favorites
    t.append(i, b); r.append(t); // W88 favorites
    return r; // W88 favorites
  } // W88 favorites
  function draw() { // W88 favorites
    const list = starred(); // W88 favorites
    title.textContent = pick(WORDS.list); // W88 favorites; W88 settings3's convention: a fold has no data-more (no (i) in its summary, where a tap opens the fold); its how-to row inside says it
    names.textContent = list.length ? pick(WORDS.saved)(list.length) : pick(WORDS.none); // W88 favorites; W210 favs2 (her row 19): how many, "10 saved" (was their names)
    const rows = byName(undo ? [...list, undo.place] : list, (p) => p.nick || label(p)).map((p) => row(p, p === undo?.place)); // W88 favorites; W210 favs2 (her row 38): by name, her nickname where she gave one; the one just removed in its place among them
    rows.push(howRow()); // W88 favorites
    box.replaceChildren(...rows); // W88 favorites
  } // W88 favorites
  addEventListener(EVENT, draw); // W88 favorites
  addEventListener("storage", (e) => { if (e.key === KEY) draw(); }); // W88 favorites: another tab's change
  onLingo(draw); // W88 favorites
  draw(); // W88 favorites
  return { draw }; // W88 favorites
} // W88 favorites

// ---- W206 favnames (SPEC §380): a nickname for a starred place, asked where she stars it (the snack's button) and in Settings ----
/** W206 favnames: "Nickname for Diesel Cafe" (SCUL "Call sign for …"): one field, Save and Cancel, as Delete's question (log.js ask);
 *  Enter saves, an empty field takes the nickname away. It stays on this phone, in the starred list (so in a backup). */
export function askNick(place, label = placeName) { // W206 favnames; W219 favs3 (SPEC §425): a name and nothing more (W216's moved(), "Home moved", went)
  const now = starred().find((s) => samePlace(s, place)), title = pick(WORDS.nickFor)(label(place)); // W206 favnames
  if (!now) return null; // W206 favnames: unstarred meanwhile
  const d = el("dialog"), f = el("form"), field = el("input"), acts = el("div", "acts"), x = el("button", "nx"); // W206 favnames
  d.id = "fav-nick"; d.setAttribute("aria-label", title); f.method = "dialog"; // W206 favnames
  Object.assign(field, { type: "text", value: now.nick || "", maxLength: NICK_MAX, placeholder: pick(WORDS.nickHint), autocomplete: "off", spellcheck: false, enterKeyHint: "done" }); // W206 favnames
  field.setAttribute("autocapitalize", "words"); field.setAttribute("aria-label", pick(WORDS.nick)); // W206 favnames
  field.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); d.close("save"); } }; // W206 favnames: an IME's Enter is its own (W201 gestures)
  const no = el("button", "no", WORDS.cancel), go = el("button", "go", WORDS.save); // W206 favnames
  no.value = "cancel"; go.value = "save"; x.value = "cancel"; x.setAttribute("aria-label", "Close"); x.append(el("i", "i i-close")); // W206 favnames
  acts.append(no, go); f.append(el("h2", "", title), field, acts, x); d.append(f); // W206 favnames; W219 favs3: no names offered (W216's Home and Work)
  const vv = window.visualViewport, fit = () => { d.style.setProperty("--vv-top", `${vv.offsetTop}px`); d.style.setProperty("--vv-h", `${vv.height}px`); }; // W210 favs2 (SPEC §389): within what the keyboard leaves (app/starred.css)
  if (vv) { fit(); vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); } // W210 favs2
  d.addEventListener("close", () => { d.remove(); vv?.removeEventListener("resize", fit); vv?.removeEventListener("scroll", fit); if (d.returnValue === "save") save(nickname(starred(), place, field.value)); }); // W206 favnames; W210 favs2: vv; W219 favs3: nickname, a name moves nothing (was W216's nameIt)
  document.body.append(d); d.showModal(); field.focus(); field.select(); // W206 favnames
  return d; // W206 favnames
} // W206 favnames
