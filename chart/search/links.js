// W67 places (design/app-ui/SPEC.md §97): a map link or coordinates, read on the phone, with no request to anyone. Pure,
// for a page, a worker and Node (chart/tests/links.test.mjs, on real links' shapes).
//
//   parseLink(text, inside)  null: neither a link nor coordinates (search the words as usual), else
//                    { lonlat: [lon, lat] | null, name: string | null, zoom: number | null, from }
//                    W73 plan: inside(lonlat), the chart's region, if given: bare coordinates written longitude first
//                    (GeoJSON's order) are read that way when only that order lands in it
//
// `from` says what it read: "geo", "google", "apple", "osm", "waze", "bing" (W73 plan), "coords", "short" (maps.app.goo.gl, goo.gl/maps,
// maps.apple/p: only their host can open them) or "other" (a link with no place in it). With no lonlat, a name is
// what to search for; with neither, there is nothing to find. Shared text around a link ("Artisan's Asylum\n
// https://maps.app.goo.gl/…") is the name when the link has none.
//
// It reads geo: URIs (RFC 5870 and Android's ?q=lat,lon(label)); Google's /place/, /search/ and /dir/ paths, its
// !3d…!4d… pin, ?q=, ?query=, ?ll=, ?daddr= and ?destination=, and @lat,lon,17z (the view's centre, last); Apple's
// ?ll=, ?coordinate=, ?q=, ?name=, ?address= and ?daddr=; OSM's ?mlat=&mlon= and #map=z/lat/lon; and bare decimal,
// degree-minute and degree-minute-second coordinates, with or without N/S/E/W. W73 plan: and coordinates in brackets,
// OSM's directions (?route=a;b, its end), Waze's ?ll= and ?to=ll.lat,lon, and Bing's ?cp=lat~lon.

const NUM = /^[+-]?\d{1,3}(?:\.\d+)?$/;
const URL_RE = /\bgeo:[^\s<>"(]+(?:\([^)]*\))?|\bhttps?:\/\/[^\s<>"]+|\b(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\/p)\/[^\s<>"]+/i; // a geo: label may have spaces: "(Fort Antwerp)"
const BARE_HOST = /^(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com|(?:www\.)?openstreetmap\.org|osm\.org|waze\.com|bing\.com\/maps)\b/i; // W73 plan: waze, bing
const SHORT = /^(?:maps\.app\.goo\.gl|goo\.gl|maps\.apple)$/i;

const ok = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const round = (v) => Math.round(v * 1e6) / 1e6;
const at = (lat, lon) => (ok(lat, lon) ? [round(lon), round(lat)] : null);
const clean = (s) => { const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return t ? t.slice(0, 120) : null; };
const decode = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch { return String(s); } };

/**
 * Coordinates alone: "42.3596, -71.1395", "42.3596 -71.1395", "42.3596° N, 71.1395° W", "42°21'34.6\"N 71°08'22.1\"W",
 * "N 42° 21.576' W 71° 8.368'", "42 21 34.6 N 71 8 22.1 W". Latitude first, as every map app writes it, unless N/S/E/W
 * say otherwise. Two bare whole numbers ("12 34") are not coordinates: one needs a decimal, a unit or a letter.
 * Returns [lon, lat] or null.
 */
export function parseCoords(text) {
  const s = String(text ?? "").normalize("NFKC").replace(/[′’‘`´]/g, "'").replace(/[″”“]/g, "\"").replace(/''/g, "\"").toUpperCase().trim()
    .replace(/^[([]([^()[\]]*)[)\]]$/, "$1").trim(); // W73 plan: "(42.3596, -71.1395)", "[-71.1395, 42.3596]"; no lazy group between two \s*, which took cubic time
  if (!s || s.length > 80 || /[^0-9NSEW°'".,;+\-\s]/.test(s) || !/\d/.test(s)) return null;
  const toks = s.match(/\d+(?:\.\d+)?|[NSEW°'",;+-]/g) || [];
  const groups = [];
  let g = null, cue = false; // cue: a decimal, a unit or a letter somewhere
  const open = () => (g ??= { nums: [], units: [], sign: 1, hemi: null });
  const close = () => { if (g?.nums.length) groups.push(g); g = null; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "," || t === ";") close();
    else if (t === "-" || t === "+") { close(); open().sign = t === "-" ? -1 : 1; }
    else if ("NSEW".includes(t)) { cue = true; if (g?.nums.length && !g.hemi) { g.hemi = t; close(); } else { if (g?.nums.length) close(); open().hemi = t; } } // after its numbers, or before them
    else if ("°'\"".includes(t)) { cue = true; if (!g?.nums.length || g.units[g.nums.length - 1]) return null; g.units[g.nums.length - 1] = t; }
    else { // a number
      const last = g?.nums.length ? g.nums.length - 1 : -1;
      if (g && (g.nums.length === 3 || (last >= 0 && /\./.test(g.raw[last]) && !g.units[last]) || g.units[last] === "\"")) close();
      open();
      (g.raw ??= []).push(t);
      g.nums.push(Number(t));
      if (t.includes(".")) cue = true;
    }
  }
  close();
  if (groups.length !== 2 || !cue) return null;
  const value = (gr) => {
    const [d, m = 0, sec = 0] = gr.nums, n = gr.nums.length;
    if (n > 1 && (m >= 60 || sec >= 60 || (n > 1 && /\./.test(gr.raw[0])) || (n > 2 && /\./.test(gr.raw[1])))) return NaN; // 21.5' then 30": not a reading
    const order = { "°": 0, "'": 1, "\"": 2 };
    for (let i = 0; i < n; i++) if (gr.units[i] && order[gr.units[i]] !== i) return NaN;
    const v = d + m / 60 + sec / 3600, neg = gr.sign < 0 || gr.hemi === "S" || gr.hemi === "W";
    return neg ? -v : v;
  };
  let [a, b] = groups;
  if ((a.hemi === "E" || a.hemi === "W") || (b.hemi === "N" || b.hemi === "S")) [a, b] = [b, a];
  if ((a.hemi && b.hemi && (a.hemi === "E" || a.hemi === "W") === (b.hemi === "E" || b.hemi === "W"))) return null; // N and S, or E and W
  const lat = value(a), lon = value(b);
  return at(lat, lon);
}

/** "42.3596,-71.1395" (and "42.3596,-71.1395,17z"): [lon, lat] for the first two numbers, or null. */
const pair = (s) => {
  const p = decode(s ?? "").split(",").map((x) => x.trim());
  return p.length >= 2 && NUM.test(p[0]) && NUM.test(p[1]) ? at(+p[0], +p[1]) : null;
};
/** A value that is coordinates in any of parseCoords' shapes, else null. */
const coords = (s) => (s ? pair(s) ?? parseCoords(decode(s)) : null);

function geoUri(u) {
  const body = u.slice(4), [path, query = ""] = body.split("?"), q = new URLSearchParams(query);
  let lonlat = pair(path.split(";")[0]), name = null;
  const z = Number(q.get("z"));
  const qq = q.get("q");
  if (qq) {
    const m = /^\s*([^()]*?)\s*(?:\((.*)\))?\s*$/.exec(qq) || [];
    const ll = coords(m[1]);
    if (ll) { lonlat = ll; name = clean(m[2]); } else name = clean(qq.replace(/\(.*\)$/, "")) || clean(m[2]);
  }
  return { lonlat, name, zoom: Number.isFinite(z) && z > 0 ? z : null, from: "geo" };
}

function google(url) {
  const q = url.searchParams, path = decode(url.pathname), href = url.href;
  let lonlat = null, name = null, zoom = null;
  const pins = [...href.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)]; // the place's own pin, in the data blob
  if (pins.length) lonlat = at(+pins.at(-1)[1], +pins.at(-1)[2]);
  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(path), dir = /\/maps\/dir\//.test(path);
  if (view?.[3]) zoom = +view[3];
  const segs = path.split("/").filter(Boolean), i = segs.findIndex((s) => s === "place" || s === "search" || s === "dir");
  if (i >= 0) {
    const ends = segs.slice(i + 1).filter((s) => !s.startsWith("@") && !s.startsWith("data=") && s !== "am=t");
    const end = segs[i] === "dir" ? ends.at(-1) : ends[0]; // a route's last stop is where it goes
    if (end) { const ll = coords(end); if (ll) lonlat ??= ll; else name = clean(end); }
    const stops = dir ? [...href.matchAll(/!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g)] : []; // a route's named stops, lon then lat
    if (dir && name && stops.length) lonlat ??= at(+stops.at(-1)[2], +stops.at(-1)[1]);
  }
  for (const k of ["destination", "daddr", "q", "query", "ll", "center"]) {
    const v = q.get(k);
    if (!v) continue;
    const ll = coords(v);
    if (ll) lonlat ??= ll; else if (k !== "ll" && k !== "center") name ??= clean(v);
  }
  if (!lonlat && view && !dir) lonlat = at(+view[1], +view[2]); // the view's centre: a place link's is the place, near enough; a route's is not
  return { lonlat, name, zoom, from: "google" };
}

function apple(url) {
  const q = url.searchParams;
  let lonlat = null, name = clean(q.get("name"));
  for (const k of ["coordinate", "ll", "daddr", "q", "center"]) { const ll = coords(q.get(k)); if (ll) { lonlat = ll; break; } }
  for (const k of ["q", "address", "daddr"]) { const v = q.get(k); if (v && !coords(v)) { name ??= clean(v); } }
  const z = Number(q.get("z"));
  return { lonlat, name, zoom: Number.isFinite(z) && z > 0 ? z : null, from: "apple" };
}

function osm(url) {
  const q = url.searchParams, m = /map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
  const pin = q.get("mlat") && q.get("mlon") ? at(+q.get("mlat"), +q.get("mlon")) : url.pathname.startsWith("/directions") ? pair(q.get("route")?.split(";").at(-1)) : null; // W73 plan: directions, to their end
  return { lonlat: pin ?? (m ? at(+m[2], +m[3]) : null), name: null, zoom: m ? +m[1] : null, from: "osm" };
}

/** W73 plan: Waze's ?ll=lat,lon (its share links) or ?to=ll.lat,lon (its live map's), else ?q= as the name. */
function waze(url) {
  const q = url.searchParams, ll = coords(q.get("ll")) ?? coords(q.get("to")?.replace(/^ll\./, ""));
  const z = Number(q.get("zoom") ?? q.get("z"));
  return { lonlat: ll, name: ll ? null : clean(q.get("q")), zoom: Number.isFinite(z) && z > 0 ? z : null, from: "waze" };
}
/** W73 plan: Bing's ?cp=lat~lon&lvl=z, else ?q= as the name. */
function bing(url) {
  const q = url.searchParams, ll = coords(q.get("cp")?.replace("~", ",")), z = Number(q.get("lvl"));
  return { lonlat: ll, name: ll ? null : clean(q.get("q")), zoom: Number.isFinite(z) && z > 0 ? z : null, from: "bing" };
}

/** A link's place, from its host's shapes. */
function readUrl(raw) {
  if (/^geo:/i.test(raw)) return geoUri(raw);
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { lonlat: null, name: null, zoom: null, from: "other" }; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (SHORT.test(host) && (host !== "goo.gl" || url.pathname.startsWith("/maps")) && !(host === "maps.apple" && !url.pathname.startsWith("/p"))) return { lonlat: null, name: null, zoom: null, from: "short" };
  if (/^(?:maps\.)?google\.[a-z.]+$/.test(host) && (host.startsWith("maps.") || url.pathname.startsWith("/maps"))) return google(url);
  if (host === "maps.apple.com" || host === "maps.apple") { const r = apple(url); return r.lonlat || r.name ? r : { ...r, from: "short" }; } // an Apple place id: only Apple can read it
  if (host === "openstreetmap.org" || host === "osm.org") return osm(url);
  if (host === "waze.com" || host === "ul.waze.com") return waze(url); // W73 plan
  if (host === "bing.com" && url.pathname.startsWith("/maps")) return bing(url); // W73 plan
  return { lonlat: null, name: null, zoom: null, from: "other" };
}

/** What a pasted or shared text points at (see the header), or null when it is neither a link nor coordinates. */
export function parseLink(text, inside = null) { // W73 plan: inside
  const s = String(text ?? "").trim();
  if (!s) return null;
  const ll = parseCoords(s), swap = ll && inside && !/[NSEW]/i.test(s) && !inside(ll) && at(ll[0], ll[1]); // W73 plan: longitude first, unless N/S/E/W say which is which
  if (ll) return { lonlat: swap && inside(swap) ? swap : ll, name: null, zoom: null, from: "coords" }; // W73 plan: swap
  let m = URL_RE.exec(s), raw = m?.[0];
  if (!raw && BARE_HOST.test(s)) raw = s.split(/\s/)[0];
  if (!raw) return null;
  while (/[.,;!?]$/.test(raw)) raw = raw.slice(0, -1); // the sentence's own full stop; W73 plan: a loop, as an anchored + took quadratic time
  if (raw.endsWith(")") && !raw.includes("(")) raw = raw.slice(0, -1); // "(https://…)"
  const r = readUrl(raw);
  if (!r.name) { // the shared text around the link: Google's "Name\nhttps://maps.app.goo.gl/…"
    let around = s.replace(m?.[0] ?? raw, " ").trimEnd(); // W73 plan: trimEnd and one character, as an anchored \s* took quadratic time
    if (/[-–|:]$/.test(around)) around = around.slice(0, -1); // W73 plan
    around = clean(around); // W73 plan
    if (around && /\p{L}/u.test(around) && !/^https?:/i.test(around)) r.name = around;
  }
  return r;
}
