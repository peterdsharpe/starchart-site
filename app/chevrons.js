// W229 chevrons (design/app-ui/SPEC.md §483), pancake's row 5 of 2026-11-13, her points 5 and 8: Climbs' uphill chevrons, one custom
// WebGL 2 layer just over the shading (chart/terrain/style.js climbsLayers) and under the water, the roads and the labels, as in her
// renders. Loaded by app/terrain.js only while Climbs is drawn, and taken out of the style when it isn't (the layer off).
//
// One instanced draw of one quad a lattice point, with no vertex buffer: the instance's number is its point (app/chevrons-logic.js
// lattice). W229's vertex shader read the uphill direction there and whether any part of its V touches a level (SAMPLES: 26 reads of
// the grade round its outline, and one at its centre), and dropped the quad if none did; W233's first pass does that now (below). The
// fragment shader draws the V by its distance (vDistance) and inks each pixel by the level under it, or by the V's own level where the
// ground there is flat (partLevel). The CPU's part a frame: the lattice's range over the ground in view (groundBox, from the map's
// matrix), the windows, targetFor and the uniforms; no allocation. The field (chart/terrain/README.md, "Climbs") is read from the
// stored files' tiles once each, decoded off the main thread (createImageBitmap) and kept in two small textures, each a K × K window
// of tiles about the view whose slots wrap (windowAt, slotOf; K by the screen's size, windowK), so a tile is read only when the view
// comes to it; the map repaints only when a tile arrives (and as Climbs and raised hills fade, which MapLibre or app/terrain.js
// drives).
// Sizes are CSS px at every device pixel ratio; the edges are antialiased over one device pixel.
//
// W233 chevfast (SPEC §488): each point's work once, not once a vertex, and next to none where no climb is within its V's reach. A first
// pass (prerender, POINT_FS) writes one texel a lattice point into the per-point target (RGBA32UI: its uphill unit vector's float bits,
// its own level, 0 for no V), made again only when the view leaves it, the zoom moves or a tile arrives (targetFor); the quads' vertices
// read their point's texel once each. A point whose centre is in a level stops there (its V drawn, in that level's ink, whatever its
// outline's reads say). Before any of the 27 reads a point asks the coarse mask once (CELL × CELL grade texels a cell, the steepest
// texel within each of MASK_D of it), which MASKH_FS and MASKV_FS make on the GPU for a grade slot and its border when its tile
// comes; a point it passes does exactly what W229's vertex shader did, so the Vs are the same pixels.
import { V, A, E, N, ARM, REACH, SAMPLES, LEVELS, NO_DIR, FROM, MARGIN, SLACK, lattice, zoomOpacity, riseOpacity, invert, onGround, groundBox, windowAt, slotOf, windowK, windowReach, fadeRange, CELL, MASK_D, maskChannel, STATUS, isNew, targetFor, census, span } from "./chevrons-logic.js"; // W233 chevfast: CELL to census

export { riseOpacity } from "./chevrons-logic.js"; // for app/terrain.js, which hides the layer once raised hills have faded it out
export const ID = "climb-chevrons";
/** The field's two windows: the grade (z12 tiles, one byte) and the uphill direction (z10 tiles, two bytes), each K × K tiles, K by the
 *  screen's size (windowK: 3 and 2 on a phone, its half-diagonal under one z12 tile from z12 up), wider when the screen grows past them. */
export const GRADE = { z: 12, size: 512, channels: 1 }, DIR = { z: 10, size: 512, channels: 2 };
/** How far from the view's centre the Vs reach on a tilted map, in half-diagonals of the screen: past it they would be specks. The last
 *  0.4 of it fades, and it ends inside the grade's window (fadeRange). The cap on lattice points a frame (a tilted or turned view's box). */
export const FAR = 2, MAX_POINTS = 40000;

const f = (x) => x.toFixed(5);
const v2 = ([x, y]) => `vec2(${f(x)}, ${f(y)})`;
const AA = 1.2; // the quad's margin past the V's reach, CSS px, for its antialiased edge
const LO = [-REACH.x - AA, -REACH.down - AA], HI = [REACH.x + AA, REACH.up + AA];
const DD = [(E[0] - A[0]) / ARM, (E[1] - A[1]) / ARM];

// W233 chevfast: the lattice point of a texel or an instance, from the reference point (u_par); W229's expression, its twin in both passes
const POINT = `int J = (u_par.y + j) & 3, I = (u_par.x + i) & 1;
  vec2 p = vec2((float(i) + float((J & 1) - (u_par.y & 1)) * 0.5) * u_step.x, float(j) * u_step.y);`;

const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform mat4 u_matrix;     // mercator, from the lattice's first point, to clip
uniform vec2 u_step;       // the lattice's pitch and its rows' spacing, mercator units
uniform ivec2 u_n;         // its points a row, and its rows
uniform ivec2 u_par;       // the first point's column mod 2 and row mod 4, on the whole lattice
uniform ivec2 u_at;        // the first point's texel in the per-point target
uniform float u_px;        // mercator units a CSS px at the view's zoom
uniform vec4 u_win;        // the grade's window: the first point in its tiles from its corner (xy), the corner's slot (zw: FS)
uniform float u_fresh;     // the new points' opacity (the finer lattice fading in)
uniform float u_alpha;     // the Vs' opacity (Climbs' fade in, raised hills)
uniform vec4 u_far;        // the view's centre, from the first point (xy), and the Vs whole to z from it, gone at w, mercator units
uniform usampler2D u_pts;  // the per-point target (POINT_FS): the uphill unit vector's float bits, the V's own level (0: none)
out vec2 v_local;          // the V's own frame, CSS px, y uphill
out vec2 v_win;            // the grade's window, tiles
flat out int v_own;        // the V's own level's ink, 0 to 2
out float v_a;
void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // dropped: outside the view
  int i = gl_InstanceID % u_n.x, j = gl_InstanceID / u_n.x;
  ${POINT}
  bool fresh = (J & 1) == 1 || I != ((J >> 1) & 1);
  float a = u_alpha * (fresh ? u_fresh : 1.0) * (1.0 - smoothstep(u_far.z, u_far.w, length(p - u_far.xy)));
  if (a < 0.004) return;
  uvec4 t = texelFetch(u_pts, ivec2(i, j) + u_at, 0);
  if (t.z == 0u) return;
  vec2 up = vec2(uintBitsToFloat(t.x), uintBitsToFloat(t.y)), nr = vec2(-up.y, up.x);
  vec2 w = u_win.xy + p * 4096.0;
  vec2 local = mix(${v2(LO)}, ${v2(HI)}, vec2(gl_VertexID & 1, gl_VertexID >> 1));
  vec2 q = (nr * local.x + up * local.y) * u_px;
  gl_Position = u_matrix * vec4(p + q, 0.0, 1.0);
  v_local = local; v_win = w + q * 4096.0; v_own = int(t.z) - 1; v_a = a;
}`;

/** W233 chevfast: one triangle over the viewport, for the passes that write a texel a point or a mask cell (gl_FragCoord is the texel). */
const FULL = `#version 300 es
void main() { gl_Position = vec4(float(gl_VertexID & 1) * 4.0 - 1.0, float(gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }`;

/** W233 chevfast: a lattice point's work, once (W229's vertex shader's, the mask's one read first): its texel in the per-point target. */
const POINT_FS = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_step;       // the lattice's pitch and its rows' spacing, mercator units
uniform ivec2 u_par;       // the reference point's column mod 2 and row mod 4 (the view's first point when the target was made)
uniform ivec2 u_from;      // the target's first point from the reference point (its pad: 0 or less)
uniform float u_px;        // mercator units a CSS px at the view's zoom
uniform vec4 u_win;        // the grade's window: the reference point in its tiles from its corner (xy), the corner's slot (zw)
uniform vec4 u_dwin;       // the direction's window, the same
uniform vec2 u_K;          // the windows' widths in tiles
uniform vec4 u_chan;       // the mask's channel at this zoom (maskChannel), one-hot
uniform bool u_count;      // counting (read on demand): a masked point's direction read too, for its STATUS alone
uniform sampler2D u_grade; // R: the grade in 0.1 %
uniform sampler2D u_dir;   // R, G: the uphill direction east and north, 128 + 127 × each
// both at the default precision, as W229's vertex shader declared them: highp moved 9,708 pixels by up to 6/255 on tower (SPEC §488)
uniform highp sampler2D u_mask; // the steepest grade within MASK_D texels of a cell of CELL × CELL (MASKH_FS, MASKV_FS)
out uvec4 o;
const int NS = ${SAMPLES.length};
const vec2 S[NS] = vec2[NS](${SAMPLES.map(v2).join(", ")});
int lvl(vec2 w) {
  float r = textureLod(u_grade, (w + u_win.zw) / u_K.x, 0.0).r * 255.0;
  return r >= ${f(LEVELS[2])} ? 3 : r >= ${f(LEVELS[1])} ? 2 : r >= ${f(LEVELS[0])} ? 1 : 0;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int i = c.x + u_from.x, j = c.y + u_from.y;
  ${POINT}
  o = uvec4(0u, 0u, 0u, ${STATUS.edge}u);
  vec2 w = u_win.xy + p * 4096.0;
  float m = ${f(MARGIN)} * u_px * 4096.0 + ${f(SLACK)};
  if (any(lessThan(w, vec2(m))) || any(greaterThan(w, vec2(u_K.x - m)))) return;
  float n = u_K.x * 512.0;
  vec2 g = mod((w + u_win.zw) * 512.0, n); // the point in the grade's texels, as the texture wraps
  bool masked = dot(texelFetch(u_mask, min(ivec2(g / ${f(CELL)}), ivec2(n / ${f(CELL)}) - 1), 0), u_chan) * 255.0 < ${f(LEVELS[0])};
  o.w = ${STATUS.masked}u;
  if (masked && !u_count) return;
  vec2 d = textureLod(u_dir, (u_dwin.xy + p * 1024.0 + u_dwin.zw) / u_K.y, 0.0).rg * 255.0 - 128.0;
  o.w = masked ? ${STATUS.maskednodir}u : ${STATUS.nodir}u;
  if (length(d) < ${f(NO_DIR * 127)}) return;
  o.w = ${STATUS.masked}u;
  if (masked) return;
  vec2 up = normalize(vec2(d.x, -d.y)), nr = vec2(-up.y, up.x); // mercator's y runs south
  int own = lvl(w); // in a level, its centre's is its own and the V is drawn: its outline's reads would change neither
  o = uvec4(floatBitsToUint(up.x), floatBitsToUint(up.y), uint(own), ${STATUS.inside}u);
  if (own > 0) return;
  float k = u_px * 4096.0;
  int c1 = 0, c2 = 0, c3 = 0;
  for (int s = 0; s < NS; s++) {
    int l = lvl(w + (nr * S[s].x + up * S[s].y) * k);
    c1 += int(l == 1); c2 += int(l == 2); c3 += int(l == 3);
  }
  o.zw = uvec2(0u, ${STATUS.none}u);
  if (c1 + c2 + c3 == 0) return;
  own = c1 >= c2 && c1 >= c3 ? 1 : c2 >= c3 ? 2 : 3;
  o.zw = uvec2(uint(own), ${STATUS.draws}u);
}`;

/** W233 chevfast: the mask in two passes (maskTop's twin, the square split in rows and columns: (CELL + 2 × 6) reads a texel, not its square).
 *  The first: for a column of cells and a texel row about a grade slot, the steepest texel within each of MASK_D of the cells' columns. */
const DM = MASK_D[MASK_D.length - 1];
const MASKH_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_grade;
uniform int u_size;        // the grade's texture, texels a side
uniform ivec2 u_origin;    // the run's first cell (a grade slot's first, less MASK_B), not wrapped
out vec4 o;
void main() {
  ivec2 l = ivec2(gl_FragCoord.xy);
  int cx = (u_origin.x + l.x) * ${CELL}, ty = u_origin.y * ${CELL} - ${DM} + l.y;
  vec4 top = vec4(0.0);
  for (int x = -${DM}; x < ${CELL + DM}; x++) {
    ivec2 t = ivec2(cx + x, ty);
    t += u_size * (ivec2(lessThan(t, ivec2(0))) - ivec2(greaterThanEqual(t, ivec2(u_size))));
    int e = max(max(-x, x - ${CELL - 1}), 0); // texels outside the cell's columns
    top = max(top, texelFetch(u_grade, t, 0).r * vec4(greaterThanEqual(ivec4(${MASK_D.join(", ")}), ivec4(e))));
  }
  o = top;
}`;
/** W233 chevfast: the second: a mask cell, the steepest of the first pass's rows within each of MASK_D of its own, channel by channel. */
const MASKV_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_h;  // MASKH_FS's run
uniform ivec2 u_origin;       // its first cell, not wrapped
uniform int u_cells;          // the mask's cells a side
out vec4 o;
void main() {
  ivec2 l = ivec2(gl_FragCoord.xy) - u_origin; // the cell in the run, the mask wrapped
  l += u_cells * (ivec2(lessThan(l, ivec2(0))) - ivec2(greaterThanEqual(l, ivec2(u_cells))));
  vec4 top = vec4(0.0);
  for (int y = -${DM}; y < ${CELL + DM}; y++) {
    int e = max(max(-y, y - ${CELL - 1}), 0); // rows outside the cell's
    top = max(top, texelFetch(u_h, ivec2(l.x, l.y * ${CELL} + ${DM} + y), 0) * vec4(greaterThanEqual(ivec4(${MASK_D.join(", ")}), ivec4(e))));
  }
  o = top;
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_grade;
uniform vec4 u_win;
uniform vec2 u_K;
uniform vec3 u_ink[3];     // the levels' inks, gentle to steep
in vec2 v_local;
in vec2 v_win;
flat in int v_own;
in float v_a;
out vec4 o;
float edge(float r, float at, float fr) { return clamp((r - at) / fr + 0.5, 0.0, 1.0); }
void main() {
  // the V (chevrons-logic.js vDistance): its right arm's strip past the fold (the tip a mitre), a round end past E
  vec2 q = vec2(abs(v_local.x), v_local.y) - ${v2(A)};
  float t = dot(q, ${v2(DD)});
  float dn = dot(q, ${v2([-DD[1], DD[0]])});
  float d = (t > ${f(ARM)} ? length(q - ${v2(DD)} * ${f(ARM)}) : abs(dn)) - ${f(V.stroke / 2)};
  vec2 rn = vec2(abs(v_local.x), v_local.y) - ${v2(N)}; // inside, by the inner corner: the corner's distance where it is nearer
  if (t <= ${f(ARM)} && d < 0.0 && dn < 0.0 && dot(rn, ${v2(DD)}) < 0.0) d = -min(length(rn), ${f(V.stroke / 2)} - dn);
  float a = clamp(0.5 - d / max(length(vec2(dFdx(d), dFdy(d))), 1e-4), 0.0, 1.0) * v_a;
  if (a <= 0.0) discard;
  // the ink of the level under the pixel, its edges antialiased; on flat ground the V's own
  float r = textureLod(u_grade, (v_win + u_win.zw) / u_K.x, 0.0).r * 255.0, fr = max(length(vec2(dFdx(r), dFdy(r))), 1e-3);
  float l1 = edge(r, ${f(LEVELS[0])}, fr), l2 = edge(r, ${f(LEVELS[1])}, fr), l3 = edge(r, ${f(LEVELS[2])}, fr);
  vec3 c = u_ink[v_own] * (1.0 - l1) + u_ink[0] * (l1 - l2) + u_ink[1] * (l2 - l3) + u_ink[2] * l3;
  o = vec4(c * a, a);
}`;

export const SHADERS = { VS, FS, FULL, POINT_FS, MASKH_FS, MASKV_FS }; // for app/tests/chevrons.test.mjs: the twins of app/chevrons-logic.js; W233 chevfast: the passes'
/** W233 chevfast: each program's shaders and uniforms: the Vs' draw, the per-point pass, the mask's two. */
const PROGRAMS = {
  draw: [VS, FS, ["u_matrix", "u_step", "u_n", "u_par", "u_at", "u_px", "u_win", "u_K", "u_fresh", "u_alpha", "u_far", "u_pts", "u_grade", "u_ink"]],
  point: [FULL, POINT_FS, ["u_step", "u_par", "u_from", "u_px", "u_win", "u_dwin", "u_K", "u_chan", "u_count", "u_grade", "u_dir", "u_mask"]],
  maskh: [FULL, MASKH_FS, ["u_grade", "u_size", "u_origin"]],
  maskv: [FULL, MASKV_FS, ["u_h", "u_origin", "u_cells"]],
};
const MASK_B = Math.ceil(MASK_D[MASK_D.length - 1] / CELL); // W233 chevfast: a grade slot's mask cells and this many past each side
const SX = [0, 0], SY = [0, 0];

/**
 * The chevrons' layer. `field`: { grade, dir }, each a PMTiles (getZxy) of the stored files, or null while they aren't (nothing drawn);
 * `inks()`: the levels' three inks (hex) for the theme now, the same array while it doesn't change; `hills`: app/terrain.js's state,
 * whose on3d says whether raised hills are drawn (the map's terrain then has their exaggeration).
 */
export class ClimbChevrons {
  constructor({ field, inks, hills }) {
    this.id = ID; this.type = "custom"; this.renderingMode = "2d";
    this.field = field; this.inks = inks; this.hills = hills;
    this.matrix = new Float32Array(16); this.inv = new Float64Array(16); this.box = new Float64Array(4); this.centre = new Float64Array(3); this.fade = new Float64Array(2);
    this.ink = new Float32Array(9); this.inked = null; this.L = {};
    // for tests: adds, its onAdds (one more after each restored context); W233 chevfast: builds, the per-point passes; masks, the mask's slot
    // passes; and while `count` is set (read on demand: each pass is read back, a stall), the frame's points that pass the mask and that draw
    this.stats = { points: 0, draws: 0, tiles: 0, adds: 0, lattice: 0, pitch: 0, fresh: 0, alpha: 0, builds: 0, masks: 0, passed: null, drawn: null, census: null, bytes: 0 };
    this.queue = []; // decoded tiles, uploaded at the next frame
    this.count = false; this.chan = new Float32Array(4); this.T = { z: NaN }; // W233 chevfast
  }

  /** Added, and added again after a lost WebGL context (keepLayer, chart/prototype/gl-layer.js): new GL objects, the tiles read again. */
  onAdd(map, gl) {
    this.map = map; this.gl = gl; this.ready = false; this.broken = false; this.stats.adds++;
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    this.progs = {}; this.shaders = []; // W233 chevfast: four programs
    for (const [k, [vs, fs]] of Object.entries(PROGRAMS)) {
      const p = (this.progs[k] = gl.createProgram()), two = [sh(gl.VERTEX_SHADER, vs), sh(gl.FRAGMENT_SHADER, fs)];
      for (const s of two) gl.attachShader(p, s);
      gl.linkProgram(p); // its status is asked once it's done (linked()), so the compile overlaps the next frames
      this.shaders.push(...two);
    }
    this.vao = gl.createVertexArray(); // no attributes: a point is its instance's number, a corner its vertex's
    this.win = {}; this.fitted = NaN; this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); this.maxTiles = Math.floor(this.maxTex / GRADE.size);
    this.target = null; this.T = { z: NaN }; this.version = 0; this.words = null; this.run = null; this.drawn = false; // W233 chevfast: the per-point target and the mask's run, made in a frame
    for (const q of this.queue) q.bmp?.close();
    this.queue.length = 0;
    this.fit(this.halfDiagonal());
  }

  /** The screen's half-diagonal, CSS px. */
  halfDiagonal() { // rel-0.1.122 (the re-review's P2): from the map's own size, CSS px: the drawing buffer is clamped at 4,096 device px while getPixelRatio() isn't
    const t = this.map.transform, w = t?.width, h = t?.height;
    return (w > 0 && h > 0 ? Math.hypot(w, h) : Math.hypot(this.gl.drawingBufferWidth, this.gl.drawingBufferHeight) / this.map.getPixelRatio()) / 2;
  }

  /** Windows wide enough for a screen `hd` CSS px from its centre to a corner (windowK): made at onAdd, made wider (never narrower) when
   *  the screen grows past them, their tiles read again. W233 chevfast: the grade's with its mask, as many cells as it has CELLs. */
  fit(hd) {
    if (hd === this.fitted) return; // a frame's usual case: nothing to do, nothing allocated
    this.fitted = hd;
    const gl = this.gl, K = windowK(hd, this.maxTiles);
    if (this.win.grade?.K >= K.grade && this.win.dir?.K >= K.dir) return;
    for (const [k, w] of [["grade", GRADE], ["dir", DIR]]) {
      const old = this.win[k];
      if (old?.K >= K[k]) continue;
      if (old) { for (const s of old.slots) if (s) s.gone = true; gl.deleteTexture(old.tex); if (old.mask) { gl.deleteTexture(old.mask); gl.deleteFramebuffer(old.fbo); } }
      const tex = gl.createTexture(), n = K[k] * w.size, fmt = w.channels === 1 ? [gl.R8, gl.RED] : [gl.RG8, gl.RG];
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt[0], n, n);
      for (const [q, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, q, v);
      this.win[k] = { ...w, K: K[k], tex, fmt: fmt[1], tx: NaN, ty: NaN, slots: new Array(K[k] * K[k]).fill(null), zero: old?.zero ?? null, has: 0 };
      if (k === "grade") { // W233 chevfast: its mask, the slots whose mask must be made again
        const W = this.win[k], m = n / CELL;
        W.mask = this.texture(gl.RGBA8, m, m); W.fbo = null; W.dirty = new Uint8Array(K[k] * K[k]); // its framebuffer made in a frame (masks())
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.version++; this.sized();
  }

  /** W233 chevfast: a texture of one level, read texel by texel (texelFetch). */
  texture(fmt, w, h) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    for (const [q, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, q, v);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
  framebuffer(tex) { const gl = this.gl, fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return fb; }
  /** W233 chevfast: the layer's texture memory, bytes (for counts). */
  sized() {
    const g = this.win.grade, d = this.win.dir, t = this.target, r = this.run;
    this.stats.bytes = (g ? (g.K * g.size) ** 2 * (1 + 4 / CELL ** 2) : 0) + (d ? (d.K * d.size) ** 2 * 2 : 0) + (t ? t.w * t.h * 16 : 0) + (r ? r.w * r.h * 4 : 0);
  }

  onRemove(map, gl) {
    for (const w of Object.values(this.win ?? {})) for (const s of w.slots) if (s) s.gone = true;
    this.queue.length = 0;
    if (gl.isContextLost()) return;
    for (const s of this.shaders) gl.deleteShader(s);
    for (const p of Object.values(this.progs)) gl.deleteProgram(p);
    gl.deleteVertexArray(this.vao);
    for (const w of Object.values(this.win)) { gl.deleteTexture(w.tex); if (w.mask) { gl.deleteTexture(w.mask); gl.deleteFramebuffer(w.fbo); } }
    for (const t of [this.target, this.run]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
  }

  /** Are the programs linked? Asks the driver only once they're done, then never again. */
  linked() {
    if (this.ready) return true;
    const gl = this.gl, ps = Object.values(this.progs);
    if (this.broken || gl.isContextLost()) return false;
    if (this.parallel && ps.some((p) => !gl.getProgramParameter(p, this.parallel.COMPLETION_STATUS_KHR))) { this.map.triggerRepaint(); return false; }
    if (ps.some((p) => !gl.getProgramParameter(p, gl.LINK_STATUS))) {
      this.broken = true;
      console.error("climb-chevrons:", [...ps.map((p) => gl.getProgramInfoLog(p)), ...this.shaders.map((s) => gl.getShaderInfoLog(s))].filter(Boolean).join("\n"));
      return false;
    }
    this.u = {};
    for (const [k, [, , names]] of Object.entries(PROGRAMS)) { const u = (this.u[k] = {}); for (const n of names) u[n] = gl.getUniformLocation(this.progs[k], n); }
    return (this.ready = true);
  }

  /** The field's files came (or went): read the windows again. */
  setField(field) { this.field = field; for (const w of Object.values(this.win ?? {})) { w.tx = w.ty = NaN; w.has = 0; for (const s of w.slots) if (s) s.gone = true; w.slots.fill(null); } this.version++; this.map?.triggerRepaint(); }

  /** Move a window to the tiles about (x, y): each slot that holds another tile is cleared and its tile asked for. */
  place(w, src, x, y) {
    const tx = windowAt(x, w.z, w.K), ty = windowAt(y, w.z, w.K);
    if (w.tx === tx && w.ty === ty) return;
    w.tx = tx; w.ty = ty; this.version++; // W233 chevfast: the points' texels read the window from its corner
    const gl = this.gl, n = 2 ** w.z;
    for (let a = 0; a < w.K; a++) for (let b = 0; b < w.K; b++) {
      const X = tx + a, Y = ty + b, s = slotOf(X, w.K) + w.K * slotOf(Y, w.K), key = `${X}/${Y}`;
      if (w.slots[s]?.key === key) continue;
      if (w.slots[s]) { w.slots[s].gone = true; if (w.slots[s].data) w.has--; }
      const slot = (w.slots[s] = { key, ready: false, data: false, gone: false });
      w.zero ??= new Uint8Array(w.size * w.size * w.channels);
      gl.bindTexture(gl.TEXTURE_2D, w.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, slotOf(X, w.K) * w.size, slotOf(Y, w.K) * w.size, w.size, w.size, w.fmt, gl.UNSIGNED_BYTE, w.zero);
      if (X < 0 || Y < 0 || X >= n || Y >= n || !src) { slot.ready = true; continue; }
      src.getZxy(w.z, X, Y).then((t) => t?.data ? createImageBitmap(new Blob([t.data], { type: "image/webp" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" }) : null)
        .then((bmp) => {
          if (slot.gone) { bmp?.close(); return; }
          this.queue.push({ w, slot, bmp, x: slotOf(X, w.K) * w.size, y: slotOf(Y, w.K) * w.size });
          this.map.triggerRepaint();
        })
        .catch((err) => { slot.ready = true; console.warn("climb-chevrons: a tile:", err.message); });
    }
  }

  /** The tiles decoded since the last frame, into their slots (a slot moved on since is skipped). W233 chevfast: a grade slot that came,
   *  with its tile or none, has its mask made again (masks()); the per-point target is made again. */
  upload() {
    const gl = this.gl;
    while (this.queue.length) {
      const { w, slot, bmp, x, y } = this.queue.shift();
      if (!slot.gone && bmp && bmp.width === w.size && bmp.height === w.size) {
        gl.bindTexture(gl.TEXTURE_2D, w.tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w.fmt, gl.UNSIGNED_BYTE, bmp);
        slot.data = true; w.has++; this.stats.tiles++; this.version++;
      }
      if (!slot.gone && w.dirty) w.dirty[x / w.size + w.K * (y / w.size)] = 1;
      slot.ready = true;
      bmp?.close();
    }
  }

  /** W233 chevfast: the mask of each grade slot whose tile came, and of the border cells about it whose reach goes into it: its run of
   *  columns (MASKH_FS), then its cells (MASKV_FS), wrapped on the mask as the slots are. */
  masks() {
    const gl = this.gl, g = this.win.grade, M = (g.K * g.size) / CELL, S = g.size / CELL, n = S + 2 * MASK_B, u = this.u;
    let any = false;
    for (let s = 0; s < g.dirty.length; s++) {
      if (!g.dirty[s]) continue;
      g.dirty[s] = 0;
      if (!any) {
        any = true; this.plain(); gl.bindVertexArray(this.vao);
        if (!this.run) { const tex = this.texture(gl.RGBA8, n, n * CELL + 2 * DM); this.run = { tex, fbo: this.framebuffer(tex), w: n, h: n * CELL + 2 * DM }; this.sized(); }
      }
      const x0 = (s % g.K) * S - MASK_B, y0 = Math.floor(s / g.K) * S - MASK_B; // wraps once at most: K ≥ 3
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.run.fbo); gl.viewport(0, 0, this.run.w, this.run.h);
      gl.useProgram(this.progs.maskh);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.uniform1i(u.maskh.u_grade, 0); gl.uniform1i(u.maskh.u_size, g.K * g.size); gl.uniform2i(u.maskh.u_origin, x0, y0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, (g.fbo ??= this.framebuffer(g.mask)));
      gl.useProgram(this.progs.maskv);
      gl.bindTexture(gl.TEXTURE_2D, this.run.tex);
      gl.uniform1i(u.maskv.u_h, 0); gl.uniform2i(u.maskv.u_origin, x0, y0); gl.uniform1i(u.maskv.u_cells, M);
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const X = span(x0, n, M, a, SX), Y = span(y0, n, M, b, SY);
        if (X[1] > 0 && Y[1] > 0) { gl.viewport(X[0], Y[0], X[1], Y[1]); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      }
      this.stats.masks++;
    }
    if (any) { gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null); this.version++; }
  }

  /** W233 chevfast: no blend, test or mask for a pass that writes texels (MapLibre sets its own state again after prerender). */
  plain() {
    const gl = this.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); // no array: a pinch's every frame
    gl.colorMask(true, true, true, true);
  }

  /**
   * W233 chevfast: the frame's work before MapLibre draws (its offscreen pass): the ground in view, the windows and their tiles, the masks of
   * the slots whose tiles came, and the per-point target when the view has left it, the zoom moved or a tile came (targetFor). Nothing
   * allocated; nothing done while the Vs draw nothing (below z12, no field, faded out under raised hills).
   */
  prerender(gl, args) {
    const map = this.map, z = map.getZoom(), st = this.stats;
    this.drawn = false; st.points = st.draws = 0;
    if (z < FROM || !this.field || !this.linked()) return;
    const alpha = (st.alpha = zoomOpacity(z) * riseOpacity(this.hills.on3d, map.terrain?.exaggeration ?? 0));
    if (alpha <= 0) return;
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
    if (!invert(m, this.inv)) return;
    // the ground in view: the screen's centre on the ground, and its corners' rays, out to FAR half-diagonals from it, inside the windows
    const hd = this.halfDiagonal(), px = 1 / (512 * 2 ** z);
    this.fit(hd);
    const g = this.win.grade, dw = this.win.dir, fade = fadeRange(hd, px, windowReach(g.K, z), FAR, this.fade);
    const c = onGround(this.inv, 0, 0, this.centre), box = groundBox(this.inv, c, fade[1], this.box);
    this.place(g, this.field.grade, c[0], c[1]);
    this.place(dw, this.field.dir, c[0], c[1]);
    this.upload();
    if (!g.has || !dw.has) return; // no field tile here: nothing drawn
    this.masks();
    const L = lattice(z, this.L);
    let i0 = Math.floor(box[0] / L.pitch) - 1, i1 = Math.ceil(box[2] / L.pitch) + 1, j0 = Math.floor(box[1] / L.row) - 1, j1 = Math.ceil(box[3] / L.row) + 1;
    let ni = i1 - i0 + 1, nj = j1 - j0 + 1;
    if (ni * nj > MAX_POINTS) { // a cap: the box shrunk about the centre
      const k = Math.sqrt(MAX_POINTS / (ni * nj)), ci = c[0] / L.pitch, cj = c[1] / L.row;
      i0 = Math.floor(ci - (ci - i0) * k); i1 = Math.ceil(ci + (i1 - ci) * k); j0 = Math.floor(cj - (cj - j0) * k); j1 = Math.ceil(cj + (j1 - cj) * k);
      ni = i1 - i0 + 1; nj = j1 - j0 + 1;
    }
    // the first point, in float64, as the matrix's origin: the shader's positions stay small and exact to z18 and past
    const ox = i0 * L.pitch + (j0 & 1 ? L.pitch / 2 : 0), oy = j0 * L.row, G = 2 ** g.z, Dz = 2 ** dw.z;
    const win = (this.uwin ??= new Float32Array(8)); // the windows' uniforms, from the first point
    win[0] = ox * G - g.tx; win[1] = oy * G - g.ty; win[2] = slotOf(g.tx, g.K); win[3] = slotOf(g.ty, g.K);
    win[4] = ox * Dz - dw.tx; win[5] = oy * Dz - dw.ty; win[6] = slotOf(dw.tx, dw.K); win[7] = slotOf(dw.ty, dw.K);
    const T = this.T;
    if (targetFor(T, i0, j0, ni, nj, z, this.version) && !this.build(T, L, px)) { T.z = NaN; return; }
    const F = (this.F ??= {}); // the frame, for render()
    F.i0 = i0; F.j0 = j0; F.ni = ni; F.nj = nj; F.ox = ox; F.oy = oy; F.px = px; F.alpha = alpha; F.c0 = c[0]; F.c1 = c[1]; F.f0 = fade[0]; F.f1 = fade[1];
    this.drawn = true;
    if (this.count) this.counts(L);
  }

  /** W233 chevfast: the per-point pass over T's points (POINT_FS), from the view's first point now; false if its texture can't hold them. */
  build(T, L, px) {
    const gl = this.gl, g = this.win.grade, dw = this.win.dir, u = this.u.point, win = this.uwin;
    if (T.NI > this.maxTex || T.NJ > this.maxTex) return false;
    let t = this.target;
    if (!t || t.w < T.NI || t.h < T.NJ) { // grown, never shrunk: 64 points at a time
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
      const w = Math.min(this.maxTex, Math.ceil(Math.max(T.NI, t?.w ?? 0) / 64) * 64), h = Math.min(this.maxTex, Math.ceil(Math.max(T.NJ, t?.h ?? 0) / 64) * 64), tex = this.texture(gl.RGBA32UI, w, h);
      t = this.target = { tex, fbo: this.framebuffer(tex), w, h };
      this.sized();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); this.plain();
    gl.viewport(0, 0, T.NI, T.NJ);
    gl.useProgram(this.progs.point); gl.bindVertexArray(this.vao);
    this.chan.fill(0); this.chan[maskChannel(T.z)] = 1;
    gl.uniform2f(u.u_step, L.pitch, L.row);
    gl.uniform2i(u.u_par, ((T.i0 % 2) + 2) % 2, ((T.j0 % 4) + 4) % 4);
    gl.uniform2i(u.u_from, T.I0 - T.i0, T.J0 - T.j0);
    gl.uniform1f(u.u_px, px);
    gl.uniform4f(u.u_win, win[0], win[1], win[2], win[3]);
    gl.uniform4f(u.u_dwin, win[4], win[5], win[6], win[7]);
    gl.uniform2f(u.u_K, g.K, dw.K);
    gl.uniform4fv(u.u_chan, this.chan);
    gl.uniform1i(u.u_count, this.count ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.uniform1i(u.u_grade, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dw.tex); gl.uniform1i(u.u_dir, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, g.mask); gl.uniform1i(u.u_mask, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.count) { // read on demand: a stall, for counts only
      if (this.words?.length !== T.NI * T.NJ * 4) this.words = new Uint32Array(T.NI * T.NJ * 4);
      gl.readPixels(0, 0, T.NI, T.NJ, gl.RGBA_INTEGER, gl.UNSIGNED_INT, this.words);
    }
    gl.bindVertexArray(null);
    for (let k = 2; k >= 0; k--) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stats.builds++;
    return true;
  }

  /** W233 chevfast: while `count` is set, the frame's counts (census) from the target read back at its pass: stats.passed, drawn, census. */
  counts(L) {
    const F = this.F, T = this.T, st = this.stats;
    if (!this.words || this.words.length !== T.NI * T.NJ * 4) return;
    const faded = (i, j) => { // the draw's vertex shader's fade, in float64
      const J = (((F.j0 + j) % 4) + 4) % 4, x = (i + (J & 1 ? 0.5 : 0) - (((F.j0 % 2) + 2) % 2 ? 0.5 : 0)) * L.pitch + F.ox - F.c0, y = j * L.row + F.oy - F.c1;
      const r = Math.hypot(x, y), t = Math.min(1, Math.max(0, (r - F.f0) / (F.f1 - F.f0)));
      return F.alpha * (isNew(F.i0 + i, F.j0 + j) ? L.fresh : 1) * (1 - t * t * (3 - 2 * t)) < 0.004;
    };
    st.census = census(this.words, T.NI, T, F.i0, F.j0, F.ni, F.nj, faded, st.census ?? {});
    st.passed = st.census.passed; st.drawn = st.census.draws;
  }

  render(gl, args) {
    const st = this.stats;
    if (!this.drawn) return; // W233 chevfast: prerender found nothing to draw this frame
    const F = this.F, T = this.T, L = this.L, g = this.win.grade, M = this.matrix, win = this.uwin;
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
    for (let i = 0; i < 12; i++) M[i] = m[i];
    for (let i = 0; i < 4; i++) M[12 + i] = m[i] * F.ox + m[4 + i] * F.oy + m[12 + i];
    const ink = this.inks();
    if (ink !== this.inked) { this.inked = ink; for (let l = 0; l < 3; l++) for (let i = 0; i < 3; i++) this.ink[3 * l + i] = parseInt(ink[l].slice(1 + 2 * i, 3 + 2 * i), 16) / 255; }
    const u = this.u.draw;
    gl.useProgram(this.progs.draw);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.u_matrix, false, M);
    gl.uniform2f(u.u_step, L.pitch, L.row);
    gl.uniform2i(u.u_n, F.ni, F.nj);
    gl.uniform2i(u.u_par, ((F.i0 % 2) + 2) % 2, ((F.j0 % 4) + 4) % 4);
    gl.uniform2i(u.u_at, F.i0 - T.I0, F.j0 - T.J0);
    gl.uniform1f(u.u_px, F.px);
    gl.uniform4f(u.u_win, win[0], win[1], win[2], win[3]);
    gl.uniform2f(u.u_K, g.K, this.win.dir.K);
    gl.uniform1f(u.u_fresh, L.fresh);
    gl.uniform1f(u.u_alpha, F.alpha);
    gl.uniform4f(u.u_far, F.c0 - F.ox, F.c1 - F.oy, F.f0, F.f1);
    gl.uniform3fv(u.u_ink, this.ink);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.uniform1i(u.u_grade, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.target.tex); gl.uniform1i(u.u_pts, 1);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, F.ni * F.nj);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    st.points = F.ni * F.nj; st.draws = 1; st.lattice = L.level; st.pitch = L.screen; st.fresh = L.fresh;
    st.i0 = F.i0; st.j0 = F.j0; st.ni = F.ni; st.nj = F.nj;
  }
}
