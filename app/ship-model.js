// W21 ship: TIG Spark Gap as a real 3D mesh, built in code from primitives (swept tubes, tori, ellipsoids,
// ribbons), and the curves that animate it. Pure: no DOM and no GL, so Node tests it (app/tests/ship-model.test.mjs).
// app/ship-model-gl.js draws it; design/app-ui/w21-ship/ shows it for arclight's pick.
//
// Units: 1 is the ship's size on the screen (the old sprite's width, 48 to 78 px). x is right, y forward, z up,
// and the origin is on the ground under the pilot, where the sprite's centre was. The proportions come from
// design/ships/ships.js's frigate, scaled so that a wheel's diameter is the top-view sprite's wheel (0.2), so the
// ship covers the sprite's footprint from above: about 0.7 long and 0.6 wide at the bars.
//
// A vertex is 12 floats: position (3), normal (3), colour (3), and (group, k1, k2). The group says how the vertex
// shader moves it:
//   0 still      the frame, the pilot and the parts; k1 = gloss (the helmet's highlight)
//   1, 2         the rear and the front wheel, which turn about their axles
//   3 streamer   the helm comets: the position is the grip end plus the ribbon's half width in x; normal =
//                (length, phase, 0); k1 = s, 0 at the grip to 1 at the tip. The shader hangs or streams them
//   4 light      unlit, blinking; k1 = channel (0 front, 1 rear, 2 + i the top tube's LEDs, a chase)
//   5 thruster   additive, its length and flicker from the speed; k1 = 0 at the nozzle to 1 at the tip; in the
//                funk spectrum, as it starts the warp trail
//   6 glow       additive halos round the lights; k1 = channel as 4
// The mesh comes in three ranges, drawn in order: closed (outlined in the toon look), streamers, additive.

export const FLOATS = 12;
export const G = { still: 0, rear: 1, front: 2, streamer: 3, light: 4, thruster: 5, glow: 6 };
export const MOTION = { pulsar_period_s: 1.6, banner_hold_s: 2.6, t_normal_ms: 280, t_ceremony_ms: 1200 }; // design/tokens.*

// ---- small vector helpers (arrays of 3) ----------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirror = (p) => [-p[0], p[1], p[2]];
export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Collects triangles. Each one is turned to face its normals, so the winding is always counter-clockwise outside. */
class Mesh {
  constructor() { this.v = []; }
  vert(p, n, c, g, k1, k2) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], g, k1, k2); }
  tri(a, b, c, na, nb, nc, col, g = 0, k1 = 0, k2 = 0, ka = k1, kb = k1, kc = k1) {
    const f = cross(sub(b, a), sub(c, a));
    if (dot(f, add(add(na, nb), nc)) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; [kb, kc] = [kc, kb]; }
    this.vert(a, na, col, g, ka, k2); this.vert(b, nb, col, g, kb, k2); this.vert(c, nc, col, g, kc, k2);
  }
  quad(a, b, c, d, na, nb, nc, nd, col, g, k1, k2) { this.tri(a, b, c, na, nb, nc, col, g, k1, k2); this.tri(a, c, d, na, nc, nd, col, g, k1, k2); }

  /** A tube swept along a polyline, radius r (a number, or one per point), with flat caps. */
  tube(pts, r, sides, col, { g = 0, k1 = 0, caps = true } = {}) {
    const n = pts.length, R = typeof r === "number" ? pts.map(() => r) : r;
    const T = pts.map((_, i) => norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
    let N = Math.abs(T[0][2]) < 0.9 ? norm(cross(T[0], [0, 0, 1])) : norm(cross(T[0], [1, 0, 0]));
    const rings = [];
    for (let i = 0; i < n; i++) {
      if (i) N = norm(sub(N, mul(T[i], dot(N, T[i])))); // parallel transport, so the tube doesn't twist
      const B = cross(T[i], N), ring = [];
      for (let j = 0; j < sides; j++) {
        const a = (2 * Math.PI * j) / sides, d = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
        ring.push([add(pts[i], mul(d, R[i])), d]);
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < sides; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % sides], c = rings[i + 1][(j + 1) % sides], d = rings[i + 1][j];
      this.quad(a[0], b[0], c[0], d[0], a[1], b[1], c[1], d[1], col, g, k1, 0);
    }
    if (caps) for (const [i, s] of [[0, -1], [n - 1, 1]]) {
      const nn = mul(T[i], s);
      for (let j = 0; j < sides; j++) this.tri(pts[i], rings[i][j][0], rings[i][(j + 1) % sides][0], nn, nn, nn, col, g, k1);
    }
  }

  /** An ellipsoid at c with radii r = [rx, ry, rz], u segments round z and v from pole to pole; z from zMin (-1) up. */
  ellipsoid(c, r, u, v, col, { g = 0, k1 = 0, zMin = -1 } = {}) {
    const P = (i, j) => {
      const th = Math.asin(zMin) + ((Math.PI / 2 - Math.asin(zMin)) * j) / v, ph = (2 * Math.PI * i) / u;
      const s = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), Math.sin(th)];
      return [add(c, [s[0] * r[0], s[1] * r[1], s[2] * r[2]]), norm([s[0] / r[0], s[1] / r[1], s[2] / r[2]])];
    };
    for (let j = 0; j < v; j++) for (let i = 0; i < u; i++) {
      const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
      if (j + 1 === v) this.tri(a[0], b[0], d[0], a[1], b[1], d[1], col, g, k1); // the top pole
      else if (j === 0 && zMin === -1) this.tri(a[0], cc[0], d[0], a[1], cc[1], d[1], col, g, k1); // the bottom pole
      else this.quad(a[0], b[0], cc[0], d[0], a[1], b[1], cc[1], d[1], col, g, k1, 0);
    }
    if (zMin > -1) { // a flat bottom
      const nn = [0, 0, -1], ring = []; for (let i = 0; i <= u; i++) ring.push(P(i, 0)[0]);
      const mid = add(c, [0, 0, zMin * r[2]]);
      for (let i = 0; i < u; i++) this.tri(mid, ring[i], ring[i + 1], nn, nn, nn, col, g, k1);
    }
  }

  /** A torus about the x axis (a wheel's plane is y-z): major radius R, tube radius r. */
  torus(c, R, r, u, v, col, { g = 0, rx = r } = {}) {
    const P = (i, j) => {
      const a = (2 * Math.PI * i) / u, b = (2 * Math.PI * j) / v, rad = [0, Math.cos(a), Math.sin(a)];
      const n = norm(add(mul(rad, Math.cos(b) / r), [Math.sin(b) / rx, 0, 0]));
      return [add(c, add(mul(rad, R + r * Math.cos(b)), [rx * Math.sin(b), 0, 0])), n];
    };
    for (let i = 0; i < u; i++) for (let j = 0; j < v; j++) {
      const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
      this.quad(a[0], b[0], cc[0], d[0], a[1], b[1], cc[1], d[1], col, g, 0, 0);
    }
  }

  /** A flat fin: a polygon in a plane (its points, in order), extruded t thick along the plane's normal. */
  fin(pts, t, col, k1 = 0) {
    const nrm = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))), off = mul(nrm, t / 2);
    const top = pts.map((p) => add(p, off)), bot = pts.map((p) => sub(p, off)), ctr = mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
    for (let i = 1; i + 1 < pts.length; i++) {
      this.tri(top[0], top[i], top[i + 1], nrm, nrm, nrm, col, 0, k1);
      const m = mul(nrm, -1); this.tri(bot[0], bot[i], bot[i + 1], m, m, m, col, 0, k1);
    }
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length, mid = lerp3(pts[i], pts[j], 0.5), e = norm(sub(mid, ctr));
      const s = norm(sub(e, mul(nrm, dot(e, nrm))));
      this.quad(top[i], top[j], bot[j], bot[i], s, s, s, s, col, 0, k1, 0);
    }
  }

  /** A ribbon for a streamer: segs quads from the grip end a, half width w across x, two-sided. */
  ribbon(a, w, len, phase, segs, col) {
    for (let i = 0; i < segs; i++) {
      const s0 = i / segs, s1 = (i + 1) / segs, L = [-w, 0, 0], R = [w, 0, 0];
      for (const face of [1, -1]) { // both windings; the shader lights the side it sees
        const n = [len, phase, face];
        const v = [[add(a, L), s0], [add(a, R), s0], [add(a, R), s1], [add(a, L), s1]];
        const order = face > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const o of order) this.vert(v[o][0], n, col, G.streamer, v[o][1], 0);
      }
    }
  }
}

// ---- the ship -------------------------------------------------------------------------------------------
/** TIG Spark Gap's paints (design/ships/sprites/fleet.json), as token names. */
export const PAINT = { hull: "starlight", trim: "luna", tyre: "space-3", metal: "console-grey", suit: "chalk", glass: "starlight",
  visor: "void", front: "wormhole", rear: "negi", led: "wormhole", bell: "pulsar", comets: ["luna", "pulsar", "wormhole"],
  thrust: ["luna", "course", "pulsar", "wormhole", "black-hole"] };
/** How far aft of the rear axle the thruster's nozzle is, behind the tyre. */
export const NOZZLE = 0.07;

/**
 * The proportions. "standard" keeps the frigate's side view (wheels 0.2 across, the long raked bow); "chibi"
 * is a toy: bigger wheels and helmet, a shorter frame, the same footprint from above.
 */
export const BUILDS = {
  standard: { wheel: 0.1, rear: [-0.17, 0.1], front: [0.35, 0.1], tube: 0.025, tyre: 0.044, tyreF: 0.036, helmet: 0.09, bars: 0.28, seat: 0.24 },
  chibi: { wheel: 0.125, rear: [-0.15, 0.125], front: [0.3, 0.125], tube: 0.03, tyre: 0.054, tyreF: 0.046, helmet: 0.11, bars: 0.28, seat: 0.27 },
};

/**
 * Build the mesh. colors: the tokens' colour table (design/tokens.json "color"); build: a BUILDS key; detail:
 * 1 for the app (low poly), up to 2 for the turntable; avatar: the pilot's colour, a hex, or none for the paints (W86 avatar). Returns { data: Float32Array, closed, streamers, additive
 * (vertex counts, in that order in data), axles: [rear y, z, front y, z], box: [x0, y0, z0, x1, y1, z1] }.
 */
export function buildShip(color, { build = "standard", detail = 1, gait = "ride", avatar } = {}) {
  if (gait === "walk") return buildWalker(color, { build, detail, avatar }); // W79 walker: off the bike, on foot; W86 avatar
  if (RIDERS[build]) return buildRider(color, { build, detail, avatar }); // W63 rider: in Plain, a person on a bike; W86 avatar
  const B = BUILDS[build] || BUILDS.standard, m = new Mesh();
  const c = (name) => hex(color[name]);
  const hull = c(PAINT.hull), trim = c(PAINT.trim), tyre = c(PAINT.tyre), metal = c(PAINT.metal), suit = avatar ? hex(avatar) : c(PAINT.suit); // W86 avatar: the suit and the shields
  const sides = Math.round(6 * detail), seg = Math.round(14 * detail);
  const R = [0, B.rear[0], B.rear[1]], F = [0, B.front[0], B.front[1]], w = B.wheel, s = w / 0.1; // s: the wheels' scale

  // the wheels: a fat tyre, a luna rim, a hub, and five chunky spokes (a mag wheel turns visibly at 30 fps)
  for (const [A, tr, g] of [[R, B.tyre, G.rear], [F, B.tyreF, G.front]]) {
    const tt = 0.026 * s, rim = w - tt * 1.85; // the tyre's depth; the rim inside it
    m.torus(A, w - tt, tt, seg + 2, Math.max(4, Math.round(5 * detail)), tyre, { g, rx: tr });
    m.torus(A, rim, tt * 0.32, seg, 4, trim, { g, rx: tr * 0.55 });
    m.tube([add(A, [-tr * 0.75, 0, 0]), add(A, [tr * 0.75, 0, 0])], 0.024 * s, sides, trim, { g });
    for (let i = 0; i < 5; i++) {
      const a = (2 * Math.PI * i) / 5, d = [0, Math.cos(a), Math.sin(a)];
      m.tube([add(A, mul(d, 0.02 * s)), add(A, mul(d, rim))], 0.009 * s, 4, hull, { g, caps: false });
    }
  }

  // the frame (hull), the stays forked round the rear wheel, and the bow (fork) to the front axle
  const z0 = B.rear[1] - 0.1; // the chibi build stands its frame up with its wheels
  const Bb = [0, -0.02, 0.122 + z0], S0 = [0, -0.064, 0.226 + z0], Hb = [0, 0.173 + (B.front[0] - 0.35) * 0.6, 0.287 + z0];
  const Ht = add(Hb, [0, -0.043, 0.044]);
  const tube = B.tube;
  m.tube([S0, Ht], tube, sides, hull);
  m.tube([Bb, Hb], tube, sides, hull);
  m.tube([Bb, S0], tube, sides, hull);
  m.tube([Hb, Ht], tube * 1.35, sides, trim); // the head tube, in the trim
  for (const x of [-1, 1]) {
    const hub = add(R, [x * B.tyre * 0.8, 0, 0]);
    m.tube([hub, add(Bb, [x * tube * 0.6, 0, 0])], tube * 0.8, sides, hull);
    m.tube([hub, add(S0, [x * tube * 0.6, 0, 0])], tube * 0.8, sides, hull);
    const fhub = add(F, [x * B.tyreF * 0.8, 0, 0]);
    m.tube([fhub, add(Hb, [x * tube * 1.1, 0, 0])], tube * 0.85, sides, trim); // the long chopper bow
  }
  m.ellipsoid(Bb, [tube * 1.4, tube * 1.4, tube * 1.4], sides, 3, hull); // the cranks' shell

  // the banana seat (luna) and the sissy bar (metal), with the rear laser on it
  const seatA = [0, -0.2, B.seat + z0], seatB = [0, -0.005, B.seat + 0.01 + z0];
  m.ellipsoid(lerp3(seatA, seatB, 0.5), [0.038, 0.105, 0.022], sides + 2, 4, trim);
  const sissy = [[0, -0.155, 0.11 + z0], [0, -0.215, 0.39 + z0], [0, -0.178, 0.435 + z0], [0, -0.178, 0.262 + z0]];
  for (const x of [-1, 1]) m.tube(sissy.map((p) => add(p, [x * 0.024, 0, 0])), 0.011, Math.max(4, sides - 2), metal);
  m.tube([add(sissy[2], [-0.024, 0, 0]), add(sissy[2], [0.024, 0, 0])], 0.011, 4, metal);

  // the fins: two little luna fins on the rear stays, swept back, as on a fifties rocket
  for (const x of [-1, 1]) {
    const root = [x * 0.04, -0.13, 0.2 + z0];
    m.fin([root, add(root, [x * 0.06, -0.11, 0.07]), add(root, [x * 0.02, -0.07, -0.03])], 0.012, trim);
  }

  // the helm: ape bars from the head tube out to luna grips
  const bw = B.bars, bars = [Ht, add(Ht, [0.03, 0.017, 0.022]), add(Ht, [0.07, -0.004, 0.13]), add(Ht, [bw - 0.055, -0.03, 0.14]), add(Ht, [bw, -0.056, 0.124])];
  m.tube(bars, 0.018, Math.max(4, sides - 2), metal);
  m.tube(bars.map(mirror), 0.018, Math.max(4, sides - 2), metal);
  const grip = bars[4], gripIn = add(grip, [-0.05, 0.012, 0.004]);
  for (const g of [[gripIn, grip], [mirror(gripIn), mirror(grip)]]) m.tube(g, 0.02, sides, trim);
  m.ellipsoid(add(mirror(bars[3]), [0.03, 0, 0.022]), [0.022, 0.022, 0.018], sides, 3, c(PAINT.bell), { zMin: 0 }); // the sonic disruptor: a bell
  m.ellipsoid(add(Hb, [0, 0.022, -0.004]), [0.02, 0.008, 0.02], sides, 3, trim); // the escutcheon, on the head tube

  // the pilot: a chalk suit, arms to the grips, the shields (a glass helmet) with a dark face and an antenna
  const hip = [0, -0.09, B.seat + 0.03 + z0], chest = [0, -0.06, 0.37 + z0 + (B.seat - 0.24) * 0.5];
  m.tube([hip, chest], [0.045, 0.052], sides + 4, suit);
  m.ellipsoid(chest, [0.065, 0.045, 0.04], sides + 2, 4, suit); // the shoulders, wide, as on the sprite
  m.ellipsoid(hip, [0.05, 0.05, 0.035], sides, 3, suit);
  for (const x of [-1, 1]) {
    const sh = add(chest, [x * 0.06, 0, 0.01]), g = x > 0 ? gripIn : mirror(gripIn);
    m.tube([sh, add(lerp3(sh, g, 0.5), [x * 0.012, 0, -0.035]), g], 0.014, sides, suit);
    const knee = add(hip, [x * 0.045, 0.08, -0.03]);
    m.tube([add(hip, [x * 0.03, 0, 0]), knee, add(Bb, [x * 0.04, 0.02, -0.01])], 0.02, sides, suit);
  }
  const H = B.helmet, head = add(chest, [0, 0.005, 0.03 + H]);
  m.ellipsoid(head, [H, H, H], seg + 4, Math.round(7 * detail), avatar ? suit : c(PAINT.glass), { k1: 1 }); // W86 avatar
  // the face, a dark visor standing well out of the glass (a shallow one cuts the facets into a ragged edge)
  const face = add(head, [0, H * 0.32, -H * 0.04]);
  m.ellipsoid(face, [H * 0.74, H * 0.8, H * 0.64], seg + 4, Math.round(6 * detail), c(PAINT.visor), { k1: 0.6 });
  for (const x of [-1, 1]) m.ellipsoid(add(face, [x * H * 0.27, H * 0.76, H * 0.1]), [H * 0.12, H * 0.08, H * 0.17], 6, 3, hull); // eyes
  m.tube([add(head, [0, -H * 0.2, H * 0.95]), add(head, [0, -H * 0.35, H * 1.55])], 0.006, 4, metal);
  m.ellipsoid(add(head, [0, -H * 0.36, H * 1.62]), [0.016, 0.016, 0.016], 6, 3, trim);
  const closed = m.v.length / FLOATS;

  // the lights: the fore laser (wormhole) ahead of the head tube, the aft laser (negi) on the sissy bar, and five
  // LEDs a side down the bow, chasing toward the front wheel (the sprite has them on the top tube, which the
  // pilot hides in 3D)
  const lf = add(Hb, [0, 0.045, -0.025]), lr = add(sissy[1], [0, -0.012, -0.04]);
  const lights = [[lf, 0.028, c(PAINT.front), 0], [lr, 0.022, c(PAINT.rear), 1]];
  for (let i = 0; i < 5; i++) for (const x of [-1, 1]) {
    const a = add(Hb, [x * tube * 1.1, 0, 0]), b = add(F, [x * B.tyreF * 0.8, 0, 0]);
    lights.push([add(lerp3(a, b, 0.12 + i * 0.15), [x * tube * 0.85, 0, tube * 0.2]), 0.0095, c(PAINT.led), 2 + i]);
  }
  const lit = new Mesh();
  for (const [p, r, col, ch] of lights) lit.ellipsoid(p, [r, r, r], 6, 3, col, { g: G.light, k1: ch });
  m.v.push(...lit.v);
  const opaque = m.v.length / FLOATS;

  // the helm comets: three ribbons from each grip, luna, pulsar and wormhole
  PAINT.comets.forEach((name, i) => {
    for (const x of [-1, 1]) m.ribbon(add(x > 0 ? grip : mirror(grip), [x * (0.006 + i * 0.016), -0.012, -0.01]), 0.0075, 0.13 + i * 0.025, i * 0.9 + (x > 0 ? 0.5 : 0), Math.max(3, Math.round(4 * detail)), c(name));
  });
  const streamers = m.v.length / FLOATS - opaque;

  // additive: the thruster (a cone from the rear hub, aft) and the lights' halos
  const add0 = m.v.length;
  // the flame starts the warp trail: the funk spectrum from the nozzle aft, as the sprite's trail stub does
  const nozzle = add(R, [0, -NOZZLE, 0]), funk = PAINT.thrust.map(c);
  const cone = new Mesh(), L = [0, 0.07, 0.14, 0.21, 0.28];
  cone.tube(L.map((d) => add(nozzle, [0, -d, 0])), [0.034, 0.03, 0.022, 0.012, 0.002], sides, funk[0], { g: G.thruster, caps: false });
  for (let i = 0; i < cone.v.length; i += FLOATS) {
    const k = Math.min(1, (nozzle[1] - cone.v[i + 1]) / 0.28), f = k * (funk.length - 1), j = Math.min(funk.length - 2, Math.floor(f));
    cone.v[i + 10] = k; // k1: along the flame
    for (let n = 0; n < 3; n++) cone.v[i + 6 + n] = funk[j][n] + (funk[j + 1][n] - funk[j][n]) * (f - j);
  }
  m.v.push(...cone.v);
  const glow = new Mesh();
  for (const [p, r, col, ch] of lights.slice(0, 2)) glow.ellipsoid(p, [r * 2.6, r * 2.6, r * 2.6], 8, 4, col, { g: G.glow, k1: ch });
  m.v.push(...glow.v);
  const additive = (m.v.length - add0) / FLOATS;

  const data = Float32Array.from(m.v);
  return { data, closed, lights: opaque - closed, opaque, streamers, additive, count: data.length / FLOATS,
    axles: [R[1], R[2], F[1], F[2]], grip, box: bounds(data, closed + (opaque - closed)), build };
}

// ---- W63 rider: in Plain, a person on an ordinary bike ---------------------------------------------------
// arclight, 2026-10-20: "when a user switches to Plain words, their bike switches from a scul bike to a normal person on
// a bike? They can still be cute and all, just a normal bike". The same units, groups and ranges as the ship, and about
// its footprint from above (the chibi ship's box: 0.58 wide, -0.28 to 0.43 long), so the layer, its box on the screen
// and the ground pass hold. No thruster and no streamers; a white front light and a red rear one, which blink as the
// ship's do. A chunky toy: a big round head in a helmet in the "you" blue, a short body, fat tyres.
/** The rider's paints, as token names. The face is a toy's gold (--pulsar) rather than a skin tone. */
export const RIDER_PAINT = { helmet: "you", stripe: "starlight", face: "pulsar", eyes: "void", cheeks: "luna", legs: "stardust",
  shoes: "space-3", tyre: "space-3", metal: "console-grey", saddle: "space-3", front: "starlight", rear: "negi", basket: "chalk" };
/** The riders, for arclight's pick (design/app-ui/w63-rider/): a frame, its parts, the bars, the coat, and how far forward. */
export const RIDERS = {
  commuter: { frame: "step", paint: "starlight", basket: true, fenders: true, rack: true, bars: "swept", coat: "wormhole", lean: 0 },
  city: { frame: "diamond", paint: "you", fenders: true, rack: true, bars: "swept", coat: "chalk", lean: 0.3 },
  sporty: { frame: "diamond", paint: "luna", bars: "drops", coat: "terraform-glow", lean: 1 },
};

/** Build a rider's mesh: buildShip()'s fields, with streamers 0, no thruster, and rolls: true (it stands on the ground). */
export function buildRider(color, { build = "commuter", detail = 1, avatar } = {}) {
  const B = RIDERS[build] || RIDERS.commuter, m = new Mesh();
  const c = (name) => hex(color[name]), P = RIDER_PAINT;
  const helmet = avatar ? hex(avatar) : c(P.helmet); // W86 avatar: the helmet and the coat
  const frame = c(B.paint), metal = c(P.metal), coat = avatar ? hex(avatar) : c(B.coat), legs = c(P.legs), shoe = c(P.shoes);
  const sides = Math.round(6 * detail), seg = Math.round(14 * detail), W = 0.12;
  const R = [0, -0.15, W], F = [0, 0.28, W];

  // the wheels: a tyre, a rim, a hub and six thin spokes (under half a spoke's spacing a frame at MAX_SPIN)
  for (const [A, g] of [[R, G.rear], [F, G.front]]) {
    const tt = 0.022, rim = W - tt * 1.8;
    m.torus(A, W - tt, tt, seg + 2, Math.max(4, Math.round(5 * detail)), c(P.tyre), { g, rx: 0.026 });
    m.torus(A, rim, tt * 0.32, seg, 4, metal, { g, rx: 0.014 });
    m.tube([add(A, [-0.024, 0, 0]), add(A, [0.024, 0, 0])], 0.016, sides, metal, { g });
    for (let i = 0; i < 6; i++) {
      const a = (2 * Math.PI * i) / 6, d = [0, Math.cos(a), Math.sin(a)];
      m.tube([add(A, mul(d, 0.014)), add(A, mul(d, rim))], 0.0055, 4, metal, { g, caps: false });
    }
  }

  // the frame: a diamond, or a step-through's one low curved tube, and the fork to the front axle
  const BB = [0, 0.02, 0.1], ST = [0, -0.05, 0.3], HT = [0, 0.215, 0.325], HB = [0, 0.235, 0.25], tube = 0.019;
  m.tube([BB, ST], tube, sides, frame);
  if (B.frame === "step") m.tube([BB, [0, 0.1, 0.105], [0, 0.18, 0.15], HB], tube * 1.15, sides, frame);
  else { m.tube([BB, HB], tube * 1.1, sides, frame); m.tube([ST, HT], tube, sides, frame); }
  m.tube([HB, HT], tube * 1.3, sides, frame);
  for (const x of [-1, 1]) {
    const hub = add(R, [x * 0.024, 0, 0]);
    m.tube([hub, add(BB, [x * 0.012, 0, 0])], tube * 0.7, sides, frame);
    m.tube([hub, add(ST, [x * 0.012, -0.01, -0.02])], tube * 0.7, sides, frame);
    m.tube([add(HB, [x * 0.02, 0, 0]), add(F, [x * 0.026, 0, 0])], tube * 0.8, sides, frame);
  }
  // the cranks: a chainring on the right, a pedal forward on the right and back on the left
  m.torus(add(BB, [0.035, 0, 0]), 0.038, 0.007, seg, 4, metal);
  const pedal = [[1, [0.06, 0.075, 0.075]], [-1, [-0.06, -0.035, 0.135]]];
  for (const [, p] of pedal) m.tube([[p[0] * 0.65, BB[1], BB[2]], p], 0.008, 4, metal);

  // the parts: fenders, a rear rack, a front basket
  if (B.fenders) for (const [A, a0, a1] of [[R, 0.25, 2.7], [F, 0.5, 2.9]]) {
    const pts = []; for (let i = 0; i <= seg; i++) { const a = a0 + ((a1 - a0) * i) / seg; pts.push(add(A, [0, Math.cos(a) * (W + 0.012), Math.sin(a) * (W + 0.012)])); }
    m.tube(pts, 0.013, sides, frame);
  }
  if (B.rack) {
    for (const x of [-1, 1]) {
      m.tube([[x * 0.035, -0.235, 0.255], [x * 0.035, -0.06, 0.26]], 0.007, 4, metal);
      m.tube([add(R, [x * 0.03, 0, 0]), [x * 0.035, -0.2, 0.255]], 0.007, 4, metal);
    }
  }
  if (B.basket) { // a chalk basket on the head tube, over the front wheel, open at the top
    const y0 = 0.25, y1 = 0.37, z0 = 0.27, z1 = 0.35, x = 0.075, t = 0.01;
    m.fin([[-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0]], t, c(P.basket));
    m.fin([[-x, y1, z0], [x, y1, z0], [x, y1, z1], [-x, y1, z1]], t, c(P.basket));
    m.fin([[-x, y0, z0], [-x, y0, z1], [x, y0, z1], [x, y0, z0]], t, c(P.basket));
    for (const s of [-1, 1]) m.fin([[s * x, y0, z0], [s * x, y1, z0], [s * x, y1, z1], [s * x, y0, z1]], t, c(P.basket));
    m.tube([[-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1], [-x, y0, z1]], 0.008, 4, c(P.basket), { caps: false });
    m.ellipsoid([0.025, 0.3, 0.34], [0.03, 0.03, 0.03], sides, 3, c("terraform-glow")); // a lettuce and a lemon
    m.ellipsoid([-0.03, 0.325, 0.335], [0.026, 0.024, 0.024], sides, 3, c("pulsar"));
  }

  // the saddle on its post, the stem and the bars: swept back to the grips, or road drops
  m.tube([ST, [0, -0.06, 0.34]], 0.011, sides, metal);
  m.ellipsoid([0, -0.055, 0.352], [0.042, 0.065, 0.02], sides + 2, 4, c(P.saddle));
  const stem = B.bars === "drops" ? [0, 0.25, 0.35] : [0, 0.215, 0.385];
  m.tube([HT, stem], 0.012, sides, metal);
  const bars = B.bars === "drops" ? [stem, add(stem, [0.1, 0, 0]), add(stem, [0.125, 0.045, -0.015]), add(stem, [0.13, 0.05, -0.07]), add(stem, [0.13, 0.005, -0.085])]
    : [stem, add(stem, [0.1, 0, 0]), add(stem, [0.18, -0.045, 0.005]), add(stem, [0.245, -0.085, 0])];
  m.tube(bars, 0.012, Math.max(4, sides - 2), metal);
  m.tube(bars.map(mirror), 0.012, Math.max(4, sides - 2), metal);
  const grip = B.bars === "drops" ? add(stem, [0.125, 0.04, 0]) : bars[3], gripIn = add(grip, B.bars === "drops" ? [0, -0.01, 0] : [-0.045, 0.02, 0]);
  if (B.bars !== "drops") for (const g of [[gripIn, grip], [mirror(gripIn), mirror(grip)]]) m.tube(g, 0.016, sides, c(P.saddle));

  // the rider: on the saddle, hands on the grips, feet on the pedals; leaning forward as far as the build says
  const k = B.lean, hip = [0, -0.06, 0.39], chest = [0, -0.01 + 0.09 * k, 0.525 - 0.06 * k];
  m.tube([hip, chest], [0.048, 0.054], sides + 4, coat);
  m.ellipsoid(chest, [0.066, 0.045, 0.042], sides + 2, 4, coat);
  m.ellipsoid(hip, [0.052, 0.05, 0.036], sides, 3, legs);
  for (const x of [-1, 1]) {
    const sh = add(chest, [x * 0.058, 0, 0.012]), g = x > 0 ? gripIn : mirror(gripIn);
    m.tube([sh, add(lerp3(sh, g, 0.5), [x * 0.018, 0, -0.03]), g], 0.016, sides, coat);
    m.ellipsoid(g, [0.017, 0.017, 0.017], sides, 3, coat); // the hands, in mittens
    const foot = pedal.find(([s]) => s === x)[1], knee = [x * 0.05, 0.075 + 0.04 * (x > 0 ? 1 : -0.4), 0.33 - (x > 0 ? 0 : 0.03)];
    const gf = x < 0 ? GW.foot : G.still; // W79 walker: the left leg is the one put down at a stop
    m.tube([add(hip, [x * 0.032, 0, 0]), knee, foot], 0.021, sides, legs, { g: gf });
    m.ellipsoid(add(foot, [0, 0.012, 0.008]), [0.018, 0.032, 0.016], sides, 3, shoe, { g: gf });
  }
  // the head: big and round, a toy's gold face with two dots and pink cheeks, in a helmet with a stripe and a peak
  const H = 0.094, head = add(chest, [0, 0.012, 0.035 + H]);
  m.ellipsoid(head, [H * 0.95, H * 0.95, H * 0.95], seg + 2, Math.round(6 * detail), c(P.face));
  for (const x of [-1, 1]) {
    m.ellipsoid(add(head, [x * H * 0.38, H * 0.84, -H * 0.1]), [H * 0.13, H * 0.1, H * 0.19], 6, 3, c(P.eyes));
    m.ellipsoid(add(head, [x * H * 0.58, H * 0.7, -H * 0.42]), [H * 0.14, H * 0.08, H * 0.1], 6, 3, c(P.cheeks));
  }
  const hc = add(head, [0, -H * 0.06, H * 0.12]), HR = [H * 1.08, H * 1.14, H * 0.98];
  m.ellipsoid(hc, HR, seg + 4, Math.round(6 * detail), helmet, { k1: 1, zMin: -0.12 }); // W86 avatar
  const stripe = []; for (let i = 0; i <= 8; i++) { const a = 0.35 + (2.45 * i) / 8; stripe.push(add(hc, [0, Math.cos(a) * HR[1] * 1.0, Math.sin(a) * HR[2] * 1.0])); }
  m.tube(stripe, H * 0.24, sides, c(P.stripe));
  m.ellipsoid(add(hc, [0, HR[1] * 0.9, -H * 0.02]), [H * 0.72, H * 0.32, H * 0.1], sides + 2, 3, helmet, { k1: 0.6 }); // the peak
  const closed = m.v.length / FLOATS;

  // the lights: white at the front (the basket's, or the head tube's), red at the back (the rack's, or the seat post's)
  const lf = B.basket ? [0, 0.378, 0.3] : add(HB, [0, 0.03, 0.03]), lr = B.rack ? [0, -0.245, 0.25] : [0, -0.085, 0.3];
  const lights = [[lf, 0.024, c(P.front), 0], [lr, 0.02, c(P.rear), 1]];
  for (const [p, r, col, ch] of lights) m.ellipsoid(p, [r, r, r], 6, 3, col, { g: G.light, k1: ch });
  const opaque = m.v.length / FLOATS, add0 = m.v.length;
  for (const [p, r, col, ch] of lights) m.ellipsoid(p, [r * 2.6, r * 2.6, r * 2.6], 8, 4, col, { g: G.glow, k1: ch });
  const additive = (m.v.length - add0) / FLOATS;

  const data = Float32Array.from(m.v);
  return { data, closed, lights: opaque - closed, opaque, streamers: 0, additive, count: data.length / FLOATS,
    axles: [R[1], R[2], F[1], F[2]], grip, box: bounds(data, opaque), build, rolls: true, hip: [-0.032, hip[1], hip[2]] }; // W79 walker: hip, the foot's pivot
}

// ---- W79 walker: off the bike, on foot ----------------------------------------------------------------------------
// arclight, 2026-10-21: "If they're walking, it should just be a person ... the same person, just not on a bike". In walking
// mode the marker is the same person standing on the ground: SCUL's chibi pilot in the chalk suit and the glass helmet, with
// luna moon boots and gloves and a little life-support pack with the negi light; Plain's commuter in the jacket and the "you"
// helmet. The ship's units and ranges; the legs (GW.leg) and the arms (GW.arm) swing about the hip and the shoulder in the
// vertex shader, k2 = ± the pivot's height (the sign, the swing's side), so the step cycle is one uniform.
/** The groups the walker and the rider add: the legs and the arms that swing, and the rider's foot put down at a stop. */
export const GW = { leg: 7, arm: 8, foot: 9 };
/** The walker drawn bigger than the rider on the bike: from above, a standing person is only a head and shoulders. */
export const WALKER_SCALE = 1.3;

/** Build the person on foot for a build: a RIDERS key gives Plain's commuter, any other SCUL's pilot. buildShip()'s fields, with walks: true. */
export function buildWalker(color, { build = "chibi", detail = 1, avatar } = {}) {
  const plain = !!RIDERS[build], m = new Mesh(), c = (name) => hex(color[name]), P = RIDER_PAINT;
  const sides = Math.round(6 * detail), seg = Math.round(14 * detail);
  const helmet = avatar ? hex(avatar) : c(P.helmet), suit = avatar ? hex(avatar) : c(PAINT.suit); // W86 avatar: as on the bike
  const coat = plain ? (avatar ? hex(avatar) : c(RIDERS[build].coat)) : suit, legs = plain ? c(P.legs) : suit; // W86 avatar
  const shoe = plain ? c(P.shoes) : c(PAINT.trim), hand = plain ? coat : c(PAINT.trim);
  const limb = (g, k2, draw) => { const i0 = m.v.length; draw(); for (let i = i0; i < m.v.length; i += FLOATS) { m.v[i + 9] = g; m.v[i + 11] = k2; } };
  const hipZ = 0.2, shZ = 0.33, hip = [0, 0, hipZ], chest = [0, 0.004, shZ - 0.006];
  for (const x of [-1, 1]) {
    limb(GW.leg, -x * hipZ, () => { // the left leg swings forward as the right arm does
      m.tube([[x * 0.036, 0, hipZ], [x * 0.039, 0.012, 0.11], [x * 0.039, 0, 0.05]], [0.03, 0.026, 0.024], sides, legs);
      m.ellipsoid([x * 0.039, 0.02, 0.027], [0.031, 0.052, 0.027], sides + 2, 3, shoe);
    });
    limb(GW.arm, x * shZ, () => {
      const sh = [x * 0.066, 0, shZ], el = [x * 0.084, 0.004, 0.255], hd = [x * 0.08, 0.02, 0.188];
      m.tube([sh, el, hd], 0.018, sides, coat);
      m.ellipsoid(hd, [0.021, 0.021, 0.021], sides, 3, hand);
    });
  }
  m.ellipsoid(hip, [0.058, 0.046, 0.04], sides, 3, legs);
  m.tube([hip, chest], [0.05, 0.058], sides + 4, coat);
  m.ellipsoid(chest, [0.072, 0.048, 0.046], sides + 2, 4, coat);
  const lights = [];
  if (plain) { // the commuter's head, as on the bike: a toy's gold face, two dots, pink cheeks, the helmet with its stripe and peak
    const H = 0.094, head = add(chest, [0, 0.012, 0.035 + H]);
    m.ellipsoid(head, [H * 0.95, H * 0.95, H * 0.95], seg + 2, Math.round(6 * detail), c(P.face));
    for (const x of [-1, 1]) {
      m.ellipsoid(add(head, [x * H * 0.38, H * 0.84, -H * 0.1]), [H * 0.13, H * 0.1, H * 0.19], 6, 3, c(P.eyes));
      m.ellipsoid(add(head, [x * H * 0.58, H * 0.7, -H * 0.42]), [H * 0.14, H * 0.08, H * 0.1], 6, 3, c(P.cheeks));
    }
    const hc = add(head, [0, -H * 0.06, H * 0.12]), HR = [H * 1.08, H * 1.14, H * 0.98];
    m.ellipsoid(hc, HR, seg + 4, Math.round(6 * detail), helmet, { k1: 1, zMin: -0.12 }); // W86 avatar
    const stripe = []; for (let i = 0; i <= 8; i++) { const a = 0.35 + (2.45 * i) / 8; stripe.push(add(hc, [0, Math.cos(a) * HR[1], Math.sin(a) * HR[2]])); }
    m.tube(stripe, H * 0.24, sides, c(P.stripe));
    m.ellipsoid(add(hc, [0, HR[1] * 0.9, -H * 0.02]), [H * 0.72, H * 0.32, H * 0.1], sides + 2, 3, helmet, { k1: 0.6 });
  } else { // the pilot's: the glass helmet, the dark visor with its eyes, the antenna; and the pack on the back
    const H = BUILDS.chibi.helmet, head = add(chest, [0, 0.005, 0.03 + H]);
    m.ellipsoid(head, [H, H, H], seg + 4, Math.round(7 * detail), avatar ? suit : c(PAINT.glass), { k1: 1 }); // W86 avatar
    const face = add(head, [0, H * 0.32, -H * 0.04]);
    m.ellipsoid(face, [H * 0.74, H * 0.8, H * 0.64], seg + 4, Math.round(6 * detail), c(PAINT.visor), { k1: 0.6 });
    for (const x of [-1, 1]) m.ellipsoid(add(face, [x * H * 0.27, H * 0.76, H * 0.1]), [H * 0.12, H * 0.08, H * 0.17], 6, 3, c(PAINT.hull));
    m.tube([add(head, [0, -H * 0.2, H * 0.95]), add(head, [0, -H * 0.35, H * 1.55])], 0.006, 4, c(PAINT.metal));
    m.ellipsoid(add(head, [0, -H * 0.36, H * 1.62]), [0.016, 0.016, 0.016], 6, 3, c(PAINT.trim));
    const pack = [0, -0.062, 0.29];
    m.ellipsoid(pack, [0.056, 0.03, 0.062], sides + 2, 4, c(PAINT.hull));
    m.tube([add(pack, [-0.05, -0.02, 0.05]), add(pack, [0.05, -0.02, 0.05])], 0.009, 4, c(PAINT.metal));
    lights.push([add(pack, [0, -0.032, -0.012]), 0.018, c(PAINT.rear), 1]);
  }
  const closed = m.v.length / FLOATS;
  for (const [p, r, col, ch] of lights) m.ellipsoid(p, [r, r, r], 6, 3, col, { g: G.light, k1: ch });
  const opaque = m.v.length / FLOATS, add0 = m.v.length;
  for (const [p, r, col, ch] of lights) m.ellipsoid(p, [r * 2.6, r * 2.6, r * 2.6], 8, 4, col, { g: G.glow, k1: ch });
  const additive = (m.v.length - add0) / FLOATS;
  const S = WALKER_SCALE;
  for (let i = 0; i < m.v.length; i += FLOATS) {
    m.v[i] *= S; m.v[i + 1] *= S; m.v[i + 2] *= S;
    if (m.v[i + 9] === GW.leg || m.v[i + 9] === GW.arm) m.v[i + 11] *= S;
  }
  const data = Float32Array.from(m.v);
  return { data, closed, lights: opaque - closed, opaque, streamers: 0, additive, count: data.length / FLOATS,
    axles: [0, 0, 0, 0], grip: null, box: bounds(data, opaque), build, rolls: true, walks: true, hip: [0, 0, hipZ * S] };
}

/** The box round the first n vertices' positions: [x0, y0, z0, x1, y1, z1]. */
export function bounds(data, n = data.length / FLOATS) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = data[i * FLOATS + k];
    if (v < b[k]) b[k] = v;
    if (v > b[k + 3]) b[k + 3] = v;
  }
  return b;
}

// ---- the motion: pure functions of time (s) and speed (m/s) -------------------------------------------------
const TAU = 2 * Math.PI;
export const HOVER = 0.045, BOB = 0.012, BOB_PERIOD = 2 * MOTION.pulsar_period_s; // parked: up and down every 3.2 s
export const FLY_HOVER = 0.075, HOP = 0.16, HOP_S = (2 * MOTION.t_normal_ms) / 1000, SETTLE_S = MOTION.t_ceremony_ms / 1000;
export const MAX_SPIN = TAU * 2; // the wheels' turn, at most 2 a second: five spokes never strobe at 30 fps
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** The hover's height while parked, in ship units: a slow bob round HOVER. */
export const hover = (t) => HOVER + BOB * Math.sin((TAU * t) / BOB_PERIOD);
/** The wheels' turn rate, rad/s: about a turn and a half a second at 9 m/s, capped at MAX_SPIN. */
export const wheelSpin = (speed) => Math.min(MAX_SPIN, Math.max(0, speed || 0) * (Math.PI / 3));
/** The streamers: { hz, amp, sweep }. Faster and wider with speed, at most 3 Hz; sweep 0 hangs, 1 streams back. */
export function flutter(speed) {
  const v = Math.max(0, speed || 0);
  return { hz: Math.min(3, 0.6 + v * 0.22), amp: Math.min(0.045, 0.012 + v * 0.0035), sweep: Math.min(1, v / 6) };
}
/**
 * The hop at Launch, ms after it: { z (ship units, on top of the rise from the parked to the flying hover),
 * squash (z scale), pitch (radians, nose up +) }. A crouch for the first sixth, a stretch on the way up and the
 * nose up, a squash as it comes down, then nothing.
 */
export function hop(ms) {
  const t = ms / 1000 / HOP_S;
  if (!(t > 0) || t >= 1.25) return { z: 0, squash: 1, pitch: 0 };
  if (t < 0.15) { const k = Math.sin((Math.PI * t) / 0.15); return { z: 0, squash: 1 - 0.12 * k, pitch: 0 }; }
  if (t < 1) { const u = (t - 0.15) / 0.85, k = Math.sin(Math.PI * u); return { z: HOP * k, squash: 1 + 0.08 * Math.cos(Math.PI * u) * k, pitch: 0.12 * Math.cos(Math.PI * u) * k }; }
  const k = Math.sin((Math.PI * (t - 1)) / 0.25); return { z: 0, squash: 1 - 0.1 * k, pitch: 0 };
}
/**
 * The settle at Land, ms after it: { z (above the parked hover), squash, pitch }. It starts at the flying hover,
 * so nothing jumps, and drops as a soft spring: one dip below the hover with a little squash, then still by SETTLE_S.
 */
export function settle(ms) {
  const t = ms / 1000;
  if (!(t >= 0) || t >= SETTLE_S) return { z: 0, squash: 1, pitch: 0 };
  const w = TAU * 1.4, zeta = 0.35, wd = w * Math.sqrt(1 - zeta * zeta), A = FLY_HOVER - HOVER, B = (-0.4 + zeta * w * A) / wd;
  const z = Math.exp(-zeta * w * t) * (A * Math.cos(wd * t) + B * Math.sin(wd * t)) * (1 - smooth((t / SETTLE_S - 0.75) / 0.25));
  return { z, squash: 1 + 2 * Math.min(0, z), pitch: 0.6 * Math.min(0, z) };
}
/** A light's brightness, 0.3 to 1, once a pulsar period; phase in periods. Slow, never a flash. */
export const blink = (t, phase = 0) => 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(TAU * (t / MOTION.pulsar_period_s - phase))) ** 2;
/** The thruster: { len (of its modelled length, up to 1.2), glow } from the speed, with a slow flicker under 3 Hz. It
 *  reads at a glance (arclight, 2026-10-16: "more thrust when you were moving fast, and less when you were moving
 *  slower"): a stub at a walk, about 0.7 at a 10 mph cruise, and its longest and brightest from THRUST_FULL_MPS. */
export const THRUST_FULL_MPS = 10; // about 22 mph
export function thrust(t, speed) {
  const v = Math.max(0, speed || 0), on = Math.min(1, v / 1.5), u = Math.min(1, v / THRUST_FULL_MPS);
  const f = 0.5 * Math.sin(TAU * 2.3 * t) + 0.3 * Math.sin(TAU * 2.9 * t + 1.7) + 0.2 * Math.sin(TAU * 1.1 * t + 0.4);
  return { len: on * (0.3 + 0.9 * u + 0.06 * f), glow: on * (0.45 + 0.55 * u + 0.12 * f) };
}

// ---- W79 walker: the step cycle, the dismount and the mount, and the stop and the push-off ----------------------------
/** The step cycle: no steps under min_mps; the legs' swing (radians) full from full_mps; the arms swing arm_k of it. */
export const STEP = { min_mps: 0.3, full_mps: 1.2, swing: 0.5, arm_k: 0.7, bob: 0.012, max_hz: 1.3 };
/** The step cycle at a speed: { hz (strides a second, two steps each), swing (radians) }. About two steps a second at 1.4 m/s. */
export function stride(speed) {
  const v = Math.max(0, speed || 0);
  if (v < STEP.min_mps) return { hz: 0, swing: 0 };
  return { hz: Math.min(STEP.max_hz, 0.55 + 0.3 * v), swing: STEP.swing * Math.min(1, v / STEP.full_mps) };
}
/** The dismount and the mount: GAIT_S long, the build swapped at GAIT_SWAP_S (the top of the hop); Calm's fade, GAIT_FADE_S. */
export const GAIT_S = 0.56, GAIT_SWAP_S = 0.28, GAIT_FADE_S = 0.24, GAIT_HOP = 0.16;
/**
 * The hop off the bike or back on, ms after the switch: { z, squash, yaw (radians) }. A crouch, a hop with a twirl, the
 * build swapped at the top, a squash as the feet land, then nothing.
 */
export function gaitHop(ms) {
  const t = ms / 1000;
  if (!(t >= 0) || t >= GAIT_S) return { z: 0, squash: 1, yaw: 0 };
  if (t < 0.1) return { z: 0, squash: 1 - 0.14 * Math.sin((Math.PI * t) / 0.1), yaw: 0 };
  if (t < 0.46) { const u = (t - 0.1) / 0.36, k = Math.sin(Math.PI * u); return { z: GAIT_HOP * k, squash: 1 + 0.08 * Math.cos(Math.PI * u) * k, yaw: TAU * smooth(u) }; }
  return { z: 0, squash: 1 - 0.12 * Math.sin((Math.PI * (t - 0.46)) / 0.1), yaw: 0 };
}
/** Calm's dismount and mount: the marker's opacity, 1 down to 0 at the swap and back, over GAIT_FADE_S. */
export const gaitFade = (ms) => { const t = ms / 1000 / GAIT_FADE_S; return t >= 0 && t < 1 ? Math.abs(1 - 2 * t) : 1; };
/** In flight: stopped under STOP_MPS, moving again over GO_MPS. The stop's ease into the held pose, STOP_S; the push-off, GO_S. */
export const STOP_MPS = 0.4, GO_MPS = 0.8, STOP_S = 0.36, GO_S = 0.32;
/** Stopped: Plain's bike tips TILT_DEG onto the foot put down; the ship settles SINK lower. */
export const TILT_DEG = 7, SINK = 0.02;
/** The stop, ms after it: { z, squash }: a little dip as the weight comes down. */
export function stopDip(ms) {
  const u = ms / 1000 / STOP_S;
  if (!(u > 0) || u >= 1) return { z: 0, squash: 1 };
  const k = Math.sin(Math.PI * u); return { z: -0.012 * k, squash: 1 - 0.07 * k };
}
/** The push-off, ms after moving again: { z, squash, pitch }: a stretch forward and up, the nose a touch up. */
export function pushOff(ms) {
  const u = ms / 1000 / GO_S;
  if (!(u > 0) || u >= 1) return { z: 0, squash: 1, pitch: 0 };
  const k = Math.sin(Math.PI * u); return { z: 0.018 * k, squash: 1 + 0.06 * k, pitch: 0.07 * k };
}

/** W21 shipin: parked, the ship animates for PARKED_S after a touch (or Land), then eases to rest over REST_S. */
export const PARKED_S = 4, REST_S = MOTION.t_ceremony_ms / 1000, RISE_S = MOTION.t_normal_ms / 1000;
/** How awake the parked ship is, 1 to 0, s after its last touch: 1 through the window, then a smooth ease to 0. */
export const awake = (s, window = PARKED_S) => 1 - smooth((s - window) / REST_S);

/**
 * The ship's motion state, stepped once a frame: step(t in s, speed in m/s) sets the uniforms' numbers. With
 * still (Calm, or prefers-reduced-motion) nothing moves: the ship hovers at HOVER, the comets hang, the lights
 * stay lit and the thruster, in flight, stays at its middle. Toggles in .on switch each animation (the turntable).
 * W21 shipin: parked, the bob, the comets and the lights run for .window s after wake(t) or land(t), easing in
 * over RISE_S from rest, then ease into a still hover, and step() returns false. Launch, Land, Undo and wake take the clock's time, as the
 * steps stop while the ship rests.
 */
export class ShipMotion {
  constructor() {
    this.on = { hover: true, wheels: true, streamers: true, hopSettle: true, lights: true, thruster: true, lean: true };
    this.still = false; this.flying = false;
    this.rolls = false; // W63 rider: true for a bike on its wheels: no hover or bob, half the hop at Launch, the squashes kept
    this.t = 0; this.spin = 0; this.phase = 0;
    this.launchAt = -1e9; this.landAt = -1e9;
    this.window = PARKED_S; this.wokeAt = -1e9; this.a = 0; this.resumed = false; this.fromZ = HOVER; // W21 shipin
    Object.assign(this, { z: HOVER, squash: 1, pitch: 0, amp: 0, sweep: 0, len: 0, glow: 0, time: 0, blinking: 1 });
    // W79 walker: the gait asked for and the body shown (the layer swaps the build at the hop's top, .swap); walks, for a
    // walker's mesh; stopped in flight, and k, the held stop's pose, 0 to 1; the step cycle; the foot, the tilt, the twirl, the fade
    Object.assign(this, { gait: "ride", body: "ride", gaitAt: -1e9, gaitOn: false, swap: false, walks: false, stopped: false, stopAt: -1e9, goAt: -1e9 });
    Object.assign(this, { k: 0, kFrom: 0, kTo: 0, kAt: -1e9, stride: 0, swingA: 0, stepPh: 0, foot: 0, tilt: 0, yaw: 0, fade: 1 }); // W80 marker2d: no stand: the layer stands every body up by one angle
  }
  launch(t = this.t) { this.flying = true; this.launchAt = t; this.resumed = false; this.stopped = false; this.ease(0, t); } // W79 walker: stopped, ease
  land(t = this.t) { this.flying = false; this.landAt = t; this.stopped = false; this.ease(0, t); } // W79 walker: the foot back up
  /** W79 walker: off the bike ("walk") or back on ("ride"): the hop, with the build swapped at its top (.swap, for the layer).
   *  Back to the body still shown before the swap (a preview closed and a walk launched in one go): no hop at all. */
  setGait(gait, t = this.t) { if (gait === this.gait) return false; this.gait = gait; this.gaitAt = gait === this.body ? -1e9 : t; return true; }
  /** W79 walker: ease k, the held stop's pose, to `to` from where it is. */
  ease(to, t) { this.kFrom = this.k; this.kTo = to; this.kAt = t; }
  /** W21 shipin: Undo after Land: back to the flying hover from where the ship is, with no second hop. */
  undo(t = this.t) { this.flying = true; this.launchAt = t; this.resumed = true; this.fromZ = this.z; }
  /** W21 shipin: a touch, a gesture or a closed sheet: parked, the ship animates again for .window s. */
  wake(t = this.t) { this.wokeAt = t; }
  /** True while something moves, so the caller keeps asking for frames. */
  step(t, speed) {
    const dt = Math.min(0.25, Math.max(0, t - this.t)); this.t = t;
    const on = this.on, still = this.still, v = this.flying ? speed : 0;
    // W79 walker: the dismount or the mount, its build swapped at the hop's top (Calm: at the fade's middle)
    const gms = (t - this.gaitAt) * 1000, gaitOn = (this.gaitOn = gms >= 0 && gms < (still ? GAIT_FADE_S : GAIT_S) * 1000);
    if (this.body !== this.gait && gms >= (still ? GAIT_FADE_S / 2 : GAIT_SWAP_S) * 1000) { this.body = this.gait; this.swap = true; }
    this.fade = still ? gaitFade(gms) : 1;
    if (still) {
      Object.assign(this, { z: this.rolls ? 0 : HOVER, squash: 1, pitch: 0, amp: 0, sweep: 0, time: 0, blinking: 0 }); // W63 rider
      Object.assign(this, { k: 0, stride: 0, swingA: 0, foot: 0, tilt: 0, yaw: 0 }); // W79 walker: Calm, none of it
      const th = thrust(0, this.flying ? 6 : 0); this.len = th.len; this.glow = th.glow; // Calm: a still flame at a cruise, as before
      return gaitOn; // W79 walker: frames only while the fade plays
    }
    // W79 walker: in flight, after the Launch's hop: stopped under STOP_MPS, moving again over GO_MPS; k eases to the held pose
    if (this.flying && t - this.launchAt > HOP_S * 1.25) {
      if (!this.stopped && v < STOP_MPS) { this.stopped = true; this.stopAt = t; this.ease(1, t); }
      else if (this.stopped && v > GO_MPS) { this.stopped = false; this.goAt = t; this.ease(0, t); }
    }
    this.k = this.kFrom + (this.kTo - this.kFrom) * smooth((t - this.kAt) / (this.kTo ? STOP_S : 0.4 * GO_S)); // W79 walker
    const fl = flutter(v);
    const ms = (t - Math.max(this.launchAt, this.landAt)) * 1000;
    // W21 shipin: how awake, eased in over a quick RISE_S when a touch wakes the ship from rest
    const aim = this.flying ? 1 : awake(t - Math.max(this.wokeAt, this.landAt), this.window);
    const a = (this.a = aim < this.a ? aim : Math.min(aim, this.a + Math.min(dt, 1 / 30) / RISE_S));
    if (!this.flying && a <= 0 && ms >= SETTLE_S * 1000 && !gaitOn && this.k <= 0) { // at rest: a still hover, and no frames; W79 walker: no hop, the foot up
      Object.assign(this, { z: this.rolls ? 0 : HOVER, squash: 1, pitch: 0, amp: 0, sweep: 0, len: 0, glow: 0, blinking: 0 }); // W63 rider
      Object.assign(this, { stride: 0, swingA: 0, foot: 0, tilt: 0, yaw: 0 }); // W79 walker
      return false;
    }
    if (on.wheels) this.spin = (this.spin + wheelSpin(v) * dt) % TAU;
    if (on.streamers) this.phase = (this.phase + fl.hz * dt) % 1000;
    this.amp = on.streamers ? fl.amp * a : 0; this.sweep = fl.sweep;
    const parked = on.hover ? HOVER + (hover(t) - HOVER) * a : HOVER, flyBase = FLY_HOVER + (on.hover ? 0.004 * Math.sin((TAU * t) / MOTION.pulsar_period_s) : 0);
    let base, j;
    const from = this.resumed ? this.fromZ : parked; // W21 shipin: Undo rises from where the ship is
    if (this.flying) { base = from + (flyBase - from) * smooth(ms / 1000 / HOP_S); j = on.hopSettle && !this.resumed ? hop(ms) : hop(-1); }
    else if (on.hopSettle) { j = settle(ms); base = parked; }
    else { base = flyBase + (parked - flyBase) * smooth(ms / 300); j = hop(-1); }
    this.z = this.rolls ? (this.flying ? j.z * 0.5 : 0) : base + j.z; this.squash = j.squash; this.pitch = j.pitch; // W63 rider: a bunny hop
    // W79 walker: the step cycle (a walker's legs and arms, a little bob each step), the hop off or on, the stop's dip and the
    // push-off; stopped, Plain's bike tips onto its foot and the ship sinks a little
    const st = stride(this.walks ? v : 0);
    this.swingA += (st.swing - this.swingA) * Math.min(1, dt * 10);
    if (!st.swing && this.swingA < 0.01) this.swingA = 0; // under a degree: together
    if (this.swingA > 0) this.stepPh = (this.stepPh + Math.max(st.hz, 0.8) * dt) % 1;
    const sw = Math.sin(TAU * this.stepPh), bob = STEP.bob * Math.abs(sw) * (this.swingA / STEP.swing);
    const gh = gaitHop(gms), d = stopDip((t - this.stopAt) * 1000), o = pushOff((t - this.goAt) * 1000), bike = this.rolls && !this.walks;
    this.stride = this.swingA * sw;
    this.z += gh.z + bob + (this.rolls ? 0 : d.z + o.z - SINK * this.k);
    this.squash *= gh.squash * d.squash * o.squash; this.pitch += o.pitch * (this.walks ? 0.4 : 1);
    this.yaw = gh.yaw; this.foot = bike ? this.k : 0; this.tilt = bike && this.k ? -TILT_DEG * this.k : 0;
    const th = on.thruster ? thrust(t, v) : thrust(0, v); this.len = th.len; this.glow = th.glow;
    this.time = t; this.blinking = on.lights ? a : 0;
    return true;
  }
}
