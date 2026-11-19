// W142 remscale (design/app-ui/SPEC.md §256): the chart's labels follow the phone's text size, as the UI's rem type does.
// Every symbol layer's text-size is its style's size times k, the root font size over 16 (a size over 24 px gains what
// 24 px gains, as the UI's display type does): at load, for a layer added later
// (the stars, the ride quality's words), and when the text size changes. A size of 0 stays 0 and the zoom stops stay where
// they are, so the street names' tiers (the W51 and W91 ladders) keep their zooms; MapLibre's collision drops what no
// longer fits. A glyph drawn as text (the course's › chevrons) is an icon, and stays put.

/** W142 remscale: a text-size value (a number, a zoom curve, a legacy function or any expression) at the text size k: x·k up
 *  to 24 px, x + 24·(k − 1) above, continuous and in order. An expression's size is unknown: times k. */
export function scaleSize(v, k) {
  if (typeof v === "number") return Math.round((v <= 24 ? v * k : v + 24 * (k - 1)) * 100) / 100; // a display size (the towns', over 24 px) gains what 24 px gains, as the UI's: smooth, so a smaller label never overtakes a larger
  if (v && !Array.isArray(v) && Array.isArray(v.stops)) return { ...v, stops: v.stops.map(([z, s]) => [z, scaleSize(s, k)]) };
  if (!Array.isArray(v)) return v;
  const zoomed = Array.isArray(v[2]) && v[2][0] === "zoom";
  if (v[0] === "interpolate" && zoomed) return [...v.slice(0, 3), ...v.slice(3).map((x, i) => (i % 2 ? scaleSize(x, k) : x))]; // zoom, size, zoom, size
  if (v[0] === "step" && Array.isArray(v[1]) && v[1][0] === "zoom") return [...v.slice(0, 2), ...v.slice(2).map((x, i) => (i % 2 ? x : scaleSize(x, k)))]; // size, zoom, size
  return ["*", v, k]; // no zoom inside (MapLibre allows zoom only at the top): any other expression
}

/** W142 remscale: a text-field that is a literal glyph or two (the course's › chevrons) draws an icon, not words: it keeps its size. */
export const glyph = (f) => typeof f === "string" && !f.includes("{") && [...f].length <= 2;

/** W142 remscale: the root font size over 16, the text-size setting's factor (1 at the default 16 px). */
export const textScale = (doc = document) => (parseFloat(getComputedStyle(doc.documentElement).fontSize) || 16) / 16;

/** W142 remscale: keep the map's labels at the text size, from now on. */
export function followTextSize(map, doc = document) {
  const done = new Map(); // layer id -> { orig, scaled (as JSON), k }
  let k = textScale(doc), scaledOnce = false;
  const apply = () => {
    if (k === 1 && !scaledOnce) return; // the default text size: the style's own sizes, nothing to do
    scaledOnce = true;
    for (const id of map.getLayersOrder()) {
      const now = map.getLayer(id)?.type === "symbol" ? map.getLayoutProperty(id, "text-size") : undefined, seen = done.get(id);
      if (now === undefined || glyph(map.getLayoutProperty(id, "text-field"))) continue;
      const fresh = !seen || JSON.stringify(now) !== seen.scaled; // a layer added (or set) anew since: its size is the style's
      if (!fresh && seen.k === k) continue;
      const orig = fresh ? now : seen.orig, scaled = k === 1 ? orig : scaleSize(orig, k);
      done.set(id, { orig, scaled: JSON.stringify(scaled), k });
      if (JSON.stringify(scaled) !== JSON.stringify(now)) map.setLayoutProperty(id, "text-size", scaled);
    }
  };
  apply();
  let queued = false; // a theme's paint diff sends a styledata per change: one pass after them all
  map.on("styledata", () => { if ((k !== 1 || scaledOnce) && !queued) { queued = true; queueMicrotask(() => { queued = false; apply(); }); } });
  // a 1rem box: it resizes when the root font size does (the browser's text size, Android's text scaling)
  const probe = doc.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.className = "rem-probe";
  doc.body.append(probe);
  new ResizeObserver(() => { const n = textScale(doc); if (n !== k) { k = n; apply(); } }).observe(probe);
  return { get k() { return k; } };
}
