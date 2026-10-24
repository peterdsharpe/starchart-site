// W67 places (design/app-ui/SPEC.md §97): the starred places on the chart, and the list in this phone's storage.
//   - The marks: a small chalk sparkle (the chart's hue for your own marks, BRIEF §7.2) from z14, its name from z16,
//     under the street labels, which win a collision; the marks themselves never hide anything, nor give way.
//   - starred() and save(list): the list (app/starred-logic.js); a save tells the chart and the open picks
//     ("starchart:starred").
//   - W88 favorites (SPEC §176): mountStarredRow({ label, glyph }), Settings' list under Avoided streets, in #fav-fold.
import { KEY, readStarred, marks, unstar, samePlace, WORDS } from "./starred-logic.js"; // W88 favorites: unstar, samePlace, WORDS
import { placeName } from "./course-logic.js";
import { onLingo, pick } from "./lingo-mode.js"; // W88 favorites: pick

export const SOURCE = "starred", EVENT = "starchart:starred";
export const starred = () => { try { return readStarred(localStorage.getItem(KEY)); } catch { return []; } };
export function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full: the change lasts this visit's view only */ }
  dispatchEvent(new CustomEvent(EVENT, { detail: { list } }));
}

/** The mark: a four-point sparkle in chalk, with the void's halo, drawn at 2× (28 px, shown 14 px at z16). */
function sparkle(ink, halo) {
  const n = 28, c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true }), m = n / 2; // W74 start: read back on the CPU, not behind the GPU's queue
  c.width = c.height = n;
  const path = (r, w) => { g.beginPath(); g.moveTo(m, m - r); g.quadraticCurveTo(m + w, m - w, m + r, m); g.quadraticCurveTo(m + w, m + w, m, m + r);
    g.quadraticCurveTo(m - w, m + w, m - r, m); g.quadraticCurveTo(m - w, m - w, m, m - r); g.closePath(); };
  path(12, 2.6); g.lineJoin = "round"; g.lineWidth = 5; g.strokeStyle = halo; g.stroke(); // the halo, so it reads on a street
  path(12, 2.6); g.fillStyle = ink; g.fill();
  return g.getImageData(0, 0, n, n);
}

/** The marks on `map`, kept up with the list, the theme and the Words. `before`: the layer they go under. */
export function mountStarred({ map, before = "starpath-label" }) {
  const css = () => getComputedStyle(document.documentElement), tok = (k) => css().getPropertyValue(k).trim();
  const data = () => marks(starred(), (p) => placeName(p));
  const ink = () => {
    if (!map.getLayer(SOURCE)) return;
    if (map.hasImage("starred-mark")) map.removeImage("starred-mark");
    map.addImage("starred-mark", sparkle(tok("--chalk"), tok("--void")), { pixelRatio: 2 });
    map.setPaintProperty(SOURCE, "text-color", tok("--chalk"));
    map.setPaintProperty(SOURCE, "text-halo-color", tok("--void"));
  };
  const add = () => {
    if (map.getLayer(SOURCE)) return;
    map.addSource(SOURCE, { type: "geojson", data: data() });
    map.addLayer({ id: SOURCE, type: "symbol", source: SOURCE, minzoom: 12.5, // arclight, 2026-10-21: from a little farther out (was z14)
      layout: { "icon-image": "starred-mark", "icon-size": ["interpolate", ["linear"], ["zoom"], 12.5, 0.6, 14, 0.75, 16, 1, 18, 1.2],
        "icon-allow-overlap": true, "icon-ignore-placement": true,
        "text-field": ["step", ["zoom"], "", 16, ["get", "name"]], "text-font": ["Atkinson Hyperlegible Next Regular", "Noto Sans Regular"],
        "text-size": 12.5, "text-anchor": "left", "text-offset": ["literal", [0.85, 0]], "text-optional": true, "text-max-width": 9, "text-padding": 2 },
      paint: { "text-halo-width": 1.4, "icon-opacity": 0.95 } }, map.getLayer(before) ? before : undefined);
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
 *  `glyph(kind)`, its icon (course.js has both). */
export function mountStarredRow({ label = placeName, glyph = () => document.createElement("i") } = {}) { // W88 favorites
  const fold = document.getElementById("starred-fold"), box = document.getElementById("starred-list"); // W88 favorites: index.html's, in #fav-fold, so Settings' folds and long press have it
  if (!fold || !box) return null; // W88 favorites
  const sum = fold.querySelector("summary"), title = sum.querySelector(".t"), names = sum.querySelector("small"); // W88 favorites
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }; // W88 favorites
  let undo = null; // W88 favorites: { place, at, back(list), timer }: the place just removed, kept in its row for a moment
  function row(p, gone = false) { // W88 favorites
    const r = el("div", `row fav${gone ? " gone" : ""}`), t = el("span", "txt", label(p)), b = el("button", gone ? "undo" : "rm"); // W88 favorites
    if (p.place && !gone) t.append(el("small", "", p.place)); // W88 favorites: its town
    if (gone) { b.textContent = "Undo"; b.onclick = () => { const u = undo; clearTimeout(u.timer); undo = null; save(u.back(starred())); }; } // W88 favorites
    else { b.innerHTML = CLOSE_SVG; b.setAttribute("aria-label", WORDS.remove(label(p))); b.title = b.getAttribute("aria-label"); b.onclick = () => remove(p); } // W88 favorites
    r.append(glyph(p.kind), t, b); // W88 favorites
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
