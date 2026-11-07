// Small-area geometry on lon/lat pairs, in metres and degrees.

const rad = (d) => (d * Math.PI) / 180;

export function metres(a, b) {
  const dy = (b[1] - a[1]) * 111320;
  const dx = (b[0] - a[0]) * 111320 * Math.cos(rad(a[1]));
  return Math.hypot(dx, dy);
}

/** Bearing from a to b, degrees clockwise from north (small-area approximation, the same as metres). */
export function bearing(a, b) {
  const k = Math.cos(rad(a[1]));
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}

/** The point d metres from p along heading h (degrees). */
export function destination(p, h, d) {
  const dy = d * Math.cos(rad(h)), dx = d * Math.sin(rad(h));
  return [p[0] + dx / (111320 * Math.cos(rad(p[1]))), p[1] + dy / 111320];
}

/** The signed difference a - b, in -180..180 degrees. */
export const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;

/** An angle in 0..360 degrees. */
export const wrap360 = (d) => ((d % 360) + 360) % 360;
