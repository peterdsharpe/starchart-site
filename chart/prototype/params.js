// URL parameters, checked: a bad value falls back to its default instead of reaching the map as NaN
// (prototype-7), the lingo mode must be one of the three (prototype-15), and the ship is a fleet id or
// a same-origin image, never markup (prototype-1). Shared by chart/prototype/app.js and app/main.js.

export const MODES = ["scul", "cadet", "meatspace"];
export const MODE_LABEL = { scul: "SCUL", cadet: "Cadet", meatspace: "Meatspace" };

/** A finite number from a parameter, clamped to [min, max], or `dflt` when it is missing or not a number. */
export function num(v, dflt, min = -Infinity, max = Infinity) {
  const n = v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

/** `v` if it is one of `list`, else `dflt`. */
export const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

/** "lon,lat" as [lon, lat], or `dflt` unless both are finite and on the globe. */
export function lonlat(v, dflt) {
  const p = String(v ?? "").split(",").map((x) => num(x, NaN));
  return p.length === 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85 ? p : dflt;
}

/** A file id such as a course or a style: lower-case letters, digits and dashes only, else `dflt`. */
export const fileId = (v, dflt) => (/^[a-z0-9][a-z0-9-]{0,63}$/.test(v || "") ? v : dflt);

/**
 * The ship's image: a fleet id from design/ships/sprites/, or an image URL on this page's origin.
 * Anything else gives the default ship. `sprites` is the folder's URL, `page` the page's.
 */
export function shipSrc(v, sprites, page, dflt = "tig-spark-gap") {
  const fleet = (id) => new URL(`${id}-top${id === "tig-spark-gap" ? "-trail" : ""}.svg`, sprites).href;
  if (!v) return fleet(dflt);
  if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) return fleet(v);
  let u;
  try { u = new URL(v, page); } catch { return fleet(dflt); }
  return u.origin === new URL(page).origin && /^https?:$/.test(u.protocol) ? u.href : fleet(dflt);
}
