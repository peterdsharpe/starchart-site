// W22 pretty: the course preview's flow (arclight, 2026-10-16: "the nice little moving-dots animation that you do
// for the wormholes, but in orange, and only in one direction (the direction of travel)").
//
// One custom WebGL 2 layer, a sibling of chart/prototype/gl-layer.js's ChartMotion: soft dots in the course's orange
// flow along the chosen route, from the ship toward the landing pad, at the wormholes' speed (tokens: motion.
// wormhole_flow_px_per_s). The dots are spaced evenly along the whole route, not per segment, so they run on through
// its bends without bunching: every dot sits at a route position s (in spacings from the start) with
// s ≡ phase (mod 1), and each segment carries floor(length) + 1 instances, the ones past its end hidden. As the phase
// grows, every dot moves forward; one that leaves a segment's end is the next segment's first.
//
// The CPU builds the instances only when the lines change or the zoom crosses a half level (the spacing stays about
// SPACING_PX on the screen); each frame it adds the time step to the phase, a few float operations, with no
// allocation. `count` is 0 when there is nothing to draw, so the frame governor counts the flow as motion only while
// it shows (app/main.js). Calm holds the phase: the dots stay, still.
//
// W137 cleanroute (SPEC §249): the preview draws no dots now, on the chosen route or the others ("Please remove ... the
// yellow dots currently overlayed on top of a highlighted route"): the line is one clean line in its comfort colours. The
// draw-on below stays. `inFlight = true` keeps a faint flow on the course in flight; off.
//
// W23 polish: the route draws on. When a route is plotted (the preview opens on a new destination, or the pilot picks
// another style), its line runs out from the ship to the pad in 0.6 s (W137 cleanroute: no flow after it). The course's own
// layers (DRAWN) get a line-gradient, clear past the drawn part, on the source's line metrics; MapLibre 6.14 has no
// line-trim-offset. A gradient is a paint change only: MapLibre re-renders its 256-texel ramp, and the worker does
// nothing, so no setData a frame. The chevrons hide while it runs and fade back. The frame loop calls tick() at the
// governor's rate; nothing waits on it: a drag, a Launch, a new line or Calm ends it at once, with the line whole.
import { courseInk } from "./ink.js";
import { COLOURS, rgba } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json
import { lineInk } from "./course-logic.js"; // W86 ride: the gap where the course walks, while it draws on

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;   // CSS px
uniform float u_phase;     // spacings, mod 6
uniform float u_size;      // the dot's radius, CSS px
in vec2 a_corner;          // -1..1
in vec2 a_pos;             // the segment's start, mercator, from the origin
in vec2 a_end;             // its end
in vec4 a_info;            // the segment's start along the route (spacings), its length (spacings), the instance, the route's length
in float a_alpha;          // the line's: < 0 for a sparse flow (every third dot)
out vec2 v_uv;
out float v_a;
void main() {
  float sa = a_info.x, len = a_info.y;
  float s = sa + fract(u_phase - sa) + a_info.z;  // this instance's dot, along the route
  float t = (s - sa) / max(len, 1e-6);
  float a = abs(a_alpha) * smoothstep(0.0, 1.2, s) * (1.0 - smoothstep(a_info.w - 1.2, a_info.w, s));
  if (a_alpha < 0.0 && mod(floor(s - u_phase + 0.5), 3.0) != 0.0) a = 0.0;
  if (t > 1.0 || a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // past the segment: nothing
  vec4 c = u_matrix * vec4(mix(a_pos, a_end, t), 0.0, 1.0);
  c.xy += a_corner * u_size * 2.0 / u_viewport * c.w;
  gl_Position = c;
  v_uv = a_corner;
  v_a = a;
}`;

const FS = `#version 300 es
precision highp float;
uniform vec3 u_course;
uniform vec3 u_core;
in vec2 v_uv;
in float v_a;
out vec4 o;
void main() {
  float r = length(v_uv);
  if (r > 1.0) discard;
  // the wormholes' dot: a soft glow in the course's orange round a bright core
  float a = smoothstep(1.0, 0.15, r) * 0.95 * v_a;
  vec3 col = mix(u_course, u_core, smoothstep(0.6, 0.0, r) * 0.92);
  o = vec4(col * a, a);
}`;

const ATTRS = ["a_corner", "a_pos", "a_end", "a_info", "a_alpha"];
const STRIDE = 9; // floats per instance: a_pos, a_end, a_info, a_alpha
const UNIFORMS = ["u_matrix", "u_viewport", "u_phase", "u_size", "u_course", "u_core"];
export const DRAW_MS = 600; // W23 polish: the draw-on
export const DRAWN = ["course-glow", "course-casing", "course-inner", "course"]; // the course's lines, under the flow; W138 dayink: course-inner
const BARE = ["course-bare", "course-bare-core"]; // W59 routes
const WALKS = ["course-walk", "course-walk-dots"]; // W86 ride: the footprints; W124 mapbits: and a short walk's dots
const CHEVRONS = "course-chevrons", CLEAR = rgba(COLOURS["color-fixed"].black, 0); // MapLibre blends premultiplied, so clear black fades the ink cleanly
const NO_CHECK = { validate: false }; // drawGradient's are well formed: no style-spec check each frame
/** The draw-on's own curve, cubic-bezier(.2, .8, .2, 1) (once --ease-warp, which W73 polish aliased to --ease-enter in CSS), at t in 0..1: x(u) = 0.6u − 0.6u² + u³, solved for u by Newton (x′ ≥ 0.48). */
export function easeWarp(t) {
  let u = t;
  for (let i = 0; i < 5; i++) u -= (0.6 * u - 0.6 * u * u + u * u * u - t) / (0.6 - 1.2 * u + 3 * u * u);
  return 2.4 * u * (1 - u) ** 2 + 3 * u * u * (1 - u) + u ** 3;
}
/** W73 delight: a CSS cubic-bezier(x1, y1, x2, y2) as a function of t in 0..1 (bisection on x, 24 steps: no allocation). */
export function bezier(x1, y1, x2, y2) {
  const f = (a, b, u) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  return (t) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (f(x1, x2, m) < t) lo = m; else hi = m; }
    return f(y1, y2, (lo + hi) / 2);
  };
}
export const easeEnter = bezier(0.05, 0.7, 0.1, 1); // W73 delight: --ease-enter
export const PICK_MS = 320, FADE_MS = 120; // W73 delight: a picked card's course draws in --t-sheet; in Calm it fades in --t-press
/** W73 delight: `ink` (a #rrggbb or rgb[a]() string) at `a` times its alpha, the whole line; null if it isn't one. */
export function fadeGradient(ink, a, holes = []) { // W86 ride: holes, [[from, to]] in 0..1, clear (where the course walks)
  if (Array.isArray(ink)) { const st = ink.map(([t, c]) => [t, fadeGradient(c, a)?.[4]]); return st.every(([, c]) => c) ? lineInk(st, holes) : null; } // W90 comfort: the comfort scale's steps ([[t, colour]]), each faded
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ink), m = h ? null : /^rgba?\(([^)]+)\)$/.exec(ink ?? "");
  const p = h ? [...h.slice(1).map((x) => parseInt(x, 16)), 1] : m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : null;
  if (!p || p.length < 3 || p.some((x) => !Number.isFinite(x))) return null;
  const c = `rgba(${p[0]},${p[1]},${p[2]},${+((p[3] ?? 1) * Math.min(1, Math.max(0, a))).toFixed(3)})`;
  return holes.length ? lineInk([[0, c]], holes) : ["interpolate", ["linear"], ["line-progress"], 0, c, 1, c]; // W86 ride
}
/** The line-gradient that shows a line's first `d` (0..1) of its length in `ink`, and nothing past it. */
export function drawGradient(ink, d, holes = []) { // W86 ride: holes, as fadeGradient's
  const a = Math.min(0.995, Math.max(0.0001, d));
  if (Array.isArray(ink)) return lineInk([...ink.filter(([t]) => t < a), [a, CLEAR]], holes); // W90 comfort: the comfort scale's steps, drawn on
  if (holes.length) return lineInk([[0, ink], [a, CLEAR]], holes); // W86 ride: the gap kept while it draws on
  return ["interpolate", ["linear"], ["line-progress"], 0, ink, a, ink, a + 0.004, CLEAR, 1, CLEAR];
}
export const SPACING_PX = 26; // px between dots: a little closer than the wormholes' 30, as the course is one line
const ALPHA = { flight: 0.45 }; // W137 cleanroute: no chosen or alt dots (the preview's)
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/**
 * The instances for some lines: [{ coords: [[lon, lat], ...], alpha }], first to last along each line, `spacing` in
 * mercator units, positions from `origin`. Writes into `buf` (grown if needed) and returns [buf, floats written].
 */
export function flowInstances(lines, spacing, origin, buf = new Float32Array(STRIDE * 256)) {
  let n = 0;
  for (const { coords, alpha, holes } of lines) { // W86 ride: holes, as drawGradient's: no dots where the course walks
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += Math.hypot(mercX(coords[i][0]) - mercX(coords[i - 1][0]), mercY(coords[i][1]) - mercY(coords[i - 1][1]));
    total /= spacing;
    let sa = 0;
    for (let i = 1; i < coords.length; i++) {
      const ax = mercX(coords[i - 1][0]), ay = mercY(coords[i - 1][1]), ex = mercX(coords[i][0]), ey = mercY(coords[i][1]);
      const len = Math.hypot(ex - ax, ey - ay) / spacing;
      if (len <= 0) continue;
      if (holes?.some(([a, b]) => (sa + len / 2) / total > a && (sa + len / 2) / total < b)) { sa += len; continue; } // W86 ride
      const k = Math.floor(len) + 1;
      if (n + k * STRIDE > buf.length) { const b = new Float32Array(Math.max(buf.length * 2, n + k * STRIDE)); b.set(buf.subarray(0, n)); buf = b; }
      for (let j = 0; j < k; j++, n += STRIDE) {
        buf[n] = ax - origin[0]; buf[n + 1] = ay - origin[1]; buf[n + 2] = ex - origin[0]; buf[n + 3] = ey - origin[1];
        buf[n + 4] = sa; buf[n + 5] = len; buf[n + 6] = j; buf[n + 7] = total; buf[n + 8] = alpha;
      }
      sa += len;
    }
  }
  return [buf, n];
}

/** The dots' places along a line's segments at a phase, as the shader puts them: [{ seg, s, t }], for the tests. */
export function dotsAt(data, n, phase) {
  const out = [];
  for (let o = 0, seg = -1, last = NaN; o < n; o += STRIDE) {
    const sa = data[o + 4], len = data[o + 5];
    if (sa !== last) { seg++; last = sa; }
    const s = sa + (((phase - sa) % 1) + 1) % 1 + data[o + 6], t = (s - sa) / len;
    if (t <= 1 && s > 0 && s < data[o + 7]) out.push({ seg, s, t });
  }
  return out;
}

export class CourseFlow {
  /** colors: { dark: { course, core }, light: { course, core } } hex strings from the tokens. */
  constructor(colors, { calm = false, theme = "dark", flowPxPerS = 28 } = {}) {
    this.id = "course-flow";
    this.type = "custom";
    this.renderingMode = "2d";
    this.colors = colors;
    this.rgb = { course: new Float32Array(3), core: new Float32Array(3) };
    this.theme(theme);
    this.calm = calm;
    this.flow = flowPxPerS;
    this.inFlight = false;
    this.count = 0;
    this.phase = 0;
    this.lines = null; // what set() was given
    this.preview = false;
    this.level = NaN; // the half zoom level the instances were built for
    this.spacing = 1;
    this.origin = [0, 0];
    this.buf = new Float32Array(STRIDE * 256);
    this.n = 0;
    this.matrix = new Float32Array(16);
    this.lastT = 0;
    this.stats = { builds: 0, instances: 0, draws: 0, drawFrames: 0 };
    this.drawMs = DRAW_MS; // W23 polish: a test or a shot may slow it
    this.pickMs = PICK_MS; // W73 delight: and this
    this.drawing = null; // W23 polish: { t0, geometry, ink, saved, d } while the route draws on
    this.ahead = null; // W90 comfort: the course ahead's comfort steps ([[t, colour]], course.js), else its one ink
  }

  /** The theme's inks: "dark" or "light". */
  theme(t) {
    const c = this.colors[t] || this.colors.dark;
    this.rgb.course.set(hex(c.course));
    this.rgb.core.set(hex(c.core));
    this.map?.triggerRepaint();
  }

  /** The course's lines, the chosen one first ([{ geometry }], as course.js's nav.lines), and whether the preview shows them. */
  set(lines, preview, draw = false) {
    this.lines = lines && lines.length ? lines : null;
    this.preview = !!preview;
    this.level = NaN;
    this.build();
    // W23 polish: `draw` for a plotted route. course.js sets its progress gradient just before, so a running draw-on
    // saves it again; a new line (a drag, a re-plot, Launch) ends the draw-on, the line whole.
    const d = this.drawing;
    if (d && !draw && this.preview && this.lines?.[0].geometry === d.geometry) { this.save(); d.d = -1; this.tick(); }
    else if (d) this.endDraw(true);
    if (draw && this.preview && (!this.calm || draw === "pick") && this.lines && this.map && this.gl) this.startDraw(draw === "pick"); // W73 delight: "pick", a card picked; W137 cleanroute: a line, not its dots (none now)
  }

  // ---- W23 polish: the route draws on ----
  startDraw(pick = false) { // W73 delight: pick, a picked card's quicker draw (a fade in Calm)
    const map = this.map, prog = courseInk(); // the theme's, as course.js's progress
    const ink = {};
    for (const id of DRAWN) if (map.getLayer(id)) ink[id] = id === "course-casing" || id === "course-inner" || !prog ? map.getPaintProperty(id, "line-color") : this.ahead ?? prog.ahead; // as course.js's progress; W90 comfort: this.ahead, its comfort scale
    if ("course-glow" in ink && this.glowInk) ink["course-glow"] = this.glowInk(); // W148 routepop: the preview's neutral glow (course.js), as when the draw-on ends
    const fade = pick && this.calm && Object.values(ink).every((c) => fadeGradient(c, 1)); // W73 delight
    this.drawing = { t0: performance.now(), geometry: this.lines[0].geometry, ink, saved: {}, d: -1, holes: this.lines[0].holes ?? [], // W86 ride: holes // W73 delight: its length, curve and kind
      ms: pick ? (fade ? FADE_MS : this.pickMs) : this.drawMs, ease: pick ? easeEnter : easeWarp, fade };
    if (pick && this.calm && !fade) { this.drawing = null; return; } // W73 delight: an ink it can't fade: the line whole, as before
    this.save();
    if (map.getLayer(CHEVRONS)) {
      this.drawing.chevrons = [map.getPaintProperty(CHEVRONS, "text-opacity-transition"), map.getPaintProperty(CHEVRONS, "text-opacity")];
      map.setPaintProperty(CHEVRONS, "text-opacity-transition", { duration: 0, delay: 0 });
      map.setPaintProperty(CHEVRONS, "text-opacity", 0);
    }
    if (map.getLayer(BARE[0])) { this.drawing.bare = BARE.map((id) => map.getPaintProperty(id, "line-opacity")); for (const id of BARE) map.setPaintProperty(id, "line-opacity", 0); } // W59 routes: the bare stretches wait for the line
    for (const id of WALKS.filter((w) => map.getLayer(w))) { (this.drawing.walk ??= {})[id] = map.getPaintProperty(id, "icon-opacity"); map.setPaintProperty(id, "icon-opacity", 0); } // W86 ride: and the footprints; W124 mapbits: WALKS
    this.stats.draws++;
    this.tick();
  }

  /** W90 comfort: the line's comfort steps came in (course.js): the course ahead in them, a running draw-on too. */
  reink(ahead) { // W90 comfort
    this.ahead = ahead; // W90 comfort
    const dr = this.drawing; if (!dr) return; // W90 comfort
    for (const id of ["course", "course-glow"]) if (id in dr.ink && !(id === "course-glow" && this.glowInk)) dr.ink[id] = ahead; // W90 comfort; W148 routepop: the glow keeps the preview's neutral ink
    this.save(); dr.d = -1; this.tick(); // W90 comfort: course.js has set its progress anew
  } // W90 comfort

  /** The course's own gradients (its progress), to give back when the draw-on ends. */
  save() {
    for (const id of DRAWN) if (this.map.getLayer(id)) this.drawing.saved[id] = this.map.getPaintProperty(id, "line-gradient"); // W86 ride: DRAWN, the casing too: course.js sets its gradient with the others (a gap where the course walks)
  }

  /** Each frame of the frame loop: the drawn part now, in a gradient when it has grown by a texel of the ramp. */
  tick() {
    const dr = this.drawing;
    if (!dr) return;
    const ms = performance.now() - dr.t0;
    if ((this.calm && !dr.fade) || ms >= dr.ms) { this.endDraw(false); return; } // W73 delight: dr.ms, dr.fade
    const d = dr.ease(ms / dr.ms); // W73 delight: dr.ease
    if (d - dr.d < 1 / 256) return;
    dr.d = d;
    for (const id in dr.ink) this.map.setPaintProperty(id, "line-gradient", dr.fade ? fadeGradient(dr.ink[id], d, dr.holes) : drawGradient(dr.ink[id], d, dr.holes), NO_CHECK); // W73 delight: or a fade
    this.stats.drawFrames++;
  }

  /** The line whole again: its own gradients back (unless course.js has just set them: `fresh`), and the chevrons. */
  endDraw(fresh) {
    const dr = this.drawing, map = this.map;
    this.drawing = null;
    if (!map?.style) return;
    for (const id in dr.ink) if (!fresh) map.setPaintProperty(id, "line-gradient", dr.saved[id]); // W86 ride: the casing as the others
    if (dr.bare && map.getLayer(BARE[0])) BARE.forEach((id, i) => map.setPaintProperty(id, "line-opacity", dr.bare[i])); // W59 routes
    for (const id in dr.walk) if (map.getLayer(id)) map.setPaintProperty(id, "icon-opacity", dr.walk[id]); // W86 ride; W124 mapbits: WALKS
    if (dr.chevrons) {
      map.setPaintProperty(CHEVRONS, "text-opacity-transition", dr.chevrons[0]);
      map.setPaintProperty(CHEVRONS, "text-opacity", dr.chevrons[1]);
    }
    map.triggerRepaint();
  }

  build() {
    const map = this.map;
    const want = !this.lines || this.preview ? [] // W137 cleanroute (SPEC §249): no dots on the preview, the route one clean line in its comfort colours
      : this.inFlight ? [{ coords: this.lines[0].geometry, alpha: ALPHA.flight, holes: this.lines[0].holes }] : []; // W86 ride: holes
    if (!map || !want.length || !this.gl) { this.count = this.n = 0; return; }
    this.level = Math.round(map.getZoom() * 2) / 2;
    this.spacing = SPACING_PX / (512 * 2 ** this.level);
    const c0 = want[0].coords[0];
    this.origin[0] = mercX(c0[0]); this.origin[1] = mercY(c0[1]);
    [this.buf, this.n] = flowInstances(want, this.spacing, this.origin, this.buf);
    this.count = this.n / STRIDE;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.subarray(0, this.n), gl.DYNAMIC_DRAW);
    this.stats.builds++;
    this.stats.instances = this.count;
    map.triggerRepaint();
  }

  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;
    this.ready = false;
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = (this.prog = gl.createProgram());
    this.shaders = [sh(gl.VERTEX_SHADER, VS), sh(gl.FRAGMENT_SHADER, FS)];
    for (const s of this.shaders) gl.attachShader(p, s);
    ATTRS.forEach((name, i) => gl.bindAttribLocation(p, i, name));
    gl.linkProgram(p);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    for (const [loc, size, off] of [[1, 2, 0], [2, 2, 8], [3, 4, 16], [4, 1, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.build(); // after a context loss (keepLayer() in chart/prototype/gl-layer.js adds it again), the lines again
  }

  onRemove(map, gl) {
    for (const s of this.shaders) gl.deleteShader(s);
    gl.deleteProgram(this.prog);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.inst);
    gl.deleteVertexArray(this.vao);
    this.gl = null;
    this.count = 0;
  }

  linked() {
    if (this.ready) return true;
    const gl = this.gl, p = this.prog;
    if (this.broken || gl.isContextLost()) return false;
    if (this.parallel && !gl.getProgramParameter(p, this.parallel.COMPLETION_STATUS_KHR)) { this.map.triggerRepaint(); return false; }
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.broken = true;
      console.error("course-flow:", [gl.getProgramInfoLog(p), ...this.shaders.map((s) => gl.getShaderInfoLog(s))].filter(Boolean).join("\n"));
      return false;
    }
    this.u = {};
    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(p, name);
    return (this.ready = true);
  }

  render(gl, args) {
    const now = performance.now(), dt = Math.min(0.25, Math.max(0, (now - this.lastT) / 1000)); // a slow frame moves on, a pause doesn't jump
    this.lastT = now;
    if (!this.count || !this.linked()) return;
    const map = this.map, z = map.getZoom();
    if (map.getTerrain()) return; // 3D hills (a tilt): the dots would float off the draped line
    if (Math.abs(Math.round(z * 2) / 2 - this.level) > 0.01) { this.build(); if (!this.count) return; }
    const world = 512 * 2 ** z;
    // px per s on the screen, whatever the zoom: spacings per s = flow / (the spacing in px now)
    if (!this.calm && !this.rest) this.phase = (this.phase + (dt * this.flow) / (this.spacing * world)) % 6; // W56 perf: still while the chart rests
    if (this.drawing) return; // W23 polish: the flow starts once the line has reached the pad
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
    const M = this.matrix, ox = this.origin[0], oy = this.origin[1];
    for (let i = 0; i < 12; i++) M[i] = m[i];
    for (let i = 0; i < 4; i++) M[12 + i] = m[i] * ox + m[4 + i] * oy + m[12 + i];
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const ratio = map.getPixelRatio();
    gl.uniformMatrix4fv(this.u.u_matrix, false, M);
    gl.uniform2f(this.u.u_viewport, gl.drawingBufferWidth / ratio, gl.drawingBufferHeight / ratio);
    gl.uniform1f(this.u.u_phase, this.phase);
    // wider than the course line (the style's: 2 px at z10 to 4.5 at z17, ×1.6 a level), so its glow shows either side
    gl.uniform1f(this.u.u_size, Math.min(7, Math.max(3.4, 3.6 * 1.6 ** ((z - 15) / 2))));
    gl.uniform3fv(this.u.u_course, this.rgb.course);
    gl.uniform3fv(this.u.u_core, this.rgb.core);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }

  /** For tests: the dots now, along the first line. */
  dots() { return dotsAt(this.buf, this.n, this.phase); }
}
