// W80 avoidmap (design/app-ui/SPEC.md §151): the avoided streets on the chart, from z13.
//   - The mark: the avoided stretch (the street's parts within 150 m of its point, as the router takes it) in a dashed
//     casing either side of the street, with small Avoid signs (⊘) along it, in caution lime (BRIEF §7.2: cautions). Not
//     red: red is the Red Line's and negi's, and a caution must never read as a comet track; nor orange, the course's.
//   - Under the street labels and the course. It takes no taps: a tap on it is a tap on its street, whose peek has
//     "Stop avoiding" (app/course.js), and the camera stays put.
//   - The streets come from the event engine's world (chart/prototype/world.js), the tiles on the phone, never from what
//     MapLibre has drawn, so a street off screen is marked once the chart gets there.
import { stretch, SAME_M } from "./avoid-logic.js";
import { avoids, EVENT } from "./avoid.js";

export const SOURCE = "avoided", MINZOOM = 13, INK = "--caution", READ = 4; // READ: the streets read a pass, so their tiles fit the world's 32

/** The sign: a ring and its slash in `ink`, on a disc of `halo`, drawn at 2× (32 px, shown 16 px). */
function sign(ink, halo) {
  const n = 32, c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true }), m = n / 2;
  c.width = c.height = n;
  g.beginPath(); g.arc(m, m, 14, 0, 2 * Math.PI); g.fillStyle = halo; g.fill();
  g.lineWidth = 3.4; g.lineCap = "round"; g.strokeStyle = ink;
  g.beginPath(); g.arc(m, m, 9.5, 0, 2 * Math.PI); g.stroke();
  g.beginPath(); g.moveTo(m - 6.7, m - 6.7); g.lineTo(m + 6.7, m + 6.7); g.stroke();
  return g.getImageData(0, 0, n, n);
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
      if (lines.length) features.push({ type: "Feature", properties: { name: a.name }, geometry: { type: "MultiLineString", coordinates: lines } });
    }
    if (short && !waiting && world && tries++ < 4) { waiting = true; world.idle().then(() => { waiting = false; draw(); }); } // its tiles on the way: again once in
    return { type: "FeatureCollection", features };
  };
  const ink = () => {
    if (!map.getLayer(SOURCE)) return;
    if (map.hasImage("avoid-sign")) map.removeImage("avoid-sign");
    map.addImage("avoid-sign", sign(tok(inkToken), tok("--void")), { pixelRatio: 2 });
    map.setPaintProperty(SOURCE, "line-color", tok(inkToken));
  };
  const add = () => {
    if (map.getLayer(SOURCE)) return;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const at = [before, "starpath-label"].find((id) => map.getLayer(id)); // under the course, else under the street labels
    map.addLayer({ id: SOURCE, type: "line", source: SOURCE, minzoom: MINZOOM, layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 3.2, 18, 4], "line-gap-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 3, 16, 9, 18, 18],
        "line-dasharray": ["literal", [2, 1.2]], "line-opacity": 1 } }, at);
    map.addLayer({ id: `${SOURCE}-sign`, type: "symbol", source: SOURCE, minzoom: MINZOOM,
      layout: { "symbol-placement": "line", "symbol-spacing": 220, "icon-image": "avoid-sign", "icon-rotation-alignment": "viewport",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.75, 16, 1.1, 18, 1.3], "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-opacity": 1 } }, at);
    ink();
    draw();
  };
  const draw = () => map.getSource(SOURCE)?.setData(data());
  if (map.isStyleLoaded()) add(); else map.once("load", add);
  map.on("style.load", add); // a restored context's style
  addEventListener(EVENT, () => { list = avoids(); tries = 0; draw(); });
  map.on("moveend", () => { if (!waiting && missing()) { tries = 0; draw(); } }); // a street come into view
  addEventListener("storage", (e) => { if (e.key === "starchart.avoid") { list = avoids(); draw(); } }); // another tab's change
  addEventListener("starchart:theme", ink);
  return { draw, ink, data };
}
