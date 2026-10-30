// W67 routefile (SPEC §94): a route file's line, read on the page with a small tag scanner (no DOMParser, so Node tests
// it, and a 5,000-point file takes a few ms, not a long task). What it reads:
//   - GPX: every <trk>'s <trkpt>s (all their segments, in order) or every <rte>'s <rtept>s, whichever has more points
//     (RideWithGPS and Garmin put a few course points in a <rte> beside the dense <trk>); any namespace prefix.
//   - KML: each <LineString>'s <coordinates> and each <gx:Track>'s <gx:coord>s, in the file's order.
//   - GeoJSON: LineString and MultiLineString geometries, in Features, FeatureCollections and GeometryCollections.
// The lines of a file are joined, in order, into one: a track's segments, a file's placemarks.
//
//   parseRoute(text) -> { format: "gpx" | "kml" | "geojson", name, line: [[lon, lat], ...] }, or null (not a route file)

import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json
const { void: VOID, course: CO } = COLOURS.color, HL = COLOURS["color-fixed"].highlight; // W185 colours: the glyphs' void, --course and white highlight
const NUM = (s) => (s == null ? NaN : Number(s));
const ok = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && !(lon === 0 && lat === 0);
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag); return m ? (m[1] ?? m[2]) : null; };
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** W73 plan: `s` without its spans from `a` to `b` (`keep`: with what is between them kept), in one pass: a span left open
 *  ends the search, as a lazy regex's retries from every later opener took quadratic time (a crafted file froze the page). */
const cut = (s, a, b, keep) => { let out = "", i = 0; for (let j; (j = s.indexOf(a, i)) >= 0;) { const k = s.indexOf(b, j + a.length); if (k < 0) break; out += s.slice(i, j) + (keep ? s.slice(j + a.length, k) : ""); i = k + b.length; } return out + s.slice(i); };
const code = (n) => (n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\uFFFD"); // W73 plan: &#x110000; was a throw, and the file did nothing
const text = (s) => cut(s, "<![CDATA[", "]]>", true).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => // W73 plan: cut
  (e[0] === "#" ? code(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()])).trim(); // W73 plan: code
/** The first <name> in `xml`, its text, or null. */
const nameIn = (xml) => { const b = blocks(xml, "name", 1)[0]; return b ? text(b.body) || null : null; }; // W73 plan: blocks, linear
/** The elements `tag` (any prefix; W73 plan: or tags, "a|b") in `xml`, whole, at most `max`: [{ at, end, body }]. W73 plan: each
 *  opener's closer is found once, and a tag with none is skipped after, so a crafted file takes linear time, not quadratic. */
function blocks(xml, tag, max = Infinity) {
  const re = new RegExp(`<(?:[\\w.-]+:)?(${tag})\\b[^<>]*>`, "g"), out = [], open = new Set(), ends = {};
  for (let m; out.length < max && (m = re.exec(xml));) {
    if (open.has(m[1])) continue;
    const end = (ends[m[1]] ??= new RegExp(`</(?:[\\w.-]+:)?${m[1]}>`, "g")); end.lastIndex = re.lastIndex;
    const e = end.exec(xml);
    if (!e) { open.add(m[1]); continue; }
    out.push({ at: m.index, end: end.lastIndex, body: xml.slice(re.lastIndex, e.index) }); re.lastIndex = end.lastIndex;
  }
  return out;
}
/** Every point of the elements `pt` (<trkpt lat lon>, <rtept lat lon>), in order. */
function points(xml, pt) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${pt}\\b([^<>]*)>`, "g"), out = []; // W73 plan: [^<>], linear
  for (let m; (m = re.exec(xml));) { const lon = NUM(attr(m[1], "lon")), lat = NUM(attr(m[1], "lat")); if (ok(lon, lat)) out.push([lon, lat]); }
  return out;
}
/** The same point twice in a row (a segment's end and the next one's start, a paused recorder) is one. */
function joined(lines) {
  const out = [];
  for (const l of lines) for (const p of l) { const q = out.at(-1); if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  return out;
}

function gpx(xml) {
  const trk = blocks(xml, "trk"), rte = blocks(xml, "rte");
  const t = joined(trk.map((b) => points(b.body, "trkpt"))), r = joined(rte.map((b) => points(b.body, "rtept")));
  const useTrk = t.length >= r.length, chosen = useTrk ? trk : rte;
  const meta = blocks(xml, "metadata")[0];
  const own = (xml) => { xml = xml.replace(/<[^<>]*\/>/g, ""); let out = "", i = 0; for (const b of blocks(xml, "author|copyright|link")) { out += xml.slice(i, b.at); i = b.end; } return out + xml.slice(i); }; // a <name> of its own, not its author's; W73 plan: linear
  return { format: "gpx", name: (meta && nameIn(own(meta.body))) || (chosen[0] && nameIn(chosen[0].body.replace(/<(?:[\w.-]+:)?(?:trkseg|rtept)\b[\s\S]*/, ""))) || null, line: useTrk ? t : r };
}

function kml(xml) {
  const lines = [];
  for (const b of blocks(xml, "LineString")) {
    const c = blocks(b.body, "coordinates", 1)[0]; // W73 plan: blocks, linear
    if (c) lines.push({ at: b.at, pts: c.body.trim().split(/\s+/).map((s) => s.split(",").map(Number)).filter(([lon, lat]) => ok(lon, lat)).map(([lon, lat]) => [lon, lat]) });
  }
  for (const b of blocks(xml, "Track")) { // gx:Track's <gx:coord>lon lat alt</gx:coord>
    const pts = [];
    for (const m of b.body.matchAll(/<(?:[\w.-]+:)?coord\b[^<>]*>([^<]*)</g)) { const [lon, lat] = m[1].trim().split(/\s+/).map(Number); if (ok(lon, lat)) pts.push([lon, lat]); }
    lines.push({ at: b.at, pts });
  }
  return { format: "kml", name: nameIn(xml), line: joined(lines.sort((a, b) => a.at - b.at).map((l) => l.pts)) };
}

function geojson(json) {
  const lines = [];
  let name = typeof json?.name === "string" ? json.name : null;
  const walk = (g, props) => {
    if (!g || typeof g !== "object") return;
    if (g.type === "FeatureCollection") return (g.features || []).forEach((f) => walk(f));
    if (g.type === "Feature") { const before = lines.length; walk(g.geometry); if (lines.length > before && !name && typeof g.properties?.name === "string") name = g.properties.name; return; }
    if (g.type === "GeometryCollection") return (g.geometries || []).forEach((x) => walk(x, props));
    const pts = (l) => (Array.isArray(l) ? l.filter((p) => Array.isArray(p) && ok(+p[0], +p[1])).map((p) => [+p[0], +p[1]]) : []);
    if (g.type === "LineString") lines.push(pts(g.coordinates));
    if (g.type === "MultiLineString") for (const l of g.coordinates || []) lines.push(pts(l));
  };
  walk(json);
  return { format: "geojson", name: name?.trim() || null, line: joined(lines) };
}

/** The route in a file's text; null when it isn't a GPX, KML or GeoJSON file with a line of 2 points or more. */
export function parseRoute(src) {
  const s = cut(String(src ?? "").replace(/^\uFEFF/, ""), "<!--", "-->", false); // W73 plan: cut, linear
  let r = null;
  if (/^\s*[{[]/.test(s)) { try { r = geojson(JSON.parse(s)); } catch { return null; } }
  else if (/<(?:[\w.-]+:)?gpx\b/.test(s)) r = gpx(s);
  else if (/<(?:[\w.-]+:)?kml\b/.test(s)) r = kml(s);
  return r && r.line.length >= 2 ? r : null;
}


/** The words of a route file, [SCUL, Plain] (app/lingo-mode.js pick()). */
export const WORDS = {
  open: ["Open a route file", "Open a route file"], // the search's last pick: what a first-time pilot knows a GPX by
  notRoute: ["No route in that file. It takes GPX, KML or GeoJSON.", "No route in that file. It takes GPX, KML or GeoJSON."],
  offChart: ["That route is off the chart. It covers Greater Boston.", "That route is off the map. It covers Greater Boston."],
  strays: [(n) => `Leaves your file in ${n} ${n === 1 ? "place" : "places"}, dashed.`, (n) => `Leaves your file in ${n} ${n === 1 ? "place" : "places"}, dashed.`],
  save: ["Save as GPX", "Save as GPX"], // the share menu's third
  saved: ["GPX saved to Downloads.", "GPX saved to Downloads."],
  again: ["Fly again", "Ride again"], // a flight's page in the Log
};
/** The pick's glyph, drawn here in the chart glyphs' manner (design/glyphs/waypoint.svg: a dark disc in a --course ring, its
 *  highlight arc): a dotted route from a start ring to an end flag. */
export const ROUTE_SVG = `<svg class="rf-ic" viewBox="0 0 64 64" width="36" height="36" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">`
  + `<circle cx="32" cy="32" r="25" stroke="${VOID}" stroke-width="6"/><circle cx="32" cy="32" r="25" fill="${VOID}"/>` // W185 colours
  + `<circle cx="32" cy="32" r="25" stroke="${CO}" stroke-width="3"/><path d="M10.6 22.4A25 25 0 0 1 22.4 10.6" stroke="${HL}" stroke-width="1.6" opacity=".9"/>`
  + `<path d="M21 44C21 35 40 37 40 29S29 24 32 19" stroke="${CO}" stroke-width="3.6" stroke-dasharray="0.1 6.4"/>`
  + `<circle cx="21" cy="45" r="4" stroke="${CO}" stroke-width="3"/><path d="M33 22V12.5L41.5 15.5 33 18.5" fill="${CO}" stroke="${CO}" stroke-width="2"/></svg>`;
/** A point inside the chart's region, the routing graph's [W, S, E, N] (no region known: inside). */
export const inside = (b, p) => !b || (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]);
