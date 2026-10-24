// The follow camera and the frame clock, shared by chart/prototype/app.js and app/main.js.
//
// - Heading-up: the bearing eases toward the course's heading at 2.2/s; the ship sprite itself is
//   steered by a short centred chord, so it points where it is going through turns (motion-6).
// - Three modes, as MapKit's: free, follow (north up, or the pilot's bearing) and heading. A drag
//   frees the camera; a pinch or a wheel zoom wins over it while the fingers move (prototype-3) and
//   keeps the mode. Turning follow back on puts the ship back at once, even when paused (prototype-14).
// - Two fingers: a spread zooms, a twist rotates, a vertical parallel move tilts (all three keep
//   following), and a sideways or diagonal parallel move pans and frees (W15).
// - In course mode the camera zooms out, a little and smoothly, to keep the next turn on screen (navigation-10).
// - W31 navview: in the app's flight the zoom follows the road, as Google Maps' navigation does (AUTO, AutoZoom below):
//   closer on slow streets and paths, wider on fast roads, a little closer before a turn. A pinch wins until a recentre.
// - The flight advances by real time; only the animation is clamped (the dt cap below).

const EARTH = 40075016.686;

/** Metres per CSS pixel at a latitude and zoom (MapLibre's 512 px tiles). */
export const metresPerPixel = (lat, zoom) => (EARTH * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/** Pixels on screen for `m` metres at a latitude and zoom. */
export const pixels = (m, lat, zoom) => m / metresPerPixel(lat, zoom);

/**
 * The real seconds since the last frame, for the flight, and the same clamped for what animates. The
 * flight keeps real time below 10 fps (a 0.1 s cap made it run slow); after a hidden tab it moves at
 * most `maxFlight` seconds, so the ship never leaps a kilometre past its events.
 */
export function frameDt(t, lastT, maxFlight = 1, maxAnim = 0.1) {
  const dt = Math.max(0, (t - lastT) / 1000);
  return { flight: Math.min(maxFlight, dt), anim: Math.min(maxAnim, dt) };
}

/** The bearing of the chord from s-back to s+ahead along a course (degrees, 0 = north). */
export function chordHeading(course, s, back = 6, ahead = 6) {
  const p = course.pointAt(Math.max(0, s - back)), q = course.pointAt(Math.min(course.length, s + ahead));
  if (p[0] === q[0] && p[1] === q[1]) return course.heading(s);
  const k = Math.cos((p[1] * Math.PI) / 180);
  return ((Math.atan2((q[0] - p[0]) * k, q[1] - p[1]) * 180) / Math.PI + 360) % 360;
}

/**
 * Do something only after the ship has moved far enough on screen: the ship-space symbol (motion-5,
 * 6 px) and the flown/ahead course gradient (motion-2, half the ship's length). due(s, lat, zoom).
 */
export class MoveGate {
  constructor(px) { this.px = px; this.last = null; }
  due(s, lat, zoom) {
    if (this.last !== null && Math.abs(pixels(s - this.last, lat, zoom)) < this.px) return false;
    this.last = s;
    return true;
  }
  reset() { this.last = null; }
}

/**
 * The zoom at which a point `m` metres from the ship fits in `px` pixels of screen, never lower
 * than `floor`, never higher than `zoom`.
 */
export function fitZoom(m, lat, px, zoom, floor = zoom - 1.5) {
  if (!(m > 0) || !(px > 0)) return zoom;
  const z = Math.log2((EARTH * Math.cos((lat * Math.PI) / 180) * px) / (512 * m));
  return Math.max(floor, Math.min(zoom, z));
}

/**
 * W31 navview: the zoom in flight (SPEC §43). The stretch ahead is what the rider covers in `street_s` seconds at the
 * street's speed plus `rider_s` at his own, within `min_m` and `max_m`; the zoom fits it between the ship and the top of
 * the view, within `minZoom` and `maxZoom`. The stretch is smoothed over `tau_s`, and the target moves only when the
 * zoom it wants is `band` levels away (hysteresis), so a fix or a red light changes nothing. Within `turn_m` of a turn,
 * or `turn_s` at the rider's speed, the target is `turnZoom` closer. The camera eases to it with a time constant of
 * `ease_s`, at most `rate` levels a second.
 */
export const AUTO = { street_s: 12, rider_s: 20, min_m: 100, max_m: 600, minZoom: 15, maxZoom: 18.5, tau_s: 5, band: 0.25,
  turn_m: 120, turn_s: 15, turnZoom: 0.5, ease_s: 1.5, rate: 0.35 };
const MPH = 0.44704;
const PATHS = new Set(["cycleway", "path", "footway", "track", "bridleway", "steps", "pedestrian"]);
/** The street's speed in m/s, from a matched road's properties (tiles v8's `mph`): without one, 12 mph on a path or off the
 *  network, 25 mph on a street. */
export function streetMps(props) {
  const mph = +props?.mph;
  if (mph > 0) return mph * MPH;
  return (!props || PATHS.has(props.class) || props.bike === "wormhole" ? 12 : 25) * MPH;
}
/** The stretch ahead the pilot should see, in metres, at a street's and a rider's speeds (m/s). */
export const aheadMetres = (street, rider) => Math.max(AUTO.min_m, Math.min(AUTO.max_m, AUTO.street_s * street + AUTO.rider_s * Math.max(0, rider || 0)));
/** The zoom at which `m` metres fit in `px` pixels at a latitude, within AUTO's clamps. */
export const zoomFor = (m, lat, px) =>
  Math.max(AUTO.minZoom, Math.min(AUTO.maxZoom, Math.log2((EARTH * Math.cos((lat * Math.PI) / 180) * Math.max(1, px)) / (512 * m))));

/** W31 navview: the target zoom, fix by fix, smoothed and with hysteresis (AUTO). */
export class AutoZoom {
  constructor() { this.reset(); }
  reset() { this.m = null; this.t = null; this.base = null; }
  /** One fix: street and rider in m/s, lat, px from the ship to the top of the view, turn the metres to the next turn (or
   *  null), t in ms. Gives the target zoom. */
  update({ street, rider = 0, lat, px, turn = null, t }) {
    const raw = aheadMetres(street, rider), dt = this.t === null ? Infinity : Math.max(0, (t - this.t) / 1000);
    this.t = t;
    this.m = this.m === null ? raw : this.m + (raw - this.m) * (1 - Math.exp(-dt / AUTO.tau_s));
    const z = zoomFor(this.m, lat, px);
    if (this.base === null || Math.abs(z - this.base) > AUTO.band) this.base = z;
    const near = turn !== null && turn >= 0 && turn <= Math.max(AUTO.turn_m, AUTO.turn_s * rider);
    return Math.min(AUTO.maxZoom, this.base + (near ? AUTO.turnZoom : 0));
  }
}

/** The camera's modes, as MapKit's tracking modes: the pilot's chart, following north up, following the heading. */
export const CAMERA_MODES = ["free", "follow", "heading"];
/** W29 polish (BRIEF §7.8): a camera move glides 200 ms, plus a little for each degree it turns or tilts, at most 400 ms
 *  (a half turn), so a big turn is easy to follow and a small one quick. Even in Calm: the glide says what changed. */
export const glideMs = (deg = 0) => Math.round(200 + (Math.min(180, Math.abs(deg)) * 10) / 9);
/** How far the camera turns from `from` to `to` degrees, the short way; 0 when either is unknown. */
const turned = (to, from) => (to === undefined || from === undefined ? 0 : Math.abs(((to - from + 540) % 360) - 180));
const easeOut = (t) => 1 - (1 - t) ** 3; // close to --ease-warp, cubic-bezier(.2, .8, .2, 1)
/** W26 relief: two paddings ({top, bottom, left, right}) within half a pixel of each other. */
const samePadding = (a, b) => ["top", "bottom", "left", "right"].every((k) => Math.abs((a?.[k] ?? 0) - (b?.[k] ?? 0)) < 0.5);
/** Two fingers on the chart: their centroid and spread in CSS pixels, or null. */
function twoFingers(ev) {
  const t = ev?.touches;
  if (!(t?.length === 2)) return null;
  return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2,
    d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1, pinch: false };
}

export class FollowCamera {
  /**
   * @param map  a MapLibre map (jumpTo, easeTo, isZooming, getZoom, getBearing, on)
   * @param opts {mode: "free" | "follow" | "heading" (or on: true for heading, false for free),
   *              bearing: the starting bearing}
   *
   * A drag frees the camera from the first dragstart, and so does a two-finger pan (the fingers' centroid
   * moves 30 px while their spread stays within 10 %); a pinch, a wheel or a double-tap zooms and keeps
   * the mode. A two-finger rotate in heading mode drops to follow, at the bearing the pilot left the
   * chart at (design/app-ui/SPEC.md §5). With pitch on, a parallel move whose first 30 px are more
   * vertical than not is a tilt, as MapLibre's touchPitch decides, and keeps following.
   *
   * tilt: the pitch heading mode eases to (45 with the tilted setting); 0 leaves the pitch to the pilot.
   * With a tilt, follow eases flat. The compass always lays the chart flat.
   */
  constructor(map, { on = true, mode = on ? "heading" : "free", bearing = 0 } = {}) {
    this.map = map;
    this.mode = mode;
    this.bearing = bearing; // heading mode's bearing, easing toward the heading
    this.heading = bearing; // the last heading seen
    this.onmode = null; // called with (mode, was) on every change
    this.gesture = false; // the pilot's fingers (or wheel) are moving the chart
    this.zoom = map.getZoom(); // the pilot's own zoom; course mode may show less than this, never more
    this.shown = null; // the zoom the camera last set
    this.auto = null; // W31 navview: the zoom the road asks for (AutoZoom), or null: the pilot's zoom
    this.pinched = false; // W31 navview: the pilot zoomed since the last recentre, so his zoom wins
    this.last = null; // the last [lonlat] followed
    this.glideEnd = 0; // no jumps until our own ease onto the ship has ended
    // The bearing that ease ends at. Its end is set by time: on slow frames the next jump would stop
    // MapLibre's ease part-way, so that jump puts the bearing there itself.
    this.glideBearing = null;
    this.glidePitch = null; // and the pitch, the same way
    this.tilt = 0;
    // W26 relief: (mode) => the map's padding while following in that mode, or null to leave it (app/main.js: the ship
    // in the middle north up, at 62 % of the height heading up). It changes with the camera's own eases, never a jump.
    this.padding = null;
    // A finger or a button down on the chart holds the camera still: a jump would stop MapLibre's
    // gesture before it became a drag, so following could never be dragged away (W12-ux item 9).
    this.held = false;
    const hold = () => { this.held = true; }, letGo = () => { this.held = false; };
    for (const ev of ["mousedown", "touchstart"]) map.on(ev, hold);
    for (const ev of ["mouseup", "touchend", "touchcancel"]) map.on(ev, letGo);
    globalThis.addEventListener?.("pointerup", letGo, true); // released off the chart
    globalThis.addEventListener?.("pointercancel", letGo, true);
    map.on("movestart", (e) => {
      if (e.originalEvent) this.gesture = true;
      if (!e.follow) this.glideBearing = this.glidePitch = null; // someone else moved the chart: our ease is over
    });
    map.on("moveend", (e) => { if (!e.follow) this.gesture = false; }); // our own jumps do not end a gesture
    map.on("zoomend", (e) => { // the pilot zoomed; W31 navview: in flight his zoom wins until he recentres
      if (e.originalEvent && this.auto !== null) { this.pinched = true; this.shown = null; }
      if (e.originalEvent || !e.follow) this.zoom = map.getZoom();
    });
    // A drag lets go of the ship. Two fingers moving together are a pinch, which keeps following.
    map.on("dragstart", (e) => { if (!(e.originalEvent?.touches?.length > 1)) this.setMode("free"); });
    map.on("rotatestart", (e) => { if (e.originalEvent && this.mode === "heading") this.setMode("follow", { move: false }); });
    // Two fingers moving together, their spread steady, pan the chart: that lets go of the ship too
    // (W12 UX item 14). Once the spread changes it is a pinch, which keeps following. With pitch on, a
    // parallel move up or down is a tilt, decided once, as MapLibre decides it (it then blocks the pan).
    for (const ev of ["touchstart", "touchend", "touchcancel"]) map.on(ev, (e) => { this.two = twoFingers(e.originalEvent); });
    map.on("touchmove", (e) => {
      const now = twoFingers(e.originalEvent), was = this.two;
      if (!now || !was) { this.two = now; return; }
      if (was.pinch || Math.abs(now.d / was.d - 1) > 0.1) { was.pinch = true; return; }
      const dx = now.x - was.x, dy = now.y - was.y;
      if (Math.hypot(dx, dy) < 30 || this.mode === "free") return;
      was.pinch = true; // decided: a tilt or a pan, for the rest of this gesture
      if (map.getMaxPitch?.() > 0 && map.touchPitch?.isEnabled?.() && Math.abs(dy) > Math.abs(dx)) return;
      this.setMode("free");
    });
  }

  /** Following, in either mode. */
  get on() { return this.mode !== "free"; }

  /** Is the camera free to jump? Not while touched, nor during a pinch, a wheel zoom, a drag, or a glide (its own, or a
   *  sheet's: a jump would cut it short; W29 polish). */
  get free() { return !this.held && !this.gesture && !this.map.isZooming() && !this.map.isEasing?.() && Date.now() >= this.glideEnd; }

  /** W31 navview: the road's zoom drives the camera (following, in flight, with no pinch since the last recentre). */
  get autoOn() { return this.auto !== null && !this.pinched && this.mode !== "free"; }
  /** W31 navview: the camera still easing to the road's zoom, so the frame loop keeps calling update(). */
  get settling() { return this.autoOn && this.shown !== this.auto; }
  /** W31 navview: the zoom the road asks for, or null to leave the zoom to the pilot, where it is now. The first glides there. */
  setAuto(z) {
    const was = this.auto;
    if (z === null && was !== null) { this.zoom = this.map.getZoom(); this.shown = null; this.pinched = false; }
    this.auto = z;
    if (was === null && this.autoOn && this.last && this.free) this.glide({ center: this.last }); // the first: glide there
  }

  /**
   * Change mode. Following (again) moves the camera onto the ship with an ease; heading mode also turns
   * the chart to the heading. move: false changes only the mode.
   */
  setMode(mode, { move = true } = {}) {
    if (!CAMERA_MODES.includes(mode) || mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    if (mode !== "free" && move) this.pinched = false; // W31 navview: a recentre brings the road's zoom back
    const pitch = this.tilt && mode !== "free" ? (mode === "heading" ? this.tilt : 0) : undefined;
    if (mode !== "free" && move && this.last) {
      const opts = { center: this.last };
      if (mode === "heading") opts.bearing = this.bearing = this.heading;
      if (pitch !== undefined) opts.pitch = pitch;
      this.glide(opts);
    } else if (pitch !== undefined && move) this.glidePitch = pitch; // no ship yet: the first jump tilts
    this.onmode?.(mode, was);
  }

  /** Move the camera with an ease, in Calm and with the phone's reduced motion too (W29 polish), over glideMs of its turn. */
  glide(opts) {
    const padding = this.repad();
    if (padding && !opts.padding) opts = { ...opts, padding }; // W26 relief
    if (opts.center && opts.zoom === undefined && this.autoOn) { opts = { ...opts, zoom: this.auto }; this.shown = this.auto; } // W31 navview: onto the ship at the road's zoom
    if (!this.map.easeTo) return this.map.jumpTo(opts, { follow: true });
    const dz = opts.zoom === undefined ? 0 : Math.abs(opts.zoom - this.map.getZoom()) * 60; // W31 navview: a zoom level glides as long as 60°
    const ms = glideMs(Math.max(dz, turned(opts.bearing, this.map.getBearing?.()), turned(opts.pitch, this.map.getPitch?.())));
    this.glideEnd = Date.now() + ms + 60;
    this.glideBearing = opts.bearing ?? null;
    this.glidePitch = opts.pitch ?? null;
    this.map.easeTo({ ...opts, duration: ms, easing: easeOut, essential: true }, { follow: true }); // essential: MapLibre jumps for reduced motion otherwise
  }

  /** W26 relief: the padding the mode wants, when the map's differs from it, else null. */
  repad() {
    const want = this.mode !== "free" && this.map.getPadding ? this.padding?.(this.mode) : null;
    return want && !samePadding(this.map.getPadding(), want) ? want : null;
  }

  /**
   * The location button: free → follow → heading → follow, north up → heading. From heading it eases to
   * north up, as Google's compass mode does, so the button's "north up" holds. Only a drag lets go.
   */
  cycle() {
    this.pinched = false; // W31 navview: the location button recentres, with the road's zoom
    if (this.mode === "heading") this.northUp();
    else this.setMode(this.mode === "follow" ? "heading" : "follow");
  }

  /** The compass: north up and flat. Heading mode becomes follow; a free chart stays free. */
  northUp() {
    if (this.mode === "heading") this.setMode("follow", { move: false });
    const opts = { bearing: 0, pitch: 0 };
    if (this.on && this.last) opts.center = this.last;
    this.glide(opts);
  }

  /** Turn following on (heading-up) or off, at once, even when paused (prototype-14). */
  set(on) {
    const was = this.mode;
    this.mode = on ? "heading" : "free";
    if (on && this.last) this.map.jumpTo({ center: this.last, bearing: this.bearing }, { follow: true });
    if (this.mode !== was) this.onmode?.(this.mode, was);
  }

  /**
   * One frame: the ship is at lonlat, heading `heading`; dt is the animation's seconds. Heading mode
   * eases the bearing toward the heading at 2.2/s; follow mode keeps the chart's bearing.
   * lookAt: {m, px} keeps a point m metres away within px pixels (course mode), or null.
   */
  update(lonlat, heading, dt, lookAt = null) {
    this.last = lonlat;
    this.heading = heading;
    const d = ((heading - this.bearing + 540) % 360) - 180;
    this.bearing = (this.bearing + d * Math.min(1, dt * 2.2) + 360) % 360;
    if (this.mode === "free" || !this.free) return false;
    const opts = { center: lonlat };
    if (this.mode === "heading") opts.bearing = this.bearing;
    else if (this.glideBearing !== null) opts.bearing = this.glideBearing; // where our ease was going
    if (this.glidePitch !== null) opts.pitch = this.glidePitch;
    this.glideBearing = this.glidePitch = null;
    const auto = this.autoOn; // W31 navview: the road's zoom, eased slowly (AUTO)
    const want = auto ? this.auto : lookAt ? fitZoom(lookAt.m, lonlat[1], lookAt.px, this.zoom) : this.zoom;
    const padding = this.repad(); // W26 relief: a mode changed in a gesture, or an ease cut short: ease the rest
    if (auto || lookAt || (this.shown !== null && Math.abs(this.shown - this.zoom) > 0.001)) {
      const from = this.shown ?? this.map.getZoom();
      const step = auto ? (want - from) * (1 - Math.exp(-dt / AUTO.ease_s)) : (want - from) * Math.min(1, dt * 1.5);
      this.shown = from + (auto ? Math.max(-AUTO.rate * dt, Math.min(AUTO.rate * dt, step)) : step);
      if (Math.abs(this.shown - want) < 0.005) this.shown = want;
      opts.zoom = this.shown;
      if (!lookAt && !auto && this.shown === this.zoom) this.shown = null;
    }
    if (padding) this.glide({ ...opts, padding }); else this.map.jumpTo(opts, { follow: true });
    return true;
  }
}
