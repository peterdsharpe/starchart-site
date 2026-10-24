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
  parseVehicles, pollDelay, routeOf, shapesUrl, stationUrl, tripUrl, vehiclesUrl } from "./comets-logic.js";
import { clockAt } from "./course-logic.js";
import { pick } from "./lingo-mode.js"; // W60 b: the peeks' words
import { bikeWords, bikesNow, stationWords, word } from "./comet-bikes.js"; // W59 cometbikes; W88 settings3: no bikes-only view, so no fades
import { keepLayer } from "../chart/prototype/gl-layer.js"; // W39 ship

export const SETTING = "starchart.comets"; // "off" or "on" (the default)
const SHAPES = "starchart:comets-shapes", WEEK = 7 * 864e5;
const TAIL = 8; // dots behind the head, overlapping, so the tail reads as one streak
const PER = TAIL + 2; // instances a comet: its glow, its head, its tail
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
  float a = smoothstep(1.0, 0.25, r) * v_look.y;
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
  let on = localStorage.getItem(SETTING) !== "off", modified = "", lastReply = 0, movedAt = performance.now(), open = null, timer = 0, busy = false;
  let buf = new Float32Array(STRIDE * PER * 128), shown = false, fps = 0;
  const tmp = [0, 0], head = [0, 0], tail = new Float64Array(2 * TAIL);
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
      area: map.getZoom() >= 9 && inArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]) };
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
      if (!c) { c = { id: v.id, x: to[0], y: to[1], g: null, t0: now, dur: 0, from: [0, 0], to, color: [0, 0, 0], hx: to[0], hy: to[1], drawnX: NaN, drawnY: NaN }; comets.set(v.id, c); }
      const moved = c.to[0] !== to[0] || c.to[1] !== to[1];
      if (c.trip !== v.trip) c.bikes = 0; // W59 cometbikes: a new trip says for itself
      Object.assign(c, { route: v.route, trip: v.trip, stop: v.stop, status: v.status, dir: v.dir, bearing: v.bearing });
      if (!c.color[0] && !c.color[1] && !c.color[2]) paint(c);
      if (!moved && c.g) continue;
      const from = [c.hx, c.hy]; // where it is drawn now
      const g = glideOf(lines[v.route], dur ? from : null, to, v.dir, tmp);
      c.g = g; c.from = g.jump ? to : from; c.to = to; c.t0 = now; c.dur = g.jump || calm ? 0 : dur;
    }
    for (const id of comets.keys()) if (!seen.has(id)) comets.delete(id);
    if (open?.comet && !comets.has(open.comet.id)) open.gone?.();
    api.changed?.(); // W77 rest: new places to glide to (main.js wakes its sleeping frame loop)
  }
  // on the dark chart a line's colour is lifted a third toward white, so the Blue Line's deep blue shows on the void
  const tint = (route) => { const rgb = hex(routeOf(routes, route || "").color); return theme === "light" ? rgb : rgb.map((v) => v + (1 - v) * 0.35); };
  function paint(c) {
    c.color = tint(c.route);
    c.core = theme === "light" ? 0.2 : 0.8;
    c.glow = LOOK.glow[theme === "light" ? "light" : "dark"]; // W50 layers: a little brighter
  }

  /** Where comet c is at time `now` (ms, performance.now): its head, and its tail `len` mercator units long behind it. */
  function place(c, now, len) {
    const g = c.g, u = c.dur ? Math.min(1, (now - c.t0) / c.dur) : 1;
    if (g?.line) {
      const s = g.s0 + (g.s1 - g.s0) * u, back = g.fwd ? -1 : 1;
      g.line.at(s, head);
      for (let k = 0; k < TAIL; k++) g.line.at(s + back * len * (k + 1) / TAIL, tail, 2 * k);
    } else {
      const f = c.from || c.to, e = g?.end || c.to; // W92 cometsnap: onto its line when its new place is near it
      head[0] = f[0] + (e[0] - f[0]) * u; head[1] = f[1] + (e[1] - f[1]) * u;
      let dx = e[0] - f[0], dy = e[1] - f[1], d = Math.hypot(dx, dy);
      if (d < 1e-9 && c.bearing != null) { const b = (c.bearing * Math.PI) / 180; dx = Math.sin(b); dy = -Math.cos(b); d = 1; }
      for (let k = 0; k < TAIL; k++) { const t = d < 1e-9 ? 0 : (len * (k + 1)) / TAIL / d; tail[2 * k] = head[0] - dx * t; tail[2 * k + 1] = head[1] - dy * t; }
    }
    c.hx = head[0]; c.hy = head[1];
  }

  let n = 0, rgb = null, gz = 0; // this frame's instances so far, and the comet's colour and ground (W40 maplayout), for put(): no closure a frame
  const put = (x, y, size, alpha, core) => { const o = n++ * STRIDE; buf[o] = x - O[0]; buf[o + 1] = y - O[1]; buf[o + 2] = gz; buf[o + 3] = size; buf[o + 4] = alpha; buf[o + 5] = core; buf[o + 6] = rgb[0]; buf[o + 7] = rgb[1]; buf[o + 8] = rgb[2]; };
  /** W40 maplayout: the ground's height under the head in 3D, in mercator units (as Ship3D's), so a tilt keeps the comets on the hills. */
  const ground = (c) => { const lat = latOf(c.hy); return (map.queryTerrainElevation([lonOf(c.hx), lat]) || 0) / (40075016.686 * Math.cos((lat * Math.PI) / 180)); };
  const inView = (c, x0, x1, y0, y1, pad) => c.hx > x0 - pad && c.hx < x1 + pad && c.hy > y0 - pad && c.hy < y1 + pad;
  /** Each frame: the comets' places now. True when the chart must be drawn again: a comet in view moved half a px. `fps`
   *  is the rate the fastest glide in view wants. */
  function tick(t = performance.now()) {
    const show = on && comets.size > 0 && performance.now() - lastReply < STALE_MS && map.getZoom() >= 9;
    if (!show) { fps = 0; if (shown) { shown = false; layer.set(buf, 0); return true; } return false; }
    const z = map.getZoom(), world = 512 * 2 ** z, r = cometRadius(z), len = Math.max(12, Math.min(36, 16 + (z - 12) * 4)) / world; // small at low zoom
    const b = map.getBounds(), x0 = mercX(b.getWest()), x1 = mercX(b.getEast()), y0 = mercY(b.getNorth()), y1 = mercY(b.getSouth()), pad = 40 / world;
    if (buf.length < comets.size * PER * STRIDE) buf = new Float32Array(comets.size * PER * STRIDE * 2);
    let moved = !shown, speed = 0;
    const deep = !!map.getTerrain(); // W40 maplayout
    n = 0;
    for (const c of comets.values()) {
      place(c, t, len);
      // only the comets in view go in the buffer (an instance off the screen still costs the draw)
      if (!inView(c, x0, x1, y0, y1, pad)) { c.drawnX = NaN; continue; }
      gz = deep ? ground(c) - (api.sink ? api.sink(c) : 0) : 0; c.z = gz; // W40 maplayout: the hills rise as the tilt eases in, and their tiles come; W70 deep: in a tunnel, at its depth (app/deep.js)
      if (Math.hypot(c.hx - c.drawnX, c.hy - c.drawnY, gz - c.drawnZ) * world >= 0.5 || !(c.drawnX === c.drawnX)) moved = true; // NaN: it has just come into view; W40 maplayout: z
      if (c.dur && t - c.t0 < c.dur) { const e = c.g?.end || c.to, d = c.g?.line ? Math.abs(c.g.s1 - c.g.s0) : Math.hypot(e[0] - c.from[0], e[1] - c.from[1]); speed = Math.max(speed, (d * world * 1000) / c.dur); } // W92 cometsnap: e
      const big = open?.comet === c ? 1.5 : 1; // W88 settings3: no alpha, since the bikes-only view that faded them went
      rgb = c.color;
      for (let k = TAIL - 1; k >= 0; k--) { const f = (k + 1) / (TAIL + 1); put(tail[2 * k], tail[2 * k + 1], Math.max(1.6, r * big * (1 - 0.45 * f)), LOOK.tail * (1 - f) ** 0.8, 0.25 * (1 - f)); } // tapering and fading
      put(c.hx, c.hy, r * 2.2 * big, c.glow, 0); // the glow
      put(c.hx, c.hy, r * big, 1, c.core); // the head
    }
    shown = true;
    fps = calm ? 0 : Math.min(10, Math.ceil(speed)); // a frame each px a comet moves, at most 10 a second
    if (!moved) return false;
    for (const c of comets.values()) if (inView(c, x0, x1, y0, y1, pad)) { c.drawnX = c.hx; c.drawnY = c.hy; c.drawnZ = c.z; } // W40 maplayout: z
    layer.set(buf, n);
    return true;
  }

  /** W70 deep: where comet c was last drawn, in the canvas's CSS px, z and all (its layer's matrix). */
  const drawnAt = (c) => {
    const M = layer.matrix, X = c.hx - O[0], Y = c.hy - O[1], Z = c.z, cv = map.getCanvas(), w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
    return { x: ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w + 1) / 2 * cv.clientWidth, y: (1 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w) / 2 * cv.clientHeight };
  };
  /** The comet under a tap at (x, y) on the map's canvas, within `r` px, nearer than `than` px; or null. */
  function at(x, y, than = Infinity, r = HIT_PX) {
    if (!shown) return null;
    let best = null, bd = Math.min(r, than);
    for (const c of comets.values()) {
      const q = api.sink && c.z ? drawnAt(c) : map.project([lonOf(c.hx), latOf(c.hy)]), d = Math.hypot(q.x - x, q.y - y); // W70 deep: a sunk comet where it is drawn
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
  const dot = (route, color) => { const i = el("i", "cdot"); i.setAttribute("aria-hidden", "true"); i.style.setProperty("--line", color || routeOf(routes, route).color); return i; };
  /** Rows of [label, time, route, colour]: spans, since a parked station's peek is a button. W33 peeks: a colour from the
   *  reply (a sandworm's) over the route's. */
  const rows = (items) => {
    const list = el("span", "crows");
    for (const [label, time, route, color] of items) {
      const r = el("span", "crow"), cn = el("span", "cn"), ct = el("span", "ct");
      String(label).split("/").forEach((s, k) => { if (k) cn.append("/", document.createElement("wbr")); cn.append(s); }); // arclight's screenshot, 2026-10-23: "Ashmont/Braintree" breaks at its slash, never a letter a line
      String(time).split(", ").forEach((s, k) => { if (k) ct.append(", "); ct.append(/^\d/.test(s) ? el("span", "", s) : s); }); // and the times wrap between trains, a time ("2 min", "3:47 · Track 2") never inside itself; the MBTA's words ("Stopped 3 stops away") wrap as words
      r.append(...(route ? [dot(route, color)] : []), cn, ct); list.append(r);
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
    n.style.setProperty("--line", routeOf(routes, c.route || "").color); // W73 a11y: no role="status": hints.js show() says it
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

  /** A Comet Station's next trains, or W33 peeks: a Sandworm Nest's next sandworms (buses), under its name in `t` (the
   *  peek's words): returns close(). A station's peek lights its lines too. */
  function stationPeek(f, t, relayout) {
    if (!on) return null; // comets off: the MBTA is never asked
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
      const now = Date.now(), perTrain = (g) => bikesNow(g.route, g.dir, now).ok === null; // W59 cometbikes: a Commuter Rail train says for itself on weekdays
      const mark = (p) => (perTrain(p) && bikesNow(p.route, p.dir, now, { bikes: p.bikes }).ok === false ? ` · ${word("no").toLowerCase()}` : ""); // W59 cometbikes: "4:47 · no bikes"
      const groups = arrivalsAt(parsePredictions(r.json), at0, now, { clock, mark });
      const items = groups.map((g) => [`${nest ? `${pick("Sandworm", "Bus")} ${g.name || g.route}` : short(g.route)}${g.headsign ? ` · ${g.headsign}` : ""}`, g.etas.join(", "), g.route, g.color]); // W60 b: Plain's buses
      const family = (g) => (/^Green/.test(g.route) ? "Green" : short(g.route)); // W59 cometbikes: the Green Line's branches as one
      const bikes = !items.length ? "" : nest ? word("rack") : stationWords(groups, now, { station: groups[0].station, name: family, perTrain }); // W59 cometbikes
      body.replaceChildren(...(bikes ? [el("small", "cbike", bikes)] : []), items.length ? rows(items) : note(`No ${what} due here now.`)); // W59 cometbikes: bikes first
      if (button) button.setAttribute("aria-label", label.replace(/\. (Set course|Get directions)$/, (_, go) => `. ${[bikes, ...items.map(([a, b]) => `${a}, ${b}`)].filter(Boolean).join(". ")}. ${go}`)); /* W60 b: Plain's */ // W59 cometbikes: bikes
      if (!nest && open === peek) track([...new Set(groups.map((g) => g.route))]); // W33 peeks: its lines
      relayout();
    };
    const stop = refreshing(STATION_MS, run, peek);
    return { ms: LIVE_MS, close: () => { stop(); track([]); } };
  }

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
    sink: null, // W70 deep: (comet) → its drop below the ground in 3D, mercator units (app/deep.js), or none
    get on() { return on; }, get fps() { return fps; }, get count() { return shown ? comets.size : 0; },
    get calm() { return calm; }, set calm(v) { calm = !!v; },
    theme(t) { theme = t; for (const c of comets.values()) { paint(c); c.drawnX = NaN; } if (tracked.routes.length) track(tracked.routes, tracked.dir); map.triggerRepaint(); }, // W33 peeks: the line too
    /** For tests: each comet's id, route and head [lon, lat] as drawn. */
    list: () => [...comets.values()].map((c) => ({ id: c.id, route: c.route, lonlat: [lonOf(c.hx), latOf(c.hy)], line: !!c.g?.line, z: c.z || 0 })), // W88 settings3: no fade; W70 deep: z, its height as drawn (mercator units)
    host: MBTA,
  };
  return api;
}
