// W82 packmap (design/app-ui/SPEC.md §155): which stored map packs' graphs a trip needs (app/course.js).
import { packsFor } from "../chart/routing/merge.js";

/** The ids of the stored packs (`stored`: [{ id, bounds }]) whose graphs the trip through `pts` (From, the stops, To) needs:
 *  none while every point is on the base (`onBase(p)`), else every stored pack its box plus 5 km touches (merge.js packsFor). */
export function graphPick(pts, onBase, stored) {
  if (!pts.length || pts.every(onBase)) return [];
  return packsFor({ from: pts[0], to: pts.at(-1), vias: pts.slice(1, -1) }, stored);
}

// W82 packdraw (SPEC §160): past the base's edge the style lays New England's void, sea, coast and towns over the chart's lines
// and fills, and keeps the chart's point labels inside the edge's middle ring (build_style.py, W51 edge). A stored pack's box is
// chart too, so the edge's features are cut away there, and the labels' ring takes in the box. Each box is widened by PAD
// degrees (the pack's tiles run on past it, whole), so the void's fade inside the base's own box ends at a cut with no step.
const PAD = 0.02; // W82 packdraw
const SIDES = (w, s, e, n) => [[0, w, 1], [1, s, 1], [0, e, -1], [1, n, -1]]; // W82 packdraw: [axis, edge, inward sign]
const at = (p, q, ax, k) => { const t = (k - p[ax]) / (q[ax] - p[ax]); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; }; // W82 packdraw
/** W82 packdraw: a closed ring cut to the box (Sutherland–Hodgman); [] when nothing is left. */
function ringIn(ring, [w, s, e, n]) {
  let pts = ring.slice(0, -1);
  for (const [ax, k, sign] of SIDES(w, s, e, n)) {
    const inside = (p) => sign * (p[ax] - k) >= 0, out = [];
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; if (inside(p)) out.push(p); if (inside(p) !== inside(q)) out.push(at(p, q, ax, k)); });
    if ((pts = out).length < 3) return [];
  }
  return [...pts, pts[0]];
}
/** W82 packdraw: a line's parts inside the box (Liang–Barsky per segment). */
function lineIn(line, [w, s, e, n]) {
  const parts = [];
  let cur = null;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    let t0 = 0, t1 = 1;
    for (const [ax, k, sign] of SIDES(w, s, e, n)) {
      const pa = sign * (a[ax] - k), d = sign * (b[ax] - a[ax]);
      if (d === 0) { if (pa < 0) t1 = -1; } else if (d > 0) t0 = Math.max(t0, -pa / d); else t1 = Math.min(t1, -pa / d);
    }
    if (t0 >= t1) { cur = null; continue; }
    const p = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    if (!cur || t0 > 0) parts.push((cur = [p(t0)]));
    cur.push(p(t1));
    if (t1 < 1) cur = null;
  }
  return parts;
}
/** W82 packdraw: the GeoJSON geometry's parts in any of the boxes, or null. */
function geomIn(g, boxes) {
  if (g.type === "Point") return boxes.some(([w, s, e, n]) => g.coordinates[0] >= w && g.coordinates[0] <= e && g.coordinates[1] >= s && g.coordinates[1] <= n) ? g : null;
  if (/LineString$/.test(g.type)) {
    const lines = boxes.flatMap((b) => (g.type === "LineString" ? [g.coordinates] : g.coordinates).flatMap((l) => lineIn(l, b)));
    return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
  }
  const polys = boxes.flatMap((b) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((p) => p.map((r) => ringIn(r, b))).filter((p) => p[0].length).map((p) => p.filter((r) => r.length)));
  return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
}
const padded = ([w, s, e, n]) => [w - PAD, s - PAD, e + PAD, n + PAD]; // W82 packdraw
/** W82 packdraw: the FeatureCollection `fc` (the style's `new-england`) with every part inside the boxes ([w, s, e, n]) cut away. */
export function outsideBoxes(fc, boxes) {
  let features = fc.features;
  for (const [w, s, e, n] of boxes.map(padded)) {
    const around = [[-180, -90, w, 90], [e, -90, 180, 90], [w, n, e, 90], [w, -90, e, s]]; // the four boxes around this one
    features = features.flatMap((f) => { const g = geomIn(f.geometry, around); return g ? [{ ...f, geometry: g }] : []; });
  }
  return { ...fc, features };
}
/** W82 packdraw: a layer's filter whose `within` (the edge's middle ring) also takes in the boxes; null if it has none. */
export function withinBoxes(filter, boxes) {
  const wide = (g) => ["within", { type: "MultiPolygon", coordinates: [g.coordinates, ...boxes.map(padded).map(([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]])] }];
  if (filter?.[0] === "within") return wide(filter[1]);
  if (filter?.[0] === "all" && filter[1]?.[0] === "within") return ["all", wide(filter[1][1]), ...filter.slice(2)];
  return null;
}
