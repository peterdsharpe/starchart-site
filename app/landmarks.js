// W157 landmarks (design/app-ui/SPEC.md §279): a landmark at a turn, for Detailed directions. Her note (2026-10-25): "It
// would be great if Detailed directions also mentioned a landmark at turns, when available … If a stop sign or traffic light
// or bus stop or park is available, prefer those as landmarks over businesses."
//
// The landmark is said before the move, as "At the stop sign, turn left." always was, so it is joined from clips the same way:
// "After the traffic light, turn left.", "At the bus stop, turn right.", "Before Walgreens, turn left." Where it sits:
//   - at:     at the junction (a light within 40 m of the turn, a stop sign the course meets in the 40 m before it, as before;
//             a bus stop or a business within 30 m (a wide junction's corner: the router's turn point may sit on either of
//             its nodes); a park within 25 m of the turn's point)
//   - after:  passed on the way in, beside the course (within 15 m for a light, 25 m for a bus stop or a business), a light or
//             a stop sign 40–90 m before the turn (the junction before, a short block back), the others 30–70 m
//   - before: across the junction, straight ahead on the street the rider is on, 30–55 m past the turn's point and within
//             25 m of that line; only at a real turn (left, right or sharp), where straight ahead is not the new street
// Anything farther to the side is set back from the street, behind the corner or across a block, and the rider can't see it
// from the approach, so it doesn't count. Order: the junction's own light or stop sign (as Basic says it), then traffic light,
// stop sign, bus stop, park, then a business; at, after, before; the nearest. All from the phone's own data: the z15 tiles'
// pois and parks, and the router's stop signs.
import { metres } from "./geo.js";
import { KINDS } from "../chart/lingo/kinds.js"; // W188 kindsone

/** The pois that are businesses: the paid places (a shop, a convenience store, a café, a donut shop, a bar, ice cream, a bike
 *  shop). Also design/sound/scripts/landmark_bank.mjs, which counts their names. */
export const BIZ = Object.keys(KINDS).filter((k) => KINDS[k].group === "pay"); // W188 kindsone: chart/kinds.json's pay group, the style's pink
/** The order of preference, hers: a traffic light, a stop sign, a bus stop, a park, then a business. */
export const ORDER = ["light", "stop", "bus", "park", "biz"];
const RELS = ["at", "after", "before"];
/** The windows in metres, by kind: at (from the turn), after [far, near) before it along the course with `side` its farthest
 *  from the course, before (near, far] past it straight ahead. */
export const NEAR = {
  light: { at: 40, after: [90, 40], side: 15 },
  stop: { at: 40, after: [90, 40] },
  bus: { at: 30, after: [70, 30], before: [30, 55], side: 25 },
  park: { at: 25 },
  biz: { at: 30, after: [70, 30], before: [30, 55], side: 25 },
};
/** The turns that take a landmark: none for straight on, a rotary (its own "At the rotary,"), a U-turn or the end. "before"
 *  only where straight ahead is clearly not the new street. */
const TAKES = new Set(["left", "right", "sharp_left", "sharp_right", "slight_left", "slight_right", "keep_left", "keep_right"]);
const SQUARE = new Set(["left", "right", "sharp_left", "sharp_right"]);

/** The area's most frequent business names (design/sound/scripts/landmark_bank.mjs on tiles v16, 2026-10-25), the ones the
 *  voice names: each has a lazy clip per relation in every voice ("At CVS,", "After CVS,", "Before CVS,"). Every other
 *  business is named on the banner only, and the voice gives the turn without it. Names only, never a word about them. */
export const BANK = ["Dunkin'", "Starbucks", "7-Eleven", "CVS Pharmacy", "Caffè Nero", "Walgreens", "Whole Foods Market", "Star Market", "Target"]; // the
// top 16 less the phone shops, a parcel shop, a dollar store, a hair salon, a petrol station and a newsagent (a landmark is a storefront
// everyone knows), and Stop & Shop, heard as "stopping shop" in road noise
/** How a bank name is said, as its clip's text: the name people say ("CVS"), in words Kokoro reads right. */
export const SAY = { "Dunkin'": "Dunkin", "7-Eleven": "Seven Eleven", "CVS Pharmacy": "CVS", "Caffè Nero": "Caffe Nero",
  "Whole Foods Market": "Whole Foods" };

// a flat frame in metres around a point: x east, y north
const frame = (o) => { const kx = 111320 * Math.cos((o[1] * Math.PI) / 180), ky = 110540; return (p) => [(p[0] - o[0]) * kx, (p[1] - o[1]) * ky]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], dot = (a, b) => a[0] * b[0] + a[1] * b[1], len = (a) => Math.hypot(a[0], a[1]);

/** The course in to the turn as [[x, y], along offset (m, ≤ 0)] in the turn's frame, back to `back` metres, nearest first. */
function approach(line, along_m, at, back) {
  const xy = frame(at), cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + metres(line[i - 1], line[i]));
  let k = 0; // the vertex at the turn: the nearest to its point of those within 40 m of its distance along (the router's metres and ours differ a little)
  const near = (i) => Math.abs(cum[i] - along_m) <= 40, score = (i) => (near(i) ? metres(line[i], at) : 1e9 + Math.abs(cum[i] - along_m));
  for (let i = 1; i < line.length; i++) if (score(i) < score(k)) k = i;
  const out = [];
  for (let i = k; i >= 0; i--) { out.push([xy(line[i]), cum[i] - cum[k]]); if (cum[k] - cum[i] > back + 30) break; } // the first vertex past the limit too: a long straight in is one segment
  return { out, xy };
}

/** A point's place on the course in: [along offset, distance from the course], the nearest segment's. */
function onApproach(pts, p) {
  let best = [0, Infinity];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, sa] = pts[i], [b, sb] = pts[i + 1], ab = sub(b, a), l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0, q = [a[0] + ab[0] * t, a[1] + ab[1] * t], d = len(sub(p, q));
    if (d < best[1]) best = [sa + (sb - sa) * t, d];
  }
  return best;
}

/** A polygon's distance from the origin (0 inside), its rings in the frame. */
function polyDistance(rings) {
  let inside = false, best = Infinity;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [a, b] = [r[i], r[j]];
    if ((a[1] > 0) !== (b[1] > 0) && 0 < ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    const ab = sub(b, a), l2 = dot(ab, ab), t = l2 ? Math.max(0, Math.min(1, -dot(a, ab) / l2)) : 0;
    best = Math.min(best, len([a[0] + ab[0] * t, a[1] + ab[1] * t]));
  }
  return inside ? 0 : best;
}
const ringsOf = (g) => (g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []);

/**
 * The landmark at a turn, or null: { kind, rel, name? }, kind one of ORDER and rel one of "at", "after", "before".
 * `ins`: the instruction ({ turn, at: [lon, lat], along_m }). `line`: the course's geometry. The rest are what is near:
 * `lights`, `buses`, `biz` points ({ ll: [lon, lat], name? }), `stops` the router's ([along_m, lon, lat], the ones the course
 * meets from the approach they face; W177 mapmarks2: a fourth, 1, on an all-way stop, kind `stop_all`) and `parks` GeoJSON polygons.
 */
export function landmarkAt(ins, { line = [], lights = [], stops = [], buses = [], parks = [], biz = [] } = {}) {
  if (!ins?.at || !TAKES.has(ins.turn) || line.length < 2) return null;
  const { out: pts, xy } = approach(line, ins.along_m, ins.at, 90);
  if (pts.length < 2) return null;
  const T = pts[0][0], back = pts.find(([, s]) => s <= -20) || pts.at(-1), u0 = sub(T, back[0]), ul = len(u0) || 1, u = [u0[0] / ul, u0[1] / ul]; // the way in, over its last 20 m
  const where = (kind, p) => { // [rel, distance] or null
    const w = NEAR[kind], q = sub(xy(p), T), d = len(q);
    if (d <= w.at) return ["at", d];
    if (w.after) {
      const [s, side] = onApproach(pts, q);
      if (s >= -w.after[0] && s < -w.after[1] && side <= w.side) return ["after", -s];
    }
    if (w.before && SQUARE.has(ins.turn)) {
      const t = dot(q, u), off = Math.abs(q[0] * u[1] - q[1] * u[0]);
      if (t > w.before[0] && t <= w.before[1] && off <= w.side) return ["before", t];
    }
    return null;
  };
  const found = [];
  const add = (kind, list, name = () => undefined) => { for (const f of list) { const r = where(kind, f.ll); if (r) found.push({ kind, rel: r[0], d: r[1], name: name(f) }); } };
  add("light", lights);
  for (const [m, , , all] of stops) { // the router's own: along the course, so no side to check
    const s = m - ins.along_m, kind = all ? "stop_all" : "stop"; // W177 mapmarks2 (SPEC §314): an all-way stop, the stop sign's twin
    if (s <= 5 && s >= -NEAR.stop.at) found.push({ kind, rel: "at", d: -s });
    else if (s >= -NEAR.stop.after[0] && s < -NEAR.stop.after[1]) found.push({ kind, rel: "after", d: -s });
  }
  add("bus", buses);
  for (const g of parks) { const d = polyDistance(ringsOf(g).map((r) => r.map(xy).map((p) => sub(p, T)))); if (d <= NEAR.park.at) found.push({ kind: "park", rel: "at", d }); }
  add("biz", biz.filter((f) => f.name), (f) => f.name);
  if (!found.length) return null;
  const rank = (f) => ORDER.indexOf(f.kind === "stop_all" ? "stop" : f.kind); // W177 mapmarks2: an all-way stop is a stop sign
  const own = (f) => (f.rel === "at" && ["light", "stop", "stop_all"].includes(f.kind) ? 0 : 1); // the junction's own light or stop sign first, as Basic says it; W177 mapmarks2: stop_all
  found.sort((a, b) => own(a) - own(b) || rank(a) - rank(b) || RELS.indexOf(a.rel) - RELS.indexOf(b.rel) || a.d - b.d);
  const { kind, rel, name } = found[0];
  return name ? { kind, rel, name } : { kind, rel };
}

/** The landmark's words before the move, [SCUL, Plain]: "the pulsar", "the traffic light". A business is its name. */
const THING = { light: ["the pulsar", "the traffic light"], stop: ["the stop sign", "the stop sign"], stop_all: ["the all-way stop", "the all-way stop"], bus: ["the sandworm nest", "the bus stop"], // W177 mapmarks2: stop_all
  park: ["the terraform", "the park"] };
const REL = { at: "At", after: "After", before: "Before" };
/**
 * The landmark as a turn's call starts with it: "After the bus stop, " (a phrase and its comma, for promptLine and promptText),
 * or "". `spoken`: the voice's, where a business is named only from the bank (BANK, as its clip says it, SAY); otherwise "",
 * and the voice gives the turn alone. The banner names any business.
 */
export function markWords(mark, mode = "scul", spoken = false) {
  if (!mark) return "";
  if (mark.kind === "biz") {
    if (spoken && !BANK.includes(mark.name)) return "";
    return `${REL[mark.rel]} ${spoken ? SAY[mark.name] || mark.name : mark.name}, `;
  }
  return `${REL[mark.rel]} ${THING[mark.kind][mode === "meatspace" ? 1 : 0]}, `;
}

/** Every landmark phrase the voice can say that wasn't a clip before, as its clip's text, by mode: { scul, meatspace, both } (both:
 *  the stop sign, which the club has no word for, and the bank's names). "At the stop sign," and Plain's "At the traffic
 *  light," were clips already (W86 stops, W60 d), and SCUL's "At the pulsar,". All lazy (design/sound/voice/lines.json). */
export function markClips() {
  const marks = [["light", "after"], ["bus", "at"], ["bus", "after"], ["bus", "before"], ["park", "at"]];
  const words = (mode) => marks.map(([kind, rel]) => markWords({ kind, rel }, mode).trim());
  return { scul: words("scul"), meatspace: words("meatspace"),
    both: [markWords({ kind: "stop", rel: "after" }).trim(), ...BANK.flatMap((name) => RELS.map((rel) => markWords({ kind: "biz", rel, name }, "scul", true).trim()))] };
}
