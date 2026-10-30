// W29 comets: live T trains as comets on the chart (design/app-ui/SPEC.md §41). arclight, 2026-10-17: "It would be kind
// of cool if you could show live location of the T trains "comets", color-coded by the line they run on. That obviously
// shouldn't be the forefront ... And if you click on a comet, you see what time it will arrive at each station?"
//
// - The phone asks the MBTA's V3 API itself (api-v3.mbta.com sends access-control-allow-origin: *): every train, every
//   15 s while the chart shows and has moved in the last minute or a peek is open, else every 30 s; never while the page
//   is hidden, offline, under the Log or Settings, outside the comets' area, or on Data Saver. At most 20 requests a
//   minute (the API's limit without a key), and after a 429 none for a minute, then 2, 4, up to 10.
// - The requests carry no referrer and nothing about the pilot: they ask for every train, or for the station tapped.
// - Each comet is a bright head and a short tail in its line's colour (the MBTA's own), drawn in one custom WebGL 2 layer
//   under the course, the ship and the labels. Between replies a comet glides from where it was drawn to its new place
//   along its line's shape (the route patterns' canonical shapes, kept a week), or straight where it is off them.
//   W92 cometsnap: within about 150 m of its line (underground, the GPS is poor), a comet is drawn on it; farther, where it is. The
//   glide trails the reply by one interval, so a comet never jumps back. Calm moves them only when a reply comes.
// - A tap on a comet: its line, destination and coming stops with their times; a Comet Station's peek adds its next trains.
//   Both refresh while open (app/hints.js places them).
// - On by default; `starchart.comets` = "off" turns them off, as window.starchart.comets.set(false) does.
import { LOOK, MBTA, Line, Limiter, STALE_MS, cometRadius, arrivalsAt, comingStops, decodePolyline, glideOf, inArea, mayPoll, mercX, mercY, nestUrl, parsePredictions, parseShapes,
  parseVehicles, pollDelay, routeOf, lineColour, shapesUrl, STATION_LINE_M, stationLines, stationUrl, tripUrl, vehiclesUrl, TAIL_R, sideOffsets, tailRadius, tailSpots, placeComet, stopUrl, stopEtas } from "./comets-logic.js"; // W111 stationlines: stationLines; W144 tlines: TAIL_R, sideOffsets; W150 mapink: tailRadius, tailSpots; W153 tstations: placeComet
import { clockAt } from "./course-logic.js";
import { pick } from "./lingo-mode.js"; // W60 b: the peeks' words
import { bikeWords, bikesNow, stationWords, word } from "./comet-bikes.js"; // W59 cometbikes; W88 settings3: no bikes-only view, so no fades
import { keepLayer } from "../chart/prototype/gl-layer.js"; // W39 ship
import { KINDS } from "../chart/lingo/kinds.js"; // W191 dataleft (SPEC §335): the trains from the tiles' tracks' zoom, chart/kinds.json's (was 9 here)
import { WORDS as WALKW } from "./walk-card.js"; // W189 transittimes: the timetable's words
import { get } from "./settings.js"; // W191 appleft (SPEC §334): the setting through the registry, with its default
import { COLOURS } from "./colours.js"; // W192 icons7: the bus yellow by day
import { MASSPORT } from "../chart/routing/transit.js"; // W192 sltimes: Massport's stops, which the MBTA is never asked about

export const SETTING = "starchart.comets"; // "off" or "on" (the default)
const SHAPES = "starchart:comets-shapes", WEEK = 7 * 864e5;
const TAIL = 24; // dots behind the head, overlapping, so the tail reads as one streak; W95 cometlook: 16, was 8, for a tail eight radii long; W144 tlines: 24, for TAIL_R's twelve, as close; W150 mapink: 24 still, spaced by their size (tailSpots)
const PER = TAIL + 2; // instances a comet: its glow, its head, its tail
// W95 cometlook: the tail's length in head radii (her note: "the tail is really short"); W144 tlines: TAIL_R (comets-logic.js), 12, was 8; W150 mapink: 6.15, 0.1.65's length on the screen
const STRIDE = 9; // floats an instance: a_pos (3), a_look (size px, alpha, core), a_color (3); W40 maplayout: a_pos's z, the ground's height
const HIT_PX = 14;
const LIVE_MS = 60000; // a live peek stays this long at most, refreshing
const TRIP_MS = 15000, STATION_MS = 20000;
const TRACK = "comet-track"; // W33 peeks: the layer and source of a tapped comet's line
const O = [mercX(-71.06), mercY(42.36)]; // the buffer's origin, Boston: float32 keeps millimetres

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
in vec2 a_corner;
in vec3 a_pos;     // mercator, from the origin; W40 maplayout: z, the ground's height in 3D
in vec3 a_look;    // radius (CSS px), alpha, core (0..1)
in vec3 a_color;
out vec2 v_uv;
out vec3 v_look;
out vec3 v_color;
void main() {
  vec4 c = u_matrix * vec4(a_pos, 1.0); // W40 maplayout: on the ground in 3D
  c.xy += a_corner * a_look.x * 2.0 / u_viewport * c.w;
  gl_Position = a_look.y > 0.0 ? c : vec4(2.0, 2.0, 2.0, 1.0);
  v_uv = a_corner; v_look = a_look; v_color = a_color;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_look;
in vec3 v_color;
out vec4 o;
void main() {
  float r = length(v_uv);
  if (r > 1.0) discard;
  float a = smoothstep(1.0, v_look.y >= 1.0 ? 0.6 : 0.25, r) * v_look.y; // W95 cometlook: the head (alpha 1) a crisp bright disc, the glow and tail soft
  vec3 col = mix(v_color, vec3(1.0), v_look.z * smoothstep(0.7, 0.0, r));
  o = vec4(col * a, a);
}`;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lonOf = (x) => x * 360 - 180;
const latOf = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;

/** The comets' layer: one instanced draw of soft dots. `set(buf, n)` gives it this frame's instances. */
export class CometLayer {
  constructor() { this.id = "comets"; this.type = "custom"; this.renderingMode = "2d"; this.buf = null; this.n = 0; this.dirty = false; this.matrix = new Float32Array(16); this.draws = 0; }
  onAdd(map, gl) {
    this.map = map; this.gl = gl; this.ready = false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const p = (this.prog = gl.createProgram());
    this.shaders = [sh(gl.VERTEX_SHADER, VS), sh(gl.FRAGMENT_SHADER, FS)];
    for (const s of this.shaders) gl.attachShader(p, s);
    ["a_corner", "a_pos", "a_look", "a_color"].forEach((name, i) => gl.bindAttribLocation(p, i, name));
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
    for (const [loc, size, off] of [[1, 3, 0], [2, 3, 12], [3, 3, 24]]) { // W40 maplayout: a_pos has z
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.dirty = true;
  }
  onRemove(map, gl) {
    for (const s of this.shaders) gl.deleteShader(s);
    gl.deleteProgram(this.prog); gl.deleteBuffer(this.quad); gl.deleteBuffer(this.inst); gl.deleteVertexArray(this.vao);
    this.gl = null;
  }
  set(buf, n) { this.buf = buf; this.n = n; this.dirty = true; }
  render(gl, args) {
    if (!this.n || !this.gl) return;
    if (!this.ready) {
      if (gl.isContextLost() || !gl.getProgramParameter(this.prog, gl.LINK_STATUS)) return;
      this.u = { m: gl.getUniformLocation(this.prog, "u_matrix"), v: gl.getUniformLocation(this.prog, "u_viewport") };
      this.ready = true;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    if (this.dirty) { gl.bufferData(gl.ARRAY_BUFFER, this.buf.subarray(0, this.n * STRIDE), gl.DYNAMIC_DRAW); this.dirty = false; }
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args, M = this.matrix;
    for (let i = 0; i < 12; i++) M[i] = m[i];
    for (let i = 0; i < 4; i++) M[12 + i] = m[i] * O[0] + m[4 + i] * O[1] + m[12 + i];
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const ratio = this.map.getPixelRatio();
    gl.uniformMatrix4fv(this.u.m, false, M);
    gl.uniform2f(this.u.v, gl.drawingBufferWidth / ratio, gl.drawingBufferHeight / ratio);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
    gl.bindVertexArray(null);
    this.draws++;
  }
}

/**
 * Mount the comets. `chart()` says whether the chart shows (no Log page, no Settings over it); `theme` is "dark" or
 * "light"; `calm`. Returns the controller: tick(t) each frame (true: repaint), fps (the rate their glides want), at(x, y)
 * (the comet under a tap), the peek hooks for app/hints.js, set(on), and stats.
 */
export function mountComets({ map, chart = () => true, theme = "dark", calm = false, key = "", before }) {
  const layer = new CometLayer();
  keepLayer(map, layer, before); // W39 ship: back after a lost WebGL context, in its place
  // W33 peeks: a tapped comet's line, or a tapped Comet Station's lines, in their colours, under the comets
  map.addSource(TRACK, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: TRACK, type: "line", source: TRACK, layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-opacity": 0.75, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 1.4, 17, 4.5] } }, layer.id);
  const limiter = new Limiter();
  const stats = { requests: 0, bytes: 0, replies: 0, unchanged: 0, failed: 0, limited: 0, last: 0, polls: [] };
  const comets = new Map(); // id → comet
  let routes = {}, lines = {}, shapesAt = 0, shapesTried = 0;
  let on = get(SETTING) === "on", modified = "", lastReply = 0, movedAt = performance.now(), open = null, timer = 0, busy = false;
  let buf = new Float32Array(STRIDE * PER * 128), shown = false, fps = 0;
  const tmp = [0, 0], head = [0, 0];
  let near = { x: new Float64Array(64), y: new Float64Array(64), dx: new Float64Array(64), dy: new Float64Array(64), out: new Float64Array(128), c: [] }; // W144 tlines: this frame's trains in view, for sideOffsets
  let tracked = { routes: [], dir: null }; // W33 peeks: the lines drawn for an open peek
  const bikesOf = (c) => c.bikes || 0; // W59 cometbikes; W88 settings3: the bikes-only view (starchart.comets.bikes) went, and with it the trips it asked for

  // ---- the lines, kept a week ----
  function useShapes(s) {
    routes = s.routes || {};
    lines = {};
    for (const [r, ls] of Object.entries(s.lines || {})) lines[r] = ls.map((l) => new Line(decode(l.polyline), l.dir));
    for (const c of comets.values()) paint(c);
    if (tracked.routes.length) track(tracked.routes, tracked.dir); // W33 peeks
  }
  const decode = (p) => { try { return decodePolyline(p); } catch { return [[0, 0]]; } }; // each start, from the kept polylines: a few ms
  try { const k = JSON.parse(localStorage.getItem(SHAPES) || "null"); if (k && Date.now() - k.at < WEEK) { shapesAt = k.at; useShapes(k); } } catch { /* none kept */ }

  // ---- asking ----
  async function ask(url) {
    if (!limiter.take(Date.now())) { stats.limited++; return { status: -1 }; }
    stats.requests++;
    try {
      // no-cache: the browser asks with If-Modified-Since and gets a 304 when nothing changed; no referrer, no cookies
      const r = await fetch(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
      limiter.answer(r.status, Date.now());
      stats.bytes += +r.headers.get("content-length") || 0;
      if (!r.ok) { stats.failed++; return { status: r.status }; }
      return { status: r.status, json: await r.json(), modified: r.headers.get("last-modified") || "" };
    } catch { stats.failed++; return { status: 0 }; }
  }
  const conn = () => navigator.connection;
  const state = () => {
    const b = map.getBounds();
    return { on, visible: document.visibilityState === "visible", online: navigator.onLine, chart: chart(), saveData: conn()?.saveData === true,
      area: map.getZoom() >= KINDS.comet_trail.zoom && inArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]) };
  };
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(poll, ms); };
  async function poll() {
    if (busy) return;
    if (!mayPoll(state())) { schedule(5000); return; } // looked at again by the events below, or in 5 s
    const wait = limiter.wait(Date.now());
    if (wait) { schedule(wait + 50); return; }
    busy = true;
    try {
      if (!shapesAt && Date.now() - shapesTried > 600000) { // the lines first, once a week (or again 10 min after a failure)
        shapesTried = Date.now();
        const r = await ask(shapesUrl(key));
        if (r.json) { const s = parseShapes(r.json); shapesAt = Date.now(); useShapes(s); try { localStorage.setItem(SHAPES, JSON.stringify({ at: shapesAt, ...s })); } catch { /* full */ } }
      }
      if (!mayPoll(state())) return void schedule(5000); // 2026-10-24 (the 0.1.62 gate): turned off, or hidden, while the lines came: no vehicles asked
      const r = await ask(vehiclesUrl(key));
      if (r.json) {
        stats.replies++; stats.last = Date.now(); stats.polls.push(stats.last); if (stats.polls.length > 100) stats.polls.shift();
        if (r.modified && r.modified === modified) stats.unchanged++; else { modified = r.modified; update(parseVehicles(r.json)); }
        lastReply = performance.now();
      }
    } finally { busy = false; }
    schedule(pollDelay({ still: performance.now() - movedAt, open: !!open }));
  }
  const kick = () => { if (!busy && mayPoll(state()) && performance.now() - lastReply > 5000) schedule(0); };
  document.addEventListener("visibilitychange", kick);
  addEventListener("online", kick);
  map.on("moveend", () => { movedAt = performance.now(); if (!lastReply || performance.now() - lastReply > 15000) kick(); });
  addEventListener("starchart:settings", (e) => { if (e.detail?.key === SETTING) set(e.detail.value !== "off", false); });
  conn()?.addEventListener?.("change", kick);
  schedule(0);

  // ---- the comets' places ----
  let prevReply = 0;
  function update(list) {
    const now = performance.now(), dur = prevReply ? Math.max(4000, Math.min(35000, now - prevReply)) : 0;
    prevReply = now;
    const seen = new Set();
    for (const v of list) {
      seen.add(v.id);
      let c = comets.get(v.id);
      const to = [mercX(v.lon), mercY(v.lat)];
      if (!c) { c = { id: v.id, x: to[0], y: to[1], g: null, t0: now, dur: 0, from: [0, 0], to, color: [0, 0, 0], hx: to[0], hy: to[1], drawnX: NaN, drawnY: NaN, tail: new Float64Array(2 * TAIL), ox: 0, oy: 0 }; comets.set(v.id, c); } // W144 tlines: its own tail, and its offset aside
      const moved = c.to[0] !== to[0] || c.to[1] !== to[1];
      if (c.trip !== v.trip) c.bikes = 0; // W59 cometbikes: a new trip says for itself
      Object.assign(c, { route: v.route, trip: v.trip, stop: v.stop, status: v.status, dir: v.dir, bearing: v.bearing });
      if (!c.color[0] && !c.color[1] && !c.color[2]) paint(c);
      if (!moved && c.g) continue;
      const from = [c.hx, c.hy]; // where it is drawn now
      const g = glideOf(lines[v.route], dur ? from : null, to, v.dir, tmp, c.g?.line || c.g?.along); // W153 tstations: its last line wins a tie
      c.g = g; c.from = g.jump ? to : from; c.to = to; c.t0 = now; c.dur = g.jump || calm ? 0 : dur;
    }
    for (const id of comets.keys()) if (!seen.has(id)) comets.delete(id);
    if (open?.comet && !comets.has(open.comet.id)) open.gone?.();
    api.changed?.(); // W77 rest: new places to glide to (main.js wakes its sleeping frame loop)
  }
  // on the dark chart a line's colour is lifted a third toward white, so the Blue Line's deep blue shows on the void; W186 palette: her
  // line colour by theme (her night fills read on the ground: 3.7:1 and more), as the tracks under it
  const tint = (route) => hex(lineColour(route || "", theme === "light"));
  function paint(c) {
    c.color = tint(c.route);
    c.core = theme === "light" ? 0.2 : 0.8;
    c.glow = LOOK.glow[theme === "light" ? "light" : "dark"]; // W50 layers: a little brighter
  }

  /** Where comet c is at time `now` (ms, performance.now): its head, and its tail `len` mercator units long behind it (c.tail). */
  function place(c, now, len) {
    const u = c.dur ? Math.min(1, (now - c.t0) / c.dur) : 1;
    placeComet(c.g, c.from || c.to, c.to, u, c.bearing, len, spots, TAIL, head, c.tail); // W144 tlines: c.tail; W150 mapink: spots; W153 tstations: placeComet, the tail along its line
    c.hx = head[0]; c.hy = head[1];
  }

  const spots = new Float64Array(TAIL); let spotsR = NaN; // W150 mapink: where the tail's dots lie (tailSpots), for the head's radius spotsR
  let n = 0, rgb = null, gz = 0; // this frame's instances so far, and the comet's colour and ground (W40 maplayout), for put(): no closure a frame
  const put = (x, y, size, alpha, core) => { const o = n++ * STRIDE; buf[o] = x - O[0]; buf[o + 1] = y - O[1]; buf[o + 2] = gz; buf[o + 3] = size; buf[o + 4] = alpha; buf[o + 5] = core; buf[o + 6] = rgb[0]; buf[o + 7] = rgb[1]; buf[o + 8] = rgb[2]; };
  /** W40 maplayout: the ground's height under the head in 3D, in mercator units (as Ship3D's), so a tilt keeps the comets on the hills. */
  const ground = (c) => { const lat = latOf(c.hy); return (map.queryTerrainElevation([lonOf(c.hx), lat]) || 0) / (40075016.686 * Math.cos((lat * Math.PI) / 180)); };
  const inView = (c, x0, x1, y0, y1, pad) => c.hx > x0 - pad && c.hx < x1 + pad && c.hy > y0 - pad && c.hy < y1 + pad;
  /** Each frame: the comets' places now. True when the chart must be drawn again: a comet in view moved half a px. `fps`
   *  is the rate the fastest glide in view wants. */
  function tick(t = performance.now()) {
    const show = on && comets.size > 0 && performance.now() - lastReply < STALE_MS && map.getZoom() >= KINDS.comet_trail.zoom && !!map.getLayer("comets") && map.getLayoutProperty("comets", "visibility") !== "none"; // W173 mapstyle2: not while a preview puts them aside (app/layers.js hush), so a tap finds none; W173 integration: nor while a lost context has no layer yet (MapLibre fires an error for each ask of a missing layer)
    if (!show) { fps = 0; if (shown) { shown = false; layer.set(buf, 0); return true; } return false; }
    const z = map.getZoom(), world = 512 * 2 ** z, r = cometRadius(z), len = (TAIL_R * r) / world; // small at low zoom; W95 cometlook: TAIL_R radii, was 12-36 px
    if (r !== spotsR) { tailSpots(r, TAIL, spots); spotsR = r; } // W150 mapink
    const b = map.getBounds(), x0 = mercX(b.getWest()), x1 = mercX(b.getEast()), y0 = mercY(b.getNorth()), y1 = mercY(b.getSouth()), pad = 40 / world;
    if (buf.length < comets.size * PER * STRIDE) buf = new Float32Array(comets.size * PER * STRIDE * 2);
    if (near.x.length < comets.size) { const m = comets.size * 2; near = { x: new Float64Array(m), y: new Float64Array(m), dx: new Float64Array(m), dy: new Float64Array(m), out: new Float64Array(2 * m), c: near.c }; } // W144 tlines
    let moved = !shown, speed = 0, m = 0; // W144 tlines: m, the trains in view
    const deep = !!map.getTerrain(); // W40 maplayout
    n = 0;
    near.c.length = 0;
    for (const c of comets.values()) { // W144 tlines: first each train's place and way, then their offsets aside, then the drawing
      place(c, t, len);
      // only the comets in view go in the buffer (an instance off the screen still costs the draw)
      if (!inView(c, x0, x1, y0, y1, pad)) { c.drawnX = NaN; continue; }
      const wx = c.hx - c.tail[0], wy = c.hy - c.tail[1], wl = Math.hypot(wx, wy) || 1; // its way: from its tail's first dot to its head
      near.x[m] = c.hx * world; near.y[m] = c.hy * world; near.dx[m] = wx / wl; near.dy[m] = wy / wl; near.c[m++] = c;
    }
    sideOffsets(m, near.x, near.y, near.dx, near.dy, r, near.out); // W144 tlines: px
    for (let i = 0; i < m; i++) {
      const c = near.c[i], ox = (c.ox = near.out[2 * i] / world), oy = (c.oy = near.out[2 * i + 1] / world), tail = c.tail;
      gz = deep ? ground(c) - (api.sink ? api.sink(c) : 0) : 0; c.z = gz; // W40 maplayout: the hills rise as the tilt eases in, and their tiles come; W70 deep: in a tunnel, at its depth (app/deep.js)
      if (Math.hypot(c.hx + ox - c.drawnX, c.hy + oy - c.drawnY, gz - c.drawnZ) * world >= 0.5 || !(c.drawnX === c.drawnX)) moved = true; // NaN: it has just come into view; W40 maplayout: z; W144 tlines: aside
      if (c.dur && t - c.t0 < c.dur) { const e = c.g?.end || c.to, d = c.g?.line ? Math.abs(c.g.s1 - c.g.s0) : Math.hypot(e[0] - c.from[0], e[1] - c.from[1]); speed = Math.max(speed, (d * world * 1000) / c.dur); } // W92 cometsnap: e
      const big = open?.comet === c ? 1.5 : 1; // W88 settings3: no alpha, since the bikes-only view that faded them went
      rgb = c.color;
      for (let k = TAIL - 1; k >= 0; k--) { const f = spots[k]; put(tail[2 * k] + ox, tail[2 * k + 1] + oy, tailRadius(r * big, f), LOOK.tail * (1 - f) ** 0.3, 0.25 * (1 - f)); } // tapering and fading; W95 cometlook: narrower than the head, to a point (was max(1.6, r (1 - 0.45 f))); W144 tlines: aside
      put(c.hx + ox, c.hy + oy, r * 1.8 * big, c.glow, 0); // the glow; W95 cometlook: 1.8 r, was 2.2 r, so the head reads as one bright point
      put(c.hx + ox, c.hy + oy, r * big, 1, c.core); // the head
    }
    shown = true;
    fps = calm ? 0 : Math.min(10, Math.ceil(speed)); // a frame each px a comet moves, at most 10 a second
    if (!moved) return false;
    for (let i = 0; i < m; i++) { const c = near.c[i]; c.drawnX = c.hx + c.ox; c.drawnY = c.hy + c.oy; c.drawnZ = c.z; } // W40 maplayout: z; W144 tlines: as drawn, aside
    layer.set(buf, n);
    return true;
  }

  /** W70 deep: where comet c was last drawn, in the canvas's CSS px, z and all (its layer's matrix). */
  const drawnAt = (c) => {
    const M = layer.matrix, X = c.hx + c.ox - O[0], Y = c.hy + c.oy - O[1], Z = c.z, cv = map.getCanvas(), w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
    return { x: ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w + 1) / 2 * cv.clientWidth, y: (1 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w) / 2 * cv.clientHeight };
  };
  /** The comet under a tap at (x, y) on the map's canvas, within `r` px, nearer than `than` px; or null. */
  function at(x, y, than = Infinity, r = HIT_PX) {
    if (!shown) return null;
    let best = null, bd = Math.min(r, than);
    for (const c of comets.values()) {
      const q = api.sink && c.z ? drawnAt(c) : map.project([lonOf(c.hx + c.ox), latOf(c.hy + c.oy)]), d = Math.hypot(q.x - x, q.y - y); // W70 deep: a sunk comet where it is drawn
      if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }

  // ---- W33 peeks: the lines of a tapped comet or Comet Station, while its peek is open ----
  /** Draw `rs`'s lines (one direction's patterns: `dir` where the route has them, else its first), or none. */
  function track(rs, dir = null) {
    tracked = { routes: rs, dir };
    const features = [];
    for (const r of rs) {
      const ls = lines[r] || [], d = ls.some((l) => l.dir === dir) ? dir : ls[0]?.dir, color = `rgb(${tint(r).map((v) => Math.round(v * 255)).join(",")})`;
      for (const l of ls) if (l.dir === d) features.push({ type: "Feature", properties: { route: r, color }, geometry: { type: "LineString", coordinates: Array.from(l.x, (x, i) => [lonOf(x), latOf(l.y[i])]) } });
    }
    map.getSource(TRACK)?.setData({ type: "FeatureCollection", features });
  }

  // ---- the peeks: app/hints.js places the card; these fill it and keep its times fresh ----
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const clock = (d) => clockAt(d);
  const short = (route) => routeOf(routes, route).name.replace(/ Line\b/, "");
  const ink = (route, hint) => lineColour(route || "", theme === "light", hint); // W186 palette: her line colour by the theme (Daystar's day fills), as the comets' tint; W192 icons7: a bus's by its hint
  const dot = (route, hint) => { // W192 icons7 (SPEC §338): hint, the row's colour; by day her faint yellow takes her thin ink edge (comets.css .pale)
    const i = el("i", "cdot"), c = ink(route, hint); i.setAttribute("aria-hidden", "true"); i.style.setProperty("--line", c);
    if (c === COLOURS["mbta-day"].bus) i.classList.add("pale"); // W192 icons7
    return i;
  };
  /** Rows of [label, time, route, colour]: spans, since a parked station's peek is a button. W33 peeks: a colour from the
   *  reply (a sandworm's) over the route's; W186 palette: her line colour by the route and the theme (ink). W192 icons7 (SPEC §338):
   *  the row's colour, the feed's (a bus's route_color), is ink's hint. */
  const rows = (items) => {
    const list = el("span", "crows");
    for (const [label, time, route, hint] of items) { // W192 icons7: hint
      const r = el("span", "crow"), cn = el("span", "cn"), ct = el("span", "ct");
      String(label).split("/").forEach((s, k) => { if (k) cn.append("/", document.createElement("wbr")); cn.append(s); }); // arclight's screenshot, 2026-10-23: "Ashmont/Braintree" breaks at its slash, never a letter a line
      String(time).split(", ").forEach((s, k) => { if (k) ct.append(", "); ct.append(/^\d/.test(s) ? el("span", "", s) : s); }); // and the times wrap between trains, a time ("2 min", "3:47 · Track 2") never inside itself; the MBTA's words ("Stopped 3 stops away") wrap as words
      r.append(...(route ? [dot(route, hint)] : []), cn, ct); list.append(r); // W192 icons7: hint
    }
    return list;
  };
  const note = (text) => el("small", "cnote", text);
  /** Every `ms` while the peek is open (and once on Data Saver, which asks only for the tap). */
  function refreshing(ms, run, peek) {
    let t = 0, live = true;
    const go = async () => { if (!live) return; await run(); if (live && !(conn()?.saveData === true)) t = setTimeout(go, ms); };
    go();
    return () => { live = false; clearTimeout(t); if (open === peek) open = null; };
  }

  /** A comet's peek: { node, close }. `relayout()` places the card again when its content changes. */
  function cometPeek(c, relayout) {
    const name = `${routeOf(routes, c.route || "").name} ${pick("comet", "train")}`; // W60 b
    const n = el("div", "cpeek fly ccomet"), t = el("span", "t"), title = el("b", "", name), dest = el("span", "", ""), body = el("span", "cbody");
    const bike = el("small", "cbike", bikeWords(bikesNow(c.route, c.dir, Date.now(), { bikes: bikesOf(c) }))); // W59 cometbikes: may a bike board it now
    n.style.setProperty("--line", ink(c.route)); // W186 palette: by the theme; W73 a11y: no role="status": hints.js show() says it
    t.append(dot(c.route), title, dest, bike, body); // W59 cometbikes: bike
    n.append(t);
    body.append(note("Coming stations…"));
    const peek = { comet: c, gone: () => { body.replaceChildren(note(pick("This comet has left the chart.", "This train has left the chart."))); /* W60 b */ relayout(); } };
    open = peek;
    layer.dirty = true; c.drawnX = NaN; // drawn bigger while its peek is open
    const run = async () => {
      if (!navigator.onLine) { body.replaceChildren(note("Live times need a connection.")); return relayout(); }
      const r = await ask(tripUrl(c.trip, key));
      if (!r.json) { if (!body.querySelector(".crows")) { body.replaceChildren(note(r.status === 429 || r.status === -1 ? "The MBTA asks us to wait a minute." : "No live times right now.")); relayout(); } return; }
      const ps = parsePredictions(r.json), head = ps.find((p) => p.headsign)?.headsign;
      dest.textContent = head ? ` · to ${head}` : "";
      c.bikes = ps.find((p) => p.bikes)?.bikes || 0; bike.textContent = bikeWords(bikesNow(c.route, c.dir, Date.now(), { bikes: bikesOf(c) })); // W59 cometbikes: a Commuter Rail train's own
      const stops = comingStops(ps, Date.now(), c, { clock });
      body.replaceChildren(stops.length ? rows(stops.map((s) => [s.name, s.eta])) : note("No coming stations given."));
      n.setAttribute("aria-label", [name + dest.textContent, bike.textContent, ...stops.map((s) => `${s.name}, ${s.eta}`)].join(". ")); // W59 cometbikes: bike
      relayout();
    };
    const stop = refreshing(TRIP_MS, run, peek);
    track([c.route], c.dir); // W33 peeks: its line
    return { node: n, ms: LIVE_MS, text: name, close: () => { stop(); c.drawnX = NaN; track([]); } };
  }

  /** The next trains (or W33 peeks: buses) at `at0` in a predictions reply's rows `ps`, by the clock now: { groups, items (the peek's
   *  rows), bikes (the line over them) }. W173 uismall: from stationPeek's run, so the peek with Comets off reads the same. */
  function arrivals(ps, at0, nest = false) {
    const now = Date.now(), perTrain = (g) => bikesNow(g.route, g.dir, now).ok === null; // W59 cometbikes: a Commuter Rail train says for itself on weekdays
    const mark = (p) => (perTrain(p) && bikesNow(p.route, p.dir, now, { bikes: p.bikes }).ok === false ? ` · ${word("no").toLowerCase()}` : ""); // W59 cometbikes: "4:47 · no bikes"
    const groups = arrivalsAt(ps, at0, now, { clock, mark });
    const items = groups.map((g) => [`${nest ? `${pick("Sandworm", "Bus")} ${g.name || g.route}` : short(g.route)}${g.headsign ? ` · ${g.headsign}` : ""}`, g.etas.join(", "), g.route, g.color]); // W60 b: Plain's buses
    const family = (g) => (/^Green/.test(g.route) ? "Green" : short(g.route)); // W59 cometbikes: the Green Line's branches as one
    const bikes = !items.length ? "" : nest ? word("rack") : stationWords(groups, now, { station: groups[0].station, name: family, perTrain }); // W59 cometbikes
    return { groups, items, bikes };
  }
  /** A Comet Station's next trains, or W33 peeks: a Sandworm Nest's next sandworms (buses), under its name in `t` (the
   *  peek's words): returns close(). A station's peek lights its lines too. */
  function stationPeek(f, t, relayout) {
    if (!on) return f.properties?.kind === "comet_station" ? linesPeek(f, t, relayout) : nestPeek(f, t, relayout); // W111 stationlines: a station's lines; W173 uismall: and its next trains, asked once; W189 transittimes: a nest's buses, from the timetable
    const nest = f.properties?.kind === "sandworm_nest", what = nest ? pick("sandworms", "buses") : "trains"; // W33 peeks; W60 b
    const body = el("span", nest ? "cbody cnest" : "cbody"), at0 = f.geometry.coordinates.slice(0, 2), button = t.closest("button"), label = button?.getAttribute("aria-label") || "";
    t.append(body);
    body.append(note(navigator.onLine ? `Next ${what}…` : "Live times need a connection."));
    if (!navigator.onLine) return { ms: 0, close: () => {} };
    const peek = { station: at0 };
    open = peek;
    const run = async () => {
      if (!navigator.onLine) { body.replaceChildren(note("Live times need a connection.")); return relayout(); }
      const r = await ask((nest ? nestUrl : stationUrl)(at0, key));
      if (!r.json) { if (!body.querySelector(".crows")) { body.replaceChildren(note(r.status === 429 || r.status === -1 ? "The MBTA asks us to wait a minute." : "No live times right now.")); relayout(); } return; }
      const { groups, items, bikes } = arrivals(parsePredictions(r.json), at0, nest); // W173 uismall: arrivals(), shared with the peek with Comets off
      body.replaceChildren(...(bikes ? [el("small", "cbike", bikes)] : []), items.length ? rows(items) : note(`No ${what} due here now.`)); // W59 cometbikes: bikes first
      if (button) button.setAttribute("aria-label", label.replace(/\. (Set course|Get directions)$/, (_, go) => `. ${[bikes, ...items.map(([a, b]) => `${a}, ${b}`)].filter(Boolean).join(". ")}. ${go}`)); /* W60 b: Plain's */ // W59 cometbikes: bikes
      if (!nest && open === peek) track([...new Set(groups.map((g) => g.route))]); // W33 peeks: its lines
      relayout();
    };
    const stop = refreshing(STATION_MS, run, peek);
    return { ms: LIVE_MS, close: () => { stop(); track([]); } };
  }

  /** W111 stationlines (SPEC §215): with Comets off, a Comet Station's lines in their colours under its name, from the
   *  tiles on the phone (its `line`, else the tracks beside it: api.tracks, the z15 tiles' `transit`), and the comets
   *  timetable's stops (api.stations, our own file, about 30 KB once).
   *  W173 uismall (SPEC §302), her note 24: "Even when the transit layer is off, please display upcoming train times when a subway
   *  station is selected": one ask of the MBTA for the tap, at the station's own point (stationUrl: never the rider's), and its next
   *  trains in place of the lines once they come, counted down by the clock from that one reply; no polling, no comets, no lines lit.
   *  Offline, or with no answer, the lines stay with a few words under them. */
  function linesPeek(f, t, relayout) {
    const at0 = f.geometry.coordinates.slice(0, 2), button = t.closest("button"), label = button?.getAttribute("aria-label") || "", body = el("span", "cbody clines"); // W173 uismall: slice, as stationPeek's
    let live = true, tracks = [], table = null, ps = null, said = "", tick = 0; // W173 uismall: ps, the one reply's rows; said, its few words when there are none
    const draw = (shown = true) => {
      const ls = stationLines(f.properties, at0, tracks, undefined, table), got = ps && arrivals(ps, at0); // W173 uismall: got
      const timed = !!got?.items.length; // W173 uismall
      body.replaceChildren(...(timed ? [...(got.bikes ? [el("small", "cbike", got.bikes)] : []), rows(got.items)] : ls.length ? [rows(ls.map((l) => [l.name, "", l.line, l.color]))] : []), ...(!timed && said ? [note(said)] : [])); // W173 uismall: the times, else the lines and why there are none
      if ((ls.length || timed || said) && !body.isConnected) t.append(body); // W173 uismall: timed, said
      const words = timed ? [got.bikes, ...got.items.map(([a, b]) => `${a}, ${b}`)].filter(Boolean).join(". ") : [ls.map((l) => l.name).join(", "), said.replace(/\.$/, "")].filter(Boolean).join(". "); // W173 uismall: its words without their stop, as the label adds one
      if (button) button.setAttribute("aria-label", words ? label.replace(/\. (Set course|Get directions)$/, (_, go) => `. ${words}. ${go}`) : label); // W173 uismall: words
      if (shown) relayout();
    };
    if (f.properties?.line) draw(false); // v16: its own, before the card shows
    else Promise.resolve(api.tracks?.(at0, STATION_LINE_M)).then((ts) => { if (live && ts?.length) { tracks = ts; draw(); } }, () => { /* no tiles read: the timetable's lines */ });
    Promise.resolve(api.stations?.()).then((tb) => { if (live && tb?.length) { table = tb; draw(); } }, () => { /* no timetable: the tiles' lines */ });
    if (!navigator.onLine) { said = "Live times need a connection."; draw(false); return { close: () => { live = false; } }; } // W173 uismall: offline, it says so
    ask(stationUrl(at0, key)).then((r) => { // W173 uismall: the one ask
      if (!live) return;
      if (r.json) { ps = parsePredictions(r.json); said = arrivals(ps, at0).items.length ? "" : "No trains due here now."; tick = setInterval(() => live && draw(), 15000); } // W173 uismall: the minutes by the clock, from this reply
      else said = r.status === 429 || r.status === -1 ? "The MBTA asks us to wait a minute." : "No live times right now."; // W173 uismall: stationPeek's words
      draw();
    });
    return { ms: LIVE_MS, close: () => { live = false; clearInterval(tick); } }; // W173 uismall: a live peek's minute (was the lines' few seconds)
  }

  /** W189 transittimes (SPEC §329), her row of 10-28: "Clicking on the bus stop itself doesn't give me the timetable either." With
   *  Comets off, a Sandworm Nest's next buses by route, a row each as the live peek's, from the walker's timetable on the phone
   *  (api.stops, app/walk.js: stops of its name within STOP_M, 60 m), then one ask of the MBTA naming those stops (stopUrl, never a
   *  position), whose predictions take the place of the times they cover (stopEtas), counted down by the clock from that reply.
   *  Offline, the timetable's alone. Few words, never silence: no file on Data Saver, no stop of its name, none due. */
  function nestPeek(f, t, relayout) { // W189 transittimes
    const at0 = f.geometry.coordinates.slice(0, 2), button = t.closest("button"), label = button?.getAttribute("aria-label") || "", body = el("span", "cbody cnest"), what = pick("sandworms", "buses");
    let live = true, got = null, ps = null, said = "", tick = 0;
    const draw = () => {
      if (!live) return;
      const items = got ? stopEtas(got.rows, ps, Date.now(), { clock }).map((g) => [`${pick("Sandworm", "Bus")} ${g.short || g.line}${g.head ? ` · ${g.head}` : ""}`, g.etas.join(", "), g.route, g.color ? `#${g.color}` : ""]) : [];
      body.replaceChildren(items.length ? rows(items) : note(said || `No ${what} due here now.`));
      const words = items.length ? items.map(([a, b]) => `${a}, ${b}`).join(". ") : body.textContent.replace(/\.$/, "");
      if (button) button.setAttribute("aria-label", label.replace(/\. (Set course|Get directions)$/, (_, go) => `. ${words}. ${go}`));
      relayout();
    };
    t.append(body); body.append(note(`Next ${what}…`));
    Promise.resolve(api.stops?.(at0, f.properties?.name || "", f.properties?.ref || "")).then((r) => { // W192 sltimes: its ref
      if (!live) return;
      if (!r?.rows) { said = { saver: WALKW.saver, held: WALKW.held, offline: WALKW.offline, ended: WALKW.ended }[r?.reason] || WALKW.noStop; return draw(); } // Data Saver with no file: it says so
      got = r; said = r.stops.length ? "" : WALKW.noStop;
      draw();
      const mbta = r.stops.filter((id) => !id.startsWith(MASSPORT)); // W192 sltimes: the MBTA is asked only for its own stops
      if (!r.rows.length || !mbta.length || !navigator.onLine) return; // offline: the timetable's times alone; W192 sltimes: Massport's alone too
      ask(stopUrl(mbta, key)).then((x) => { if (!live || !x.json) return; ps = parsePredictions(x.json); draw(); tick = setInterval(draw, 15000); }); // the one ask
    }, () => { said = WALKW.offline; draw(); });
    return { ms: LIVE_MS, close: () => { live = false; clearInterval(tick); } };
  } // W189 transittimes

  function set(v, store = true) {
    on = !!v;
    if (store) try { localStorage.setItem(SETTING, on ? "on" : "off"); } catch { /* storage off */ }
    if (!on) { comets.clear(); modified = ""; prevReply = 0; track([]); } // W33 peeks: and no line
    map.triggerRepaint();
    if (on) kick();
    return on;
  }
  const api = {
    layer, tick, at, cometPeek, stationPeek, set, stats, limiter,
    changed: null, // W77 rest: () → each new set of places, from update()
    tracks: null, // W111 stationlines: (lonlat, m) → the z15 tiles' `transit` features near it (main.js, the world's)
    stations: null, // W111 stationlines: () → the comets timetable's stations (app/transit.js stations()), or none
    stops: null, // W189 transittimes: (lonlat, name) → a bus stop's times by route (app/walk.js stops()), or none
    sink: null, // W70 deep: (comet) → its drop below the ground in 3D, mercator units (app/deep.js), or none
    get on() { return on; }, get fps() { return fps; }, get count() { return shown ? comets.size : 0; },
    get calm() { return calm; }, set calm(v) { calm = !!v; },
    theme(t) { theme = t; for (const c of comets.values()) { paint(c); c.drawnX = NaN; } if (tracked.routes.length) track(tracked.routes, tracked.dir); map.triggerRepaint(); }, // W33 peeks: the line too
    /** For tests: each comet's id, route and head [lon, lat] as drawn. */
    list: () => [...comets.values()].map((c) => ({ id: c.id, route: c.route, lonlat: [lonOf(c.hx), latOf(c.hy)], drawn: [lonOf(c.hx + c.ox), latOf(c.hy + c.oy)], line: !!c.g?.line, z: c.z || 0 })), // W88 settings3: no fade; W70 deep: z, its height as drawn (mercator units); W144 tlines: lonlat on its line, drawn aside
    host: MBTA,
  };
  return api;
}
