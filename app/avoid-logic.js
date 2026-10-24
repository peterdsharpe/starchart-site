// W73 avoid (design/app-ui/SPEC.md §118): the streets a pilot avoids, kept pure so Node can test them. app/avoid.js keeps
// the list in storage and draws Settings' row; app/course.js offers Avoid on a street's peek and on a hold of the course
// in flight, sends the list with every route, and says "1 starpath avoided" on the preview; the router
// (chart/routing/router.js routeAvoiding) makes their edges dearer.
//
// The list is localStorage "starchart.avoid": streets as { name, kind, lonlat }, newest first. A street is its OSM name
// and a point on it, never an edge or way id, so it outlives the weekly graph: the router finds the street of that name
// at the point on whatever graph the phone has, and one it can't find stays in the list, marked `missing`.

export const KEY = "starchart.avoid";
export const MAX = 50; // the list's length: an older street drops off the end
export const LINK_MAX = 12; // a shared course carries the streets it bends round, at most this many
const R = 6371008.8, rad = Math.PI / 180;
const metres = (a, b) => { const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad), y = (b[1] - a[1]) * rad; return Math.hypot(x, y) * R; };
export const SAME_M = 150; // the same street: the same name within this (the router's AVOID_M)

export const WORDS = {
  avoidThis: ["Avoid this starpath", "Avoid this street"],
  avoiding: (name) => `Avoiding ${name}`,
  avoided: (n) => (n === 1 ? ["1 starpath avoided", "1 street avoided"] : [`${n} starpaths avoided`, `${n} streets avoided`]),
  list: ["Avoided starpaths", "Avoided streets"], // W88 settings3: `more`, the row's long press, went: its list says how to add one
  remove: (name) => `Remove ${name}`,
  missing: ["not found on this chart", "not found on this map"],
  street: ["Unnamed starpath", "Unnamed street"],
  // W80 avoidmap (SPEC §151): the chart's mark, Settings' list, the preview's line and the old avoid's reminder
  since: (date) => `since ${date}`,
  clearAll: ["Clear all", "Clear all"],
  cleared: (n) => (n === 1 ? ["1 starpath let back in", "1 street let back in"] : [`${n} starpaths let back in`, `${n} streets let back in`]),
  none: ["No starpaths avoided.", "No streets avoided."],
  how: [["Tap a starpath on the chart, then ", "."], ["Tap a street on the map, then ", "."]], // W86 settings: the list's how-to, its ⊘ drawn between (app/avoid.js)
  avoidIcon: "Avoid", // W86 settings: the ⊘'s name, for a screen reader
  stop: ["Stop avoiding", "Stop avoiding"],
  stopped: (name) => `No longer avoiding ${name}`,
  avoidingAll: (names) => (names.length <= 2 ? `Avoiding ${names.join(" and ")}` : `Avoiding ${names[0]} and ${names.length - 1} more`),
  still: (name) => [`Still avoiding ${name}? Settings › Avoided starpaths`, `Still avoiding ${name}? Settings › Avoided streets`],
};
export const OLD_DAYS = 30; // W80 avoidmap: an avoid this old is reminded of once, at its first course after
const DAY = 86400000, MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** W80 avoidmap: when a street was avoided, "3 Oct" (local), with the year when it isn't this year's. */
export function sinceDate(ms, now = Date.now()) {
  const d = new Date(ms), y = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}
/** W80 avoidmap: the list with `now` as `since` on each street that has none (one kept before W80), or null when none lacks it. */
export function stamp(list, now) {
  return list.some((a) => !Number.isFinite(a.since)) ? list.map((a) => (Number.isFinite(a.since) ? a : keep({ ...a, since: now }))) : null;
}
/** W80 avoidmap: the old avoid to remind of for a course that went round `bent`: the first of them, as `list` keeps it,
 *  avoided OLD_DAYS or more before `now` and never reminded of (`told`); else null. */
export function oldAvoid(list, bent, now) {
  for (const b of bent) {
    const a = list.find((x) => sameAvoid(x, b));
    if (a && Number.isFinite(a.since) && now - a.since >= OLD_DAYS * DAY && !a.told) return a;
  }
  return null;
}
/** W80 avoidmap: the list with `a` marked as reminded of. */
export const told = (list, a) => list.map((x) => (sameAvoid(x, a) ? keep({ ...x, told: true }) : x));

/** The same street: the same name (any case) within SAME_M metres. */
export const sameAvoid = (a, b) => !!a?.lonlat && !!b?.lonlat && String(a.name || "").toLowerCase() === String(b.name || "").toLowerCase() && metres(a.lonlat, b.lonlat) <= SAME_M;

/** What the list keeps of a street: its OSM name, its lingo kind, its point (5 decimals, about a metre), and `missing`. */
export const keep = (a) => ({ name: String(a.name || "").slice(0, 120), kind: a.kind || "starpath", lonlat: a.lonlat.map((v) => Math.round(v * 1e5) / 1e5), ...(a.missing ? { missing: true } : {}),
  ...(Number.isFinite(a.since) ? { since: Math.round(a.since) } : {}), ...(a.told ? { told: true } : {}) }); // W80 avoidmap: since, when it was avoided (ms); told, its old avoid's reminder shown

const valid = (a) => a && typeof a.name === "string" && Array.isArray(a.lonlat) && a.lonlat.length === 2 && a.lonlat.every(Number.isFinite) && Math.abs(a.lonlat[0]) <= 180 && Math.abs(a.lonlat[1]) <= 90;
/** The list from storage's text: only streets with a name and a point; anything else is dropped. */
export function readAvoids(text) {
  let v;
  try { v = JSON.parse(text); } catch { return []; }
  return Array.isArray(v) ? v.filter(valid).map(keep).slice(0, MAX) : [];
}

/** The list with `a` first; a street already in it stays where it is. */
export const addAvoid = (list, a, now) => (list.some((x) => sameAvoid(x, a)) ? list : [keep(now != null && !Number.isFinite(a.since) ? { ...a, since: now } : a), ...list].slice(0, MAX)); // W80 avoidmap: now, its since
/** The list without `a`, and what Undo needs: { list, undo } where undo(list) puts it back where it was. */
export function removeAvoid(list, a) {
  const at = list.findIndex((x) => sameAvoid(x, a));
  if (at < 0) return { list, undo: (l) => l };
  const gone = list[at];
  return { list: list.filter((_, i) => i !== at), undo: (l) => (l.some((x) => sameAvoid(x, gone)) ? l : [...l.slice(0, at), gone, ...l.slice(at)]) };
}

/** What the router takes: [{ name, at }]. */
export const forRouter = (list) => list.map((a) => ({ name: a.name, at: a.lonlat }));
/** The streets of `list` a course went round: the router's `avoids` says "bent" for each. */
export const bentOf = (list, avoids = []) => list.filter((_, i) => avoids[i] === "bent");
/** The list again with each street the router looked for marked: `missing` when it found none, unmarked when it did; a
 *  street it didn't look for ("far"), or that wasn't sent, keeps its mark. `avoids` is the router's word for each street
 *  of `sent`, the list as the request had it. Null when nothing changed. */
export function marked(list, avoids = [], sent = list) {
  let changed = false;
  const out = list.map((a) => {
    const s = avoids[sent.findIndex((x) => sameAvoid(x, a))], miss = s === "missing" ? true : s && s !== "far" ? false : !!a.missing;
    if (miss === !!a.missing) return a;
    changed = true;
    return keep({ ...a, missing: miss });
  });
  return changed ? out : null;
}

/** The point of a line (a GeoJSON LineString or MultiLineString geometry) nearest `p`, [lon, lat]; null for none. */
export function nearestPoint(g, p) {
  const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
  const kx = Math.cos(p[1] * rad);
  let best = null, bd = Infinity;
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
    const ax = (l[i][0] - p[0]) * kx, ay = l[i][1] - p[1], vx = (l[i + 1][0] - l[i][0]) * kx, vy = l[i + 1][1] - l[i][1], L2 = vx * vx + vy * vy;
    const u = L2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)) : 0, x = ax + u * vx, y = ay + u * vy, d = x * x + y * y;
    if (d < bd) { bd = d; best = [l[i][0] + u * (l[i + 1][0] - l[i][0]), l[i][1] + u * (l[i + 1][1] - l[i][1])]; }
  }
  if (!best && lines[0]?.length === 1) best = lines[0][0].slice();
  return best && best.map((v) => Math.round(v * 1e6) / 1e6);
}

/** W80 avoidmap: the stretch of `a` the chart marks, from `roads` (GeoJSON line features near it, as world.roadsNear gives
 *  them): the parts of the roads of its name (a bridge's `street`; any case) within `m` metres of its point, as the router
 *  takes it (SPEC §118); an unnamed street is the nearest road within 40 m. A list of lines, [[lon, lat], ...] each. */
export function stretch(roads, a, m = SAME_M) {
  const name = String(a.name || "").toLowerCase(), [lon0, lat0] = a.lonlat, kx = R * rad * Math.cos(lat0 * rad), ky = R * rad;
  const xy = (p) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky], ll = ([x, y]) => [Math.round((lon0 + x / kx) * 1e6) / 1e6, Math.round((lat0 + y / ky) * 1e6) / 1e6];
  const linesOf = (g) => (g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : []);
  const named = (f) => String(f.properties?.street || f.properties?.name || "").toLowerCase() === name;
  const near = (f) => linesOf(f.geometry).some((l) => { const p = nearestPoint({ type: "LineString", coordinates: l }, a.lonlat); return p && metres(p, a.lonlat) <= 40; });
  const pick = name ? roads.filter(named) : roads.filter((f) => !f.properties?.name && near(f)).slice(0, 1);
  const out = [], r2 = m * m;
  for (const f of pick) for (const l of linesOf(f.geometry)) {
    let run = [];
    const end = () => { if (run.length > 1) out.push(run.map(ll)); run = []; };
    for (let i = 0; i + 1 < l.length; i++) {
      const p = xy(l[i]), q = xy(l[i + 1]), dx = q[0] - p[0], dy = q[1] - p[1], A = dx * dx + dy * dy;
      const B = 2 * (p[0] * dx + p[1] * dy), C = p[0] * p[0] + p[1] * p[1] - r2, D = B * B - 4 * A * C; // |p + t(q-p)|² = m²
      if (!A || D <= 0) { end(); continue; }
      const t0 = Math.max(0, (-B - Math.sqrt(D)) / (2 * A)), t1 = Math.min(1, (-B + Math.sqrt(D)) / (2 * A));
      if (t0 >= t1) { end(); continue; }
      const at = (t) => [p[0] + t * dx, p[1] + t * dy];
      if (t0 > 0 || !run.length) { end(); run.push(at(t0)); }
      run.push(at(t1));
      if (t1 < 1) end();
    }
    end();
  }
  return joined(out);
}
/** W80 avoidmap: lines that meet end to end (the tiles cut a street in pieces) as one, so its signs space evenly. */
function joined(lines) {
  const same = (p, q) => Math.abs(p[0] - q[0]) < 2e-6 && Math.abs(p[1] - q[1]) < 2e-6;
  for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines.length; j++) {
    if (i === j) continue;
    const a = lines[i], b = lines[j];
    const ab = same(a.at(-1), b[0]) ? [...a, ...b.slice(1)] : same(a.at(-1), b.at(-1)) ? [...a, ...b.slice(0, -1).reverse()] : same(a[0], b[0]) ? [...a.slice().reverse(), ...b.slice(1)] : null;
    if (!ab) continue;
    lines[i] = ab; lines.splice(j, 1);
    return joined(lines);
  }
  return lines;
}

/** Avoid's glyph: the prohibition sign, a ring and its slash, in the 24-unit line style of the peek's star and share. */
export const AVOID_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M5.9 5.9l12.2 12.2"/></svg>`;

// ---- a shared course's streets (app/share-logic.js): ";x<lat>,<lon>,<name>" each, the name encoded twice, as the hash is
// decoded once before it is split ----
export const linkPart = (a) => `x${a.lonlat[1].toFixed(5)},${a.lonlat[0].toFixed(5)}${a.name ? `,${encodeURIComponent(encodeURIComponent(String(a.name).slice(0, 80)))}` : ""}`;
/** One link part as a street { name, kind, lonlat }, or null when it isn't one. */
export function readLinkPart(p) {
  const m = /^x(-?[\d.]+),(-?[\d.]+)(?:,(.*))?$/.exec(p);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  let name = "";
  try { name = decodeURIComponent(m[3] || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); } catch { return null; }
  return { name, kind: "starpath", lonlat: [lon, lat] };
}
