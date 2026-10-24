// W54 course (design/app-ui/SPEC.md §69): a course as a link, and back. Pure functions, for Node's tests.
//
//   https://<site>/#course=<from>;<via>;…;<to>;<style>;g<graph>
//
// Each point is "lat,lon" at 5 decimals (about a metre), the style is a route style's id, and g… is the first 8 hex of
// the routing graph's SHA-256, so a receiver can say when its graph differs. The part after # never reaches the host.

import { STYLE_CARDS } from "./course-logic.js";
import qrcodegen from "../chart/vendor/qrcodegen.mjs";
import { pick } from "./lingo-mode.js"; // W60 b
import { dur } from "./duration.js"; // W68 fixes
import { linkPart, readLinkPart, LINK_MAX } from "./avoid-logic.js"; // W73 avoid: ;x<lat>,<lon>,<name> for each street it goes round

export const KEY = "course";
const ll = ([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
/** The graph's version in a link: the first 8 hex of its SHA-256 ("" without one). */
export const graphTag = (sha) => (sha ? `g${String(sha).slice(0, 8)}` : "");

/** The link for a course from `from` through `via` to `to` ([lon, lat] each) in `style`, on the site at `base`. */
export function courseLink(base, { from, via = [], to, style, graph = "", avoid = [] }) { // W73 avoid: avoid
  const parts = [from, ...via, to].map(ll);
  parts.push(style);
  parts.push(...avoid.slice(0, LINK_MAX).map(linkPart)); // W73 avoid
  if (graph) parts.push(graphTag(graph));
  return `${String(base).split("#")[0]}#${KEY}=${parts.join(";")}`;
}

export const MAX_POINTS = 40; // W73 plan: From, 38 stops and To (was 12, under a route file's 8 vias and a few stops); a link of 40 is under 1 kB
/** A link's hash ("#course=…") as { from, via, to, style, graph }, or null when it isn't a course. W73 plan: { tooMany }, the
 *  points of a course past MAX_POINTS, so the receiver can say why nothing opens. */
export function parseCourse(hash) {
  const m = /^#?course=(.+)$/.exec(String(hash || "").trim());
  if (!m) return null;
  let parts;
  try { parts = decodeURIComponent(m[1]).split(";").filter(Boolean); } catch { return null; }
  const graph = /^g[0-9a-f]{4,64}$/i.test(parts.at(-1) || "") ? parts.pop().slice(1).toLowerCase() : "";
  const avoid = []; // W73 avoid
  while (/^x/.test(parts.at(-1) || "")) { const a = readLinkPart(parts.pop()); if (!a) return null; if (avoid.length < LINK_MAX) avoid.unshift(a); } // W73 avoid
  const style = STYLE_CARDS.some((st) => st.id === parts.at(-1)) ? parts.pop() : "wormhole";
  const pts = [];
  for (const p of parts) {
    const [lat, lon, extra] = p.split(",").map((v) => (v.trim() ? Number(v) : NaN)); // W73 plan: an empty number is no 0
    if (extra !== undefined || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    pts.push([lon, lat]);
  }
  if (pts.length < 2) return null;
  if (pts.length > MAX_POINTS) return { tooMany: pts.length }; // W73 plan
  return { from: pts[0], via: pts.slice(1, -1), to: pts.at(-1), style, graph, ...(avoid.length ? { avoid } : {}) }; // W73 avoid: avoid, when it has any
}

/** Whether a link's graph and this phone's differ ("" on either side: not known, so not said). */
export const graphDiffers = (link, sha) => !!link && !!sha && !String(sha).toLowerCase().startsWith(link);

// W67 places (SPEC §97): one pin, https://<site>/#pin=<lat>,<lon>;<name>. The name is the place's own (encoded), and a
// pin dropped on the chart sends none, so the receiver names it as its own pin would (the nearest street, in its words).
export const PIN = "pin"; // W67 places
/** The link for one place at `lonlat`, named `name` (none for a bare pin), on the site at `base`. */
export function pinLink(base, { lonlat, name = "" }) { // W67 places
  const n = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80); // W67 places
  return `${String(base).split("#")[0]}#${PIN}=${ll(lonlat)}${n ? `;${encodeURIComponent(n)}` : ""}`; // W67 places
} // W67 places
/** A link's hash ("#pin=…") as { lonlat, name } (name "" for a bare pin), or null when it isn't one. */
export function parsePin(hash) { // W67 places
  const m = /^#?pin=([^;]+)(?:;(.*))?$/.exec(String(hash || "").trim()); // W67 places
  if (!m) return null; // W67 places
  const p = m[1].split(",").map((v) => (v.trim() ? Number(v) : NaN)); // W67 places; W73 plan: an empty number is no 0
  if (p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return null; // W67 places
  let name = ""; // W67 places
  try { name = decodeURIComponent(m[2] || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); } catch { return null; } // W67 places
  return { lonlat: [p[1], p[0]], name }; // W67 places
} // W67 places

/** The QR view's line: "COURSE TO FORT ANTWERP · 3.0 LY · 14 MIN" (the turn card's foot, in capitals by its style). */
export const qrLine = (name, metres, min) => pick(`Course to ${name} · ${(metres / 1609.344).toFixed(1)} LY · ${dur(min)}`, `Route to ${name} · ${(metres / 1609.344).toFixed(1)} mi · ${dur(min)}`); // W60 b: Plain's; W68 fixes: dur

/** The QR of `text` (error correction M) as rows of "1" (dark) and "0"; `mask` -1 lets the encoder choose. */
export function qrRows(text, mask = -1) {
  const { QrCode, QrSegment } = qrcodegen, q = QrCode.encodeSegments(QrSegment.makeSegments(text), QrCode.Ecc.MEDIUM, 1, 40, mask, false);
  return Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => (q.getModule(x, y) ? "1" : "0")).join(""));
}
/** The QR as one SVG path of its dark modules, with the 4-module quiet zone the standard asks for: { d, n } (n × n). */
export function qrPath(rows) {
  const n = rows.length + 8;
  let d = "";
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === "1") { let w = 1; while (r[x + w] === "1") w++; d += `M${x + 4},${y + 4}h${w}v1h-${w}z`; x += w - 1; } });
  return { d, n };
}
