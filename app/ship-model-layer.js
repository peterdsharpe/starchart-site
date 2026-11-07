// W21 ship: the meshed ship (app/ship-model.js) on the chart, as a MapLibre custom layer with the same fields as
// app/ship3d.js's Ship3D, so the app can swap one for the other: .lngLat, .heading, .size, .ring, .spread, .beam,
// .on, steer(), setYou(), getBoundingClientRect(), .roll, .lifted, .drawn, .drawMs. It reuses Ship3D's matrix, its
// lean and its depth pull behind hills (W20 terrain3d); the rest is new:
//
//   prerender: the mesh into a small multisampled target the size of the ship's box on the screen, with its own
//              depth buffer (app/ship-model-gl.js: the ink outline, the body, the glows)
//   render:    1. the ground: the heading beam, the accuracy ring, the hover glow and a soft shadow
//              2. the ship: the target, laid on the chart as one premultiplied quad, pixel for pixel
//
// The old ship's pale fringe came from its ground pass: it kept (1 - solid) of the sprite's colour round the
// silhouette, where the linearly filtered solid mask is between 0 and 1, so half of the white frame, suit and
// helmet edge stayed on the chart while the hull stood up and away from it; and each slice's hard discard at
// 0.5 left ragged, unsmoothed edges. Here nothing of the ship is drawn on the ground, and the edges come out of
// the multisampled resolve already blended, with their coverage in alpha.
//
// .motion is the ShipMotion (Launch, Land, the toggles, .still for Calm); .speed (m/s) drives the wheels, the
// comets and the thruster. .moving is true while anything animates, for the frame governor. The clock is
// .clock(), in seconds (performance.now by default; the mock-up's shots fix it).
import { lift, Ship3D } from "./ship3d.js";
import { buildShip, hex, ShipMotion } from "./ship-model.js";
import { LOOKS, Offscreen, program, ShipMeshGL } from "./ship-model-gl.js";

/** W80 marker2d: on a flat chart every marker (the ship, the bike and both people on foot) is shown as from this pitch (degrees),
 *  one view for all; a chart tilted further shows it as it is. W79 walker stood only the walker up, at 45°. */
export const STAND_DEG = 25;

const DEPTH = `vec4 pulled(vec4 c, vec4 cz) { return vec4(c.xy, cz.z / cz.w * c.w, c.w); }`;
const VS_GROUND = `#version 300 es
uniform mat4 u_m; uniform float u_half; uniform vec3 u_pull;
layout(location = 0) in vec2 a_pos; out vec2 v_px;
${DEPTH}
void main() { v_px = a_pos * u_half; gl_Position = pulled(u_m * vec4(v_px, 0.0, 1.0), u_m * vec4(vec3(v_px, 0.0) + u_pull, 1.0)); }`;
const FS_GROUND = `#version 300 es
precision highp float;
uniform float u_size, u_ring, u_spread, u_beam, u_hz, u_glow, u_tail; uniform vec3 u_you, u_worm, u_rear; uniform vec2 u_shadow; // W91 avatar2: u_tail, u_rear
in vec2 v_px; out vec4 o;
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
void main() {
  float r = length(v_px);
  // the heading beam and the accuracy ring (SPEC §7)
  float ang = degrees(atan(v_px.x, v_px.y));
  float fan = step(abs(ang), u_spread * 0.5);
  float fade = r < 33.1 ? 1.0 : r < 57.4 ? mix(1.0, 0.5, (r - 33.1) / 24.3) : r < 78.0 ? mix(0.5, 0.0, (r - 57.4) / 20.6) : 0.0;
  vec4 c = vec4(u_you, 1.0) * 0.62 * fan * fade * u_beam;
  // W91 avatar2: Plain's bike, a small red glow behind it from the rear light, steady, drawn as the beam is
  float rs = r / u_size, tail = smoothstep(18.0, 13.0, 180.0 - abs(ang)) * smoothstep(0.2, 0.27, rs) * (1.0 - smoothstep(0.3, 0.68, rs));
  c = over(vec4(u_rear, 1.0) * 0.55 * tail * u_tail, c);
  float edge = 1.0 - smoothstep(0.0, 1.0, abs(r - u_ring) - 0.75);
  float fill = 1.0 - smoothstep(u_ring - 0.5, u_ring + 0.5, r);
  c = over(vec4(u_you, 1.0) * max(0.16 * fill, 0.6 * edge), c);
  // the hover glow, in --wormhole as on the sprite, brighter in flight
  vec2 q = v_px / u_size - vec2(0.0, 0.06);
  float g = pow(max(0.0, 1.0 - length(q / vec2(0.34, 0.5))), 1.6) * 0.45 * u_glow;
  c = over(vec4(u_worm, 1.0) * g, c);
  // the shadow: the ship's footprint, softer and fainter the higher it hovers
  vec2 s = (v_px - u_shadow) / u_size - vec2(0.0, 0.08);
  float d = length(s / vec2(0.16, 0.34));
  float a = (1.0 - smoothstep(0.35, 1.0 + u_hz * 2.5, d)) * 0.62 * (1.0 - min(0.6, u_hz * 2.2));
  o = over(vec4(0.0, 0.0, 0.0, a), c);
}`;
const VS_QUAD = `#version 300 es
uniform vec4 u_box; uniform vec2 u_uv; uniform float u_z;
layout(location = 0) in vec2 a_pos; out vec2 v_uv;
void main() { vec2 t = a_pos * 0.5 + 0.5; v_uv = t * u_uv; gl_Position = vec4(mix(u_box.xy, u_box.zw, t), u_z, 1.0); }`;
const FS_QUAD = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform float u_alpha; in vec2 v_uv; out vec4 o;
void main() { o = texture(u_tex, v_uv) * u_alpha; }`; // premultiplied, so scaling all four dims the ship evenly

/**
 * The mesh's scale on the ship's size: the sprite's art, widened for the marker, fills more of its square than
 * the real proportions do, so the mesh is drawn a little bigger to read as large at a glance.
 */
export const FILL = 1.12;
const NOWHERE = Object.freeze({ x: -1e4, y: -1e4, width: 0, height: 0, left: -1e4, top: -1e4, right: -1e4, bottom: -1e4 });

export class ShipModel3D extends Ship3D {
  /**
   * color: the tokens' colour table (design/tokens.json "color"); build: "standard" | "chibi"; look: "toon" |
   * "soft"; size: the ship's size in CSS px, as Ship3D's; avatar: the pilot's colour, a hex, or none (W86 avatar).
   */
  constructor({ color, build = "standard", look = "toon", size = 68, you, avatar = null }) {
    super({ size, you: you || color.you });
    Object.assign(this, { id: "ship-model", color, build, avatar, look: LOOKS[look] || LOOKS.toon, ink: new Float32Array(hex(color.void)), worm: hex(color.wormhole), rear: hex(color.negi), tail: 0 }); // W91 avatar2: rear, tail
    this.motion = new ShipMotion(); this.speed = 0; this.moving = false; this.alpha = 1;
    this.meshes = new Map(); this.Q = new Float32Array(9); this.T = new Float32Array(12); // W79 walker: each build and body's mesh, built once; standUp's
    this.away = false; // W39 ship: true over a flight's page (app/main.js), which shows that flight, not you
    this.clock = () => performance.now() / 1000;
    this.C = new Float32Array(16); this.eye = new Float32Array(3); this.rim = new Float32Array(3);
    this.pullG = new Float32Array(3); this.box = new Float32Array(4); this.px = [0, 0, 0, 0]; this.uv = [0, 0]; this.z = 0; this.shown = false;
    this.xs = new Float64Array(2); this.ys = new Float64Array(2); this.zs = new Float64Array(2); // nothing allocates per frame
    this.lamps = true; // W112 avatars2: lit on a dark map only (setLamps)
    this.opts = { size, light: this.lightR, eye: this.eye, rim: this.rim, ink: this.ink, look: this.look, lamps: true };
  }

  /** W112 avatars2: her note (2026-10-24), "The lights on the avatars should only display during Dark mode": the lamps lit, their
   *  halos, the rear glow and the glow beneath, on a dark map (true); out on a light one, each lamp then a lens. */
  setLamps(on) { on = !!on; if (on !== this.lamps) { this.lamps = this.opts.lamps = on; if (this.mesh) this.upload(); this.map?.triggerRepaint(); } } // W150 avatars4: and the mesh, its front lamp and the arrow's outline by theme

  /** W21 shipin: "launch", "land", "undo" or "wake" (a touch), on the layer's clock, with a frame to show it. */
  cue(what) {
    this.motion[what](this.clock()); this.moving = this.on && !this.motion.still;
    if (this.moving || (this.on && what !== "wake")) this.map?.triggerRepaint(); // still or not shown, a touch changes nothing
  }

  /** W21 flight F2: the ship dims while GPS is lost, so the pilot sees at a glance that it isn't where they are. */
  dim(on) { const a = on ? 0.45 : 1; if (a !== this.alpha) { this.alpha = a; this.map?.triggerRepaint(); } }

  setLook(look) { this.look = LOOKS[look] || LOOKS.toon; this.map?.triggerRepaint(); }
  setBuild(build) { this.build = build; if (this.mesh) { this.upload(); this.map.triggerRepaint(); } }
  /** W86 avatar: the pilot's colour (a hex, or null for the paints), live. W124 avatars3: each type and colour's mesh built once and kept. */
  setAvatar(avatar, build = this.build) { // W109 notes: and the build with it, so a new tint and build together make one mesh, not one for the old build first
    if (avatar === this.avatar && build === this.build) return;
    this.avatar = avatar; this.build = build; if (this.mesh) { this.upload(); this.map.triggerRepaint(); } // W124 avatars3: no clear: the meshes are kept by build, colour and body
  }
  /** W63 rider: the build's mesh into the buffers, and its motion: a rider rolls on its wheels, the ship hovers. W79 walker: the
   *  body the motion shows (on foot or on the bike), each mesh built once and kept, so a swap mid-hop costs no frame. */
  upload() {
    const s = this.motion, key = `${this.build}/${this.avatar}/${s.body}/${this.lamps}`; // W79 walker; W124 avatars3: and the colour; W150 avatars4: and the theme
    let mesh = this.meshes.get(key); // W79 walker
    if (!mesh) this.meshes.set(key, (mesh = buildShip(this.color, { build: this.build, gait: s.body, avatar: this.avatar, dark: this.lamps }))); // W79 walker; W86 avatar; W150 avatars4: dark
    this.mesh.upload(mesh); s.rolls = !!mesh.rolls; s.walks = !!mesh.walks; s.glides = !!mesh.glides; // W79 walker: walks; W101 avatars: glides, the arrow
    this.tail = s.rolls && !s.walks && !s.glides ? 1 : 0; // W91 avatar2: the rear light's glow, for a bike on its wheels (Plain's), not on foot; W101 avatars: nor the arrow
  }
  /** W79 walker: on foot ("walk") or on the bike ("ride"). Shown, the person hops off or back on (GAIT_S, a fade in Calm),
   *  asking for frames only while it plays; not shown, the build just changes. walkgo calls it at a walk's Launch and Land. */
  setGait(gait) {
    const s = this.motion;
    if ((gait !== "walk" && gait !== "ride") || gait === s.gait) return;
    if (this.mesh && this.on && !this.away && this.shown) { s.setGait(gait, this.clock()); this.moving = true; this.map?.triggerRepaint(); return; }
    s.gait = s.body = gait; s.gaitAt = -1e9;
    if (this.mesh) { this.upload(); this.map?.triggerRepaint(); }
  }
  /**
   * W79 walker: from straight above, a person standing is only a helmet. So on a flat chart the marker (W80 marker2d: every one) is turned up toward
   * the eye, about the screen's horizontal axis through its feet, as a tilted chart would show it: FR = FR Q, with the eye
   * and the light taken into the turned frame. phi: the chart's bearing less the body's heading; a: the angle (radians).
   */
  standUp(FR, phi, a) {
    const x = Math.cos(phi), y = -Math.sin(phi), c = Math.cos(a), n = Math.sin(a), k = 1 - c, Q = this.Q, T = this.T;
    Q[0] = c + k * x * x; Q[1] = k * x * y; Q[2] = -n * y; // Q's columns: the turned x, y and z axes (Rodrigues, about (x, y, 0))
    Q[3] = k * x * y; Q[4] = c + k * y * y; Q[5] = n * x;
    Q[6] = n * y; Q[7] = -n * x; Q[8] = c;
    for (let col = 0; col < 3; col++) for (let r = 0; r < 4; r++) T[col * 4 + r] = FR[r] * Q[col * 3] + FR[4 + r] * Q[col * 3 + 1] + FR[8 + r] * Q[col * 3 + 2];
    FR.set(T);
    for (const v of [this.eye, this.lightR]) { const v0 = v[0], v1 = v[1], v2 = v[2]; for (let i = 0; i < 3; i++) v[i] = Q[i * 3] * v0 + Q[i * 3 + 1] * v1 + Q[i * 3 + 2] * v2; } // Qᵀ v
  }
  /** W79 walker: the gait asked for, "walk" or "ride". */
  get gait() { return this.motion.gait; }

  onAdd(map, gl) {
    this.map = map; this.gl = gl;
    this.g = program(gl, VS_GROUND, FS_GROUND);
    this.q = program(gl, VS_QUAD, FS_QUAD);
    this.mesh = new ShipMeshGL(gl);
    this.upload(); // W63 rider
    this.off = new Offscreen(gl);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vaoQ = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQ);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.ready = true;
    map.triggerRepaint();
  }

  /** The ship's light, from the top left of the screen and above, in the ship's frame and in its leaning frame. */
  lightFor(rollRad) {
    const rel = ((this.heading - this.map.getBearing()) * Math.PI) / 180, lx = -0.55, ly = 0.55, L = this.light, LR = this.lightR;
    L[0] = lx * Math.cos(rel) - ly * Math.sin(rel); L[1] = lx * Math.sin(rel) + ly * Math.cos(rel); L[2] = 0.63;
    LR[0] = Math.cos(rollRad) * L[0] - Math.sin(rollRad) * L[2]; LR[1] = L[1]; LR[2] = Math.sin(rollRad) * L[0] + Math.cos(rollRad) * L[2];
  }

  prerender(gl, args) {
    this.shown = false;
    if (!this.ready || !this.on || this.away) { this.moving = false; return; } // W21 shipin: not shown, nothing to animate; W39 ship: away
    const t0 = performance.now(), map = this.map, s = this.motion, size = this.size * FILL;
    this.moving = s.step(this.clock(), this.speed);
    if (s.swap) { s.swap = false; this.upload(); } // W79 walker: the top of the hop, off the bike or on
    if (s.gaitOn) map.triggerRepaint(); // W79 walker: the hop (or Calm's fade) asks for its own frames, only while it plays: the frame loop asks for none in Calm
    this.lifted = lift(map.getPitch()); // W21 shipin: how tilted the chart is (the mesh shows at every pitch)
    const m = args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args.modelViewProjectionMatrix || args;
    this.ground = map.getTerrain() ? map.queryTerrainElevation(this.lngLat) || 0 : 0;
    this.deep = !!map.getTerrain();
    this.matrix(m, 0, this.F);
    const k = this.aim(); // the ground's pull behind hills, in the ship's own frame
    const reach = Math.max(80, size * 0.6 + 8, this.ring + 2);
    const pg = this.deep ? Math.min(0.5 * this.camPx, reach * k) : 0;
    for (let i = 0; i < 3; i++) this.pullG[i] = this.toCam[i] * pg;
    const roll = s.still || !s.on.lean ? 0 : ((this.roll * (s.walks ? 0.4 : 1) + s.tilt) * Math.PI) / 180; // W79 walker: a walker leans less; a stopped bike tips onto its foot
    const heading = this.heading; this.heading += (s.yaw * 180) / Math.PI; // W79 walker: the hop's twirl turns the body, not the beam
    const FR = this.matrix(m, roll, this.FR);
    this.aim(); // the camera in the leaning frame, for the rim light and the ship's depth
    for (let i = 0; i < 3; i++) this.eye[i] = (this.toCam[i] * this.camPx) / size;
    this.lightFor(roll);
    const view = Math.max(0, STAND_DEG - map.getPitch()); // W80 marker2d: on a flat chart every marker stands up to the eye, by one angle
    if (view > 0.01) this.standUp(FR, ((map.getBearing() - this.heading) * Math.PI) / 180, (-view * Math.PI) / 180); // W79 walker
    this.heading = heading; // W79 walker

    // the ship's box on the screen, in device px, snapped outward, from its box in the model
    const b = this.mesh.mesh.box, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const xs = this.xs, ys = this.ys, zs = this.zs;
    xs[0] = Math.min(b[0], -0.36) * size; xs[1] = Math.max(b[3], 0.36) * size; ys[0] = -0.52 * size; ys[1] = (b[4] + 0.04) * size;
    zs[0] = 0; zs[1] = (b[5] * Math.max(1, s.squash) + s.z + 0.04) * size;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = xs[i & 1], y = ys[(i >> 1) & 1], z = zs[i >> 2];
      const w = FR[3] * x + FR[7] * y + FR[11] * z + FR[15];
      if (!(w > 1e-6)) return;
      const nx = (FR[0] * x + FR[4] * y + FR[8] * z + FR[12]) / w, ny = (FR[1] * x + FR[5] * y + FR[9] * z + FR[13]) / w, nz = (FR[2] * x + FR[6] * y + FR[10] * z + FR[14]) / w;
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny); z0 = Math.min(z0, nz); z1 = Math.max(z1, nz);
    }
    const px0 = Math.max(0, Math.floor(((x0 + 1) / 2) * W) - 2), px1 = Math.min(W, Math.ceil(((x1 + 1) / 2) * W) + 2);
    const py0 = Math.max(0, Math.floor(((y0 + 1) / 2) * H) - 2), py1 = Math.min(H, Math.ceil(((y1 + 1) / 2) * H) + 2);
    const w = px1 - px0, h = py1 - py0;
    if (w <= 0 || h <= 0) return;
    const nx0 = (px0 / W) * 2 - 1, nx1 = (px1 / W) * 2 - 1, ny0 = (py0 / H) * 2 - 1, ny1 = (py1 / H) * 2 - 1;
    const cx = (nx0 + nx1) / 2, hx = (nx1 - nx0) / 2, cy = (ny0 + ny1) / 2, hy = (ny1 - ny0) / 2;
    const pad = Math.max(1e-6, (z1 - z0) * 0.6), cz = (z0 + z1) / 2, hz = (z1 - z0) / 2 + pad;
    // the crop: clip' = (clip - c w) / h on x, y and z, so the box fills the target and the ship its depth range
    const C = this.C;
    for (let c = 0; c < 4; c++) {
      const r0 = FR[4 * c], r1 = FR[4 * c + 1], r2 = FR[4 * c + 2], r3 = FR[4 * c + 3];
      C[4 * c] = (r0 - cx * r3) / hx; C[4 * c + 1] = (r1 - cy * r3) / hy; C[4 * c + 2] = (r2 - cz * r3) / hz; C[4 * c + 3] = r3;
    }
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    this.off.begin(w, h);
    this.rim.set(this.you);
    const o = this.opts; o.size = size; o.look = this.look;
    this.mesh.draw(C, s, o);
    this.off.resolve();
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
    this.box[0] = nx0; this.box[1] = ny0; this.box[2] = nx1; this.box[3] = ny1;
    this.px[0] = px0; this.px[1] = py0; this.px[2] = px1; this.px[3] = py1;
    this.uv[0] = w / this.off.w; this.uv[1] = h / this.off.h;
    // the quad's depth: the ship's middle, pulled toward the camera by half its size, as W20 pulls the old hull
    const pz = this.deep ? Math.min(0.5 * this.camPx, size * 0.5 * k) : 0, mx = this.toCam[0] * pz, my = this.toCam[1] * pz, mz = s.z * size + this.toCam[2] * pz;
    const cw = FR[3] * mx + FR[7] * my + FR[11] * mz + FR[15];
    this.z = Math.max(-1, Math.min(1, (FR[2] * mx + FR[6] * my + FR[10] * mz + FR[14]) / cw));
    this.shown = true;
    this.drawMs = performance.now() - t0;
  }

  render(gl) {
    if (!this.ready || !this.on || !this.shown) return;
    const t0 = performance.now(), s = this.motion;
    if (this.deep) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); } else gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // 1. the ground
    let u = this.g.u;
    gl.useProgram(this.g.p);
    gl.bindVertexArray(this.vaoQ);
    gl.uniformMatrix4fv(u.u_m, false, this.F);
    const half = Math.max(80, this.size * 0.6 + 8, this.ring + 2), L = this.light, hz = s.z, size = this.size * FILL;
    gl.uniform1f(u.u_half, half); gl.uniform1f(u.u_size, size); gl.uniform1f(u.u_ring, this.ring);
    gl.uniform3fv(u.u_pull, this.pullG);
    gl.uniform1f(u.u_spread, this.spread); gl.uniform1f(u.u_beam, s.glides ? 0 : this.beam); // W123: no heading beam for the Arrow: it points the way itself (her note, 2026-10-24)
    gl.uniform1f(u.u_hz, hz); gl.uniform1f(u.u_glow, !this.lamps || s.glides ? 0 : s.flying ? 0.55 + 0.45 * s.glow : 0.5); // W112 avatars2: the glow beneath, on a dark map only, never under the arrow
    gl.uniform3fv(u.u_you, this.you); gl.uniform3fv(u.u_worm, this.worm);
    gl.uniform1f(u.u_tail, this.lamps ? this.tail * s.tailFade : 0); gl.uniform3fv(u.u_rear, this.rear); // W91 avatar2: Calm's hop fades it with the person; W109 notes: and the hop outside Calm, to nothing at the swap; W112 avatars2: on a dark map only
    gl.uniform2f(u.u_shadow, -L[0] * hz * size * 1.4, -L[1] * hz * size * 1.4);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 2. the ship, pixel for pixel
    u = this.q.u;
    gl.useProgram(this.q.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.off.tex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform4fv(u.u_box, this.box); gl.uniform2f(u.u_uv, this.uv[0], this.uv[1]); gl.uniform1f(u.u_z, this.z); gl.uniform1f(u.u_alpha, this.alpha * s.fade); // W79 walker: Calm's dismount and mount, a fade
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.drawn++;
    this.drawMs += performance.now() - t0;
  }

  /** The ship's box on the screen, in CSS px (a DOMRect's fields), as last drawn. */
  getBoundingClientRect() {
    if (!this.drawn || !this.on || !this.shown) return NOWHERE;
    const cv = this.map.getCanvas(), c = cv.getBoundingClientRect(), k = c.width / this.gl.drawingBufferWidth, H = this.gl.drawingBufferHeight;
    const x = c.left + this.px[0] * k, y = c.top + (H - this.px[3]) * k, w = (this.px[2] - this.px[0]) * k, h = (this.px[3] - this.px[1]) * k;
    return { x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h };
  }
}
