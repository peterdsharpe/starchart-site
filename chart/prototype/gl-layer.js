// One custom WebGL 2 layer for everything on the chart that moves (brief §8, rule 1):
// pulsars beat, black holes turn their accretion disks, and particles flow along wormholes.
// Every animated thing is one instance of one quad, drawn in a single instanced draw call with a
// time uniform. The CPU rebuilds the instance buffer only when the view changes (new tiles, a new
// zoom level); between rebuilds the GPU does all the motion.

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;   // CSS px
uniform float u_world;     // world size in px at this zoom
uniform float u_time;
uniform float u_mpp;       // metres per px at the map centre
uniform float u_flow;      // wormhole particles, CSS px per s (tokens: motion.wormhole_flow_px_per_s)
in vec2 a_corner;          // -1..1
in vec2 a_pos;             // mercator 0..1 (particles: segment start)
in vec2 a_end;             // particles: segment end
in vec4 a_info;            // kind (0 pulsar, 1 black hole, 2 particle), size, phase, extra (black hole: radius m; particle: comfort 0..1)
in vec2 a_z;               // W19 terrain: the ground's height at a_pos and a_end, mercator units (0 when flat)
uniform float u_exag;      // W20 terrain3d: a_z is the height unexaggerated; this is the exaggeration now (0 when flat)
uniform vec3 u_cam;        // W20 terrain3d: the camera, mercator units from the origin
uniform float u_pull;      // W20 terrain3d: how far to pull the depth toward the camera, per px of size and per
                           // mercator unit from the camera (0: not at all)
out vec2 v_uv;
out float v_kind;
out float v_phase;
out float v_fade;
void main() {
  float kind = a_info.x;
  vec2 p = a_pos;
  float z = a_z.x;
  float size = a_info.y;
  v_fade = 1.0;
  if (kind > 1.5) {
    // a particle: u_flow px/s along its segment, a fresh one every spacing
    // W23 comfort: on a rougher piece (a_info.w, 1 at the top or without the tiles' comfort) the dots are dimmer,
    // smaller and a little slower, by bigger steps near the top, as the style's lines; as many of them, so the
    // frame costs the same
    float comfy = a_info.w, k = comfy * comfy;
    float lenPx = max(1.0, length(a_end - a_pos) * u_world);
    float t = fract(a_info.z + u_time * u_flow * mix(0.7, 1.0, comfy) / lenPx);
    p = mix(a_pos, a_end, t);
    z = mix(a_z.x, a_z.y, t);
    size *= mix(0.65, 1.0, k);
    v_fade = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.88, t) * mix(0.4, 1.0, k);
  } else if (kind > 0.5) {
    size = max(a_info.y, a_info.w / u_mpp * 1.9); // the disk wraps the rotary itself
  }
  vec3 at = vec3(p, z * u_exag);
  vec4 c = u_matrix * vec4(at, 1.0);
  if (u_pull > 0.0) {
    // W20 terrain3d: hidden behind hills by the terrain's depth. The quad stands up to the viewer while the
    // ground under it lies back, so its depth is the centre's pulled toward the camera by the quad's reach
    // on the ground; x and y stay the centre's, so nothing moves on the screen.
    vec3 d = u_cam - at;
    vec4 cz = u_matrix * vec4(at + d * min(0.5, size * u_pull), 1.0);
    c.z = cz.z / cz.w * c.w;
  }
  c.xy += a_corner * size * 2.0 / u_viewport * c.w;
  gl_Position = c;
  v_uv = a_corner;
  v_kind = kind;
  v_phase = a_info.z;
}`;

const FS = `#version 300 es
precision highp float;
uniform float u_time;
uniform float u_pulsar_s;  // tokens: motion.pulsar_period_s
uniform float u_hole_s;    // tokens: motion.black_hole_period_s
uniform vec3 u_pulsar;
uniform vec3 u_hole;
uniform vec3 u_star;
uniform vec3 u_worm;
in vec2 v_uv;
in float v_kind;
in float v_phase;
in float v_fade;
out vec4 o;
void main() {
  float r = length(v_uv);
  if (r > 1.0) discard;
  if (v_kind < 0.5) {
    // pulsar: an expanding gold ring once a period, each light on its own beat
    float ph = fract(u_time / u_pulsar_s + v_phase);
    float ring = smoothstep(0.16, 0.0, abs(r - (0.18 + 0.82 * ph)));
    float a = ring * 0.6 * pow(1.0 - ph, 1.5);
    o = vec4(u_pulsar * a, a);
  } else if (v_kind < 1.5) {
    // black hole: a violet accretion disk with two spiral arms, and a thin bright photon ring on
    // the rotary itself
    float ang = atan(v_uv.y, v_uv.x);
    float spin = u_time * 6.2831853 / u_hole_s + v_phase * 6.2831853;
    // Counterclockwise, the way traffic goes round a rotary in the US, and drawn in like a drain.
    // The arms trail, as a galaxy's do when it turns counterclockwise: going outward they curve
    // clockwise. They hold still, and bright knots flow in along them, so each knot swirls
    // counterclockwise into the hole, one turn a period. (A rigid pattern can't do both: arms that
    // turn counterclockwise and move inward must lead, which reads as turning clockwise.)
    float arm = 2.0 * ang + 7.0 * r;                       // constant along an arm
    float knots = 0.5 + 0.5 * sin(14.0 * r + spin * 4.0);  // rings that shrink as time goes on
    float arms = pow(0.5 + 0.5 * sin(arm), 3.0) * (0.55 + 0.45 * knots);
    float disk = smoothstep(0.36, 0.5, r) * smoothstep(1.0, 0.68, r);
    float ring = exp(-pow((r - 0.5) / 0.045, 2.0));
    vec3 col = mix(u_hole, u_star, clamp(ring * 0.7 + arms * 0.35 * smoothstep(0.85, 0.5, r), 0.0, 1.0));
    float a = disk * (0.1 + 0.8 * arms) + ring * 0.45; // 0.8: the knots dim the arms by a quarter on average
    o = vec4(col * a, a);
  } else {
    // wormhole particle: a soft bright dot
    float a = smoothstep(1.0, 0.15, r) * 0.85 * v_fade;
    vec3 col = mix(u_worm, u_star, smoothstep(0.6, 0.0, r));
    o = vec4(col * a, a);
  }
}`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const W = 2 ** 26; // a grid of about a metre on the mercator square, for the de-duplication keys
const key = (x, y) => Math.round(x * W) * W + Math.round(y * W); // exact in a double
const hash = (x, y) => {
  const h = Math.sin(x * 12.9898e3 + y * 78.233e3) * 43758.5453;
  return h - Math.floor(h);
};

/** W23 comfort: a wormhole piece's comfort from the tiles (0-7, chart/SCHEMA.md) as 0..1; 1 where the tiles have none. */
export const comfortOf = (props) => (Number.isFinite(props?.comfort) ? Math.max(0, Math.min(7, props.comfort)) / 7 : 1);

// The animation's constants: design/tokens.json "motion". Pass TOK.motion to take them from there.
export const MOTION = { pulsar_period_s: 1.6, black_hole_period_s: 6, wormhole_flow_px_per_s: 28 };
export const MAX_PARTICLES = 6000;
const ATTRS = ["a_corner", "a_pos", "a_end", "a_info", "a_z"]; // bound to locations 0..4 before the link
const STRIDE = 10; // floats per instance: a_pos, a_end, a_info, a_z
const CIRCUMFERENCE = 40075016.686; // metres; a height h at latitude φ is h / (C cos φ) in mercator units
const UNIFORMS = ["u_matrix", "u_viewport", "u_world", "u_time", "u_mpp", "u_flow", "u_pulsar_s", "u_hole_s",
  "u_pulsar", "u_hole", "u_star", "u_worm", "u_exag", "u_cam", "u_pull"];
/**
 * W20 terrain3d: how far to pull a sprite's depth toward the camera, in px of the sprite's size, at a pitch:
 * the ground below a quad's centre on the screen is nearer by up to size × tan(pitch), and a little more
 * covers the terrain mesh's error.
 */
export const pullAt = (pitch) => Math.tan((Math.min(pitch, 75) * Math.PI) / 180) + 0.6;

/**
 * W20 terrain3d: the camera in mercator units, [x, y, z], and its distance to the centre, from the map's public
 * view: the camera stands cameraToCenterDistance (half the canvas over tan(fov / 2), in px) from the centre,
 * which is at the centre's height, back along the bearing and up by the pitch.
 */
export function cameraOf(map) {
  const c = map.getCenter(), rad = Math.PI / 180, world = 512 * 2 ** map.getZoom();
  const d = (0.5 * map.getCanvas().clientHeight) / Math.tan((map.getVerticalFieldOfView() * rad) / 2) / world;
  const p = map.getPitch() * rad, b = map.getBearing() * rad;
  const z = map.getCenterElevation() / (CIRCUMFERENCE * Math.cos(c.lat * rad));
  return { x: mercX(c.lng) - Math.sin(b) * Math.sin(p) * d, y: mercY(c.lat) + Math.cos(b) * Math.sin(p) * d, z: z + Math.cos(p) * d, toCentre: d };
}

/**
 * W39 ship: add a custom layer to the map, and add it again after each lost and restored WebGL context, between the same
 * neighbours. MapLibre restores the style without its custom layers (it only warns), so a layer added any other way stays
 * gone: in 0.1.10 the ship did, while the location button's ping still showed where it should be. The order is read as
 * the context goes, and the layers come back from the top down, so each finds the one above it. Returns the map's
 * record: { lost, restored }, the counts of each, for About › Developer.
 */
const KEPT = new WeakMap();
export function keepLayer(map, layer, before) {
  let k = KEPT.get(map);
  if (!k) {
    KEPT.set(map, (k = { layers: new Map(), order: [], lost: 0, restored: 0 }));
    // MapLibre drops the style before its own webglcontextlost event: read the order as the canvas's event passes its box
    map.getCanvasContainer().addEventListener("webglcontextlost", () => { k.order = map.getLayersOrder(); k.lost++; }, true);
    map.on("webglcontextrestored", () => {
      const order = k.order, add = () => {
        for (let i = order.length - 1; i >= 0; i--) {
          const l = k.layers.get(order[i]);
          if (l && !map.getLayer(l.id)) map.addLayer(l, order.slice(i + 1).find((id) => map.getLayer(id)));
        }
        k.restored++;
      };
      if (map.style?.loaded()) add(); else map.once("style.load", add);
    });
  }
  k.layers.set(layer.id, layer); // a layer removed on purpose is not in the order, so it stays removed
  map.addLayer(layer, before && map.getLayer(before) ? before : undefined);
  return k;
}

export class ChartMotion {
  /** colors: {pulsar, hole, star, worm} hex strings from the tokens; motion: the tokens' motion values. */
  constructor(colors, { calm = false, off = false, motion = {} } = {}) { // W65 plainlook: off
    this.id = "chart-motion";
    this.type = "custom";
    this.renderingMode = "2d";
    this.colors = colors;
    this.rgb = {};
    for (const k of ["pulsar", "hole", "star", "worm"]) this.rgb[k] = new Float32Array(hex(colors[k]));
    this.motion = { ...MOTION, ...motion };
    this.calm = calm;
    this.off = off; // W65 plainlook: nothing gathered or drawn (Plain: an ordinary map has no pulse, swirl or flow)
    this.count = 0;
    this.time = 0;
    this.stats = { pulsars: 0, holes: 0, particles: 0, rebuilds: 0, rebuildMs: 0 };
    this.data = new Float32Array(0);
    this.buf = new Float32Array(STRIDE * 1024); // grows; reused between rebuilds
    this.matrix = new Float32Array(16);
    this.origin = [0, 0];
    this.rebuild = this.rebuild.bind(this);
    this.schedule = () => { // coalesce view changes into one rebuild
      if (this.pending) return;
      this.pending = setTimeout(() => { this.pending = 0; this.rebuild(); }, 250);
    };
    // While the camera follows the ship it moves every frame: rebuild only once the view has
    // travelled a fifth of the screen, or zoomed, since the instances cover 60 % beyond the view.
    this.moved = () => { // cheap: plain mercator arithmetic, no projection call
      if (!this.at) return this.schedule();
      const map = this.map, c = map.getCenter(), z = map.getZoom(), world = 512 * 2 ** z;
      const d = Math.hypot(mercX(c.lng) - this.origin[0], mercY(c.lat) - this.origin[1]) * world;
      if (Math.abs(z - this.at.zoom) > 0.25 || d > 0.2 * Math.min(innerWidth, innerHeight)) this.schedule();
    };
    // W19 terrain: the 3D terrain's tiles give the sprites their heights, so a rebuild follows them too
    // W20 terrain3d: with 3D terrain on, MapLibre draws this layer in the terrain's depth range, so the
    // sprites can be tested against the hills
    this.onTerrain = () => { this.renderingMode = this.map.getTerrain() ? "3d" : "2d"; this.schedule(); };
    this.onData = (e) => { if ((e.sourceId === "chart" || e.sourceId === this.map.getTerrain()?.source) && e.isSourceLoaded) this.schedule(); };
    // A lost WebGL context takes the style with it; keepLayer() adds this one again, with new GL objects (prototype-4).
    this.lost = () => { clearTimeout(this.pending); this.pending = 0; this.ready = false; };
  }

  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;
    this.ready = false;
    // Compile and link without asking for the status, which would wait for the compiler here.
    // render() asks once the link is done (KHR_parallel_shader_compile tells when), so the
    // compile overlaps the first frames (motion-10).
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = (this.prog = gl.createProgram());
    this.shaders = [sh(gl.VERTEX_SHADER, VS), sh(gl.FRAGMENT_SHADER, FS)];
    for (const s of this.shaders) gl.attachShader(p, s);
    ATTRS.forEach((n, i) => gl.bindAttribLocation(p, i, n));
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
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW); // after a context loss, the last instances again
    const stride = STRIDE * 4;
    for (const [loc, size, off] of [[1, 2, 0], [2, 2, 8], [3, 4, 16], [4, 2, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.renderingMode = map.getTerrain() ? "3d" : "2d"; // W20 terrain3d
    for (const [ev, f] of [["moveend", this.moved], ["sourcedata", this.onData], ["terrain", this.onTerrain], ["webglcontextlost", this.lost]]) {
      map.off(ev, f); // a restored context adds the layer again: one listener each
      map.on(ev, f);
    }
    this.schedule();
  }

  onRemove(map, gl) {
    clearTimeout(this.pending);
    this.pending = 0;
    map.off("moveend", this.moved);
    map.off("sourcedata", this.onData);
    map.off("terrain", this.onTerrain);
    if (!gl.isContextLost()) map.off("webglcontextlost", this.lost); // removed on purpose, not by a lost context
    for (const s of this.shaders) gl.deleteShader(s);
    gl.deleteProgram(this.prog);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.inst);
    gl.deleteVertexArray(this.vao);
  }

  /** Is the program linked? Asks the driver only once it has finished, and then never again. */
  linked() {
    if (this.ready) return true;
    const gl = this.gl, p = this.prog;
    if (this.broken || gl.isContextLost()) return false;
    if (this.parallel && !gl.getProgramParameter(p, this.parallel.COMPLETION_STATUS_KHR)) {
      this.map.triggerRepaint();
      return false;
    }
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.broken = true;
      console.error("chart-motion:", [gl.getProgramInfoLog(p), ...this.shaders.map((s) => gl.getShaderInfoLog(s))].filter(Boolean).join("\n"));
      return false;
    }
    this.u = {};
    for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(p, n);
    return (this.ready = true);
  }

  /** Gather what is animated near the view, on the CPU, and upload one instance buffer. */
  rebuild() {
    const map = this.map;
    if (!map || !map.getSource("chart")) return;
    const t0 = performance.now();
    const z = map.getZoom();
    const cen = map.getCenter();
    const ox = mercX(cen.lng), oy = mercY(cen.lat);
    let n = 0;
    // W19 terrain: with 3D terrain on, each sprite stands on the ground (its height looked up once, here).
    // W20 terrain3d: stored unexaggerated, as the exaggeration grows with the pitch (app/terrain.js).
    const exag = map.getTerrain()?.exaggeration || 0;
    const ground = exag ? (c) => (map.queryTerrainElevation(c) || 0) / exag / (CIRCUMFERENCE * Math.cos((c[1] * Math.PI) / 180)) : () => 0;
    let za = 0, ze = 0;
    const push = (x, y, ex, ey, kind, size, phase, extra) => {
      if (n + STRIDE > this.buf.length) { const b = new Float32Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
      const o = this.buf;
      o[n] = x - ox; o[n + 1] = y - oy; o[n + 2] = ex - ox; o[n + 3] = ey - oy;
      o[n + 4] = kind; o[n + 5] = size; o[n + 6] = phase; o[n + 7] = extra;
      o[n + 8] = za; o[n + 9] = ze;
      n += STRIDE;
    };
    const b = map.getBounds();
    const pad = 0.6;
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), nn = b.getNorth();
    const dx = (e - w) * pad, dy = (nn - s) * pad;
    const inView = (c) => c[0] > w - dx && c[0] < e + dx && c[1] > s - dy && c[1] < nn + dy;
    let pulsars = 0, holes = 0, particles = 0;
    // Pulsars and black holes in one pass over the points: each query decodes every feature of its layer.
    const pl = map.getLayer("pulsar"), wantPulsars = pl && z >= (pl.minzoom ?? 15); // W21 lingo: from the style, z16
    const hole = ["all", ["==", ["get", "kind"], "black_hole"], ["!=", ["get", "class"], "mini_roundabout"]];
    const bl = map.getLayer("black-hole"), wantHoles = !bl || z >= (bl.minzoom ?? 12); // W51 ladder: from the style, z14
    if (!this.off && z >= 12 && (wantHoles || wantPulsars)) { // W65 plainlook: !this.off
      const seen = new Set();
      const filter = wantPulsars && wantHoles ? ["any", ["==", ["get", "kind"], "pulsar"], hole] : wantPulsars ? ["==", ["get", "kind"], "pulsar"] : hole;
      for (const f of map.querySourceFeatures("chart", { sourceLayer: "pois", filter })) {
        const c = f.geometry.coordinates;
        if (!inView(c)) continue;
        const x = mercX(c[0]), y = mercY(c[1]), k = key(x, y);
        if (seen.has(k)) continue; // tile buffers repeat features
        seen.add(k);
        za = ze = ground(c);
        if (f.properties.kind === "pulsar") {
          push(x, y, x, y, 0, 26 * Math.min(1.6, 1.15 ** (z - 16)), hash(x, y), 0);
          pulsars++;
        } else {
          push(x, y, x, y, 1, 16 * 1.3 ** Math.min(4, z - 13), hash(x, y), f.properties.radius_m || 12);
          holes++;
        }
      }
    }
    if (!this.off && z >= 13.5 && map.getLayer("wormhole") && map.getLayoutProperty("wormhole", "visibility") !== "none") { // W65 plainlook: !this.off; W88 paths: none with the Bike lanes layer off (app/layers.js)
      const world = 512 * 2 ** z;
      const spacing = 30; // px between particles
      const size = 3.4 * Math.min(1.5, 1.12 ** (z - 15));
      const ends = new Map(), more = new Set(); // segments seen: start key -> end key, and the rare second ends
      const fresh = (ka, kc) => {
        const k = ends.get(ka);
        if (k === undefined) { ends.set(ka, kc); return true; }
        if (k === kc) return false;
        const k2 = ka + ":" + kc;
        if (more.has(k2)) return false;
        more.add(k2);
        return true;
      };
      const tracksOff = map.getLayer("cycle-track") && map.getLayoutProperty("cycle-track", "visibility") === "none"; // W88 mapfix: hidden with the bike lanes (app/layers.js), so no flow on them
      roads: for (const f of map.querySourceFeatures("chart", { sourceLayer: "roads", filter: tracksOff ? map.getFilter("wormhole") : ["all", ["==", ["get", "bike"], "wormhole"], ["!", ["has", "tunnel"]]] })) { // W88 mapfix: tracksOff
        const g = f.geometry;
        const comfy = comfortOf(f.properties); // W23 comfort
        const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        for (const l of lines) {
          for (let i = 0; i < l.length - 1; i++) {
            const a = l[i], c = l[i + 1];
            if (!inView(a) && !inView(c)) continue;
            const ax = mercX(a[0]), ay = mercY(a[1]), cx = mercX(c[0]), cy = mercY(c[1]);
            if (!fresh(key(ax, ay), key(cx, cy))) continue; // tile buffers repeat segments
            const px = Math.hypot(cx - ax, cy - ay) * world;
            if (px < 4) continue;
            const k = Math.max(1, Math.round(px / spacing));
            if (particles + k > MAX_PARTICLES) break roads; // prototype-13: the cap holds for the whole rebuild
            za = ground(a); ze = ground(c);
            for (let j = 0; j < k; j++) push(ax, ay, cx, cy, 2, size, j / k, comfy);
            particles += k;
          }
        }
      }
    }
    this.data = this.buf.subarray(0, n);
    this.origin = [ox, oy];
    this.at = { center: cen, zoom: z };
    this.count = n / STRIDE;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
    Object.assign(this.stats, { pulsars, holes, particles, rebuilds: this.stats.rebuilds + 1, rebuildMs: +(performance.now() - t0).toFixed(1) });
    map.triggerRepaint();
  }

  render(gl, args) {
    if (!this.count || !this.linked()) return;
    const map = this.map;
    // Positions are stored relative to the rebuild's origin, so float32 keeps them exact at zoom 18;
    // the matrix is moved to that origin here, in float64.
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
    const M = this.matrix, ox = this.origin[0], oy = this.origin[1];
    for (let i = 0; i < 12; i++) M[i] = m[i];
    for (let i = 0; i < 4; i++) M[12 + i] = m[i] * ox + m[4 + i] * oy + m[12 + i];
    const matrix = M;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const lat = map.getCenter().lat;
    const world = 512 * 2 ** map.getZoom();
    const ratio = map.getPixelRatio(); // the map's, which Battery saver caps below devicePixelRatio (motion-3, W50 crisp)
    gl.uniformMatrix4fv(this.u.u_matrix, false, matrix);
    gl.uniform2f(this.u.u_viewport, gl.drawingBufferWidth / ratio, gl.drawingBufferHeight / ratio);
    gl.uniform1f(this.u.u_world, world);
    gl.uniform1f(this.u.u_time, this.calm ? 0.4 : this.time);
    gl.uniform1f(this.u.u_mpp, (40075016.686 * Math.cos((lat * Math.PI) / 180)) / world);
    gl.uniform1f(this.u.u_flow, this.motion.wormhole_flow_px_per_s);
    gl.uniform1f(this.u.u_pulsar_s, this.motion.pulsar_period_s);
    gl.uniform1f(this.u.u_hole_s, this.motion.black_hole_period_s);
    for (const k in this.rgb) gl.uniform3fv(this.u["u_" + k], this.rgb[k]);
    // W20 terrain3d: behind the hills, by the terrain's depth (MapLibre gives a "3d" layer its depth range);
    // the depth is read, never written
    const terrain = map.getTerrain(), deep = !!terrain && this.renderingMode === "3d";
    gl.uniform1f(this.u.u_exag, terrain?.exaggeration || 0);
    if (deep) {
      // a px at the camera's distance from the centre is 1 / world mercator units, and grows with the distance
      const cam = cameraOf(map);
      gl.uniform3f(this.u.u_cam, cam.x - ox, cam.y - oy, cam.z);
      gl.uniform1f(this.u.u_pull, pullAt(map.getPitch()) / (world * cam.toCentre));
    } else gl.uniform1f(this.u.u_pull, 0);
    if (deep) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); } else gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }
}
