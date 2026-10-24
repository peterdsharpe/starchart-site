// W70 deep (design/app-ui/SPEC.md §109): the T's tunnels at their depth in 3D, behind a test flag (?deep=1, or
// localStorage starchart.deep = "on"). arclight, 2026-10-20: "would it be possible to put the T underground at its
// actual depth, perhaps with like a think of like the curtain drapes, but upside down that are used for like aircraft
// traces ... when like a red line train goes through Porter Square, which is very deep underground."
//
// - The data: chart/transit/deep-v1.json (chart/transit/build_deep.py), each tunnel point's depth below the street, from
//   the MBTA's GTFS pathways and Wikipedia's station articles; fetched from our own site only when the flag is on.
// - The look: each tunnel is a line in its colour at its depth, under a curtain that hangs from the street down to it,
//   fading as it goes down. The depth is exaggerated as the hills are (×6 in full 3D), so Porter's 32 m reads beside
//   the hills as it is. The live comets on those lines ride down there too (app/comets.js's `sink`).
// - Under the ground: an X-ray. The layer draws over the terrain with no depth test, at part opacity, so the tunnels
//   show through the hills and the streets, and the chart above stays readable through the curtains.
// - The cost: nothing until the chart is tilted past FROM° with terrain on; then one draw of the curtains and one of the
//   lines. The ground under each point is read again from MapLibre's terrain, for the points in view, a moment after the camera rests or the hills' tiles come.
import { COLOUR, metresPerUnit, mercX, mercY, shown, tunnelIndex } from "./deep-logic.js";
import { keepLayer } from "../chart/prototype/gl-layer.js";

export const SETTING = "starchart.deep";
const O = [mercX(-71.06), mercY(42.36)]; // the buffer's origin, as the comets': float32 keeps millimetres
const STRIDE = 16; // a_seg (4), a_gd (4), a_corner (3), a_color (3), a_s (2)
const CORNERS = [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0], [0, -1, 1], [0, 1, 1], [1, -1, 1], [1, 1, 1]];
const SHAFT = [[0, 0, 2], [0, 0, 2], [0, 0, 2], [0, 0, 2], [0, -1, 3], [0, 1, 3], [1, -1, 3], [1, 1, 3]];
const SLICE_MS = 4; // the most a ground refresh takes at a time
const PLEAT_M = 24; // the curtain's folds, a fold every PLEAT_M metres along the track
const WIDTH = 2.2; // the line's half-width, CSS px
const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix; uniform vec2 u_viewport; uniform float u_exag, u_sink, u_width;
in vec4 a_seg;    // the segment's ends A and B, mercator from the origin
in vec4 a_gd;     // A's ground and depth, B's, in mercator units, unexaggerated
in vec3 a_corner; // end (0 A, 1 B); v (curtain: 0 the street, 1 the track; line: side -1, 1); kind (0 curtain, 1 line, 2 none, 3 a station's shaft)
in vec3 a_color;
in vec2 a_s;      // the distance along the track at A and B, metres (the curtain's folds)
out vec3 v_color; out float v_v; out float v_kind; out float v_s;
void main() {
  float e = a_corner.x;
  v_color = a_color; v_kind = a_corner.z; v_v = a_corner.y; v_s = mix(a_s.x, a_s.y, e);
  if (a_corner.z == 2.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // a shaft has no curtain
  if (a_corner.z < 0.5) {
    vec2 p = mix(a_seg.xy, a_seg.zw, e);
    float g = mix(a_gd.x, a_gd.z, e), d = mix(a_gd.y, a_gd.w, e);
    gl_Position = u_matrix * vec4(p, u_exag * (g - d * u_sink * a_corner.y), 1.0);
  } else {
    vec4 ca = u_matrix * vec4(a_seg.xy, u_exag * (a_gd.x - a_gd.y * u_sink), 1.0); // a shaft's A is at the street
    vec4 cb = u_matrix * vec4(a_seg.zw, u_exag * (a_gd.z - a_gd.w * u_sink), 1.0);
    vec2 sa = ca.xy / ca.w * u_viewport, sb = cb.xy / cb.w * u_viewport, dv = sb - sa;
    vec2 dir = dot(dv, dv) > 1e-8 ? normalize(dv) : vec2(1.0, 0.0);
    vec4 c = e < 0.5 ? ca : cb;
    c.xy += vec2(-dir.y, dir.x) * a_corner.y * (u_width + 1.0) / u_viewport * c.w; // u_viewport: half the canvas, CSS px
    gl_Position = c;
  }
}`;
const FS = `#version 300 es
precision highp float;
uniform float u_line, u_curtain, u_width, u_pleat;
in vec3 v_color; in float v_v; in float v_kind; in float v_s; out vec4 o;
void main() {
  float a = v_kind < 0.5
    ? u_curtain * mix(1.0, 0.2, v_v) * (0.72 + 0.28 * cos(6.2832 * v_s / u_pleat)) // the drape: strongest where it hangs from the street, fading as it goes down, in folds
    : (v_kind > 2.5 ? 0.6 : 1.0) * u_line * clamp((u_width + 1.0) * (1.0 - abs(v_v)), 0.0, 1.0); // the line (a shaft fainter), its edges smoothed over a px
  o = vec4(v_color * a, a);
}`;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
/** The look in each theme: the colours lifted toward white on the dark chart (as the comets'), and the opacities. */
const LOOK = { dark: { lift: 0.35, line: 0.9, curtain: 0.3 }, light: { lift: 0, line: 0.85, curtain: 0.22 } };

export class DeepLayer {
  constructor(data, theme = "dark") {
    Object.assign(this, { id: "deep", type: "custom", renderingMode: "2d", data, theme, draws: 0, drawMs: 0, refreshed: 0, refreshMs: 0, stale: true });
    this.M = new Float32Array(16);
    // the points: every tunnel's, then each station's; the segments: each tunnel's, then a shaft down from each station
    const pts = [], segs = [];
    for (const t of data.tunnels) {
      let s = 0;
      t.coords.forEach(([lon, lat], j) => {
        if (j) { const s0 = s; s += Math.hypot((lon - t.coords[j - 1][0]) * Math.cos((lat * Math.PI) / 180), lat - t.coords[j - 1][1]) * 111320; segs.push({ a: pts.length - 1, c: pts.length, dA: t.depth[j - 1], dB: t.depth[j], sA: s0, sB: s, line: t.line }); }
        pts.push([lon, lat, t.ground[j]]);
      });
    }
    for (const r of data.stations) { pts.push([r.lon, r.lat, r.ground]); segs.push({ a: pts.length - 1, c: pts.length - 1, dA: 0, dB: r.m, sA: 0, sB: 0, line: r.line, shaft: true }); }
    this.segs = segs; this.n = segs.length;
    this.k = new Float64Array(pts.length); this.g = new Float32Array(pts.length); this.lon = new Float64Array(pts.length); this.lat = new Float64Array(pts.length);
    this.got = new Uint8Array(pts.length); // read from MapLibre's terrain yet
    pts.forEach(([lon, lat, g], i) => { this.lon[i] = lon; this.lat[i] = lat; this.k[i] = 1 / metresPerUnit(lat); this.g[i] = g * this.k[i]; });
    this.buf = new Float32Array(this.n * 8 * STRIDE);
    // the curtains first, then the lines: one index buffer, two ranges (each segment's 8 vertices: 4 curtain, 4 line)
    this.idx = new Uint32Array(this.n * 12);
    for (let s = 0; s < this.n; s++) for (const [o, b] of [[s * 6, 0], [(this.n + s) * 6, 4]]) { const v = s * 8 + b; this.idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], o); }
    this.fill();
  }

  /** The vertices from the points, their ground and the theme: again after a refresh or a theme switch. */
  fill() {
    const look = LOOK[this.theme === "light" ? "light" : "dark"], b = this.buf, rgbs = {};
    for (const [line, h] of Object.entries(COLOUR)) rgbs[line] = hex(h).map((v) => v + (1 - v) * look.lift);
    let o = 0;
    for (const sg of this.segs) {
      const { a, c } = sg, rgb = rgbs[sg.line] || [1, 1, 1];
      const seg = [mercX(this.lon[a]) - O[0], mercY(this.lat[a]) - O[1], mercX(this.lon[c]) - O[0], mercY(this.lat[c]) - O[1]];
      const gd = [this.g[a], sg.dA * this.k[a], this.g[c], sg.dB * this.k[c]];
      // a shaft: a line from the street (A, depth 0) down to the platform (B), and no curtain (its quad has no area)
      for (const [e, v, kind] of sg.shaft ? SHAFT : CORNERS) {
        b.set(seg, o); b.set(gd, o + 4); b[o + 8] = e; b[o + 9] = v; b[o + 10] = kind; b.set(rgb, o + 11); b[o + 14] = sg.sA; b[o + 15] = sg.sB; o += STRIDE;
      }
    }
    this.dirty = true;
  }

  /** Only the ground's floats, after a refresh: no allocation, a few ms at most on a slow phone. */
  fillGround() {
    const b = this.buf, segs = this.segs, g = this.g;
    for (let i = 0, o = 4; i < segs.length; i++) {
      const ga = g[segs[i].a], gc = g[segs[i].c];
      for (let v = 0; v < 8; v++, o += STRIDE) { b[o] = ga; b[o + 2] = gc; }
    }
    this.dirty = true;
  }

  setTheme(theme) { this.theme = theme; this.fill(); this.map?.triggerRepaint(); }

  /**
   * The ground under the points in view, from MapLibre's terrain (exaggerated: divided back), each point once: the
   * build's ground (SRTM) until then. At most SLICE_MS of it at a time; true when it changed, `more` when points are left.
   */
  refresh() {
    const map = this.map, ex = map?.getTerrain()?.exaggeration || 0;
    this.more = false;
    if (!map || ex < 0.5 || !shown(map.getPitch(), true)) { this.more = !!map?.getTerrain(); return false; } // the hills still rising: again
    const t0 = performance.now(), b = map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth(), at = [0, 0];
    // only where the ground's height has come: before its hill tile, MapLibre answers 0, which would stick as sea level
    // (app/terrain.js reads the same way; W73's fresh review). A point skipped now is read at a later refresh.
    const t = map.terrain, LngLat = b.getCenter().constructor;
    const has = t?.hasElevationForLngLat ? (lon, lat) => t.hasElevationForLngLat(new LngLat(lon, lat), map._camera?.transform ?? map.transform) : () => true;
    let changed = false;
    for (let i = 0; i < this.g.length; i++) {
      if (this.got[i] || this.lon[i] < w || this.lon[i] > e || this.lat[i] < s || this.lat[i] > n) continue;
      if (performance.now() - t0 > SLICE_MS) { this.more = true; break; }
      if (!has(this.lon[i], this.lat[i])) continue; // its hill tile hasn't come: the terrain's data event marks the layer stale when it does
      at[0] = this.lon[i]; at[1] = this.lat[i];
      const h = map.queryTerrainElevation(at);
      if (h == null) continue;
      this.got[i] = 1;
      const g = (h / ex) * this.k[i];
      if (Math.abs(g - this.g[i]) / this.k[i] > 0.25) { this.g[i] = g; changed = true; }
    }
    if (changed) this.fillGround();
    this.refreshed++; this.refreshMs = performance.now() - t0;
    return changed;
  }

  onAdd(map, gl) {
    this.map = map; this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = (this.prog = gl.createProgram());
    this.shaders = [sh(gl.VERTEX_SHADER, VS), sh(gl.FRAGMENT_SHADER, FS)];
    for (const s of this.shaders) gl.attachShader(p, s);
    ["a_seg", "a_gd", "a_corner", "a_color", "a_s"].forEach((name, i) => gl.bindAttribLocation(p, i, name));
    gl.linkProgram(p);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    for (const [loc, size, off] of [[0, 4, 0], [1, 4, 16], [2, 3, 32], [3, 3, 44], [4, 2, 56]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off); }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.dirty = true; this.ready = false;
  }
  onRemove(map, gl) {
    for (const s of this.shaders) gl.deleteShader(s);
    gl.deleteProgram(this.prog); gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.ibo); gl.deleteVertexArray(this.vao);
    this.gl = null;
  }

  render(gl, args) {
    const map = this.map, terrain = map.getTerrain(), f = shown(map.getPitch(), !!terrain);
    this.f = f;
    if (!f || !this.gl) return; // flat, or no terrain: nothing drawn, nothing read
    if (!this.ready) {
      if (gl.isContextLost() || !gl.getProgramParameter(this.prog, gl.LINK_STATUS)) return;
      this.u = Object.fromEntries(["u_matrix", "u_viewport", "u_exag", "u_sink", "u_width", "u_line", "u_curtain", "u_pleat"].map((n) => [n, gl.getUniformLocation(this.prog, n)]));
      this.ready = true;
    }
    if (this.stale && !this.waiting) { // read the ground a moment after the frames that asked, never in one
      this.waiting = true;
      setTimeout(() => { this.waiting = false; this.stale = false; if (this.refresh()) map.triggerRepaint(); if (this.more) { this.stale = true; map.triggerRepaint(); } }, 250);
    }
    const t0 = performance.now();
    gl.bindVertexArray(this.vao);
    if (this.dirty) { gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.buf, gl.STATIC_DRAW); this.dirty = false; }
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args, M = this.M;
    for (let i = 0; i < 12; i++) M[i] = m[i];
    for (let i = 0; i < 4; i++) M[12 + i] = m[i] * O[0] + m[4 + i] * O[1] + m[12 + i];
    const look = LOOK[this.theme === "light" ? "light" : "dark"], ratio = map.getPixelRatio(), u = this.u;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.u_matrix, false, M);
    gl.uniform2f(u.u_viewport, gl.drawingBufferWidth / ratio / 2, gl.drawingBufferHeight / ratio / 2);
    gl.uniform1f(u.u_exag, terrain.exaggeration); gl.uniform1f(u.u_sink, f); gl.uniform1f(u.u_width, WIDTH);
    gl.uniform1f(u.u_line, look.line * f); gl.uniform1f(u.u_curtain, look.curtain * f); gl.uniform1f(u.u_pleat, PLEAT_M);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE); // the X-ray: over the ground
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_INT, 0); // the curtains
    gl.drawElements(gl.TRIANGLES, this.n * 6, gl.UNSIGNED_INT, this.n * 6 * 4); // the lines, over them
    gl.bindVertexArray(null);
    this.draws++; this.drawMs = performance.now() - t0;
  }
}

/**
 * Mount the underground: fetch the data, add the layer under the comets, and sink the comets on its lines. `comets` is
 * app/comets.js's controller; `url` the data's address. Returns a promise of { layer, depthAt }.
 */
export async function mountDeep({ map, comets, url, theme = "dark" }) {
  const data = await (await fetch(url)).json();
  const layer = new DeepLayer(data, theme), index = tunnelIndex(data.tunnels);
  keepLayer(map, layer, map.getLayer("comets") ? "comets" : undefined);
  const stale = () => { layer.stale = true; };
  map.on("moveend", stale); // the ground under the points in view, read again once the camera rests and when the hills' tiles come
  map.on("data", (e) => { if (e.sourceId && e.sourceId === map.getTerrain()?.source) stale(); });
  addEventListener("starchart:theme", (e) => layer.setTheme(e.detail.theme));
  if (comets) comets.sink = (c) => { // the comet's drop below the ground, in mercator units, as its z is
    const f = layer.f || 0;
    if (!f) return 0;
    const lat = (360 / Math.PI) * Math.atan(Math.exp((0.5 - c.hy) * 2 * Math.PI)) - 90;
    return (f * map.getTerrain().exaggeration * index.depthAt(c.route, c.hx, c.hy)) / metresPerUnit(lat);
  };
  map.triggerRepaint();
  return { layer, depthAt: index.depthAt };
}
