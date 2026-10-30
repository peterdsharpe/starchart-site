// The ship's placing on the chart (SPEC §17): the matrix that moves the map's to the ship and turns it by its
// heading, the lean into turns as a bike does (leanDeg()), and with 3D terrain on (app/terrain.js) the ground
// under it and the camera's direction for the depth's pull behind hills (W19, W20 terrain3d). Nothing allocates
// per frame but aim()'s camera: the matrices are typed arrays made once, and the ship's place, heading, size,
// ring radius and beam spread are numbers set by app/main.js. W21 shipin: the drawing is app/ship-model-layer.js's
// ShipModel3D, the meshed ship, which extends Ship3D; the W17 sprite slices and their ground pass are gone.

import { cameraOf, pullAt } from "../chart/prototype/gl-layer.js"; // W20 terrain3d
import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json

const G = 9.81, MAX_LEAN = 25;

/** How tilted the chart is for the ship, 0 to 1, at a pitch in degrees: 0 up to 4°, full from 30°. */
export const lift = (pitch) => Math.min(1, Math.max(0, (pitch - 4) / 26));
/** The lean into a turn, in degrees (+ to the right): tan(lean) = speed × turn rate / g, at most 25°. */
export function leanDeg(speed, turnDegPerS) {
  const a = (Math.atan((speed * turnDegPerS * Math.PI) / 180 / G) * 180) / Math.PI;
  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, a || 0));
}
/** One step of the lean's smoothing, over about a third of a second. */
export const easeLean = (roll, target, dt) => roll + (target - roll) * Math.min(1, dt * 3);
/** The smallest signed turn from heading a to heading b, in degrees. */
const turn = (a, b) => ((b - a + 540) % 360) - 180;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export class Ship3D {
  /**
   * you: a hex colour. Set .lngLat, .heading (degrees), .size (the ship's size in CSS px), .ring (px; below 0,
   * none), .spread (the beam's angle, degrees), .beam (0 or 1) and .on (false: draw nothing) at will.
   */
  constructor({ size = 68, you = COLOURS.color.you }) { // W185 colours
    Object.assign(this, { id: "ship-3d", type: "custom", renderingMode: "3d", size, you: hex(you) });
    this.lngLat = [0, 0]; this.heading = 0; this.ring = -1; this.spread = 46; this.beam = 0; this.on = false;
    this.roll = 0; this.lean = 0; // the lean into a turn, degrees, + to the right
    this.M = new Float64Array(16); this.F = new Float32Array(16); this.FR = new Float32Array(16); this.light = new Float32Array(3); this.lightR = new Float32Array(3); this.L = new Float64Array(9);
    this.lifted = 0; this.drawMs = 0; this.drawn = 0; this.ground = 0;
    this.toCam = new Float32Array(3); // W20 terrain3d: toward the camera, in the ship's frame
  }

  /** The --you colour, as a theme changes it. */
  setYou(h) { if (/^#[0-9a-f]{6}$/i.test(h)) this.you = hex(h); }

  /** The lean, from the speed (m/s) and the heading at time t (ms). True while it is still moving. */
  steer(t, speed, heading) {
    const dt = this.lastT === undefined ? 0 : Math.min(0.5, (t - this.lastT) / 1000);
    if (dt > 0) this.lean = leanDeg(speed, turn(this.lastHeading, heading) / dt);
    this.lastT = t; this.lastHeading = heading;
    const was = this.roll;
    this.roll = easeLean(this.roll, this.lean, dt);
    return Math.abs(this.roll - was) > 0.05;
  }

  /** The map's matrix, moved to the ship and turned by its heading, in px with z up; leaning by roll (radians) about its forward axis. */
  matrix(m, roll, F) {
    const map = this.map, M = this.M;
    const ox = (this.lngLat[0] + 180) / 360, oy = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (this.lngLat[1] * Math.PI) / 360))) / 360;
    const oz = this.ground / (40075016.686 * Math.cos((this.lngLat[1] * Math.PI) / 180)); // W19 terrain: metres to mercator units
    const W = 512 * 2 ** map.getZoom(), s = 1 / W, h = (this.heading * Math.PI) / 180, c = Math.cos(h), n = Math.sin(h);
    // model (x right, y forward, z up, in px) to mercator: x' = (x c + y n) s, y' = (x n - y c) s, z' = z s;
    // the lean tips the x axis down and the z axis toward it, about the forward axis at the chart
    const cr = Math.cos(roll), sr = Math.sin(roll), L = this.L;
    L[0] = c * s * cr; L[1] = n * s * cr; L[2] = -s * sr;
    L[3] = n * s; L[4] = -c * s; L[5] = 0;
    L[6] = c * s * sr; L[7] = n * s * sr; L[8] = s * cr;
    for (let i = 0; i < 4; i++) {
      M[i] = m[i] * L[0] + m[4 + i] * L[1] + m[8 + i] * L[2];
      M[4 + i] = m[i] * L[3] + m[4 + i] * L[4] + m[8 + i] * L[5];
      M[8 + i] = m[i] * L[6] + m[4 + i] * L[7] + m[8 + i] * L[8];
      M[12 + i] = m[i] * ox + m[4 + i] * oy + m[8 + i] * oz + m[12 + i];
    }
    for (let i = 0; i < 16; i++) F[i] = M[i];
    this.ox = ox; this.oy = oy; this.oz = oz; // W20 terrain3d: for aim()
    return F;
  }

  /**
   * W20 terrain3d: point this.toCam at the camera, a unit vector in the ship's frame (from the last matrix()'s
   * axes), and return the factor that turns a reach on the chart, in px, into the depth's pull, in px: the
   * ground beyond a flat quad lies back by up to tan(pitch) of its reach, and a px on the screen covers more
   * of the chart the farther it is. Never more than half the way to the camera.
   */
  aim() {
    const map = this.map, cam = cameraOf(map), L = this.L, T = this.toCam;
    const dx = cam.x - this.ox, dy = cam.y - this.oy, dz = cam.z - this.oz;
    for (let i = 0; i < 3; i++) T[i] = L[3 * i] * dx + L[3 * i + 1] * dy + L[3 * i + 2] * dz;
    const n = Math.hypot(T[0], T[1], T[2]) || 1;
    T[0] /= n; T[1] /= n; T[2] /= n;
    const dist = Math.hypot(dx, dy, dz);
    this.camPx = dist * 512 * 2 ** map.getZoom();
    return pullAt(map.getPitch()) * (dist / cam.toCentre);
  }
}
