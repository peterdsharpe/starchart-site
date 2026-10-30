// The phone's compass, from the browser's orientation events (scratch/research/R7-sensors.md §1).
//   iOS Safari:      deviceorientation's webkitCompassHeading and webkitCompassAccuracy, after
//                    DeviceOrientationEvent.requestPermission() from a tap
//   Chrome Android:  deviceorientationabsolute (alpha, beta and gamma against the Earth's frame)
//   elsewhere:       deviceorientation, only when the event says it is absolute
// Every reading is the heading of the way the rider faces, in degrees clockwise from magnetic
// north. The platform claims here are unverified; app/dev/pose.html shows the raw values so a
// device test can check them.

const RAD = Math.PI / 180;
const wrap = (d) => ((d % 360) + 360) % 360;

/**
 * The heading of a phone's forward direction, from its W3C orientation angles (degrees), for any
 * mount: the sum of the screen's up vector and the back camera's axis, projected onto the ground.
 * Flat on a table, that is where the top of the screen points; upright on a handlebar, it is where
 * the back camera looks (the rotation matrix, not raw alpha, so beta near 90° is fine).
 * `screenAngle` is screen.orientation.angle: 90 when the screen is turned so the phone's right
 * edge is up. Returns null when the phone faces straight down or up and has no forward.
 */
export function forwardHeading(alpha, beta, gamma, screenAngle = 0) {
  if (alpha == null || beta == null || gamma == null) return null;
  const ca = Math.cos(alpha * RAD), sa = Math.sin(alpha * RAD);
  const cb = Math.cos(beta * RAD), sb = Math.sin(beta * RAD);
  const cg = Math.cos(gamma * RAD), sg = Math.sin(gamma * RAD);
  // R = Rz(alpha) Rx(beta) Ry(gamma) takes the device frame to (east, north, up). We need its
  // first two rows only, applied to f = screen up + back camera = (sin θ, cos θ, -1).
  const fx = Math.sin(screenAngle * RAD), fy = Math.cos(screenAngle * RAD), fz = -1;
  const r00 = ca * cg - sa * sb * sg, r01 = -sa * cb, r02 = ca * sg + sa * sb * cg;
  const r10 = sa * cg + ca * sb * sg, r11 = ca * cb, r12 = sa * sg - ca * sb * cg;
  const east = r00 * fx + r01 * fy + r02 * fz, north = r10 * fx + r11 * fy + r12 * fz;
  if (Math.hypot(east, north) < 0.2) return null;
  return wrap(Math.atan2(east, north) / RAD);
}

/** The screen's rotation in degrees (0, 90, 180, 270). */
export function screenAngle(win = globalThis) {
  const a = win.screen?.orientation?.angle ?? win.orientation ?? 0;
  return wrap(+a || 0);
}

/**
 * A magnetic heading from one orientation event, or null if the event has none.
 * {magnetic, accuracy, kind}: accuracy is in degrees (iOS only; -1 means uncalibrated), else null.
 */
export function readingFrom(e, angle = 0) {
  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) {
    // iOS: the direction of the top of the phone. The landscape correction's sign is unverified.
    const acc = typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null;
    return { magnetic: wrap(e.webkitCompassHeading + angle), accuracy: acc, kind: "webkit" };
  }
  if (e.type === "deviceorientationabsolute" || e.absolute === true) {
    const h = forwardHeading(e.alpha, e.beta, e.gamma, angle);
    return h === null ? null : { magnetic: h, accuracy: null, kind: "absolute" };
  }
  return null;
}

/**
 * The compass as a sensor. onReading({magnetic, accuracy, t, kind}); onStatus(status), with status
 * "ok" | "needs-permission" | "denied" | "unavailable" | "uncalibrated".
 * Call requestPermission() first thing in a tap handler (iOS asks then), then start().
 */
export function compassSensor({ win = globalThis, now = () => performance.now(), onReading = () => {}, onStatus = () => {}, quietMs = 3000 } = {}) {
  const DOE = win.DeviceOrientationEvent;
  const askFirst = typeof DOE?.requestPermission === "function";
  let status = !DOE ? "unavailable" : askFirst ? "needs-permission" : "unavailable";
  let on = false, granted = !askFirst, timer = null, last = null;
  const raw = { alpha: null, beta: null, gamma: null, webkit: null, webkitAccuracy: null, absolute: null, type: null, angle: 0 };
  const set = (s) => { if (s !== status) { status = s; onStatus(s); } };
  const handle = (e) => {
    const angle = screenAngle(win);
    Object.assign(raw, { alpha: e.alpha, beta: e.beta, gamma: e.gamma, webkit: e.webkitCompassHeading ?? null,
      webkitAccuracy: e.webkitCompassAccuracy ?? null, absolute: e.absolute ?? null, type: e.type, angle });
    const r = readingFrom(e, angle);
    if (!r) return;
    last = now();
    r.t = last;
    set(r.accuracy !== null && r.accuracy < 0 ? "uncalibrated" : "ok");
    onReading(r);
  };
  return {
    get status() { return status; },
    raw,
    /** Ask for motion permission (iOS). Call it synchronously from the tap. Resolves true if granted. */
    requestPermission() {
      if (!askFirst) return Promise.resolve(!!DOE);
      let asked;
      try { asked = DOE.requestPermission(); } catch (e) { asked = Promise.reject(e); } // now, inside the tap
      return Promise.resolve(asked).then((r) => {
        granted = r === "granted";
        set(granted ? "unavailable" : "denied"); // "ok" once the first reading arrives
        return granted;
      }, () => { set("denied"); return false; });
    },
    start() {
      if (on || !DOE || !granted) return;
      on = true;
      win.addEventListener("deviceorientationabsolute", handle, true); // Chrome on Android; harmless elsewhere
      win.addEventListener("deviceorientation", handle, true);
      // no reading for a while: no compass here (desktop browsers have the events but never fire them)
      timer = setInterval(() => { if (status === "ok" && (last === null || now() - last > quietMs)) set("unavailable"); }, quietMs);
      timer?.unref?.(); // in Node (tests), the check does not keep the process alive
    },
    stop() {
      if (!on) return;
      on = false;
      win.removeEventListener("deviceorientationabsolute", handle, true);
      win.removeEventListener("deviceorientation", handle, true);
      clearInterval(timer);
    },
  };
}
