// W21 ship: draws app/ship-model.js's mesh in WebGL 2, for the chart layer (app/ship-model-layer.js) and the
// mock-up's turntable (design/app-ui/w21-ship/). Three draws into whatever framebuffer is bound:
//   1. the outline (the toon looks): the closed parts again, pushed out along their normals, back faces only, in --void
//   2. the body: lit (toon bands or soft), with a rim light in --you; the comets and the lights in the same draw
//   3. the glows: the thruster and the lights' halos, added on, depth tested but not written
// The motion is all in the vertex shader, from a few uniforms (see ShipMotion in app/ship-model.js), so a frame
// uploads numbers only. Offscreen is a small multisampled target: the layer draws the ship there and lays it on
// the chart as one premultiplied quad, which gives the ship antialiased edges on a map with no MSAA of its own.
import { FLOATS, G, GW, NOZZLE, STEP } from "./ship-model.js"; // W79 walker: GW, STEP

const VS = `#version 300 es
uniform mat4 u_m; uniform float u_size, u_lift, u_pitch, u_squash, u_spin, u_flutter, u_amp, u_sweep, u_outline, u_len;
uniform vec4 u_axles; uniform float u_pivot;
uniform float u_stride, u_foot; uniform vec3 u_hip; // W79 walker
layout(location = 0) in vec3 a_pos; layout(location = 1) in vec3 a_nrm; layout(location = 2) in vec3 a_col; layout(location = 3) in vec3 a_k;
out vec3 v_n, v_col, v_p; out vec2 v_k; flat out int v_g;
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main() {
  vec3 p = a_pos, n = a_nrm; int g = int(a_k.x + 0.5);
  if (g == ${G.rear} || g == ${G.front}) { // the wheels turn about their axles; forward motion turns the top forward
    vec2 ax = g == ${G.rear} ? u_axles.xy : u_axles.zw;
    p.yz = ax + rot(p.yz - ax, -u_spin); n.yz = rot(n.yz, -u_spin);
  } else if (g == ${G.streamer}) { // hang from the grip, or stream back, and ripple along the length
    float s = a_k.y, len = a_nrm.x, ph = a_nrm.y;
    vec3 dir = normalize(mix(vec3(0.0, -0.12, -1.0), vec3(0.0, -1.0, -0.22), u_sweep));
    vec3 side = normalize(cross(vec3(1.0, 0.0, 0.0), dir));
    float wave = sin(6.2832 * (u_flutter - s * 0.85) + ph) * u_amp * s;
    p += dir * len * s + side * wave + vec3(wave * 0.35 * sign(p.x), 0.0, 0.0);
    n = side * a_nrm.z;
  } else if (g == ${G.thruster}) { // the flame stretches aft from the nozzle
    float y0 = u_axles.x - ${NOZZLE.toFixed(3)};
    p.y = y0 + (p.y - y0) * u_len;
  } else if (g == ${GW.leg} || g == ${GW.arm}) { // W79 walker: a leg or an arm swings about the hip or the shoulder (k2: ± its height)
    float a = sign(a_k.z) * u_stride * (g == ${GW.arm} ? ${STEP.arm_k.toFixed(2)} : 1.0); vec2 c = vec2(0.0, abs(a_k.z));
    p.yz = c + rot(p.yz - c, a); n.yz = rot(n.yz, a);
  } else if (g == ${GW.foot}) { // W79 walker: the rider's left foot, out and down to the ground at a stop
    vec3 q = p - u_hip; q.z *= 1.0 + 0.5 * u_foot; q.xz = rot(q.xz, -0.5 * u_foot); n.xz = rot(n.xz, -0.5 * u_foot);
    p = u_hip + q;
  }
  p += n * u_outline;
  // the body: squashed on the ground, pitched about its middle, and lifted by the hover and the hop
  p.z *= u_squash;
  p.yz = rot(p.yz - vec2(u_pivot, 0.2), u_pitch) + vec2(u_pivot, 0.2); n.yz = rot(n.yz, u_pitch);
  p.z += u_lift;
  v_n = n; v_col = a_col; v_p = p; v_k = a_k.yz; v_g = g;
  gl_Position = u_m * vec4(p * u_size, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
uniform vec3 u_light, u_eye, u_rim, u_ink; uniform float u_pass, u_toon, u_rimK, u_time, u_blinking, u_glow;
in vec3 v_n, v_col, v_p; in vec2 v_k; flat in int v_g; out vec4 o;
float blink(float t, float phase) { float c = 0.5 + 0.5 * cos(6.2832 * (t / 1.6 - phase)); return 0.3 + 0.7 * c * c; }
void main() {
  if (u_pass < 0.5) { o = vec4(u_ink, 1.0); return; }
  vec3 n = normalize(v_n); if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(u_eye - v_p);
  if (v_g == ${G.light} || v_g == ${G.glow}) {
    float ch = v_k.x, e = ch < -0.5 ? 1.0 : mix(1.0, blink(u_time, ch < 1.5 ? ch * 0.5 : (ch - 2.0) * 0.14), u_blinking); // W91 avatar2: -1, steady
    if (v_g == ${G.light}) { o = vec4(mix(v_col, vec3(1.0), 0.25 * e) * (0.45 + 0.55 * e), 1.0); return; }
    float f = pow(max(dot(n, v), 0.0), 2.5) * 0.55 * e; o = vec4(v_col * f, 0.0); return;
  }
  if (v_g == ${G.thruster}) {
    float f = (0.35 + 0.65 * pow(max(dot(n, v), 0.0), 1.5)) * (1.0 - 0.8 * v_k.x) * u_glow * 1.3; o = vec4(mix(v_col, vec3(1.0), 0.35 * (1.0 - v_k.x)) * f, 0.0); return;
  }
  float d = dot(n, u_light);
  // toon: three bands, each edge a pixel or so soft; soft: half lambert, so the dark side keeps its paint
  float bands = mix(0.6, 0.8, smoothstep(-0.05, 0.05, d)) + 0.2 * smoothstep(0.42, 0.52, d);
  float soft = 0.5 + 0.5 * (0.5 + 0.5 * d) * (0.5 + 0.5 * d) + 0.12 * max(d, 0.0);
  float shade = mix(soft, bands, u_toon);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * u_rimK * (0.4 + 0.6 * max(n.z, 0.0));
  vec3 h = normalize(u_light + v);
  float sp = pow(max(dot(n, h), 0.0), 36.0) * v_k.x;
  sp = mix(sp, step(0.6, sp), u_toon);
  o = vec4(v_col * shade + u_rim * rim + vec3(sp * 0.85), 1.0);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
export { program };

/** The looks for arclight's pick: toon bands with an ink outline, or soft shading with none. */
export const LOOKS = { toon: { toon: 1, outline: 0.75, rimK: 0.75 }, soft: { toon: 0, outline: 0, rimK: 0.9 } };

export class ShipMeshGL {
  constructor(gl) {
    this.gl = gl;
    this.prog = program(gl, VS, FS);
    this.vao = gl.createVertexArray(); this.buf = gl.createBuffer();
  }

  /** Upload a mesh from buildShip(). */
  upload(mesh) {
    const gl = this.gl;
    this.mesh = mesh;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    const S = FLOATS * 4;
    for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 3, gl.FLOAT, false, S, i * 12); }
    gl.bindVertexArray(null);
  }

  /**
   * Draw into the bound framebuffer, depth test on. m: model px to clip (Float32Array 16); s: the ShipMotion;
   * o: { size (px), light, eye (Float32Array 3, ship units, the ship's frame), rim (rgb 0 to 1), ink, look, lean? }.
   */
  draw(m, s, o) {
    const gl = this.gl, { p, u } = this.prog, mesh = this.mesh, look = o.look;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.u_m, false, m);
    gl.uniform1f(u.u_size, o.size); gl.uniform1f(u.u_lift, s.z); gl.uniform1f(u.u_pitch, s.pitch); gl.uniform1f(u.u_squash, s.squash);
    gl.uniform1f(u.u_spin, s.spin); gl.uniform1f(u.u_flutter, s.phase); gl.uniform1f(u.u_amp, s.amp); gl.uniform1f(u.u_sweep, s.sweep);
    gl.uniform1f(u.u_len, s.len); gl.uniform1f(u.u_glow, s.glow); gl.uniform1f(u.u_time, s.time); gl.uniform1f(u.u_blinking, s.blinking);
    const ax = mesh.axles; gl.uniform4f(u.u_axles, ax[0], ax[1], ax[2], ax[3]); gl.uniform1f(u.u_pivot, (ax[0] + ax[2]) / 2);
    const hip = mesh.hip || [0, 0, 0]; gl.uniform1f(u.u_stride, s.stride || 0); gl.uniform1f(u.u_foot, s.foot || 0); gl.uniform3f(u.u_hip, hip[0], hip[1], hip[2]); // W79 walker
    gl.uniform3fv(u.u_light, o.light); gl.uniform3fv(u.u_eye, o.eye); gl.uniform3fv(u.u_rim, o.rim); gl.uniform3fv(u.u_ink, o.ink);
    gl.uniform1f(u.u_toon, look.toon); gl.uniform1f(u.u_rimK, look.rimK);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (look.outline > 0) { // 1. the ink: back faces of the closed parts, a fixed number of px out
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT); gl.frontFace(gl.CCW);
      gl.uniform1f(u.u_pass, 0); gl.uniform1f(u.u_outline, look.outline / o.size);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.closed);
      gl.disable(gl.CULL_FACE);
    }
    // 2. the body, the lights and the comets
    gl.uniform1f(u.u_pass, 1); gl.uniform1f(u.u_outline, 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.opaque + mesh.streamers);
    // 3. the glows
    if (s.glow > 0 || mesh.additive) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, mesh.opaque + mesh.streamers, mesh.additive);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}

/** A multisampled colour and depth target, resolved into a texture. Grows, never shrinks. */
export class Offscreen {
  constructor(gl) {
    this.gl = gl; this.w = 0; this.h = 0;
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    this.msaa = gl.createFramebuffer(); this.out = gl.createFramebuffer();
    this.color = gl.createRenderbuffer(); this.depth = gl.createRenderbuffer(); this.tex = gl.createTexture();
  }
  /** Make room for w × h device px. */
  ensure(w, h) {
    if (w <= this.w && h <= this.h) return;
    const gl = this.gl, W = Math.max(this.w, Math.ceil(w / 64) * 64), H = Math.max(this.h, Math.ceil(h / 64) * 64);
    this.w = W; this.h = H;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }
  /** Bind the multisampled target, cleared to nothing, with a w × h viewport. */
  begin(w, h) {
    const gl = this.gl;
    this.ensure(w, h); this.cw = w; this.ch = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  /** Resolve the samples into this.tex (premultiplied: the ship's edges carry their coverage in alpha). */
  resolve() {
    const gl = this.gl, w = this.cw, h = this.ch;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.out);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
}
