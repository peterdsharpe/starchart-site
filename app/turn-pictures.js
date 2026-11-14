// W217 turnicons (design/app-ui/SPEC.md §416), her rows 19a and 20: an instruction's picture, the whole move and the junction as it is.
// Pure functions (no DOM): the turn card (app/course.js tick) and the turn list's rows (app/turns-logic.js turnRows) show what these give.
//
// - Two turns in a row ("Turn right, then left": a jog the router folded, `then`, or the turn the card says after it, CourseFlight
//   thenOf) are one picture, design/glyphs/maneuver/<first>_then_<second>.svg (design/glyphs/build.py pair_arrow; chart/prototype/
//   course.js arrowFile picks it).
// - A rotary is drawn from its own junction (the router's `ring`: Router.ring), her way in at the bottom, its roads at their angles
//   round it and her exit marked and numbered, at run time: ringInner, which draws as design/glyphs/build.py bh_ring does (the Icon
//   legend's black_hole_exit_*.svg are its evenly spaced ones, and app/tests/turnpics.test.mjs holds the two together). A rotary whose
//   junction isn't known (a demo course, a course planned before 0.1.104) has its exit and one road more, evenly round.
// The colours are design/tokens.json's (app/colours.js), the ones build.py's TOK reads: the accent is the token `course`.
import { COLOURS } from "./colours.js";
import { arrowFile } from "../chart/prototype/course.js";

const TOK = { ...COLOURS.color, ...COLOURS["color-map"] }; // design/glyphs/build.py's TOK: the chart's colours by night over the app's
const CO = TOK.course, BH = TOK["black-hole"], S3 = TOK["space-3"], LIGHT = TOK.starlight; // build.py's CO, BH, S3, LIGHT
// W219 sculgreen (SPEC §430): SCUL's accent, as build.py scul_twin draws SCUL's twins: its phosphor by night, the chrome's by day
const SCUL_NIGHT = COLOURS.color.phosphor, SCUL_DAY = COLOURS["color-light-chrome"].phosphor; // W219 sculgreen: build.py SCUL_NIGHT, SCUL_DAY
const by = (c) => `[fill="${SCUL_NIGHT}"]{fill:${c}}[stroke="${SCUL_NIGHT}"]{stroke:${c}}`; // W219 sculgreen
export const SCUL_STYLE = `<style>${by(SCUL_DAY)}@media (prefers-color-scheme:dark){${by(SCUL_NIGHT)}}</style>`; // W219 sculgreen: build.py themed(by(SCUL_DAY), by(SCUL_NIGHT))
const R = 'stroke-linecap="round" stroke-linejoin="round"';
const f = (n) => n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); // build.py f()
const line = (x1, y1, x2, y2, c, w) => `<path  d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}" stroke="${c}" stroke-width="${w}" ${R} fill="none"/>`;
const stroke = (d, c, w) => `<path  d="${d}" stroke="${c}" stroke-width="${w}" ${R} fill="none"/>`;
function head(x, y, dx, dy, c, w = 10.5) { // build.py head()
  const n = Math.hypot(dx, dy); dx /= n; dy /= n;
  const px = -dy, py = dx, tip = [x + dx * 8, y + dy * 8], a = [x - dx * 3 + px * w, y - dy * 3 + py * w], b = [x - dx * 3 - px * w, y - dy * 3 - py * w];
  return `<path d="M${f(tip[0])} ${f(tip[1])}L${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}Z" fill="${c}" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
}
/** build.py DIGITS: the exit's number, drawn in a 7.6 by 11 box round 0. */
export const DIGITS = {
  0: "M0 -5.5Q3.6 -5.5 3.6 0Q3.6 5.5 0 5.5Q-3.6 5.5 -3.6 0Q-3.6 -5.5 0 -5.5Z",
  1: "M-2 -3.6L1 -5.5V5.5",
  2: "M-3.4 -2.6Q-3.4 -5.5 0 -5.5Q3.4 -5.5 3.4 -2.6Q3.4 -0.4 -3.4 5.5H3.6",
  3: "M-3.2 -5.5H3.2L-0.4 -0.8Q3.8 -1 3.8 2.2Q3.8 5.5 0 5.5Q-2.6 5.5 -3.6 3.8",
  4: "M1.8 5.5V-5.5L-3.8 2.2H3.8",
  5: "M3.2 -5.5H-2.6L-3.2 -0.4Q-1.4 -1.6 0.4 -1.6Q3.8 -1.6 3.8 1.9Q3.8 5.5 0 5.5Q-2.5 5.5 -3.6 3.8",
  6: "M3 -5.5Q-3.6 -4.8 -3.6 1.8Q-3.6 5.5 0 5.5Q3.6 5.5 3.6 2.1Q3.6 -1.2 0 -1.2Q-2.6 -1.2 -3.5 0.8",
  7: "M-3.4 -5.5H3.6L-0.8 5.5",
  8: "M0 -0.4Q-3.2 -0.4 -3.2 -3Q-3.2 -5.5 0 -5.5Q3.2 -5.5 3.2 -3Q3.2 -0.4 0 -0.4Q-3.7 -0.4 -3.7 2.5Q-3.7 5.5 0 5.5Q3.7 5.5 3.7 2.5Q3.7 -0.4 0 -0.4Z",
  9: "M-3 5.5Q3.6 4.8 3.6 -1.8Q3.6 -5.5 0 -5.5Q-3.6 -5.5 -3.6 -2.1Q-3.6 1.2 0 1.2Q2.6 1.2 3.5 -0.8",
};
/** build.py number(): `k` in the ring's middle, two digits smaller side by side from 10. */
function number(k, cx, cy) {
  const dig = (d, x, s) => `<path d="${DIGITS[d]}" transform="translate(${f(x)} ${cy}) scale(${s})" stroke="${LIGHT}" stroke-width="2.4" ${R} fill="none"/>`;
  return k < 10 ? dig(k, cx, 1.25) : dig(Math.floor(k / 10) % 10, cx - 4, 0.85) + dig(k % 10, cx + 4, 0.85);
}

/** A rotary's picture (the inside of a 64 by 64 SVG), as build.py bh_ring: her way in at the bottom; a road for each of `ways` (the
 *  degrees round the ring from her way in, anticlockwise, as Router.ring gives them), `mine` hers, the accent's, out of the ring;
 *  `k`, her exit's number as the call says it, in the middle on its dark disc. */
export function ringInner(ways, mine, k, co = CO) { // W219 sculgreen: co, the accent (SCUL's SCUL_NIGHT)
  const cx = 32, cy = 32, r = 13.5;
  let out = `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${BH}" stroke-width="7" fill="none" opacity=".5"/><circle cx="${cx}" cy="${cy}" r="10" fill="${S3}"/>`;
  ways.forEach((a, j) => { const t = ((90 - a) * Math.PI) / 180; if (j !== mine) out += line(cx + r * Math.cos(t), cy + r * Math.sin(t), cx + 23 * Math.cos(t), cy + 23 * Math.sin(t), BH, 7); });
  const a = ways[mine], t = ((90 - a) * Math.PI) / 180, ex = cx + r * Math.cos(t), ey = cy + r * Math.sin(t), sx = cx + 21 * Math.cos(t), sy = cy + 21 * Math.sin(t);
  const d = `M32 63V${f(cy + r)}A${r} ${r} 0 ${a > 180 ? 1 : 0} 0 ${f(ex)} ${f(ey)}L${f(sx)} ${f(sy)}`;
  return out + stroke(d, co, 7) + head(sx, sy, Math.cos(t), Math.sin(t), co, 8.5) + number(k, cx, cy); // W219 sculgreen: co
}
/** build.py bh_exit: where the junction isn't known, the exit taken and one road more, evenly round. */
export const evenRing = (k) => ({ ways: Array.from({ length: k + 1 }, (_, j) => (360 * (j + 1)) / (k + 2)), mine: k - 1 });

const known = (ins) => ins.ring?.mine >= 0 && ins.ring.mine < (ins.ring.ways?.length || 0);
const pics = new WeakMap(); // an instruction's rotary picture, made once a word mode
/** The picture for instruction `ins`, with `then` the turn the card says after it (CourseFlight thenOf): a file name in
 *  design/glyphs/maneuver (arrowFile's), or a rotary's own picture as a data: URL, made once an instruction (where its junction isn't
 *  known, the file of its exit: build.py drew those as evenRing). W219 sculgreen: `plain` false, SCUL's, in its green (a file's name
 *  is the same: chart/prototype/banners.js glyphIn takes SCUL to its twin). */
export function turnPicture(ins, then = null, plain = true) {
  if (ins?.turn !== "black_hole" || (!known(ins) && (ins.exit || 1) <= 9)) return arrowFile(ins, then); // a rotary whose junction isn't known: its file, evenRing's
  const two = pics.get(ins) || {}; // W219 sculgreen: { true: Plain's, false: SCUL's }
  let src = two[plain];
  if (!src) {
    const k = Math.max(1, ins.exit || 1), { ways, mine } = known(ins) ? ins.ring : evenRing(k);
    src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${plain ? ringInner(ways, mine, k) : SCUL_STYLE + ringInner(ways, mine, k, SCUL_NIGHT)}</svg>`)}`; // W219 sculgreen
    pics.set(ins, { ...two, [plain]: src }); // W219 sculgreen
  }
  return src;
}
/** The picture's words for a screen reader: a rotary's roads where its junction is known ("Rotary with 4 exits"; SCUL "Black hole
 *  with 4 exits"), else none (the card's and the row's words say the move). */
export const turnAlt = (ins, plain) => (ins?.turn === "black_hole" && known(ins) ? `${plain ? "Rotary" : "Black hole"} with ${ins.ring.ways.length} ${ins.ring.ways.length === 1 ? "exit" : "exits"}` : "");
