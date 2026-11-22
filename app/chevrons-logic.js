// W229 chevrons (design/app-ui/SPEC.md §483), pancake's row 5 of 2026-11-13, her points 5 and 8: small, dense, open Vs over Climbs'
// levels, the tip uphill, the same size on the screen at every zoom, on an even triangular lattice fixed to the map; a whole V wherever
// any part of it touches a level; each part in the ink of the level under it, or of the V's own level where it sticks out onto flat
// ground; hidden only while raised hills are drawn. The pure parts, with app/chevrons.js's shaders as their twins (the GLSL there
// computes the same things, per vertex and per pixel); app/tests/chevrons.test.mjs tests these.
//
// Her sizes are cutout_field.py's at her final settings (SPLIT=1 LATTICE=tri INSET=any SCALE=0.7 ARM=0.65 THICK=1.04): her scripts'
// pixels are two CSS pixels (chart/terrain/README.md, "For the chevrons"), so a V is 5.82 CSS px across its arms' ends and 4.91 from
// its tip to their line, along its centre line, stroked 1.82 px with round ends and a mitred tip; the lattice is 14.14 px across and
// 12.25 between its rows, every other row shifted by half. Her renders drew each V as a MapLibre fill with its antialiased outline,
// which adds about half a device pixel all round at 2× (OUTLINE): measured on her renders by one measure for hers and ours
// (scratch/lanes/w229-chevrons-final.md, "Measured"), her Vs are that much bolder than her script's numbers, and so are these.
export const HER_PX = 2, OUTLINE = 0.23; // CSS px to one of her scripts' pixels; her fills' outline, CSS px each side
export const SCRIPT = { w: 6.4 * 0.7 * 0.65 * HER_PX, h: 5.4 * 0.7 * 0.65 * HER_PX, stroke: 1.25 * 0.7 * 1.04 * HER_PX }; // cutout_field.py's
export const V = { ...SCRIPT, stroke: SCRIPT.stroke + 2 * OUTLINE }; // as her renders show it
export const PITCH = 9.4 * 0.7 * Math.sqrt(2 / Math.sqrt(3)) * HER_PX, ROW = (PITCH * Math.sqrt(3)) / 2;
/** Lattice k has her pitch exactly at zoom k + PHASE: her Blue Hills (13.2) and Spring Hill (15.2) views (the parent's pick, a, of
 *  three: 12.6 and 13.2 can't both be exact with lattices nested by two). FADE: the next lattice's new points fade in over half a
 *  zoom centred on the half zoom, so the pitch on the screen stays between 0.84 and 1.19 of hers outside the fade and 0.71 to 1.41
 *  within it. */
export const PHASE = 0.2, FADE = 0.5;
/** Climbs' own zooms (chart/terrain/style.js CLIMBS_FROM, CLIMBS_FADE): none below z12, fading in to z12.5, as the shading does. */
export const FROM = 12, FROM_FADE = 0.5;
/** A level is R ≥ these after linear filtering (chart/terrain/README.md, "Climbs": R is the grade in tenths of a percent). */
export const LEVELS = [39.5, 69.5, 99.5];
/** Under this length of the decoded direction (of 1) there is no uphill to speak of: no V. */
export const NO_DIR = 0.02;
/** Raised hills (her point 8): the Vs fade out as the exaggeration rises from MIN (all but flat, app/terrain.js MIN_EXAGGERATION) to
 *  GONE, and back as it sinks. */
export const RISE = { min: 0.01, gone: 0.3 };

const sin = Math.sin(Math.atan2(V.w / 2, V.h)); // the half angle at the tip, between the axis and an arm
/** The V's points, in its own frame (CSS px; y uphill along its axis, the lattice point at 0, 0): the tip's centre A, an arm's end E
 *  (the other is its mirror), the mitre's point T and the inner corner N. */
export const A = [0, V.h / 2], E = [V.w / 2, -V.h / 2], ARM = Math.hypot(E[0] - A[0], E[1] - A[1]);
export const T = [0, V.h / 2 + V.stroke / 2 / sin], N = [0, V.h / 2 - V.stroke / 2 / sin];
const D = [(E[0] - A[0]) / ARM, (E[1] - A[1]) / ARM], NRM = [-D[1], D[0]]; // the right arm's way, and its normal
/** The V's reach about its lattice point (CSS px), its antialiasing aside: x ±R.x, y from -R.down to R.up. */
export const REACH = { x: V.w / 2 + V.stroke / 2, down: V.h / 2 + V.stroke / 2, up: T[1] };

/**
 * The V's signed distance (CSS px, negative inside) at (x, y) in its frame: folded about its axis, the right arm's strip of half the
 * stroke's width, which past the tip meets the axis in a point (the mitre), and a round end past E; inside, by the inner corner N, the
 * distance to N where that is nearer than the inner line.
 */
export function vDistance(x, y) {
  const qx = Math.abs(x) - A[0], qy = y - A[1], t = qx * D[0] + qy * D[1];
  if (t > ARM) return Math.hypot(qx - D[0] * ARM, qy - D[1] * ARM) - V.stroke / 2;
  const dn = qx * NRM[0] + qy * NRM[1], d = Math.abs(dn) - V.stroke / 2, rx = Math.abs(x) - N[0], ry = y - N[1];
  return d < 0 && dn < 0 && rx * D[0] + ry * D[1] < 0 ? -Math.min(Math.hypot(rx, ry), V.stroke / 2 - dn) : d;
}

/** The points of the V where the field is read to tell whether any part of it touches a level (CSS px, its frame): the mitre's point
 *  and the inner corner, and on each arm its outer edge at every fifth, its inner edge at every quarter and its round end every 45°,
 *  from the outer edge round to the inner (no two 1.5 px apart): every corner of its outline and its end within 0.07 px, so a level's
 *  straight edge is never missed by more, nor a level's smallest part (6,000 m², a disc 5.5 px across at z12, wider past it) by 0.1 px. */
export const SAMPLES = (() => {
  const out = [T, N], h = V.stroke / 2;
  for (const s of [1, -1]) {
    const along = (from, to, ts) => { for (const t of ts) out.push([s * (from[0] + (to[0] - from[0]) * t), from[1] + (to[1] - from[1]) * t]); };
    along(T, [E[0] + NRM[0] * h, E[1] + NRM[1] * h], [0.2, 0.4, 0.6, 0.8]); // the outer edge, from the tip's point
    along(N, [E[0] - NRM[0] * h, E[1] - NRM[1] * h], [0.25, 0.5, 0.75]); // the inner, from the inner corner
    for (let k = 0; k <= 4; k++) {
      const a = (Math.PI / 4) * k, ex = NRM[0] * Math.cos(a) + D[0] * Math.sin(a), ey = NRM[1] * Math.cos(a) + D[1] * Math.sin(a);
      out.push([s * (E[0] + ex * h), E[1] + ey * h]);
    }
  }
  return out;
})();

/** The level (0 flat, 1 gentle, 2 medium, 3 steep) of a filtered R. */
export const levelOf = (r) => (r >= LEVELS[2] ? 3 : r >= LEVELS[1] ? 2 : r >= LEVELS[0] ? 1 : 0);

/**
 * Does any part of a V touch a level, and what is its own level? `read(x, y)` is R at a point of the map (any units), the V at
 * (cx, cy) with its uphill unit vector (ux, uy) in those units, `px` of them to a CSS px. Its own level is the one under its centre;
 * where that is flat, the level most of its samples touch (her cutout_field.py: the band under its centroid, else the band it overlaps
 * most; a tie goes to the gentler). Returns { touch, own }.
 */
export function touches(read, cx, cy, ux, uy, px) {
  const nx = -uy, ny = ux, count = [0, 0, 0, 0];
  for (const [x, y] of SAMPLES) count[levelOf(read(cx + (nx * x + ux * y) * px, cy + (ny * x + uy * y) * px))]++;
  const centre = levelOf(read(cx, cy));
  let own = centre;
  if (!own) for (let l = 1; l <= 3; l++) if (count[l] > (own ? count[own] : 0)) own = l;
  return { touch: centre > 0 || count[1] + count[2] + count[3] > 0, own };
}

/** The ink's level of a part of a V: the level under it, or the V's own where it lies on flat ground (her point 5). */
export const partLevel = (under, own) => under || own;

/**
 * The lattice at a zoom: lattice `level` is drawn, its points `pitch` (and `row`) apart in mercator units (the world 1 wide), those
 * that aren't on the coarser lattice (`isNew`) at `fresh` of their opacity; `screen` is its pitch in CSS px at this zoom. Into `out`.
 */
export function lattice(zoom, out = {}) {
  const a = zoom - PHASE - FADE / 2, k = Math.floor(a), level = k + 1, f = a - k, pitch = PITCH / (512 * 2 ** (level + PHASE));
  out.level = level; out.pitch = pitch; out.row = (pitch * Math.sqrt(3)) / 2; out.fresh = Math.min(1, f / FADE); out.screen = PITCH * 2 ** (zoom - level - PHASE);
  return out;
}
/** A lattice's point (i, j) in mercator units: row j at j × row, every odd row shifted by half the pitch. */
export const latticePoint = ({ pitch, row }, i, j) => [i * pitch + (j & 1 ? pitch / 2 : 0), j * row];
/** Is point (i, j) of a lattice new, not a point of the next coarser one (whose rows are its even rows and every other point there)? */
export const isNew = (i, j) => (j & 1) === 1 || (i & 1) !== ((j >> 1) & 1);

/** The Vs' opacity at a zoom (Climbs' fade in from FROM), and while raised hills are drawn (`on3d`, at an exaggeration): her point 8. */
export const zoomOpacity = (z) => Math.min(1, Math.max(0, (z - FROM) / FROM_FADE));
export function riseOpacity(on3d, exaggeration) {
  if (!on3d) return 1;
  const t = Math.min(1, Math.max(0, (exaggeration - RISE.min) / (RISE.gone - RISE.min)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The ground the view shows, as a box in mercator units, into `out` ([x0, y0, x1, y1]), from `inv`, the inverse of the map's matrix
 * (column-major, mercator x, y, z to clip; invert()): each corner of the screen's ray to the ground, or its far end where it misses the
 * ground (above the horizon), each clamped to `far` (mercator units) about `centre`. No allocation.
 */
export function groundBox(inv, centre, far, out) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let c = 0; c < 4; c++) {
    onGround(inv, c & 1 ? 1 : -1, c & 2 ? 1 : -1, G);
    const x = Math.min(centre[0] + far, Math.max(centre[0] - far, G[0])), y = Math.min(centre[1] + far, Math.max(centre[1] - far, G[1]));
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  out[0] = x0; out[1] = y0; out[2] = x1; out[3] = y1;
  return out;
}
const G = new Float64Array(3);
/** Where the ray through clip (x, y) meets the ground (z 0), into o: o[2] is 1 where it does, 0 where it misses (o is its far end). */
export function onGround(inv, x, y, o) {
  const wn = inv[3] * x + inv[7] * y - inv[11] + inv[15], wf = inv[3] * x + inv[7] * y + inv[11] + inv[15];
  const nz = (inv[2] * x + inv[6] * y - inv[10] + inv[14]) / wn, fz = (inv[2] * x + inv[6] * y + inv[10] + inv[14]) / wf;
  const t = Math.abs(fz - nz) > 1e-15 ? -nz / (fz - nz) : -1, hit = t >= 0 && t <= 1, k = hit ? t : 1;
  for (let i = 0; i < 2; i++) { const n = (inv[i] * x + inv[4 + i] * y - inv[8 + i] + inv[12 + i]) / wn, f = (inv[i] * x + inv[4 + i] * y + inv[8 + i] + inv[12 + i]) / wf; o[i] = n + (f - n) * k; }
  o[2] = hit ? 1 : 0;
  return o;
}
/** A 4 × 4 matrix's inverse (column-major) into `o`; false if it has none. */
export function invert(a, o) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det; o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det; o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/**
 * The field's window: the K × K tiles of zoom z about a mercator point, as its corner tile, an axis at a time (v: x or y): for an odd K the centre's
 * tile and (K - 1) / 2 on each side, for an even K the K / 2 on each side of the nearest tile corner. Each tile has its slot in a
 * K × K texture at (tx mod K, ty mod K), so the window moves a row or a column at a time and neighbours stay neighbours.
 */
export const windowAt = (v, z, K) => (K & 1 ? Math.floor(v * 2 ** z) - (K - 1) / 2 : Math.round(v * 2 ** z) - K / 2); // one axis
export const slotOf = (t, K) => ((t % K) + K) % K;

/** A lattice point is drawn only this far inside the grade's window (the vertex shader): its V's reach and a pixel (CSS px), and SLACK of a
 *  z12 tile, the direction's half texel. */
export const MARGIN = Math.hypot(REACH.x, REACH.up) + 1, SLACK = 0.004;
/** How far from the view's centre a lattice point is always inside a grade window K z12 tiles wide (odd), mercator units, at zoom z. */
export const windowReach = (K, z) => ((K - 1) / 2 - SLACK) / 4096 - MARGIN / (512 * 2 ** z);
/**
 * The windows' widths in tiles for a screen `hd` CSS px from its centre to a corner, at most `max` (the GPU's largest texture, in tiles):
 * the grade's (z12) the least odd K that holds the lattice points out to the corners from FROM up, so a flat view's Vs reach them at any
 * bearing (3 on a phone, 5 on a tablet or a laptop, 7 on a desktop); the direction's (z10, four z12 tiles to one) the least that holds it.
 */
export function windowK(hd, max = Infinity) {
  let K = 3;
  while (windowReach(K, FROM) * 512 * 2 ** FROM < hd && K + 2 <= max) K += 2;
  return { grade: K, dir: Math.min(Math.ceil((K + 5) / 4), max) };
}
/**
 * The Vs' reach about the view's centre into `out` ([from, to], mercator units: whole to `from`, gone at `to`): `far` half-diagonals (a
 * tilted map's far side), the last 0.4 of it fading, but never past the grade's window (`reach`, windowReach), so they fade out before
 * its edge, never cut along it; and never fading within a corner's V, so a flat view is whole. `hd` the half-diagonal, `px` a CSS px.
 */
export function fadeRange(hd, px, reach, far, out) {
  const to = Math.min(far * hd * px, reach);
  out[0] = Math.min(Math.max(0.6 * to, (hd + MARGIN) * px), 0.99 * to); out[1] = to;
  return out;
}

// ---- W233 chevfast (design/app-ui/SPEC.md §488): each point's work once, and next to none over ground with no climb within reach --------
/** The coarse mask (a texture beside the grade's window, its slots the grade's): a cell of CELL × CELL grade texels holds, in each of its
 *  four channels, the steepest grade texel within MASK_D[k] texels of the cell (Chebyshev, the grade's window wrapped as its texture). */
export const CELL = 4, MASK_D = [2, 3, 4, 6];
/** How far from its lattice point a V's reads lie: the farthest of its samples (CSS px; its centre's read is at 0). */
export const RHO = Math.max(...SAMPLES.map(([x, y]) => Math.hypot(x, y)));
/** The reads' positions against the GPU's own (its float maths and sub-texel steps), grade texels: a cell answers for a point this near it. */
export const MASK_SLACK = 0.02;
/**
 * The mask's channel at zoom z (FROM and up): the least MASK_D that holds every texel a V's reads can touch, wherever in its cell the
 * point lies. A read at texel position s (the texture's own: texel i spans i to i + 1) filters texels floor(s - 0.5) and the next, so the
 * reads within r = RHO × 2^(12 - z) texels of a point touch texels at most ceil(r + 0.5) outside its cell.
 */
export function maskChannel(z) {
  const need = Math.ceil(RHO * 2 ** (GRADE_Z - z) + 0.5 + MASK_SLACK);
  const k = MASK_D.findIndex((d) => d >= need);
  return k < 0 ? MASK_D.length - 1 : k;
}
const GRADE_Z = 12; // the grade's tiles (app/chevrons.js GRADE.z)
/**
 * The mask's value (app/chevrons.js MASK_FS's twin): the steepest of `grade` (N × N texels, row-major, its values the R byte, wrapped)
 * within `d` texels of cell (cx, cy).
 */
export function maskTop(grade, N, cx, cy, d) {
  let top = 0;
  for (let y = cy * CELL - d; y < cy * CELL + CELL + d; y++) for (let x = cx * CELL - d; x < cx * CELL + CELL + d; x++) {
    const v = grade[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
    if (v > top) top = v;
  }
  return top;
}
/** The point at texel position (gx, gy) of the grade's texture (N texels wide) can touch a level only if its cell's top is in one. */
export const maskPasses = (mask, N, gx, gy, k) => {
  const M = N / CELL, cx = Math.min(M - 1, Math.floor((((gx % N) + N) % N) / CELL)), cy = Math.min(M - 1, Math.floor((((gy % N) + N) % N) / CELL));
  return mask[k][cy * M + cx] >= LEVELS[0];
};

/** W233 chevfast: part k (0 or 1) of the run from x0, n long, on a ring M around (n < M), as [from, length] into o; length 0 for none. */
export function span(x0, n, M, k, o = [0, 0]) {
  if (x0 < 0) { o[0] = k ? 0 : M + x0; o[1] = k ? n + x0 : -x0; } else if (x0 + n > M) { o[0] = k ? 0 : x0; o[1] = k ? x0 + n - M : M - x0; } else { o[0] = x0; o[1] = k ? 0 : n; }
  return o;
}

/** A point's word in the per-point target (RGBA32UI): its uphill unit vector's float bits, its own level (0: no V), what decided it
 *  (STATUS, for counts read on demand: outside the window's margin, no climb in the mask, no uphill direction, no level touched, a V by
 *  its outline's reads, a V by its centre in a level (three reads); and while counting, a masked point with no direction either, as W229
 *  would have read it). app/chevrons.js POINT_FS writes it with floatBitsToUint; the quads' vertices read it back. */
export const STATUS = { edge: 1, masked: 2, nodir: 3, none: 4, draws: 5, maskednodir: 6, inside: 7 };
const F32 = new Float32Array(2), U32 = new Uint32Array(F32.buffer);
export function packPoint(ux, uy, own, status, out = new Uint32Array(4)) {
  F32[0] = ux; F32[1] = uy; out[0] = U32[0]; out[1] = U32[1]; out[2] = own; out[3] = status;
  return out;
}
export function unpackPoint(t, o = 0) { U32[0] = t[o]; U32[1] = t[o + 1]; return { ux: F32[0], uy: F32[1], own: t[o + 2], status: t[o + 3] }; }

/** The per-point target's spare points each side, made at a still zoom, so a pan reads it again until it leaves them. */
export const PAD = 8;
/**
 * Must the per-point target be made again for the view's points (i0, j0: the first; ni × nj) at zoom z, the field at `key`? `T` is what it
 * holds ({ I0, J0, NI, NJ, z, key, i0, j0 }: its range, and the view's first point its float maths ran from). No, while it holds the view
 * at that zoom and key. Yes otherwise, and T becomes the new range: the view's own where the zoom moved since (a pinch reads only what it
 * shows), else the view and `pad` points each side. No allocation.
 */
export function targetFor(T, i0, j0, ni, nj, z, key, pad = PAD) {
  if (T.z === z && T.key === key && i0 >= T.I0 && j0 >= T.J0 && i0 + ni <= T.I0 + T.NI && j0 + nj <= T.J0 + T.NJ) return false;
  const p = T.z === z ? pad : 0;
  T.I0 = i0 - p; T.J0 = j0 - p; T.NI = ni + 2 * p; T.NJ = nj + 2 * p; T.z = z; T.key = key; T.i0 = i0; T.j0 = j0;
  return true;
}

/**
 * A frame's counts from the target's words (`t`: rows of TW points, 4 words each, read back on demand, made while counting), for the
 * view's points (i0, j0; ni × nj): the lattice points, those the mask passed, those that draw a V, each decision; and the texture reads of
 * the vertex stage, as this layer makes them (one a vertex) and as W229's did (each of a point's four vertices: the direction, then the
 * grade 27 times if it had one), `faded(i, j)` saying which points the reach's fade drops before any read. The per-point pass's reads
 * (one of the mask a point inside the margin; then the direction, the centre's grade and, where that is flat, its outline's 26) are its
 * own count, over the whole target. Into `out`.
 */
export function census(t, TW, T, i0, j0, ni, nj, faded, out = {}) {
  const n = [0, 0, 0, 0, 0, 0, 0, 0];
  let live = 0, w229 = 0;
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const s = t[((j0 - T.J0 + j) * TW + (i0 - T.I0 + i)) * 4 + 3];
    n[s]++;
    if (faded(i, j)) continue;
    live++;
    if (s !== STATUS.edge) w229 += s === STATUS.nodir || s === STATUS.maskednodir ? 1 : 28;
  }
  out.points = ni * nj; out.edge = n[STATUS.edge]; out.masked = n[STATUS.masked] + n[STATUS.maskednodir]; out.nodir = n[STATUS.nodir] + n[STATUS.maskednodir];
  out.none = n[STATUS.none]; out.draws = n[STATUS.draws] + n[STATUS.inside]; out.inside = n[STATUS.inside]; out.passed = n[STATUS.nodir] + n[STATUS.none] + out.draws; out.live = live;
  out.vertexReads = 4 * live; out.vertexReadsW229 = 4 * w229;
  let pass = 0;
  for (let j = 0; j < T.NJ; j++) for (let i = 0; i < T.NI; i++) {
    const s = t[(j * TW + i) * 4 + 3];
    pass += s === STATUS.edge ? 0 : s === STATUS.masked || s === STATUS.maskednodir ? 1 : s === STATUS.nodir ? 2 : s === STATUS.inside ? 3 : 29;
  }
  out.passReads = pass; out.passPoints = T.NI * T.NJ;
  return out;
}
