// W21 scale: the light-years scale, a hairline bar with end ticks and a short label at the bottom of the chart,
// beside the folded OpenStreetMap credit, as a maps app's miles scale (design/app-ui/SPEC.md, "Wave 21: the
// light-years scale").
//
// 1 LY is a mile; below 0.1 LY it counts feet, as the rest of the app does. The bar is the true length of the
// longest step that fits in MAX_PX, measured where the bar sits, not at the centre: on a tilted chart the scale
// changes from top to bottom. The bar's two ends are unprojected and the great-circle distance taken between them.
//
// It costs about nothing in flight, where the follow camera moves every frame: a move only marks it dirty, and the
// next drawn frame ("render") measures, at most once a frame. While the zoom and pitch stay put it measures again
// only once a second (for the latitude and the padding), so a frame of the follow camera is a few compares. It
// writes to the DOM only when the label changes or the bar's width moves by 1 px or more.
//
// W28 settings: always on, with no setting (its While zooming and Off went). app/scale.css places it and hides it
// where the chart is covered.

import { onLingo, plain } from "./lingo-mode.js"; // W60 a

export const LY = 1609.344, FT = 0.3048;
export const MAX_PX = 80;
/** The steps, shortest first: feet, then light years. 20 ft is below the brief's 50 ft, so the bar stays within
 *  MAX_PX up to the chart's highest zoom (19.5, where 50 ft is about 195 px). */
export const LABELS = ["20 ft", "50 ft", "100 ft", "200 ft", "500 ft", "0.1 LY", "0.2 LY", "0.5 LY", "1 LY", "2 LY", "5 LY", "10 LY", "20 LY", "50 LY"];
export const STEP_M = Float64Array.from(LABELS, (l) => parseFloat(l) * (l.endsWith("ft") ? FT : LY));
/** W60 a: the same steps in Plain's words, miles for light years (1 LY is a mile). */
export const LABELS_PLAIN = LABELS.map((l) => l.replace(/ LY$/, " mi"));
const REMEASURE_MS = 1000;

/** The longest step that is at most `max` px long at `mpp` metres a pixel (the shortest, if none fits). */
export function pickStep(mpp, max = MAX_PX) {
  let i = 0;
  while (i + 1 < STEP_M.length && STEP_M[i + 1] <= mpp * max) i++;
  return i;
}

const RAD = Math.PI / 180, R = 6371008.8;
/** The great-circle distance in metres (haversine). */
export function distance(lon1, lat1, lon2, lat2) {
  const s1 = Math.sin(((lat2 - lat1) * RAD) / 2), s2 = Math.sin(((lon2 - lon1) * RAD) / 2);
  const a = s1 * s1 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Mount the scale on the element `el` (app/index.html's #scale: a span for the label, an i for the bar).
 * Returns { update(t), measures, writes } for the tests and the bench.
 */
export function mountScale({ map, el = document.getElementById("scale"), now = () => performance.now() } = {}) {
  const label = el.firstElementChild, bar = el.lastElementChild, box = map.getContainer();
  const pt = [0, 0]; // reused for both ends
  let dirty = true, anchorDirty = true;
  let ax = 0, ay = 0, step = -1, width = -1, lastZ = NaN, lastP = NaN, lastAt = -Infinity;
  const s = { update, measures: 0, writes: 0 };

  /** Measure where the bar is now; a resize, the bar's coming and going, or a sheet move it. */
  function anchor() {
    const r = bar.getBoundingClientRect(), c = box.getBoundingClientRect();
    ax = r.right - c.left; ay = r.bottom - c.top - 1;
    anchorDirty = false;
  }
  function update(t = now()) {
    dirty = false;
    const z = map.getZoom(), p = map.getPitch();
    if (!anchorDirty && Math.abs(z - lastZ) < 1e-3 && Math.abs(p - lastP) < 0.05 && t - lastAt < REMEASURE_MS) return;
    if (anchorDirty) anchor();
    lastZ = z; lastP = p; lastAt = t;
    s.measures++;
    pt[0] = ax - MAX_PX; pt[1] = ay;
    const a = map.unproject(pt), lon = a.lng, lat = a.lat;
    pt[0] = ax;
    const b = map.unproject(pt);
    const mpp = distance(lon, lat, b.lng, b.lat) / MAX_PX;
    if (!(mpp > 0)) return; // above the horizon
    const i = pickStep(mpp), w = Math.round(STEP_M[i] / mpp);
    if (i !== step) { step = i; label.textContent = (plain() ? LABELS_PLAIN : LABELS)[i]; s.writes++; } // W60 a: Plain's
    if (Math.abs(w - width) >= 1) { width = w; bar.style.width = w + "px"; s.writes++; }
  }
  const kick = () => { anchorDirty = dirty = true; requestAnimationFrame(() => { if (dirty) update(); }); };

  map.on("move", () => { dirty = true; });
  map.on("render", () => { if (dirty) update(); });
  addEventListener("resize", kick);
  onLingo(() => { step = -1; kick(); }); // W60 a: Words, live
  // the bottom row moves with html.bar (parked), and the course card or a sheet with body's classes
  const watch = new MutationObserver(kick);
  for (const n of [document.documentElement, document.body]) watch.observe(n, { attributes: true, attributeFilter: ["class"] });
  el.classList.toggle("on", true); // W28 settings: always
  kick();
  return s;
}
