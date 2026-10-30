// W185 placenames (SPEC §322), her row 2's "Place names": "Keep clear: never over the route line, the map buttons or the screen edge"
// and "While riding: names only for places along the route ahead, most of all at or just before the next turn; about 4 at a time. Icons stay."
// The style draws the names (chart/style/build_style.py place_name); this keeps them clear and picks the ride's.
//
// - Keep clear of the buttons and the screen's edge: MapLibre has no padding for labels, so "label-keepout" is a symbol layer of empty
//   icons, one over each control on the chart and a strip along each edge, placed before the places' layers in the collisions (right
//   under the stop signs, so the streets', squares' and stations' names are as they were). A place's name that would touch one moves to
//   its next side (right, left, below) or goes, its icon too where the icon itself is under a control. Sent again when the chart stops
//   moving, and twice a second while it moves (in flight, every 5 s at most).
// - In a ride with a route: the style's global state "placenames" is {name: side}, at most MAX_NAMES places within CORRIDOR_M of the
//   route's next AHEAD_M, those at or just before the next turn first, each on the first side in her order whose box clears the route line
//   and the controls (its variable anchors are off for the ride, so MapLibre can't move it onto the route), the other places' icons and the
//   names picked before it. Every other place is its icon. A name seen at two places apart is not picked: the style names every place it has.

export const LAYERS = ["stop-label", "stop-label-pink", "stop-label-free", "stop-label-near", "spot-biz", "sandworm-nest-name", "stop-label-dock-name",
  "comet-station-landmark"]; // build_style.py PLACE_NAMES
export const MAX_NAMES = 4, CORRIDOR_M = 40, AHEAD_M = 1200, TURN_BEFORE_M = 90, TURN_AFTER_M = 25, EDGE_PX = 8;
const SIDES = ["left", "right", "top"]; // the text's anchor: right of the icon, left of it, below it (build_style.py PLACE_SIDES)
const EM = 1.25, WIDTH_EM = 10, LINE = 1.1, CHAR_EM = 0.58; // build_style.py PLACE_NAME_EM, PLACE_NAME_WIDTH, text-line-height; Atkinson Bold's average letter
const CONTROLS = "button, a[href], input, #gobar, #bar, #readout, .cturn, .cthen, #banner, #scale, #snack";
const ICONS = ["sandworm-nest", "stop-sign", "pulsar", "pulsar-far"]; // the other icons in the collisions, placed before the places' names (build_style.py order)

/** The places along the route ahead, ranked: within `corridor` metres of it, the next turn's (from `before` metres before it to `after`
 *  past) first, nearest the turn first, then the rest in the order they come. places: [{ name, lonlat }]; course: a Course (events.js). */
export function rankPlaces(places, { course, s, turnM = null }, { corridor = CORRIDOR_M, ahead = AHEAD_M, before = TURN_BEFORE_M, after = TURN_AFTER_M } = {}) {
  const seen = new Set(), out = [];
  const end = Math.min(course.length, s + ahead);
  if (end <= s) return out;
  const apart = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111195 > 2 * corridor;
  const twice = new Set(places.filter((p, i) => p.name && places.some((q, j) => j < i && q.name === p.name && apart(p.lonlat, q.lonlat))).map((p) => p.name)); // two "Dunkin'"s
  for (const p of places) {
    if (!p.name || seen.has(p.name) || twice.has(p.name)) continue;
    const { d, s: at } = course.distanceTo(p.lonlat, s, end);
    if (d > corridor || at < s) continue;
    seen.add(p.name);
    const turn = turnM !== null && at >= turnM - before && at <= turnM + after;
    out.push({ ...p, at, d, turn });
  }
  return out.sort((a, b) => (a.turn !== b.turn ? (a.turn ? -1 : 1) : a.turn ? Math.abs(a.at - turnM) - Math.abs(b.at - turnM) : a.at - b.at));
}

/** A name's box on the screen beside its icon at p ([x, y]), on `side`, at text size `px`. */
export function boxFor(name, p, side, px) {
  const chars = [...name].length, perLine = Math.floor(WIDTH_EM / CHAR_EM);
  const w = Math.min(chars, perLine) * CHAR_EM * px, h = Math.min(2, Math.ceil(chars / perLine)) * LINE * px, o = EM * px;
  if (side === "left") return [p[0] + o, p[1] - h / 2, p[0] + o + w, p[1] + h / 2];
  if (side === "right") return [p[0] - o - w, p[1] - h / 2, p[0] - o, p[1] + h / 2];
  return [p[0] - w / 2, p[1] + o, p[0] + w / 2, p[1] + o + h];
}

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function crosses(box, a, b) { // the segment a-b meets the box
  const inside = (q) => q[0] >= box[0] && q[0] <= box[2] && q[1] >= box[1] && q[1] <= box[3];
  if (inside(a) || inside(b)) return true;
  const c = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
  const ccw = (p, q, r) => (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]);
  const meet = (p, q, r, t) => ccw(p, r, t) !== ccw(q, r, t) && ccw(p, q, r) !== ccw(p, q, t);
  return c.some((r, i) => meet(a, b, r, c[(i + 1) % 4]));
}

/** The first side, in her order, whose box keeps inside `view` ([x0, y0, x1, y1]), off every rect in `keep` and clear of the route
 *  `line` (screen points) by `gap` px; null if none does. */
export function sideFor(name, p, px, { line = [], keep = [], view, gap = 4 }) {
  for (const side of SIDES) {
    const b = boxFor(name, p, side, px), g = [b[0] - gap, b[1] - gap, b[2] + gap, b[3] + gap];
    if (view && (b[0] < view[0] || b[1] < view[1] || b[2] > view[2] || b[3] > view[3])) continue;
    if (keep.some((k) => overlaps(g, k))) continue;
    if (line.some((q, i) => i > 0 && crosses(g, line[i - 1], q))) continue;
    return side;
  }
  return null;
}

/** The names to show in a ride: at most `max` of the ranked places, each with the side that clears the rest and the other icons
 *  (`icons`, screen points, each `half` px round it) and the names picked before it; { name: side }. */
export function pickNames(ranked, { project, px, line, keep, view, icons = [], half = 0, max = MAX_NAMES }) {
  const out = {}, taken = [...keep];
  for (const p of ranked) {
    if (Object.keys(out).length >= max) break;
    const q = project(p.lonlat), others = icons.filter((c) => Math.abs(c[0] - q[0]) > 1 || Math.abs(c[1] - q[1]) > 1).map((c) => [c[0] - half, c[1] - half, c[0] + half, c[1] + half]);
    const side = sideFor(p.name, q, px, { line, keep: [...taken, ...others], view });
    if (side) { out[p.name] = side; taken.push(boxFor(p.name, q, side, px)); }
  }
  return out;
}

/** The text size at a zoom (build_style.py PLACE_NAME_SIZE: 14 px at z16 to 16 at z18). */
export const sizeAt = (zoom) => Math.max(14, Math.min(16, 14 + zoom - 16));
/** A place's icon's half at a zoom (build_style.py PLACE_ICON_SIZE: 12 px at z16 to 17 at z18). */
export const iconHalfAt = (zoom) => 12 + 2.5 * Math.max(0, Math.min(2, zoom - 16));

/** The controls over the chart, as screen rects; the edges' strips too, with `edges`. */
export function keepRects(doc = document, w = innerWidth, h = innerHeight, edges = false) {
  const out = [];
  for (const el of doc.querySelectorAll(CONTROLS)) {
    if (el.closest(".maplibregl-canvas-container") || (el.checkVisibility ? !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : !el.offsetParent)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= w || r.top >= h || (r.width >= w * 0.95 && r.height >= h * 0.9)) continue; // a full-screen page covers the chart: not a control on it
    out.push([r.left, r.top, r.right, r.bottom]);
  }
  if (edges) out.push([0, 0, EDGE_PX, h], [w - EDGE_PX, 0, w, h], [0, 0, w, EDGE_PX], [0, h - EDGE_PX, w, h]); // inside the screen: an icon off it is in a tile not drawn
  return out;
}

const STEP = 8; // the keep-out icons' sizes are rounded up to this many px, so there are few of them
/** The keep-out layer's features for these rects: an empty icon over each, named by its size. */
export function keepFeatures(rects, unproject) {
  return rects.map(([x0, y0, x1, y1]) => {
    const w = Math.ceil((x1 - x0) / STEP) * STEP, h = Math.ceil((y1 - y0) / STEP) * STEP;
    return { type: "Feature", properties: { img: `keepout-${w}x${h}` }, geometry: { type: "Point", coordinates: unproject([(x0 + x1) / 2, (y0 + y1) / 2]) } };
  });
}

/** Mount the keep-out layer and the ride's names on the map. ride(): { course, s, turnM } in a ride with a route, else null. */
export function mountPlaceNames({ map, ride = () => null, flying = () => false, doc = document, now = () => performance.now() }) {
  const SRC = "label-keepout";
  let sentAt = -Infinity, rideAt = -Infinity, picked = null, anchors = null;
  const ensure = () => {
    if (!map.getStyle?.() || map.getSource(SRC)) return !!map.getSource(SRC);
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: SRC, type: "symbol", source: SRC, layout: { "icon-image": ["get", "img"], "icon-allow-overlap": true, "icon-padding": 0,
      "icon-rotation-alignment": "viewport", "icon-pitch-alignment": "viewport" }, paint: { "icon-opacity": 0 } }, map.getLayer("stop-sign") ? "stop-sign" : undefined);
    return true;
  };
  const image = (name) => { // an empty image of that size, at an eighth of its pixels
    if (map.hasImage(name)) return;
    const [w, h] = name.slice(8).split("x").map(Number);
    map.addImage(name, { width: Math.max(1, w / STEP), height: Math.max(1, h / STEP), data: new Uint8Array(Math.max(1, w / STEP) * Math.max(1, h / STEP) * 4) }, { pixelRatio: 1 / STEP });
  };
  function keepOut() {
    if (!ensure()) return;
    const c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    const features = keepFeatures(keepRects(doc, w, h, true), (pt) => map.unproject(pt).toArray());
    for (const f of features) image(f.properties.img);
    map.getSource(SRC).setData({ type: "FeatureCollection", features });
    sentAt = now();
  }
  function setAnchors(on) { // the ride's names keep to their picked side: no variable anchors, so text-anchor holds
    if (on === !!anchors) return;
    if (on) anchors = {};
    for (const id of LAYERS) {
      if (!map.getLayer(id)) continue;
      if (on) { anchors[id] = map.getLayoutProperty(id, "text-variable-anchor-offset"); map.setLayoutProperty(id, "text-variable-anchor-offset", undefined); }
      else if (anchors[id] !== undefined) map.setLayoutProperty(id, "text-variable-anchor-offset", anchors[id]);
    }
    if (!on) anchors = null;
  }
  function names() {
    const r = ride();
    if (!r?.course) {
      if (picked) { picked = null; setAnchors(false); map.setGlobalStateProperty?.("placenames", null); }
      return;
    }
    rideAt = now();
    const shown = (id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none", ids = LAYERS.filter(shown);
    const drawn = map.queryRenderedFeatures({ layers: [...ids, ...ICONS.filter(shown)] }).filter((f) => f.geometry.type === "Point");
    const places = drawn.filter((f) => f.properties.name && (!f.layer || LAYERS.includes(f.layer.id))).map((f) => ({ name: f.properties.name, lonlat: f.geometry.coordinates }));
    const project = (ll) => { const q = map.project(ll); return [q.x, q.y]; };
    const c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    const line = r.course.slice(Math.max(0, r.s - 150), Math.min(r.course.length, r.s + AHEAD_M)).map((q) => map.project(q)).map((q) => [q.x, q.y]);
    const ranked = rankPlaces(places, r), kept = (p) => !p.turn && !!picked?.[p.name]; // the names shown stay while they can, after the turn's
    const pick = pickNames([...ranked.filter((p) => p.turn), ...ranked.filter(kept), ...ranked.filter((p) => !p.turn && !kept(p))], { project, px: sizeAt(map.getZoom()), line,
      keep: keepRects(doc, w, h), view: [EDGE_PX, EDGE_PX, w - EDGE_PX, h - EDGE_PX], icons: drawn.map((f) => project(f.geometry.coordinates)), half: iconHalfAt(map.getZoom()) });
    if (picked && JSON.stringify(pick) === JSON.stringify(picked)) return;
    picked = pick;
    setAnchors(true);
    map.setGlobalStateProperty?.("placenames", pick);
  }
  // In flight the follow camera never stops: a new keep-out reloads its tile and asks for frames, so there it is sent every 5 s at most,
  // when a move ends (the frame governor's cruising 30 fps, app/framerate.js); the ride's names keep clear by their own picking.
  const moving = () => { if (!flying() && now() - sentAt >= 500) keepOut(); };
  const ended = () => { if (!flying() || now() - sentAt >= 5000) keepOut(); };
  map.on("moveend", ended);
  map.on("move", moving);
  map.on("resize", keepOut);
  const reloaded = () => { picked = anchors = null; rideAt = -Infinity; keepOut(); }; // a restored context's style: its own anchors and state again
  map.on("style.load", reloaded);
  if (map.isStyleLoaded?.()) keepOut(); else map.once("load", keepOut);
  return {
    /** From the course's progress (about once a second): the ride's names, again every 3 s at most. */
    update() { if (now() - rideAt >= 3000 || (!ride()?.course && picked)) names(); },
    refresh: keepOut,
    get picked() { return picked; },
    stop() { map.off("moveend", ended); map.off("move", moving); map.off("resize", keepOut); map.off("style.load", reloaded); },
  };
}
