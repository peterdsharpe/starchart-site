// W80 avoidmap (design/app-ui/SPEC.md §151): the avoided streets on the chart, from z13.
//   - The mark: the avoided stretch (the street's parts within 150 m of its point, as the router takes it) in a dashed
//     casing either side of the street, with small Avoid signs (⊘) along it, in caution lime (BRIEF §7.2: cautions). Not
//     red: red is the Red Line's and negi's, and a caution must never read as a comet track; nor orange, the course's.
//   - Under the street labels and the course. It takes no taps: a tap on it is a tap on its street, whose peek has
//     its level, Prefer, Avoid or Never (app/course.js), and the camera stays put.
//   - The streets come from the event engine's world (chart/prototype/world.js), the tiles on the phone, never from what
//     MapLibre has drawn, so a street off screen is marked once the chart gets there.
//   - W133 roadprefs (SPEC §245): by level. Avoid keeps the dashed casing and its signs; Never is stronger, a solid casing and
//     larger signs; Prefer is subtle, a thin dotted casing in chalk (BRIEF §7.2: your own marks) and no sign.
//   - W192 icons7 (SPEC §338), her row of 2026-10-29 07:44: Never's sign "looks a bit pixelated, and it is almost the same size, shape
//     and color as bike racks ... contain a black X rather than a simple diagonal bar": its own sign, a ring round an X (Avoid's keeps
//     its bar), and each drawn at this screen's pixels for its largest size (SIZE), so neither is enlarged into steps (was 2×, to 1.55).
import { stretch, SAME_M, KEY } from "./avoid-logic.js"; // W133 roadprefs: KEY
import { avoids, EVENT } from "./avoid.js";
import { onLingo } from "./lingo-mode.js"; // W191 appleft

export const SOURCE = "avoided", MINZOOM = 13, INK = "--caution", PREFER_INK = "--chalk", READ = 4; // W133 roadprefs: PREFER_INK // READ: the streets read a pass, so their tiles fit the world's 32
/** W192 icons7: each sign's icon-size at z13, z16 and z18 (W133 roadprefs' numbers): 1 is 16 CSS px. */
export const SIZE = { avoid: [0.75, 1.1, 1.3], never: [0.9, 1.3, 1.55] };

/** The sign on a 32-unit grid: a ring in `ink` round Avoid's slash or, W192 icons7, Never's X, on a disc of `halo`; 16 CSS px, drawn
 *  `r` pixels a CSS px (W192 icons7: was 2). Returns { data, pixelRatio } for map.addImage. */
function sign(ink, halo, never = false, r = 2) {
  const n = Math.ceil(16 * r), c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true }), m = 16;
  c.width = c.height = n; g.scale(n / 32, n / 32); // W192 icons7: the drawing as a vector, at the pixels it is shown at
  g.beginPath(); g.arc(m, m, 14, 0, 2 * Math.PI); g.fillStyle = halo; g.fill();
  g.lineWidth = 3.4; g.lineCap = "round"; g.strokeStyle = ink;
  g.beginPath(); g.arc(m, m, 9.5, 0, 2 * Math.PI); g.stroke();
  g.beginPath();
  if (never) { const d = 3.8; g.moveTo(m - d, m - d); g.lineTo(m + d, m + d); g.moveTo(m + d, m - d); g.lineTo(m - d, m + d); } // W192 icons7: Never's X, clear of the ring
  else { g.moveTo(m - 6.7, m - 6.7); g.lineTo(m + 6.7, m + 6.7); }
  g.stroke();
  return { data: g.getImageData(0, 0, n, n), pixelRatio: n / 16 };
}

/** The marks on `map`, kept up with the list, the tiles and the theme. `before`: the layer they go under (the course's lowest). */
export function mountAvoidLayer({ map, world, before = "course-glow", ink: inkToken = INK }) {
  const tok = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  const seen = new Map(); // a street's stretch, by its name and point: read once, as the world keeps only 32 tiles
  let waiting = false, tries = 0, list = avoids(); // the list, read again on each change, not on each move
  /** Near the view, from z13: only those streets' tiles are asked for, never the whole list's (the world keeps the ship's). */
  const view = () => { if (map.getZoom() < MINZOOM - 0.5) return null; const b = map.getBounds(), dx = (b.getEast() - b.getWest()) / 2, dy = (b.getNorth() - b.getSouth()) / 2;
    return [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy]; };
  const inside = (v, p) => !!v && p[0] > v[0] && p[0] < v[2] && p[1] > v[1] && p[1] < v[3];
  const missing = () => { const v = view(); return !!v && list.some((a) => !seen.has(`${a.name}|${a.lonlat}`) && inside(v, a.lonlat)); };
  const data = () => {
    const features = [], v = view();
    let short = false, asked = 0;
    for (const a of list) {
      const key = `${a.name}|${a.lonlat}`;
      if (!seen.has(key) && inside(v, a.lonlat) && asked++ < READ && world?.ready(a.lonlat, SAME_M + 60)) { seen.set(key, stretch(world.roadsNear(a.lonlat, SAME_M + 40), a)); tries = 0; } // read: the next pass may go on
      if (!seen.has(key)) { short ||= inside(v, a.lonlat); continue; }
      const lines = seen.get(key);
      if (lines.length) features.push({ type: "Feature", properties: { name: a.name, level: a.level }, geometry: { type: "MultiLineString", coordinates: lines } }); // W133 roadprefs: level
    }
    if (short && !waiting && world && tries++ < 4) { waiting = true; world.idle().then(() => { waiting = false; draw(); }); } // its tiles on the way: again once in
    return { type: "FeatureCollection", features };
  };
  const ink = () => {
    if (!map.getLayer(SOURCE)) return;
    const c = tok(`${inkToken}-words`) || tok(inkToken); // W186 palette: a warning's thin lines in its words colour (Plain's ink by day, her yellow by night), else its own (SCUL's)
    for (const l of ["avoid", "never"]) { // W192 icons7: each its own, at this screen's pixels for its largest size
      const s = sign(c, tok("--void"), l === "never", (globalThis.devicePixelRatio || 1) * SIZE[l][2]);
      if (map.hasImage(`${l}-sign`)) map.removeImage(`${l}-sign`);
      map.addImage(`${l}-sign`, s.data, { pixelRatio: s.pixelRatio }); // W186 palette: c
    }
    map.setPaintProperty(SOURCE, "line-color", c); // W186 palette: c
    map.setPaintProperty(`${SOURCE}-never`, "line-color", c); // W133 roadprefs; W186 palette: c
    map.setPaintProperty(`${SOURCE}-prefer`, "line-color", tok(PREFER_INK)); // W133 roadprefs
  };
  const add = () => {
    if (map.getLayer(SOURCE)) return;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const at = [before, "starpath-label"].find((id) => map.getLayer(id)); // under the course, else under the street labels
    const gap = ["interpolate", ["exponential", 1.6], ["zoom"], 13, 3, 16, 9, 18, 18], is = (l) => ["==", ["get", "level"], l]; // W133 roadprefs
    map.addLayer({ id: SOURCE, type: "line", source: SOURCE, minzoom: MINZOOM, filter: is("avoid"), layout: { "line-cap": "butt", "line-join": "round" }, // W133 roadprefs: Avoid's
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 3.2, 18, 4], "line-gap-width": gap,
        "line-dasharray": ["literal", [2, 1.2]], "line-opacity": 1 } }, at);
    map.addLayer({ id: `${SOURCE}-never`, type: "line", source: SOURCE, minzoom: MINZOOM, filter: is("never"), layout: { "line-cap": "butt", "line-join": "round" }, // W133 roadprefs: Never's, solid
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2.4, 16, 3.8, 18, 4.8], "line-gap-width": gap, "line-opacity": 1 } }, at);
    map.addLayer({ id: `${SOURCE}-prefer`, type: "line", source: SOURCE, minzoom: MINZOOM, filter: is("prefer"), layout: { "line-cap": "round", "line-join": "round" }, // W133 roadprefs: Prefer's, thin chalk dots
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.4, 16, 2, 18, 2.6], "line-gap-width": gap, "line-dasharray": ["literal", [0.1, 2.2]], "line-opacity": 0.85 } }, at);
    map.addLayer({ id: `${SOURCE}-sign`, type: "symbol", source: SOURCE, minzoom: MINZOOM, filter: ["!", is("prefer")], // W133 roadprefs: no sign on a Prefer
      layout: { "symbol-placement": "line", "symbol-spacing": 220, "icon-image": ["case", is("never"), "never-sign", "avoid-sign"], "icon-rotation-alignment": "viewport", // W192 icons7: Never's own sign
        "icon-size": ["interpolate", ["linear"], ["zoom"], ...[13, 16, 18].flatMap((z, i) => [z, ["case", is("never"), SIZE.never[i], SIZE.avoid[i]]])], "icon-allow-overlap": true, "icon-ignore-placement": true }, // W133 roadprefs: a Never's larger; W192 icons7: SIZE
      paint: { "icon-opacity": 1 } }, at);
    ink();
    draw();
  };
  const draw = () => map.getSource(SOURCE)?.setData(data());
  if (map.isStyleLoaded()) add(); else map.once("load", add);
  map.on("style.load", add); // a restored context's style
  addEventListener(EVENT, () => { list = avoids(); tries = 0; draw(); });
  map.on("moveend", () => { if (!waiting && missing()) { tries = 0; draw(); } }); // a street come into view
  addEventListener("storage", (e) => { if (e.key === KEY) { list = avoids(); draw(); } }); // another tab's change; W133 roadprefs: KEY
  addEventListener("starchart:theme", ink); onLingo(ink); // W191 appleft (SPEC §334): Words too, whose warning ink differs (W186 palette: Plain's --caution-words)
  return { draw, ink, data };
}
