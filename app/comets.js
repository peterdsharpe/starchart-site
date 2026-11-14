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
import { MBTA, Line, Limiter, STALE_MS, cometRadius, comingStops, decodePolyline, glideOf, inArea, mayPoll, mercX, mercY, nestUrl, parsePredictions, parseShapes,
  parseVehicles, pollDelay, routeOf, lineColour, shapesUrl, STATION_LINE_M, stationLines, stationUrl, tripUrl, vehiclesUrl, TAIL_R, SIDE, sideOffsets, tailRadius, tailSpots, placeComet, stopUrl, RIM, TAIL_DOTS, tailFade, rimColour, gtfsStation, tableRoutes, cardSections, sectionName, stationStopUrl, ownRoute } from "./comets-logic.js"; // W219 stationcard3: cardSections, sectionName, stationStopUrl (withAlerts, arrivalsAt: its sections), ownRoute (W218 stations2's, as rel-0.1.106 has it) // W211 stationcard2: gtfsStation, tableRoutes, withAlerts // W200 comets4: SIDE; W111 stationlines: stationLines; W144 tlines: TAIL_R, sideOffsets; W150 mapink: tailRadius, tailSpots; W153 tstations: placeComet
import { nameInk } from "./comets-logic.js"; // W225 stationcard4 (SPEC §473): a line's name on its colour is white
import { rereadTable } from "./comets-logic.js"; // W221 cardlive (SPEC §432): when an open card reads its timetable again
import { clockAt } from "./course-logic.js";
import { onLingo, pick, plain } from "./lingo-mode.js"; // W60 b: the peeks' words; W200 comets4: plain, onLingo, Plain's trains without tails
import { bikeWords, bikesNow, takesBike } from "./comet-bikes.js"; // W219 stationcard3: takesBike, a departure's (stationWords, word: no bikes line) // W59 cometbikes; W88 settings3: no bikes-only view, so no fades
import { keepLayer } from "../chart/prototype/gl-layer.js"; // W39 ship
import { KINDS } from "../chart/lingo/kinds.js"; // W191 dataleft (SPEC §335): the trains from the tiles' tracks' zoom, chart/kinds.json's (was 9 here)
import { WORDS as WALKW } from "./walk-card.js"; // W189 transittimes: the timetable's words
import { BIKE } from "./ride-rows.js"; // W219 stationcard3: the one small bike (W217 glyphs6's, her Bluebikes sign's)
import { get } from "./settings.js"; // W191 appleft (SPEC §334): the setting through the registry, with its default
import { COLOURS } from "./colours.js"; // W192 icons7: the bus yellow by day
import { MASSPORT, ALERTS, stationAlerts, word as alertWord } from "../chart/routing/transit.js"; // W192 sltimes: Massport's stops, which the MBTA is never asked about; W211 stationcard2: ALERTS, stationAlerts, alertWord

export const SETTING = "starchart.comets"; // "off" or "on" (the default)
const SHAPES = "starchart:comets-shapes", WEEK = 7 * 864e5;
const TAIL = TAIL_DOTS; // W196 comets3: 30 for the slimmer tail, as close (comets-logic.js); dots behind the head, overlapping, so the tail reads as one streak; W95 cometlook: 16, was 8, for a tail eight radii long; W144 tlines: 24, for TAIL_R's twelve, as close; W150 mapink: 24 still, spaced by their size (tailSpots)
const PER = 3 * TAIL + 3; // instances a comet at most: its tail's rims and fills, then its head's rim, its tail's root again over it, its fill and its chevron (W200 comets4); W196 comets3: its rim (the tail's dots and the head, a size up), its fill (the same), its chevron, was its glow, its head and its tail
// W95 cometlook: the tail's length in head radii (her note: "the tail is really short"); W144 tlines: TAIL_R (comets-logic.js), 12, was 8; W150 mapink: 6.15, 0.1.65's length on the screen
const STRIDE = 11; // floats an instance: a_pos (3), a_look (size px, alpha, kind), a_color (3), a_dir (2); W40 maplayout: a_pos's z, the ground's height; W196 comets3: a_dir, and kind for core
const HIT_PX = 14;
const LIVE_MS = 60000; // a live peek stays this long at most, refreshing
const TRIP_MS = 15000, STATION_MS = 20000;
const TRACK = "comet-track"; // W33 peeks: the layer and source of a tapped comet's line
const WHY_MAX = 100; // W211 stationcard2 (SPEC §397): an alert's own header shows under its line's words up to this long (a longer one only in the card's spoken words)
const O = [mercX(-71.06), mercY(42.36)]; // the buffer's origin, Boston: float32 keeps millimetres

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
in vec2 a_corner;
in vec3 a_pos;     // mercator, from the origin; W40 maplayout: z, the ground's height in 3D
in vec3 a_look;    // radius (CSS px), alpha, kind (0 a disc, 1 the head's chevron); W196 comets3: was core (0..1)
in vec3 a_color;
in vec2 a_dir;     // W196 comets3: the chevron's way, a step ahead on the ground (mercator)
out vec2 v_uv;
out vec3 v_look;
out vec3 v_color;
out vec2 v_dir;
void main() {
  vec4 c = u_matrix * vec4(a_pos, 1.0); // W40 maplayout: on the ground in 3D
  vec4 f = u_matrix * vec4(a_pos + vec3(a_dir, 0.0), 1.0); // W196 comets3: the way on the screen, turned and tilted with the map
  vec2 d = (f.xy / f.w - c.xy / c.w) * u_viewport;
  v_dir = dot(d, d) > 0.0 ? normalize(d) : vec2(1.0, 0.0);
  c.xy += a_corner * a_look.x * 2.0 / u_viewport * c.w;
  gl_Position = a_look.y > 0.0 ? c : vec4(2.0, 2.0, 2.0, 1.0);
  v_uv = a_corner; v_look = a_look; v_color = a_color;
}`;
const FS = `#version 300 es
precision highp float;
uniform float u_px;
in vec2 v_uv;
in vec3 v_look;
in vec3 v_color;
in vec2 v_dir;
out vec4 o;
void main() {
  // W196 comets3: every dot solid with a crisp edge, a device px wide (W95's soft tail dots beaded where they overlapped); the
  // chevron two strokes meeting at its tip, ahead of the head's centre. Distances in the head's radii.
  float px = u_px / v_look.x, d;
  if (v_look.z > 0.5) {
    vec2 p = vec2(dot(v_uv, v_dir), abs(dot(v_uv, vec2(-v_dir.y, v_dir.x)))), a = vec2(-0.28, 0.42), ab = vec2(0.62, -0.42);
    d = length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0)) - 0.19;
  } else d = length(v_uv) - 1.0 + 0.5 * px;
  float a = clamp(0.5 - d / px, 0.0, 1.0) * v_look.y;
  if (a <= 0.0) discard;
  o = vec4(v_color * a, a);
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
    ["a_corner", "a_pos", "a_look", "a_color", "a_dir"].forEach((name, i) => gl.bindAttribLocation(p, i, name)); // W196 comets3: a_dir
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
    for (const [loc, size, off] of [[1, 3, 0], [2, 3, 12], [3, 3, 24], [4, 2, 36]]) { // W40 maplayout: a_pos has z; W196 comets3: a_dir
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
      this.u = { m: gl.getUniformLocation(this.prog, "u_matrix"), v: gl.getUniformLocation(this.prog, "u_viewport"), p: gl.getUniformLocation(this.prog, "u_px") }; // W196 comets3: u_px
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
    gl.uniform1f(this.u.p, 1 / ratio); // W196 comets3: a device px, in CSS px
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
  let buf = new Float32Array(STRIDE * PER * 128), shown = false, fps = 0, shownZ = NaN; // W196 comets3: shownZ, the zoom the buffer was drawn for
  let tails = !plain(), tickT = 0; // W200 comets4 (SPEC §354): SCUL draws its comets' tails, Plain a train's head alone (her row 4); tickT, the last frame's time, for the glide aside
  onLingo(() => { tails = !plain(); shownZ = NaN; api.changed?.(); map.triggerRepaint(); }); // W200 comets4: redrawn at once in the new mode
  const tmp = [0, 0], head = [0, 0];
  const room = (m) => ({ x: new Float64Array(m), y: new Float64Array(m), dx: new Float64Array(m), dy: new Float64Array(m), out: new Float64Array(2 * m), held: new Uint8Array(m), side: new Float64Array(m), tbuf: new Float64Array(2 * TAIL * m), tails: null, tr: new Float64Array(TAIL), dots: TAIL, dt: 0, c: [] }); // W200 comets4: held, side, the tails in px (holdAside)
  let near = room(64); // W144 tlines: this frame's trains in view, for sideOffsets
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
  /** W205 relabel (SPEC §374): while the chart moves or loads tiles, its next idle (at most 1.5 s on); else at once. */
  const still = () => (map.isMoving() || !map.loaded() ? new Promise((r) => { const f = () => { clearTimeout(t); r(); }, t = setTimeout(() => { map.off("idle", f); r(); }, 1500); map.once("idle", f); }) : null); // W205 relabel
  async function ask(url, settle = false) { // W205 relabel: settle, a poll's reply parsed after a gesture's tile loads, not among them
    if (!limiter.take(Date.now())) { stats.limited++; return { status: -1 }; }
    stats.requests++;
    try {
      // no-cache: the browser asks with If-Modified-Since and gets a 304 when nothing changed; no referrer, no cookies
      const r = await fetch(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
      limiter.answer(r.status, Date.now());
      stats.bytes += +r.headers.get("content-length") || 0;
      if (!r.ok) { stats.failed++; return { status: r.status }; }
      if (settle) await still(); // W205 relabel
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
        const r = await ask(shapesUrl(key), true); // W205 relabel: settle
        if (r.json) { const s = parseShapes(r.json); shapesAt = Date.now(); useShapes(s); try { localStorage.setItem(SHAPES, JSON.stringify({ at: shapesAt, ...s })); } catch { /* full */ } }
      }
      if (!mayPoll(state())) return void schedule(5000); // 2026-10-24 (the 0.1.62 gate): turned off, or hidden, while the lines came: no vehicles asked
      const r = await ask(vehiclesUrl(key), true); // W205 relabel: settle
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
  let kickT = 0, kickGo = null; // W205 relabel
  const late = () => !lastReply || performance.now() - lastReply > 15000; // W205 relabel
  map.on("moveend", () => { // W205 relabel (SPEC §374): the kick at the chart's next idle (at most 1.5 s on), so its reply's parse lands after a gesture's tiles, not among them
    movedAt = performance.now(); clearTimeout(kickT); map.off("idle", kickGo); kickGo = null; if (!late()) return; // W205 relabel
    const go = kickGo = () => { clearTimeout(kickT); map.off("idle", go); kickGo = null; if (late()) kick(); }; // W205 relabel
    map.once("idle", go); kickT = setTimeout(go, 1500); // W205 relabel
  }); // W205 relabel
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
      if (c.late) place(c, tickT, lenT); // W205 frames: out of view at the last frame, so not placed then: its place then, as before
      const from = [c.hx, c.hy]; // where it is drawn now
      const g = glideOf(lines[v.route], dur ? from : null, to, v.dir, tmp, c.g?.line || c.g?.along); // W153 tstations: its last line wins a tie
      c.g = g; c.from = g.jump ? to : from; c.to = to; c.t0 = now; c.dur = g.jump || calm ? 0 : dur;
      reachOf(c);
    }
    for (const id of comets.keys()) if (!seen.has(id)) comets.delete(id);
    if (open?.comet && !comets.has(open.comet.id)) open.gone?.();
    api.changed?.(); // W77 rest: new places to glide to (main.js wakes its sleeping frame loop)
  }
  // on the dark chart a line's colour is lifted a third toward white, so the Blue Line's deep blue shows on the void; W186 palette: her
  // line colour by theme (her night fills read on the ground: 3.7:1 and more), as the tracks under it
  const tint = (route) => hex(lineColour(route || "", theme === "light"));
  let rim = hex(rimColour(theme === "light")); // W196 comets3: the rim's and the chevron's colour, the tail's fade
  function paint(c) {
    c.color = tint(c.route); // W196 comets3: no core or glow
  }

  /** Where comet c is at time `now` (ms, performance.now): its head, and its tail `len` mercator units long behind it (c.tail). */
  function place(c, now, len) {
    const u = c.dur ? Math.min(1, (now - c.t0) / c.dur) : 1;
    placeComet(c.g, c.from || c.to, c.to, u, c.bearing, len, spots, TAIL, head, c.tail); // W144 tlines: c.tail; W150 mapink: spots; W153 tstations: placeComet, the tail along its line
    c.hx = head[0]; c.hy = head[1]; c.late = false;
  }
  /** W205 frames (SPEC §377): where comet c's head can be in its glide (u from -1 to 1): within c.reach of its start (c.sx, c.sy),
   *  its length along its line or straight; a comet whose reach is out of view is not placed each frame. */
  function reachOf(c) {
    const g = c.g, from = c.from || c.to, e = g?.end || c.to;
    placeComet(g, from, c.to, 0, c.bearing, 0, spots, 0, head, c.tail); c.sx = head[0]; c.sy = head[1];
    c.reach = g?.line ? Math.abs(g.s1 - g.s0) : Math.hypot(e[0] - from[0], e[1] - from[1]);
  }

  const spots = new Float64Array(TAIL); let spotsR = NaN; // W150 mapink: where the tail's dots lie (tailSpots), for the head's radius spotsR
  let lenT = 0; // W205 frames: the last frame's tail length, for a comet placed late
  let n = 0, rgb = null, gz = 0, dx = 0, dy = 0; // this frame's instances so far, and the comet's colour, ground (W40 maplayout) and way (W196 comets3), for put(): no closure a frame
  /** W196 comets3: an instance: `kind` 0 a disc, 1 the chevron (along dx, dy); its colour the comet's, `k` of the way to the rim's. */
  const put = (x, y, size, alpha, kind, k) => { const o = n++ * STRIDE; buf[o] = x - O[0]; buf[o + 1] = y - O[1]; buf[o + 2] = gz; buf[o + 3] = size; buf[o + 4] = alpha; buf[o + 5] = kind; for (let i = 0; i < 3; i++) buf[o + 6 + i] = rgb[i] + (rim[i] - rgb[i]) * k; buf[o + 9] = kind ? dx : 0; buf[o + 10] = kind ? dy : 0; };
  /** W40 maplayout: the ground's height under the head in 3D, in mercator units (as Ship3D's), so a tilt keeps the comets on the hills. */
  const ground = (c) => { const lat = latOf(c.hy); return (map.queryTerrainElevation([lonOf(c.hx), lat]) || 0) / (40075016.686 * Math.cos((lat * Math.PI) / 180)); };
  const inView = (c, x0, x1, y0, y1, pad) => c.hx > x0 - pad && c.hx < x1 + pad && c.hy > y0 - pad && c.hy < y1 + pad;
  const mayView = (c, x0, x1, y0, y1, pad) => { const p = pad + c.reach; return c.sx > x0 - p && c.sx < x1 + p && c.sy > y0 - p && c.sy < y1 + p; }; // W205 frames: its head may be in view this glide
  /** Each frame: the comets' places now. True when the chart must be drawn again: a comet in view moved half a px. `fps`
   *  is the rate the fastest glide in view wants. */
  function tick(t = performance.now()) {
    const show = on && comets.size > 0 && performance.now() - lastReply < STALE_MS && map.getZoom() >= KINDS.comet_trail.zoom && !!map.getLayer("comets") && map.getLayoutProperty("comets", "visibility") !== "none"; // W173 mapstyle2: not while a preview puts them aside (app/layers.js hush), so a tap finds none; W173 integration: nor while a lost context has no layer yet (MapLibre fires an error for each ask of a missing layer)
    if (!show) { fps = 0; if (shown) { shown = false; layer.set(buf, 0); return true; } return false; }
    const z = map.getZoom(), world = 512 * 2 ** z, r = cometRadius(z), len = (TAIL_R * r) / world; // small at low zoom; W95 cometlook: TAIL_R radii, was 12-36 px
    if (r !== spotsR) { tailSpots(r, TAIL, spots); spotsR = r; for (let k = 0; k < TAIL; k++) near.tr[k] = tailRadius(r, spots[k]); } // W150 mapink; W200 comets4: the dots' radii, for holdAside
    const b = map.getBounds(), x0 = mercX(b.getWest()), x1 = mercX(b.getEast()), y0 = mercY(b.getNorth()), y1 = mercY(b.getSouth()), pad = 40 / world;
    if (buf.length < comets.size * PER * STRIDE) buf = new Float32Array(comets.size * PER * STRIDE * 2);
    if (near.x.length < comets.size) { const tr = near.tr; near = room(comets.size * 2); near.tr = tr; } // W144 tlines; W200 comets4: room()
    let moved = !shown || z !== shownZ, speed = 0, m = 0; // W144 tlines: m, the trains in view; W196 comets3: a zoom redraws standing trains too, whose tails and heads were the last zoom's (her row 18's dots up close)
    const deep = !!map.getTerrain(); // W40 maplayout
    n = 0;
    near.c.length = 0;
    lenT = len; // W205 frames
    for (const c of comets.values()) { // W144 tlines: first each train's place and way, then their offsets aside, then the drawing
      const may = mayView(c, x0, x1, y0, y1, pad); // W205 frames (SPEC §377): only the comets in view, or about to be, placed (was every one, every frame)
      if (may) place(c, t, len); else c.late = true; // W205 frames
      // only the comets in view go in the buffer (an instance off the screen still costs the draw)
      if (!may || !inView(c, x0, x1, y0, y1, pad)) { c.drawnX = NaN; c.held = 0; c.side = 0; continue; } // W200 comets4: back in view, on its line; W205 frames: may
      const wx = c.hx - c.tail[0], wy = c.hy - c.tail[1], wl = Math.hypot(wx, wy) || 1; // its way: from its tail's first dot to its head
      near.x[m] = c.hx * world; near.y[m] = c.hy * world; near.dx[m] = wx / wl; near.dy[m] = wy / wl; near.held[m] = c.held || 0; near.side[m] = c.side || 0; // W200 comets4: held, side
      if (tails) for (let k = 0, o = 2 * TAIL * m; k < 2 * TAIL; k++) near.tbuf[o + k] = c.tail[k] * world; // W200 comets4: its tail in px, on its line
      near.c[m++] = c;
    }
    near.tails = tails ? near.tbuf : null; near.dt = calm ? Infinity : Math.max(0, t - tickT); tickT = t; // W200 comets4: Calm puts them aside and back at once
    sideOffsets(m, near.x, near.y, near.dx, near.dy, r, near.out, near); // W144 tlines: px; W200 comets4: near keeps who's held aside (holdAside)
    for (let i = 0; i < m; i++) {
      const c = near.c[i], ox = (c.ox = near.out[2 * i] / world), oy = (c.oy = near.out[2 * i + 1] / world);
      c.held = near.held[i]; c.side = near.side[i]; if (c.side > 0 && c.side < 1) speed = Math.max(speed, (SIDE.push * r * 1000) / SIDE.ease); // W200 comets4: a frame each px of its glide aside or back
      gz = deep ? ground(c) - (api.sink ? api.sink(c) : 0) : 0; c.z = gz; // W40 maplayout: the hills rise as the tilt eases in, and their tiles come; W70 deep: in a tunnel, at its depth (app/deep.js)
      if (Math.hypot(c.hx + ox - c.drawnX, c.hy + oy - c.drawnY, gz - c.drawnZ) * world >= 0.5 || !(c.drawnX === c.drawnX)) moved = true; // NaN: it has just come into view; W40 maplayout: z; W144 tlines: aside
      if (c.dur && t - c.t0 < c.dur) { const e = c.g?.end || c.to, d = c.g?.line ? Math.abs(c.g.s1 - c.g.s0) : Math.hypot(e[0] - c.from[0], e[1] - c.from[1]); speed = Math.max(speed, (d * world * 1000) / c.dur); } // W92 cometsnap: e
    }
    // W196 comets3 (SPEC §346): each comet one solid shape, rimmed, its chevron; no glow. W200 comets4 (SPEC §354), her row 2: every tail
    // first, then every head over them all, so no head is under another's tail; her row 4: in Plain a train is its head alone.
    if (tails) for (let i = 0; i < m; i++) {
      const c = near.c[i], ox = c.ox, oy = c.oy, tail = c.tail, R = open?.comet === c ? 1.5 * r : r; // W88 settings3: no alpha, since the bikes-only view that faded them went
      rgb = c.color; gz = c.z;
      for (let k = TAIL - 1; k >= 0; k--) put(tail[2 * k] + ox, tail[2 * k + 1] + oy, tailRadius(R, spots[k]) + RIM, 1, 0, 1); // the rim: the tail a size up, under it
      for (let k = TAIL - 1; k >= 0; k--) put(tail[2 * k] + ox, tail[2 * k + 1] + oy, tailRadius(R, spots[k]), 1, 0, tailFade(spots[k])); // the tail: tapering and fading toward the rim's colour; W95 cometlook: narrower than the head, to a point; W144 tlines: aside
    }
    for (let i = 0; i < m; i++) {
      const c = near.c[i], ox = c.ox, oy = c.oy, tail = c.tail, R = open?.comet === c ? 1.5 * r : r, hx = c.hx + ox, hy = c.hy + oy;
      rgb = c.color; gz = c.z;
      put(hx, hy, R + RIM, 1, 0, 1); // the head's rim
      if (tails) for (let k = TAIL - 1; k >= 0; k--) { const q = tailRadius(R, spots[k]); if (Math.hypot(tail[2 * k] - c.hx, tail[2 * k + 1] - c.hy) * world < R + RIM + q) put(tail[2 * k] + ox, tail[2 * k + 1] + oy, q, 1, 0, tailFade(spots[k])); } // W200 comets4: its tail's root again, over the head's rim, so head and tail stay one shape
      put(hx, hy, R, 1, 0, 0); // the head, in its line's colour
      dx = (near.dx[i] * R) / world; dy = (near.dy[i] * R) / world;
      put(hx, hy, R, dx || dy ? 1 : 0, 1, 1); // the chevron, the way it goes; none without a way
    }
    shown = true;
    fps = calm ? 0 : Math.min(10, Math.ceil(speed)); // a frame each px a comet moves, at most 10 a second
    if (!moved) return false;
    for (let i = 0; i < m; i++) { const c = near.c[i]; c.drawnX = c.hx + c.ox; c.drawnY = c.hy + c.oy; c.drawnZ = c.z; } // W40 maplayout: z; W144 tlines: as drawn, aside
    layer.set(buf, n); shownZ = z; // W196 comets3
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
  const ink = (route, hint) => lineColour(route || "", theme === "light", hint); // W186 palette: her line colour by the theme (Daystar's day fills), as the comets' tint; W192 icons7: a bus's by its hint
  const dot = (route, hint) => { // W192 icons7 (SPEC §338): hint, the row's colour; by day her faint yellow takes her thin ink edge (comets.css .pale)
    const i = el("i", "cdot"), c = ink(route, hint); i.setAttribute("aria-hidden", "true"); i.style.setProperty("--line", c);
    if (theme === "light" && c === COLOURS["mbta-day"].bus) i.classList.add("pale"); // W192 icons7; W213 palette3: by day only, as her yellow is one in both themes
    return i;
  };
  /** Rows of [label, time, route, colour]: spans, since a parked station's peek is a button. W33 peeks: a colour from the
   *  reply (a sandworm's) over the route's; W186 palette: her line colour by the route and the theme (ink). W192 icons7 (SPEC §338):
   *  the row's colour, the feed's (a bus's route_color), is ink's hint. */
  const rows = (items) => {
    const list = el("span", "crows");
    for (const [label, time, route, hint, why] of items) { // W192 icons7: hint; W211 stationcard2: why, an alert's header (withAlerts)
      const r = el("span", "crow"), cn = el("span", "cn"), ct = el("span", "ct");
      String(label).split("/").forEach((s, k) => { if (k) cn.append("/", document.createElement("wbr")); cn.append(s); }); // arclight's screenshot, 2026-10-23: "Ashmont/Braintree" breaks at its slash, never a letter a line
      (time === "" ? [] : String(time).split(", ")).forEach((s, k, all) => { if (k) ct.append(" "); const c = k < all.length - 1 ? `${s},` : s, b = ct.appendChild(el("span", "")); if (/^\d/.test(s)) c.split(" · ").forEach((q, j, qs) => { if (j) b.append(" "); b.append(el("span", "", j < qs.length - 1 ? `${q} ·` : q)); }); else b.append(c); }); // and the times wrap between trains, a time ("2 min", "3:47 · Track 2") never inside itself; the MBTA's words ("Stopped 3 stops away") wrap as words. W211 stationcard2 (SPEC §397, her row 25): each train a box with its comma, so no comma is left on a line of its own (comets.css); none, no box, so a line with no times is one line tall (its review's P1)
      if (why != null) ct.classList.add("cstorm"); // W211 stationcard2: an alert's words, in the caution's ink
      r.append(...(route ? [dot(route, hint)] : []), cn, ct, ...(why && why.length <= WHY_MAX ? [el("small", "cwhy", why)] : [])); list.append(r); // W192 icons7: hint; W211 stationcard2: its header under it, where it fits
    }
    return list;
  };
  const note = (text) => el("small", "cnote", text);
  /** W211 stationcard2 (SPEC §397), her row 40: as a station's card opens, one ask of the MBTA's alerts (transit.js ALERTS, the storm-day
   *  check's, the same for everyone, beside its departures; nothing while it is closed) and its GTFS station from our own table (api.table,
   *  chart/transit/station-lines-v1.json): `now(routes)` its lines' alerts in a few words (transit.js stationAlerts), `st` its station;
   *  `redraw()` once both are in. Offline, or with no reply, none. */
  function alertsAt(f, at0, redraw) {
    const got = { json: null, st: null };
    if (navigator.onLine) Promise.all([ask(ALERTS), Promise.resolve(api.table?.()).catch(() => null)]).then(([r, tb]) => { got.json = r.json || null; got.st = gtfsStation(tb, f.properties, at0); if (got.json && got.st) redraw(); });
    got.now = (routes) => (got.json && got.st ? stationAlerts(got.json, got.st.id, Date.now(), [...new Set([...routes, ...tableRoutes(got.st.lines).filter((l) => ownRoute(f.properties, l))])]).map((a) => { // W218 stations2: its own network's lines
      const w = (m) => (a.oneWay ? alertWord("oneWay", { said: alertWord(a.effect, {}, m) }, m) : alertWord(a.effect, {}, m));
      return { ...a, said: pick(w("scul"), w("plain")) };
    }) : []);
    return got;
  }
  /** Every `ms` while the peek is open (and once on Data Saver, which asks only for the tap). */
  function refreshing(ms, run, peek) {
    let t = 0, live = true;
    const go = async () => { if (!live) return; await run(); if (live && !(conn()?.saveData === true)) t = setTimeout(go, ms); };
    go();
    return () => { live = false; clearTimeout(t); if (open === peek) open = null; };
  }

  /** W225 stationcard4 (SPEC §473, UX rule 87): card `n`'s height glides when a draw changes it, never a snap. from(): where it stands now
   *  (mid-glide too), its glide stopped so the draw places it by its true size; none while it is unseen. to(b): the glide from there; none
   *  for a card with a tail (hints.js drawTail), whose outline is drawn at once at its new size: it takes that size at once, as before. */
  function glider(n, unseen = () => false) {
    let a = null;
    const stop = () => { a?.cancel(); a = null; };
    return {
      stop,
      from: () => { if (unseen() || !n.isConnected || n.style.visibility === "hidden") return null; const b = { top: n.offsetTop, height: n.offsetHeight }; stop(); return b; },
      to: (b) => {
        if (!b || n.classList.contains("tailed") || Math.abs(n.offsetHeight - b.height) < 1) return;
        a = n.animate([{ top: `${b.top}px`, height: `${b.height}px` }, { top: `${n.offsetTop}px`, height: `${n.offsetHeight}px` }], { duration: GLIDE_MS, easing: "cubic-bezier(.2, 0, 0, 1)" }); // --ease-standard
        a.onfinish = () => { a = null; };
      },
    };
  }
  const COMING = 5; // W225 stationcard4: a comet's coming stations (comingStops' n), each a placeholder row while they are on their way
  /** W225 stationcard4: `k` rows of a comet's peek on their way, a stop's name and its time each her placeholder. */
  const waitRows = (k) => { const l = el("span", "crows"); for (let i = 0; i < k; i++) { const r = el("span", "crow"), cn = el("span", "cn"), ct = el("span", "ct"); cn.append(el("span", "cwait")); ct.append(el("span", "cwait")); r.append(cn, ct); l.append(r); } return l; };
  /** A comet's peek: { node, close }. `relayout()` places the card again when its content changes. */
  function cometPeek(c, relayout) {
    const name = `${routeOf(routes, c.route || "").name} ${pick("comet", "train")}`; // W60 b
    const n = el("div", "cpeek fly ccomet"), t = el("span", "t"), title = el("b", "", name), dest = el("span", "", ""), body = el("span", "cbody");
    const bike = el("small", "cbike", bikeWords(bikesNow(c.route, c.dir, Date.now(), { bikes: bikesOf(c) }))); // W59 cometbikes: may a bike board it now
    n.style.setProperty("--line", ink(c.route)); // W186 palette: by the theme; W73 a11y: no role="status": hints.js show() says it
    t.append(dot(c.route), title, dest, bike, body); // W59 cometbikes: bike
    n.append(t);
    const put = (...kids) => { morphKids(body, kids); n.toggleAttribute("aria-busy", false); relayout(); }; // W225 stationcard4 (SPEC §473): its rows filled in place; its new size at once, as its tail's outline is drawn (no glide)
    body.append(waitRows(COMING)); n.setAttribute("aria-busy", "true"); // W225 stationcard4: its coming stations on their way, her placeholders where they will be (was "Coming stations…")
    const peek = { comet: c, gone: () => put(note(pick("This comet has left the chart.", "This train has left the chart."))) }; // W60 b
    open = peek;
    layer.dirty = true; c.drawnX = NaN; // drawn bigger while its peek is open
    const run = async () => {
      if (!navigator.onLine) return put(note("Live times need a connection.")); // W225 stationcard4: put
      const r = await ask(tripUrl(c.trip, key));
      if (!r.json) { if (!body.querySelector(".crows") || n.hasAttribute("aria-busy")) put(note(r.status === 429 || r.status === -1 ? "The MBTA asks us to wait a minute." : "No live times right now.")); return; } // W225 stationcard4: put, and its placeholders go
      const ps = parsePredictions(r.json), head = ps.find((p) => p.headsign)?.headsign;
      dest.textContent = head ? ` · to ${head}` : "";
      c.bikes = ps.find((p) => p.bikes)?.bikes || 0; bike.textContent = bikeWords(bikesNow(c.route, c.dir, Date.now(), { bikes: bikesOf(c) })); // W59 cometbikes: a Commuter Rail train's own
      const stops = comingStops(ps, Date.now(), c, { clock });
      n.setAttribute("aria-label", [name + dest.textContent, bike.textContent, ...stops.map((s) => `${s.name}, ${s.eta}`)].join(". ")); // W59 cometbikes: bike
      put(stops.length ? rows(stops.map((s) => [s.name, s.eta])) : note("No coming stations given.")); // W225 stationcard4: in place (was replaceChildren)
    };
    const stop = refreshing(TRIP_MS, run, peek);
    track([c.route], c.dir); // W33 peeks: its line
    return { node: n, ms: LIVE_MS, text: name, close: () => { stop(); c.drawnX = NaN; track([]); } };
  }

  // ---- W219 stationcard3 (SPEC §428), her rows 26 and 24: the stop's and station's card -------------------------------------------
  // One card for a bus stop and a station, Comets on or off: its departures in sections by line (comets-logic.js
  // cardSections), a header strip in the line's colour, a row for each direction, each time live (no mark) or the timetable's (grey, a
  // clock before it), a bike after each departure that takes one, the slot empty where it doesn't; a × in its head; the key and the place's
  // tiles in its foot. Its times: the MBTA's predictions (asked as it opens, and again every STATION_MS while it is open: W221 cardlive),
  // then the walker's timetable on the phone past the last of them (walk.js stops(): a station's by its GTFS id, its trains, the Silver
  // Line, its shuttles and Massport's at Airport). A station is asked for by its GTFS id (the MBTA counts its child stops: the Silver
  // Line's berths), so the ask is still one.
  const CLOCK = '<svg class="cclk" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/></svg>'; // her small clock
  const KEY = { scheduled: "scheduled", bikes: "takes bikes" }; // her legend's words, the same in both modes (the bike rule says bikes in SCUL too, comet-bikes.js)
  /** A strip's words: white, black only on her bus yellow (W225 stationcard4: comets-logic.js nameInk; was whichever read better). */
  const stripInk = (c) => `var(--fixed-${nameInk(c)})`; // W225 stationcard4
  /** The card's frame around `t` (the card's words): its × (a live card's), the list that scrolls, and the key, in the foot beside the
   *  tiles (or under the list in flight, where the card is words only). */
  function frame(t, hide) {
    const card = t.closest(".cpeek-place") || t.closest(".cpeek"), head = t.closest(".cpeek"), list = el("div", "cst-list"), legend = el("span", "cst-key");
    card.classList.add("cst");
    list.setAttribute("aria-hidden", "true"); // its words are Go's spoken name (as the rows were), or the card's words in flight
    list.addEventListener("scroll", () => fade(list), { passive: true });
    if (card.matches(".cpeek-place")) {
      const x = el("button", "cst-x"); x.innerHTML = '<i class="i i-close"></i>'; x.setAttribute("aria-label", "Close"); x.title = "Close";
      x.onclick = (e) => { e.stopPropagation(); hide?.(); };
      const acts = card.querySelector(":scope > .acts"), tiles = el("span", "cst-tiles");
      head.append(x); head.after(list); if (acts) { tiles.append(...acts.children); acts.append(legend, tiles); } // the key at the left, the tiles together at the right (under it where they don't fit beside it)
    } else t.after(list, legend);
    legend.innerHTML = `<span class="key-sch off">${CLOCK}${KEY.scheduled}</span><span class="key-bk off">${BIKE}${KEY.bikes}</span>`; // W225 stationcard4 (SPEC §473): its place kept from the first frame, so it never comes and goes with the marks; an entry the card has none of unseen, after the ones it has
    return { card, list, legend };
  }
  /** W225 stationcard4 (SPEC §473, UX rule 87): live node `a` made to look like fresh node `b`, its nodes kept where they match (a time's words
   *  changed in place): a refresh that changes nothing changes no node, so nothing flashes and no picture is drawn again. */
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return void a.replaceWith(b);
    if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
    for (const { name, value } of b.attributes) if (name === "style") { if (a.style.cssText !== b.style.cssText) a.style.cssText = b.style.cssText; } else if (a.getAttribute(name) !== value) a.setAttribute(name, value); // a style by the CSSOM (the page's CSP refuses a style attribute set)
    for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
    morphKids(a, [...b.childNodes]);
  }
  /** W225 stationcard4: `n`'s children made to look like `kids` (morph), `n` itself as it is. */
  function morphKids(n, kids) {
    const ac = [...n.childNodes];
    kids.forEach((k, i) => (i < ac.length ? morph(ac[i], k) : n.append(k)));
    for (const x of ac.slice(kids.length)) x.remove();
  }
  /** Her fade on the cut-off row, while the list has more below. */
  const fade = (list) => list.classList.toggle("more", list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  /** A section's rows: [{ dir, head, times: [{ text, live, bike }] }] as the destination and its times, a time a line each. W225 stationcard4
   *  (SPEC §473, her row 4): `wait`, its times still on their way: each her placeholder (.cwait) where it will be, its bike's slot kept; a
   *  destination not known yet (`head` null) and a line not known yet (`route` null: a stop's before its timetable) a placeholder too. */
  function section(s, wait = false) {
    const sec = el("div", "csec"), h = el("div", "csec-h", s.name ?? undefined), c = s.route == null ? null : ink(s.route, s.color); // W225 stationcard4
    if (c) { sec.style.setProperty("--sec", c); sec.style.setProperty("--sec-ink", stripInk(c)); } else { sec.classList.add("cguess"); h.append(el("span", "cwait")); } // W225 stationcard4
    sec.append(h);
    if (s.alert) { const r = el("div", "cdep calert"), w = el("span", "cdest", s.alert.said); r.append(w, ...(s.alert.why && s.alert.why.length <= WHY_MAX ? [el("small", "cwhy", s.alert.why)] : [])); sec.append(r); } // W211 stationcard2's words, in its line's section
    for (const row of s.rows) {
      const r = el("div", "cdep"), cn = el("span", "cdest"), ct = el("span", "ctimes");
      if (row.head == null) cn.append(el("span", "cwait")); // W225 stationcard4: a destination on its way
      else String(row.head).split("/").forEach((x, k) => { if (k) cn.append("/", document.createElement("wbr")); cn.append(x); }); // "Ashmont/Braintree" breaks at its slash; none where the feed names none (Massport's), its strip saying it
      for (const tm of row.times) {
        const line = el("span", wait ? "tm" : tm.gone ? "tm gone" : tm.live ? "tm" : "tm sch"), text = el("span", "tt"); // W225 stationcard4: wait
        if (wait) text.append(el("span", "cwait")); // W225 stationcard4: her light grey oval, a time's size, its highlight moving left to right
        else { if (!tm.live) text.innerHTML = CLOCK; text.append(tm.text); }
        const bk = el("i", "bk"); if (tm.bike && !wait) bk.innerHTML = BIKE; // her bike in its column, the slot kept where the departure takes none
        line.append(text, bk); ct.append(line);
      }
      r.append(cn, ct); sec.append(r);
    }
    return sec;
  }
  /** The card's words for a screen reader, in its sections' order: "Orange Line, Forest Hills: 2 min, 5 min with bikes". */
  const sectionWords = (s) => [s.name, ...(s.alert ? [s.alert.said, s.alert.why].filter(Boolean) : []), ...s.rows.map((r) => `${r.head ? `${r.head}: ` : ""}${r.times.map((x) => `${x.text}${x.live ? "" : ` ${KEY.scheduled}`}${x.bike ? `, ${KEY.bikes}` : ""}`).join("; ")}`)].map((x) => x.replace(/\.$/, "")).join(". ");
  const NONE = "No trains due here now."; // W211 stationcard2
  /** W225 stationcard4 (SPEC §473, UX rule 87): a card's times wait for the MBTA's reply this long after its ask, as placeholders, before the
   *  timetable's fill in, marked; the card waits this long for its timetable before it shows what it knows (HOLD_MS); a change of its height
   *  glides (GLIDE_MS); the last settled shape of each card this visit (`shapes`, by its place), for its first frame when it opens again. */
  const WAIT_MS = 1000, HOLD_MS = 150, GLIDE_MS = 300, shapes = new Map();
  let tabled1 = false; // W225 stationcard4: the walker's timetable has answered a card this visit, so it is in memory and answers in a frame or two (else no hold: the first read takes most of a second)
  /** W225 stationcard4: a card's shape before its timetable: the lines it knows, each a row a way (a stop's, one), every value a placeholder. */
  const guessed = (lines, station) => (lines?.length ? lines : [{ line: null }]).map((l) => ({ route: l.line == null ? null : l.line === "Commuter Rail" ? "CR-" : l.line, name: l.line == null ? null : l.name, color: "", alert: null, rows: Array.from({ length: station ? 2 : 1 }, () => ({ head: null, times: [{}, {}] })) }));
  /** The card of a Comet Station or a Sandworm Nest `f`, its words in `t`; `hide()` closes it (its ×). { ms, stay,
   *  dock, close }: a live card stays until it is sent away, docked over the chart's foot (app/hints.js). */
  function stationPeek(f, t, relayout, hide) { // W219 stationcard3: one card for a station and a stop (were stationPeek, linesPeek and nestPeek)
    const p = f.properties || {}, station = p.kind === "comet_station", at0 = f.geometry.coordinates.slice(0, 2);
    const button = t.closest(".cpeek-place")?.querySelector(".acts .go"), label = button?.getAttribute("aria-label") || ""; // W219 placecard: the card's Go speaks for it
    const polls = on, what = station ? "trains" : pick("sandworms", "buses"), { card, list, legend } = frame(t, hide);
    let live = true, ps = null, table = null, st, said = "", asked = !navigator.onLine, tracks = [], lines = null, ctt = null;
    let turnT = 0, asking = false, tapped = false, seen = null, liveAt = 0, then = null, again = null, reading = null; // W221 cardlive (SPEC §432): its loop; when the reply came, the timetable then; the timetable's read
    let pending = true, waitT = 0, tabled = false, held = false, holdT = 0; // W225 stationcard4 (SPEC §473): its times on their way; its wait for them; its timetable read; unseen till its shape is known
    const gl = glider(card, () => held); // W225 stationcard4: its glide
    const place = `${p.kind}|${p.name || ""}|${p.ref || ""}|${at0.map((v) => v.toFixed(5))}`; // W225 stationcard4: its shape's key
    const peek = { station: at0 };
    const own = (r) => ownRoute(p, r); // W218 stations2: a station's own network's, where its two stand apart (South Station's subway station has the Silver Line)
    const routes = () => [...new Set([...(ps || []).map((r) => r.route), ...(table?.rows || []).map((r) => r.route), ...tableRoutes(st?.lines || [])].filter((r) => r && own(r)))];
    const alerts = station ? alertsAt(f, at0, () => draw()) : null; // W211 stationcard2: asked once, as it opens
    const railed = (r) => /^(Red|Orange|Blue|Mattapan|Green|CR-)/.test(r || ""); // the comets' lines, lit while it is open
    const draw = () => {
      if (!live) return;
      if (ps && !then && table?.rows) then = table.rows; // W221 cardlive: the reply's timetable, the first known since it came
      const mine = !station && polls && table?.stops?.length ? table.stops : null; // asked by its point (nestUrl, about 100 m): its timetable's stops' (as with Comets off: its ref's kerb, or with no ref a same-named twin's too), not the nearest alone; asked by its stops, the reply is theirs (a busway's berths by its station's id)
      const { sections, scheduled, bikes } = cardSections({ live: ps, table: table?.rows || null, now: Date.now(), liveAt, liveTable: then, near: station || polls ? at0 : null, stops: mine, clock, alerts: alerts ? alerts.now(routes()) : [],
        bike: (r, d, at, b) => takesBike(r, d, at, b, st?.id || ""), names: (r, i) => sectionName(r, i, { bus: pick("Sandworm", "Bus"), shuttle: "Shuttle" }), own }); // the card's words read: "Shuttle 22" in SCUL too (every Massport number is also an MBTA bus's: "Sandworm 66" read as the 66 from Harvard)
      const wait = pending && !ps, kept = wait ? shapes.get(place) : null; // W225 stationcard4 (SPEC §473): its times on their way; meanwhile its last settled shape, the reply's rows as they were (a live train's row the timetable lacks too)
      const guess = kept || (!sections.length && !said && !(tabled && asked) ? guessed(lines?.filter((l) => own(l.line)), station) : []); // W225 stationcard4: else, before its timetable, the lines it knows
      if (sections.length && !wait) { shapes.delete(place); shapes.set(place, sections.map((x) => ({ ...x, rows: x.rows.map((r) => ({ head: r.head, times: r.times.map(() => ({})) })) }))); if (shapes.size > 50) shapes.delete(shapes.keys().next().value); } // W225 stationcard4: its shape, for its first frame when it opens again (the last 50)
      const strips = !sections.length && !guess.length && station && lines?.length ? lines.filter((l) => own(l.line)).map((l) => ({ route: l.line === "Commuter Rail" ? "CR-" : l.line, name: l.name, color: "", rows: [], alert: null })) : []; // none due: the station's lines (W111 stationlines)
      const why = sections.length || guess.length ? "" : said || (station ? NONE : `No ${what} due here now.`), busy = wait && sections.length > 0 || guess.length > 0; // W225 stationcard4: guess, busy
      const was = gl.from(); // W225 stationcard4: where it stands, its glide's start
      morphKids(list, [...(kept ? [] : sections).map((x) => section(x, wait)), ...guess.map((x) => section(x, true)), ...strips.map((x) => section(x)), ...(why ? [note(why)] : [])]); // W225 stationcard4: changed in place (was replaceChildren)
      const [ks, kb] = [legend.querySelector(".key-sch"), legend.querySelector(".key-bk")], sch = scheduled && !wait && !guess.length, bk = bikes && !wait && !guess.length; // W225 stationcard4: the key's place kept, its entries shown as the card has them
      ks.classList.toggle("off", !sch); kb.classList.toggle("off", !bk);
      if (!sch && bk && legend.firstChild === ks) legend.append(ks); else if (sch && legend.firstChild !== ks) legend.prepend(ks); // the ones it has first
      const words = busy ? "" : [...sections.map(sectionWords), ...strips.map((s) => s.name), why.replace(/[.…]$/, "")].filter(Boolean).join(". "); // W225 stationcard4: the name at once, its times when they are in, never the placeholders
      const spoken = button ? (words ? label.replace(/\. (Set course|Get directions)$/, (_, go) => `. ${words}. ${go}`) : label) : `${t.textContent}${words ? `. ${words}` : ""}`; // W225 stationcard4: set only when it changes
      if (button) { if (button.getAttribute("aria-label") !== spoken) button.setAttribute("aria-label", spoken); }
      else if (card.matches(".fly") && card.getAttribute("aria-label") !== spoken) card.setAttribute("aria-label", spoken);
      if (busy && card.getAttribute("aria-busy") !== "true") card.setAttribute("aria-busy", "true"); else if (!busy && card.hasAttribute("aria-busy")) card.removeAttribute("aria-busy"); // W225 stationcard4: aria-busy while its times are on their way
      if (polls && station && open === peek) track([...new Set((ps || []).map((r) => r.route).filter((r) => railed(r) && own(r)))]); // W33 peeks: its lines lit while it is open
      relayout();
      fade(list); // by its settled size (W225 stationcard4: before its glide, whose first frames would cut its rows short)
      gl.to(was); // W225 stationcard4: a new height glides
    };
    /** W225 stationcard4: shown once its shape is known (its timetable read, a reply, or HOLD_MS gone), its entrance from its start. */
    const reveal = () => {
      if (!held || !live) return;
      clearTimeout(holdT);
      draw(); // placed for its shape while still unseen: no glide into it
      held = false;
      card.classList.remove("cst-hold");
      for (const a of card.getAnimations()) if (a.animationName === "cpeek-in") a.currentTime = 0;
    };
    const failed = (r) => { if (!ps) said = r.status === 429 || r.status === -1 ? "The MBTA asks us to wait a minute." : "No live times right now."; };
    const run = async (url) => { // the one ask, or each refresh's: `url()`, so a refresh asks for the Silver Line once the timetable has come
      if (!navigator.onLine) { if (!ps) said = "Live times need a connection."; pending = false; return draw(); } // W225 stationcard4: pending
      tapped = true; // W221 cardlive
      if (pending && !waitT) waitT = setTimeout(() => { pending = false; draw(); }, WAIT_MS); // W225 stationcard4: the timetable's times, marked, if the reply is slow
      const r = await ask(url());
      if (!live) return;
      asked = true; pending = false; clearTimeout(waitT); // W225 stationcard4: pending
      if (r.json) { ps = parsePredictions(r.json); liveAt = Date.now(); then = table?.rows || null; said = ""; } else failed(r); // W221 cardlive: liveAt, then
      reveal(); // W225 stationcard4
      draw();
    };
    /** W221 cardlive (SPEC §432): a turn of the card's one loop, every STATION_MS while it is open and the app in sight (none out of sight):
     *  the timetable read again once a row's first time has passed (rereadTable; one read at a time, a turn waiting at most 1.5 s for it),
     *  then drawn as it stands and the MBTA asked again by `url()` (none: Massport's alone; on Data Saver the tap's only), its reply drawn;
     *  offline, or an ask held or failed, the last reply drawn again; an ask still out at the next turn, drawn meanwhile. */
    const turn = async (url) => {
      if (!live) return;
      clearTimeout(turnT);
      turnT = setTimeout(() => turn(url), STATION_MS); // the next, whatever this one waits for
      if (document.visibilityState === "hidden") return;
      if (asking) return draw();
      asking = true;
      try {
        if (again && !reading && rereadTable(table?.rows, Date.now())) { // her rows taken when they come: no flicker, the same order
          reading = Promise.resolve(again()).then((x) => { if (live && x?.rows) { table = x; draw(); } }, () => {}).finally(() => { reading = null; });
          await Promise.race([reading, new Promise((r) => setTimeout(r, 1500))]);
          if (!live) return; // closed meanwhile: nothing more asked
        }
        draw(); // the minutes as they stand now, while it asks
        if (url && navigator.onLine && !(tapped && conn()?.saveData === true)) await run(url);
        else if (pending) { pending = false; draw(); } // W225 stationcard4: no ask, nothing on its way
      } finally { asking = false; }
    };
    const loop = (url) => { // W221 cardlive: a turn now, and back in sight a turn at once (as the comets' kick)
      if (!live) return;
      seen = () => { if (document.visibilityState === "visible") turn(url); };
      document.addEventListener("visibilitychange", seen);
      turn(url);
    };
    const go = (url) => { // the tap's ask, then the loop (W221 cardlive; was W173 uismall's one ask with Comets off, W29 comets' refresh with it on)
      if (!live) return;
      if (!navigator.onLine) { said = table?.rows?.length ? "" : "Live times need a connection."; asked = true; pending = false; } // W225 stationcard4: pending
      if (polls) open = peek; // Comets' own: its lines lit while it is open, the comets asked as for an open peek (pollDelay)
      loop(url);
    };
    const bare = () => Promise.resolve(api.stations?.()).then((tb) => { if (live && tb?.length) { ctt = tb; lines = stationLines(p, at0, tracks, undefined, ctt); draw(); } }, () => {}); // no walker's timetable: its lines from the comets' (W111 stationlines), for the strips when none is due
    if (!navigator.onLine && !station) said = "Live times need a connection."; // as its first line said (W225 stationcard4: drawn below)
    if (!shapes.has(place) && (tabled1 || api.tabled?.())) { held = true; card.classList.add("cst-hold"); holdT = setTimeout(reveal, HOLD_MS); } // W225 stationcard4 (SPEC §473): unseen until its timetable says its shape (a read in memory: a frame or two), HOLD_MS at most; drawn at once from its last shape; W226 cardfirst (§474): or read ahead, and in a ride too
    if (station) {
      lines = stationLines(p, at0, [], undefined, null); // its tile's own lines, until the tracks or the timetable say
      if (!p.line) Promise.resolve(api.tracks?.(at0, STATION_LINE_M)).then((ts) => { if (live && ts?.length) { tracks = ts; lines = stationLines(p, at0, tracks, undefined, ctt); draw(); } }, () => {});
      Promise.resolve(api.table?.()).catch(() => null).then(async (tb) => { // its GTFS station (station-lines-v1.json), then its timetable by that id
        st = gtfsStation(tb, p, at0);
        if (!live) return;
        if (st) again = () => api.stops?.(at0, p.name || "", p.ref || "", st.id); // W221 cardlive: read again by the same arguments
        if (st) table = await Promise.race([Promise.resolve(api.stops?.(at0, p.name || "", p.ref || "", st.id)).catch(() => null).then((x) => { tabled ||= !!x?.rows; tabled1 ||= !!x?.rows; return x; }), new Promise((r) => setTimeout(() => r(null), 1500))]); // the ask needn't wait long for it; W225 stationcard4: tabled
        if (!live) return;
        if (!table?.rows && st) Promise.resolve(api.stops?.(at0, p.name || "", p.ref || "", st.id)).then((x) => { tabled = true; if (live && x?.rows) { table = x; draw(); } else if (live) { bare(); draw(); } }, () => { tabled = true; bare(); draw(); }); // a first download's, when it comes; W225 stationcard4: tabled
        else { tabled = true; if (!table?.rows) bare(); } // W225 stationcard4: tabled
        reveal(); // W225 stationcard4
        draw();
        go(() => (st ? stationStopUrl(st.id, [...new Set((table?.rows || []).map((r) => r.route).filter((r) => !r.startsWith(MASSPORT) && own(r)))], key) : stationUrl(at0, key))); // W219 stationcard3: by its id, so the Silver Line's berths are in; else at its point (W33 peeks)
      });
    } else {
      again = () => api.stops?.(at0, p.name || "", p.ref || ""); // W221 cardlive: read again by the same arguments
      Promise.resolve(again()).then((r) => { // W189 transittimes: its times from the walker's timetable
        tabled1 ||= !!r?.rows; // W225 stationcard4
        if (!live) return;
        tabled = true; // W225 stationcard4
        if (!r?.rows) said = { saver: WALKW.saver, held: WALKW.held, offline: WALKW.offline, ended: WALKW.ended }[r?.reason] || WALKW.noStop; // Data Saver with no file: it says so
        else { table = r; if (!r.stops.length && !polls) said = WALKW.noStop; }
        if (!polls) { const mbta = (r?.stops || []).filter((id) => !id.startsWith(MASSPORT)); asked = !mbta.length || !navigator.onLine; loop(mbta.length ? () => stopUrl(mbta, key) : null); } // W221 cardlive: the loop, asking when online; W192 sltimes: the MBTA is asked only for its own stops; offline: the timetable's alone
        reveal(); // W225 stationcard4
        draw();
      }, () => { tabled = true; said = WALKW.offline; reveal(); draw(); }); // W225 stationcard4: tabled, reveal
      if (polls) go(() => nestUrl(at0, key)); // W33 peeks: with Comets on, a stop's sandworms by its point
    }
    draw(); // W225 stationcard4 (SPEC §473): its first frame, its shape as it knows it (was "Next trains…")
    return { ms: LIVE_MS, stay: !!button, dock: !!button, close: () => { live = false; clearTimeout(turnT); clearTimeout(waitT); clearTimeout(holdT); gl.stop(); document.removeEventListener("visibilitychange", seen); if (open === peek) open = null; track([]); } }; // W221 cardlive: turnT, seen
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
    tracks: null, // W111 stationlines: (lonlat, m) → the z15 tiles' `transit` features near it (main.js, the world's)
    stations: null, // W111 stationlines: () → the comets timetable's stations (app/transit.js stations()), or none
    stops: null, // W189 transittimes: (lonlat, name) → a bus stop's times by route (app/walk.js stops()), or none
    tabled: null, // W226 cardfirst (SPEC §474): () → the walker's timetable is in memory (app/walk.js tabled: read ahead), so a card's first open holds for its rows
    table: null, // W211 stationcard2: () → chart/transit/station-lines-v1.json's stations (main.js), a station card's GTFS station, or none
    sink: null, // W70 deep: (comet) → its drop below the ground in 3D, mercator units (app/deep.js), or none
    get on() { return on; }, get fps() { return fps; }, get count() { return shown ? comets.size : 0; },
    get calm() { return calm; }, set calm(v) { calm = !!v; },
    theme(t) { theme = t; rim = hex(rimColour(t === "light")); for (const c of comets.values()) { paint(c); c.drawnX = NaN; } if (tracked.routes.length) track(tracked.routes, tracked.dir); map.triggerRepaint(); }, // W33 peeks: the line too; W196 comets3: the rim
    /** For tests: each comet's id, route and head [lon, lat] as drawn. */
    list: () => [...comets.values()].map((c) => (c.late && place(c, tickT, lenT), { id: c.id, route: c.route, lonlat: [lonOf(c.hx), latOf(c.hy)], drawn: [lonOf(c.hx + c.ox), latOf(c.hy + c.oy)], line: !!c.g?.line, z: c.z || 0 })), // W88 settings3: no fade; W70 deep: z, its height as drawn (mercator units); W144 tlines: lonlat on its line, drawn aside; W205 frames: one out of view at its place at the last frame, as before
    host: MBTA,
  };
  return api;
}
